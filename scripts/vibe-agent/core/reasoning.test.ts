import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from './client.js';
import { resolveSendReasoning as resolveReasoning } from './reasoning.js';
import type { ExecutorProfiles, ReasoningCapabilities } from '../types.js';
import type { SendProfile } from './executor-profile.js';

const resolveSendReasoning = (profiles: ExecutorProfiles, profile: SendProfile, workspaceId: string) =>
  resolveReasoning(profiles, profile, { id: 'recipient-session', workspace_id: workspaceId, executor: profile.executor, created_at: '', updated_at: '' });

const profiles: ExecutorProfiles = {
  OPENCODE: { DEFAULT: { OPENCODE: { model: 'openai/reasoner' } }, HIGH: { OPENCODE: { model: 'openai/reasoner', variant: 'high' } } },
  CURSOR_AGENT: { DEFAULT: { CURSOR_AGENT: { model: 'sonnet-4.6', reasoning: 'thinking' } } },
};
const profile = { executor: 'OPENCODE' as const, variant: 'DEFAULT', reasoning: 'medium' };
const capabilities: ReasoningCapabilities = {
  model_id: 'openai/reasoner', default_model: 'openai/other',
  models: [
    { id: 'reasoner', provider_id: 'openai', reasoning_options: [{ id: 'medium' }, { id: 'high' }] },
    { id: 'reasoner', provider_id: 'other-provider', reasoning_options: [] },
    { id: 'other', provider_id: 'openai', reasoning_options: [] },
  ],
};
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-reasoning-test-'));
  vi.stubEnv('HOME', directory);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(client, 'getReasoningCapabilities').mockResolvedValue(structuredClone(capabilities));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('reasoning capability validation', () => {
  it('preserves the preset without discovery when no override is requested', async () => {
    expect(await resolveSendReasoning(profiles, { executor: 'OPENCODE', variant: 'DEFAULT' }, 'workspace')).toEqual({});
    expect(client.getReasoningCapabilities).not.toHaveBeenCalled();
  });

  it.each(['MEDIUM', 'HIGH'])('uses the explicit preset model and provider for %s, retaining canonical reasoning IDs', async reasoning => {
    expect(await resolveSendReasoning(profiles, { ...profile, reasoning }, 'workspace')).toEqual({ reasoning_id: reasoning.toLowerCase() });
  });

  it.each([
    ['agent-selected model', { agent: 'reviewer' }],
    ['resumed conversation model', {}],
  ])('does not substitute the global default for an unresolved OpenCode %s', async (_scenario, preset) => {
    const implicitProfiles = { OPENCODE: { DEFAULT: { OPENCODE: preset } } };
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue({ ...capabilities, model_id: null, default_model: 'openai/reasoner' });
    expect(await resolveSendReasoning(implicitProfiles, profile, 'workspace')).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('the OpenCode preset has no explicit model'));
  });

  it('retains default-model discovery for other executors', async () => {
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue({
      model_id: null, default_model: 'sonnet-4.6',
      models: [{ id: 'sonnet-4.6', reasoning_options: [{ id: 'thinking' }] }],
    });
    expect(await resolveSendReasoning({ CURSOR_AGENT: { DEFAULT: { CURSOR_AGENT: {} } } }, {
      executor: 'CURSOR_AGENT', variant: 'DEFAULT', reasoning: 'thinking',
    }, 'workspace')).toEqual({ reasoning_id: 'thinking' });
  });

  it('preserves Cursor thinking when medium is unsupported', async () => {
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue({
      model_id: 'sonnet-4.6', default_model: 'auto',
      models: [{ id: 'sonnet-4.6', reasoning_options: [{ id: 'standard' }, { id: 'thinking' }] }],
    });
    expect(await resolveSendReasoning(profiles, { executor: 'CURSOR_AGENT', variant: 'DEFAULT', reasoning: 'medium' }, 'workspace')).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('available: standard, thinking'));
  });

  it.each([
    { ...capabilities, model_id: 'openai/other' },
    { ...capabilities, model_id: 'unknown-model' },
    { ...capabilities, model_id: null, default_model: null },
    { ...capabilities, model_id: 'reasoner' },
  ])('preserves presets for unsupported or unknown models: %j', async metadata => {
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue(metadata);
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({});
  });

  it('does not trust default-preset discovery for a different command/environment', async () => {
    const custom = { OPENCODE: { ...profiles.OPENCODE, CUSTOM: { OPENCODE: { model: 'openai/reasoner', env: { CUSTOM_PROVIDER: 'secret' } } } } };
    expect(await resolveSendReasoning(custom, { ...profile, variant: 'CUSTOM' }, 'workspace')).toEqual({});
    expect(client.getReasoningCapabilities).not.toHaveBeenCalled();
  });

  it('preserves the preset and retries discovery after an error', async () => {
    vi.mocked(client.getReasoningCapabilities).mockRejectedValueOnce(new Error('timeout'));
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({});
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({ reasoning_id: 'medium' });
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });

  it('does not cache malformed metadata', async () => {
    vi.mocked(client.getReasoningCapabilities).mockResolvedValueOnce({ models: [] } as unknown as ReasoningCapabilities);
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({});
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({ reasoning_id: 'medium' });
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });
});

describe('cross-invocation capability cache', () => {
  it('does not treat a cached OpenCode global default as a verified execution model', async () => {
    const implicitProfiles = { OPENCODE: { DEFAULT: { OPENCODE: { agent: 'reviewer' } } } };
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue({ ...capabilities, model_id: null, default_model: 'openai/reasoner' });
    expect(await resolveSendReasoning(implicitProfiles, profile, 'workspace')).toEqual({});
    // Read the persisted metadata again, without allowing another discovery.
    vi.mocked(client.getReasoningCapabilities).mockRejectedValue(new Error('must use cache'));
    expect(await resolveSendReasoning(implicitProfiles, profile, 'workspace')).toEqual({});
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenLastCalledWith(expect.stringContaining('the OpenCode preset has no explicit model'));
  });

  it('stops overriding after the explicit OpenCode preset model is removed', async () => {
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({ reasoning_id: 'medium' });
    vi.mocked(client.getReasoningCapabilities).mockResolvedValue({ ...capabilities, model_id: null, default_model: 'openai/reasoner' });
    const implicitProfiles = { OPENCODE: { DEFAULT: { OPENCODE: {} } } };
    expect(await resolveSendReasoning(implicitProfiles, profile, 'workspace')).toEqual({});
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });

  it('reuses metadata for different levels within five minutes, then refreshes', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await resolveSendReasoning(profiles, profile, 'workspace');
    clock.mockReturnValue(300_999);
    expect(await resolveSendReasoning(profiles, { ...profile, reasoning: 'high' }, 'workspace')).toEqual({ reasoning_id: 'high' });
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(301_000);
    await resolveSendReasoning(profiles, profile, 'workspace');
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });

  it('isolates workspaces and presets and invalidates on saved settings changes', async () => {
    await resolveSendReasoning(profiles, profile, 'workspace');
    await resolveSendReasoning(profiles, profile, 'other-workspace');
    await resolveSendReasoning(profiles, { ...profile, variant: 'HIGH' }, 'workspace');
    const changed = structuredClone(profiles);
    changed.OPENCODE!.DEFAULT = { OPENCODE: { model: 'openai/other' } };
    await resolveSendReasoning(changed, profile, 'workspace');
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(4);
  });

  it('refreshes corrupt cache entries', async () => {
    await resolveSendReasoning(profiles, profile, 'workspace');
    const cache = path.join(directory, '.cache', 'vibe-agent', 'reasoning');
    fs.writeFileSync(path.join(cache, fs.readdirSync(cache)[0]), 'invalid json');
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({ reasoning_id: 'medium' });
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });

  it('isolates recipient sessions and invalidates a changed session working directory', async () => {
    const session = { id: 'recipient', workspace_id: 'workspace', executor: 'OPENCODE' as const, created_at: '', updated_at: '', agent_working_dir: 'repo-a' };
    await resolveReasoning(profiles, profile, session);
    await resolveReasoning(profiles, profile, session);
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(1);
    await resolveReasoning(profiles, profile, { ...session, id: 'other-recipient' });
    await resolveReasoning(profiles, profile, { ...session, agent_working_dir: 'repo-b' });
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(3);
  });

  it('does not reuse capabilities across different VK servers', async () => {
    const session = { id: 'recipient', workspace_id: 'workspace', executor: 'OPENCODE' as const, created_at: '', updated_at: '' };
    const first = { apiBaseUrl: 'http://first-vk', getReasoningCapabilities: vi.fn().mockResolvedValue(capabilities) };
    const second = { apiBaseUrl: 'http://second-vk', getReasoningCapabilities: vi.fn().mockResolvedValue({
      ...capabilities, models: capabilities.models.map(model => ({ ...model, reasoning_options: [] })),
    }) };
    expect(await resolveReasoning(profiles, profile, session, first)).toEqual({ reasoning_id: 'medium' });
    expect(await resolveReasoning(profiles, profile, session, second)).toEqual({});
    expect(await resolveReasoning(profiles, profile, session, first)).toEqual({ reasoning_id: 'medium' });
    expect(first.getReasoningCapabilities).toHaveBeenCalledTimes(1);
    expect(second.getReasoningCapabilities).toHaveBeenCalledTimes(1);
  });

  it('invalidates custom-preset metadata when the default discovery settings change', async () => {
    await resolveSendReasoning(profiles, { ...profile, variant: 'HIGH' }, 'workspace');
    const changed = structuredClone(profiles);
    changed.OPENCODE!.DEFAULT = { OPENCODE: { model: 'openai/other' } };
    await resolveSendReasoning(changed, { ...profile, variant: 'HIGH' }, 'workspace');
    expect(client.getReasoningCapabilities).toHaveBeenCalledTimes(2);
  });

  it('still applies a verified override if cache writes fail', async () => {
    fs.writeFileSync(path.join(directory, '.cache'), 'not a directory');
    expect(await resolveSendReasoning(profiles, profile, 'workspace')).toEqual({ reasoning_id: 'medium' });
  });
});
