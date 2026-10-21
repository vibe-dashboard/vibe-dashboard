import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../core/client.js';
import { getSessionForRole } from '../core/context.js';
import { registerSession } from '../core/session-file.js';
import { resolveSendProfile } from '../core/executor-profile.js';
import type { ExecutorProfiles, Session } from '../types.js';
import { send } from './vibe-agent.js';

vi.mock('../core/context.js', () => ({ getSessionForRole: vi.fn() }));
vi.mock('../core/session-file.js', () => ({ registerSession: vi.fn() }));

const profiles: ExecutorProfiles = {
  OPENCODE: {
    DEFAULT: { OPENCODE: { auto_approve: true } },
    DEEP_REVIEW: { OPENCODE: { auto_approve: true, variant: 'high' } },
    recently_used_models: { models: ['openai/gpt-5'] },
  },
  CODEX: { DEFAULT: { CODEX: {} }, HIGH: { CODEX: {} } },
};
const catchUp = 'Use `vibe-agent full_summary` as a standalone command to catch up.';
const session: Session = {
  id: 'existing-session', workspace_id: 'workspace', executor: 'OPENCODE',
  name: 'reviewer', created_at: '', updated_at: '',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('send profile resolution', () => {
  it.each([undefined, '', '   '])('defaults to OpenCode,Default for %j', value => {
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', value);
    expect(resolveSendProfile(profiles)).toEqual({ executor: 'OPENCODE', variant: 'DEFAULT' });
  });

  it('resolves friendly names to actual saved keys', () => {
    expect(resolveSendProfile(profiles, ' openCode , Deep Review ')).toEqual({ executor: 'OPENCODE', variant: 'DEEP_REVIEW' });
    expect(resolveSendProfile(profiles, 'Codex,High')).toEqual({ executor: 'CODEX', variant: 'HIGH' });
  });

  it.each(['OpenCode', 'OpenCode,', ',Default', 'OpenCode,Default,extra', 'Missing,Default', 'OpenCode,Missing', 'OpenCode,recently_used_models'])('rejects invalid selection %j', value => {
    expect(() => resolveSendProfile(profiles, value)).toThrow();
  });

  it('rejects ambiguous saved names', () => {
    expect(() => resolveSendProfile({ OPENCODE: { DEEP_REVIEW: {}, DEEPREVIEW: {} } }, 'OpenCode,Deep Review')).toThrow(/ambiguous/);
  });

  it('reads configurations from the live VK info response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, data: { profiles: { executors: profiles } },
    })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await client.getExecutorProfiles()).toEqual(profiles);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/info$/);
  });
});

describe('send routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VK_WORKSPACE_ID', 'workspace');
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(client, 'getExecutorProfiles').mockResolvedValue(profiles);
    vi.spyOn(client, 'createSession').mockResolvedValue({ ...session, id: 'new-session' });
    vi.spyOn(client, 'updateSession').mockResolvedValue(session);
    vi.spyOn(client, 'sendMessage').mockResolvedValue({ id: 'process', status: 'running' } as Awaited<ReturnType<typeof client.sendMessage>>);
  });

  it.each([null, { ...session, executor: 'CODEX' as const }])('creates and registers a new session when needed: %j', async existing => {
    vi.mocked(getSessionForRole).mockResolvedValue(existing);
    await send(['reviewer', 'Original message', '--json']);
    expect(client.createSession).toHaveBeenCalledWith({ workspace_id: 'workspace', executor: 'OPENCODE', name: 'reviewer' });
    expect(registerSession).toHaveBeenCalledWith('workspace', 'new-session', 'reviewer');
    expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith('new-session', expect.objectContaining({
      prompt: `Original message\n\n${catchUp}`,
      executor_config: { executor: 'OPENCODE', variant: 'DEFAULT', reasoning_id: 'medium' },
    }));
  });

  it.each(['OpenCode,Default', 'OpenCode,Deep Review'])('reuses same-executor sessions for %s without adding instructions', async selection => {
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', selection);
    vi.mocked(getSessionForRole).mockResolvedValue(session);
    await send(['reviewer', 'Original message', '--json']);
    expect(client.createSession).not.toHaveBeenCalled();
    expect(registerSession).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('existing-session', expect.objectContaining({
      prompt: 'Original message',
      executor_config: { executor: 'OPENCODE', variant: selection.endsWith('Default') ? 'DEFAULT' : 'DEEP_REVIEW', reasoning_id: 'medium' },
    }));
  });

  it.each(['reviewer', 'implementer', 'reviewer-codex', 'custom-role'])('uses the explicit profile regardless of role: %s', async role => {
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', 'Codex,High');
    vi.mocked(getSessionForRole).mockResolvedValue({ ...session, executor: 'CODEX', name: role });
    await send([role, 'Review', '--json']);
    expect(client.sendMessage).toHaveBeenCalledWith('existing-session', expect.objectContaining({ executor_config: { executor: 'CODEX', variant: 'HIGH', reasoning_id: 'medium' } }));
  });

  it('fails invalid selection before session lookup or mutations', async () => {
    vi.stubEnv('VIBE_AGENT_EXECUTOR_PROFILE', 'OpenCode,Missing');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(send(['reviewer', 'Review', '--json'])).rejects.toThrow('exit');
    expect(getSessionForRole).not.toHaveBeenCalled();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.updateSession).not.toHaveBeenCalled();
    expect(registerSession).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
