import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VKService } from '../cli/vk-service.js';
import { client } from './client.js';
import { resolveSendReasoning } from './reasoning.js';
import { DEFAULT_SEND_PROFILE, readRuntimeExecutorProfile } from './runtime-config.js';
import { getRoleForSession, registerSession } from './session-file.js';
import type { Session } from '../types.js';

vi.mock('./session-file.js', () => ({ getRoleForSession: vi.fn(), registerSession: vi.fn() }));
vi.mock('./reasoning.js', () => ({ resolveSendReasoning: vi.fn() }));
vi.mock('./runtime-config.js', { spy: true });

const profiles = {
  OPENCODE: { DEFAULT: { OPENCODE: {} }, REVIEW: { OPENCODE: {} } },
  CODEX: { DEFAULT: { CODEX: {} } },
};
const original: Session = { id: 'original', workspace_id: 'workspace', executor: 'CODEX', name: 'reviewer', created_at: '', updated_at: '' };
const replacement: Session = { ...original, id: 'replacement', executor: 'OPENCODE' };
const service = new VKService();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readRuntimeExecutorProfile).mockReturnValue({ ...DEFAULT_SEND_PROFILE });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(client, 'getExecutorProfiles').mockResolvedValue(profiles);
  vi.spyOn(client, 'getSession').mockResolvedValue(original);
  vi.spyOn(client, 'createSession').mockResolvedValue(replacement);
  vi.spyOn(client, 'sendMessage').mockImplementation(async sessionId => ({ id: 'process', session_id: sessionId, status: 'running' } as Awaited<ReturnType<typeof client.sendMessage>>));
  vi.mocked(getRoleForSession).mockReturnValue('reviewer');
  vi.mocked(resolveSendReasoning).mockImplementation(async (_profiles, profile) => profile.reasoning ? { reasoning_id: profile.reasoning } : {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('vk send session routing', () => {
  it('replaces a different-executor session, includes catch-up, and publishes its role after acceptance', async () => {
    const result = await service.sendMessage('original', 'Review');
    expect(client.createSession).toHaveBeenCalledExactlyOnceWith({ workspace_id: 'workspace', executor: 'OPENCODE', name: 'reviewer' });
    expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith('replacement', {
      prompt: 'Review\n\nUse `vibe-agent full_summary` as a standalone command to catch up.',
      executor_config: { executor: 'OPENCODE', variant: 'DEFAULT', reasoning_id: 'medium' },
      retry_process_id: null, force_when_dirty: null, perform_git_reset: null,
    });
    expect(resolveSendReasoning).toHaveBeenCalledWith(profiles, expect.objectContaining({ executor: 'OPENCODE' }), replacement);
    expect(registerSession).toHaveBeenCalledExactlyOnceWith('workspace', 'replacement', 'reviewer');
    expect(vi.mocked(registerSession).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(client.sendMessage).mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ session_id: 'replacement', id: 'process' });
  });

  it('reuses matching sessions with a selected preset and no catch-up', async () => {
    vi.mocked(readRuntimeExecutorProfile).mockReturnValue({ executor: 'OpenCode', variant: 'Review', reasoning: 'high' });
    vi.mocked(client.getSession).mockResolvedValue({ ...original, executor: 'OPENCODE' });
    await service.sendMessage('original', 'Review');
    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalledWith('original', expect.objectContaining({
      prompt: 'Review', executor_config: { executor: 'OPENCODE', variant: 'REVIEW', reasoning_id: 'high' },
    }));
    expect(registerSession).not.toHaveBeenCalled();
  });

  it('preserves saved reasoning when the config omits reasoning', async () => {
    vi.mocked(readRuntimeExecutorProfile).mockReturnValue({ executor: 'Codex', variant: 'Default' });
    await service.sendMessage('original', 'Continue');
    expect(client.sendMessage).toHaveBeenCalledWith('original', expect.objectContaining({
      executor_config: { executor: 'CODEX', variant: 'DEFAULT' },
    }));
  });

  it('does not overwrite the role on rejection and includes catch-up on retry', async () => {
    vi.mocked(client.sendMessage).mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(service.sendMessage('original', 'Review')).rejects.toThrow('HTTP 503');
    expect(registerSession).not.toHaveBeenCalled();
    vi.mocked(client.createSession).mockResolvedValueOnce({ ...replacement, id: 'retry-session' });
    await service.sendMessage('original', 'Review');
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(client.sendMessage).toHaveBeenLastCalledWith('retry-session', expect.objectContaining({ prompt: expect.stringContaining('full_summary') }));
    expect(registerSession).toHaveBeenCalledExactlyOnceWith('workspace', 'retry-session', 'reviewer');
  });

  it('does not invent a role for an unregistered explicit session', async () => {
    vi.mocked(getRoleForSession).mockReturnValue(null);
    await service.sendMessage('original', 'Review');
    expect(registerSession).not.toHaveBeenCalled();
  });

  it('reports accepted work if the subsequent role registration fails', async () => {
    vi.mocked(registerSession).mockImplementation(() => { throw new Error('disk full'); });
    await expect(service.sendMessage('original', 'Review')).resolves.toMatchObject({
      session_id: 'replacement', id: 'process', registration_error: 'disk full',
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/Message accepted.*replacement.*process.*Do not resend/));
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('validates the configured profile before any session changes', async () => {
    vi.mocked(readRuntimeExecutorProfile).mockReturnValue({ executor: 'OpenCode', variant: 'Missing', reasoning: 'high' });
    await expect(service.sendMessage('original', 'Review')).rejects.toThrow('Unknown or ambiguous configuration');
    expect(client.getSession).not.toHaveBeenCalled();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
