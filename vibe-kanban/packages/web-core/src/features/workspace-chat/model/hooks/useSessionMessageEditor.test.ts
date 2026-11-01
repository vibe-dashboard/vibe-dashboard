import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScratchType } from 'shared/types';
import {
  readStoredScratchDraft,
  writeStoredScratchDraft,
} from '../../../../shared/lib/scratchDraftStore';
import {
  clearFollowUpDraft,
  resolveSessionMessageScratchId,
  restoreQueuedFollowUpDraftAfterCancel,
} from './useSessionMessageEditor';

describe('resolveSessionMessageScratchId', () => {
  it('uses the workspace id for new-session drafts', () => {
    expect(
      resolveSessionMessageScratchId({
        approvalId: undefined,
        isNewSessionMode: true,
        workspaceId: 'workspace-1',
        sessionId: undefined,
      })
    ).toBe('workspace-1');
  });

  it('uses the session id for existing-session drafts', () => {
    expect(
      resolveSessionMessageScratchId({
        approvalId: undefined,
        isNewSessionMode: false,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
      })
    ).toBe('session-1');
  });

  it('uses the approval id before workspace or session draft ids', () => {
    expect(
      resolveSessionMessageScratchId({
        approvalId: 'approval-1',
        isNewSessionMode: true,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
      })
    ).toBe('approval-1');
  });
});

describe('clearFollowUpDraft', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the local dirty draft before remote scratch deletion resolves', async () => {
    const scratchId = 'session-1';
    writeStoredScratchDraft(
      ScratchType.DRAFT_FOLLOW_UP,
      scratchId,
      {
        message: 'submitted message',
        executor_config: { executor: 'codex' },
      },
      true
    );

    let resolveDelete: () => void = () => {};
    const deleteScratch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const cancelDebouncedSave = vi.fn();

    const clearPromise = clearFollowUpDraft({
      scratchId,
      cancelDebouncedSave,
      deleteScratch,
    });

    expect(cancelDebouncedSave).toHaveBeenCalledOnce();
    expect(deleteScratch).toHaveBeenCalledOnce();
    expect(
      readStoredScratchDraft(ScratchType.DRAFT_FOLLOW_UP, scratchId)
    ).toBeNull();

    resolveDelete();
    await clearPromise;
  });

  it('keeps the local draft cleared when remote scratch deletion fails', async () => {
    const scratchId = 'session-2';
    writeStoredScratchDraft(
      ScratchType.DRAFT_FOLLOW_UP,
      scratchId,
      {
        message: 'submitted message',
        executor_config: { executor: 'codex' },
      },
      true
    );

    const deleteError = new Error('scratch already deleted');
    const onDeleteError = vi.fn();

    await expect(
      clearFollowUpDraft({
        scratchId,
        cancelDebouncedSave: vi.fn(),
        deleteScratch: vi.fn(() => Promise.reject(deleteError)),
        onDeleteError,
      })
    ).resolves.toBeUndefined();

    expect(onDeleteError).toHaveBeenCalledWith(deleteError);
    expect(
      readStoredScratchDraft(ScratchType.DRAFT_FOLLOW_UP, scratchId)
    ).toBeNull();
  });

  it('clears workspace-keyed new-session drafts and awaits remote deletion', async () => {
    const workspaceId = 'workspace-1';
    writeStoredScratchDraft(
      ScratchType.DRAFT_FOLLOW_UP,
      workspaceId,
      {
        message: 'new session prompt',
        executor_config: { executor: 'codex' },
      },
      true
    );

    let didDelete = false;
    await clearFollowUpDraft({
      scratchId: workspaceId,
      cancelDebouncedSave: vi.fn(),
      deleteScratch: vi.fn(async () => {
        didDelete = true;
      }),
    });

    expect(didDelete).toBe(true);
    expect(
      readStoredScratchDraft(ScratchType.DRAFT_FOLLOW_UP, workspaceId)
    ).toBeNull();
  });
});

describe('restoreQueuedFollowUpDraftAfterCancel', () => {
  it('cancels the queue before restoring and persisting the queued draft', async () => {
    const events: string[] = [];
    const queuedConfig = { executor: 'codex' };

    await restoreQueuedFollowUpDraftAfterCancel({
      queuedMessage: 'queued follow-up',
      queuedConfig,
      cancelQueue: vi.fn(async () => {
        events.push('cancelQueue');
      }),
      setLocalMessage: vi.fn((message) => {
        events.push(`setLocalMessage:${message}`);
      }),
      setExecutorOverrides: vi.fn((config) => {
        events.push(`setExecutorOverrides:${config.executor}`);
      }),
      handleMessageChange: vi.fn((message, config) => {
        events.push(`handleMessageChange:${message}:${config.executor}`);
      }),
      saveToScratch: vi.fn(async (message, config) => {
        events.push(`saveToScratch:${message}:${config.executor}`);
      }),
    });

    expect(events).toEqual([
      'cancelQueue',
      'setLocalMessage:queued follow-up',
      'setExecutorOverrides:codex',
      'handleMessageChange:queued follow-up:codex',
      'saveToScratch:queued follow-up:codex',
    ]);
  });

  it('restores visible queued text without persisting when queued config is missing', async () => {
    const saveToScratch = vi.fn();
    const handleMessageChange = vi.fn();
    const setExecutorOverrides = vi.fn();
    const setLocalMessage = vi.fn();

    await restoreQueuedFollowUpDraftAfterCancel({
      queuedMessage: 'queued follow-up',
      queuedConfig: null,
      cancelQueue: vi.fn(),
      setLocalMessage,
      setExecutorOverrides,
      handleMessageChange,
      saveToScratch,
    });

    expect(setLocalMessage).toHaveBeenCalledWith('queued follow-up');
    expect(setExecutorOverrides).not.toHaveBeenCalled();
    expect(handleMessageChange).not.toHaveBeenCalled();
    expect(saveToScratch).not.toHaveBeenCalled();
  });
});
