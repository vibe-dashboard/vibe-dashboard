import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeKanbanClient, type DraftFollowUpData } from './vk-client';

const followUp: DraftFollowUpData = {
  message: 'Ship it',
  executor_config: { executor: 'CODEX', variant: 'PLAN', model_id: 'gpt-5' },
  session_command: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('VibeKanbanClient Agent composer APIs', () => {
  it('sends compatible follow-up and queue payloads for the selected session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          status: 'queued',
          message: {
            session_id: 'session / 1',
            data: followUp,
            queued_at: '2026-09-14T00:00:00Z',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VibeKanbanClient('/vk-api');

    await client.sendFollowUp('session / 1', followUp);
    await client.queueFollowUp('session / 1', followUp);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/vk-api/sessions/session%20%2F%201/follow-up',
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      prompt: 'Ship it',
      executor_config: followUp.executor_config,
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/vk-api/sessions/session%20%2F%201/queue',
    );
  });

  it('uses the scratch endpoint for loading, upserting, and deleting drafts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { payload: { type: 'DRAFT_FOLLOW_UP', data: followUp } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VibeKanbanClient('/vk-api');

    expect(await client.getFollowUpDraft('session-1')).toEqual(followUp);
    await client.saveFollowUpDraft('session-1', followUp);
    await client.deleteFollowUpDraft('session-1');

    expect(
      fetchMock.mock.calls.map((call) => [call[0], call[1]?.method]),
    ).toEqual([
      ['/vk-api/scratch/DRAFT_FOLLOW_UP/session-1', undefined],
      ['/vk-api/scratch/DRAFT_FOLLOW_UP/session-1', 'PUT'],
      ['/vk-api/scratch/DRAFT_FOLLOW_UP/session-1', 'DELETE'],
    ]);
  });

  it('creates a session with the selected executor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'session-new', workspace_id: 'workspace-1' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new VibeKanbanClient('/vk-api');

    await client.createSession('workspace-1', 'CODEX');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/vk-api/sessions');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      workspace_id: 'workspace-1',
      executor: 'CODEX',
    });
  });
});
