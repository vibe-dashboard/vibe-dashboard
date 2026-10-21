import type { QueueStatus } from 'shared/types';

export function queueMutationState(status: QueueStatus['status']) {
  return {
    isQueued: status === 'queued',
    isConsuming: status === 'consuming',
  };
}

export function isQueueTooLateError(error: unknown): boolean {
  if (!(error instanceof Error) || !('status' in error)) return false;
  return (
    error.status === 409 &&
    error.message.includes('already been consumed or is no longer queued')
  );
}

export async function cancelQueuedForEditor(options: {
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
  restore: () => void;
}): Promise<'cancelled' | 'too_late'> {
  try {
    await options.cancel();
  } catch (error) {
    if (!isQueueTooLateError(error)) throw error;
    await options.refresh();
    return 'too_late';
  }
  options.restore();
  return 'cancelled';
}

export async function editQueuedForEditor(options: {
  isQueued: boolean;
  isConsuming: boolean;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
  apply: () => void;
}): Promise<boolean> {
  if (options.isConsuming) return false;
  if (options.isQueued) {
    const result = await cancelQueuedForEditor({
      cancel: options.cancel,
      refresh: options.refresh,
      restore: () => {},
    });
    if (result === 'too_late') return false;
  }
  options.apply();
  return true;
}
