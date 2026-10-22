import { describe, expect, it, vi } from 'vitest';

import {
  cancelQueuedForEditor,
  editQueuedForEditor,
  queueMutationState,
} from '../queueEditorTransitions';

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('queueMutationState', () => {
  it('allows mutation only while a message is queued', () => {
    expect(queueMutationState('queued')).toEqual({
      isQueued: true,
      isConsuming: false,
    });
    expect(queueMutationState('consuming')).toEqual({
      isQueued: false,
      isConsuming: true,
    });
    expect(queueMutationState('empty')).toEqual({
      isQueued: false,
      isConsuming: false,
    });
  });

  it('restores the editor only after cancellation succeeds', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();
    const restore = vi.fn();

    await expect(
      cancelQueuedForEditor({ cancel, refresh, restore })
    ).resolves.toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes without restoring when consumption wins cancellation', async () => {
    const cancel = vi
      .fn()
      .mockRejectedValue(
        apiError(
          'queued message id has already been consumed or is no longer queued',
          409
        )
      );
    const refresh = vi.fn().mockResolvedValue(undefined);
    const restore = vi.fn();

    await expect(
      cancelQueuedForEditor({ cancel, refresh, restore })
    ).resolves.toBe('too_late');
    expect(refresh).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not mutate a consuming queue', async () => {
    const cancel = vi.fn();
    const refresh = vi.fn();
    const apply = vi.fn();

    await expect(
      editQueuedForEditor({
        isQueued: false,
        isConsuming: true,
        cancel,
        refresh,
        apply,
      })
    ).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('preserves unexpected cancellation errors', async () => {
    const error = apiError('identity conflict', 409);
    await expect(
      cancelQueuedForEditor({
        cancel: vi.fn().mockRejectedValue(error),
        refresh: vi.fn(),
        restore: vi.fn(),
      })
    ).rejects.toBe(error);
  });
});
