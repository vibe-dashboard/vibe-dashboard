import type { ExecutionProcess } from 'shared/types';
import { ExecutionProcessStatus } from 'shared/types';

import type { ExecutionProcessStateStore } from '@/shared/hooks/useConversationHistory/types';

export function shouldAutoReplayRemainingHistoryAfterInitialLoad(): boolean {
  return false;
}

export function hasUnloadedCompletedHistoryProcesses(
  processes: readonly Pick<ExecutionProcess, 'id' | 'status'>[],
  displayedProcesses: ExecutionProcessStateStore
): boolean {
  return processes.some(
    (process) =>
      process.status !== ExecutionProcessStatus.running &&
      displayedProcesses[process.id] == null
  );
}

interface LoadExplicitEarlierHistoryBatchOptions {
  generation: number;
  batchSize: number;
  inFlightRef: { current: boolean };
  isCurrentGeneration: (generation: number) => boolean;
  hasUnloadedHistory: () => boolean;
  updateHasMoreHistoryForGeneration: (generation: number) => void;
  setLoadingHistoryForGeneration: (
    generation: number,
    isLoading: boolean
  ) => void;
  loadRemainingEntriesInBatches: (batchSize: number) => Promise<boolean>;
  emitHistoricEntriesForGeneration: (generation: number) => boolean;
}

export type LoadExplicitEarlierHistoryBatchResult =
  | 'loaded'
  | 'empty'
  | 'deduped'
  | 'stale';

interface ShouldAutoLoadEarlierHistoryInput {
  hasMoreHistory: boolean;
  isNearHistoryBoundary: boolean;
  isLoadingHistory: boolean;
  hasHistoryError: boolean;
  hasRequestedForCurrentBoundary: boolean;
  hasLeftInitialBoundary: boolean;
  isScrollable: boolean;
  isAtBottom: boolean;
}

export function shouldAutoLoadEarlierHistoryAtBoundary({
  hasMoreHistory,
  isNearHistoryBoundary,
  isLoadingHistory,
  hasHistoryError,
  hasRequestedForCurrentBoundary,
  hasLeftInitialBoundary,
  isScrollable,
  isAtBottom,
}: ShouldAutoLoadEarlierHistoryInput): boolean {
  if (!hasMoreHistory) return false;
  if (!isNearHistoryBoundary) return false;
  if (isLoadingHistory) return false;
  if (hasHistoryError) return false;
  if (hasRequestedForCurrentBoundary && isScrollable) return false;
  // If the initial latest-history slice is shorter than the viewport, the
  // reader cannot scroll away from the top boundary to "arm" loading. In that
  // case keep fetching earlier turns until the transcript is scrollable (or
  // history is exhausted), otherwise previous messages can become unreachable.
  if (!hasLeftInitialBoundary && isScrollable) return false;

  // On initial render the boundary state can briefly be true before the
  // initial-bottom anchor settles. Avoid interpreting that as a top-boundary
  // read when the scrollable transcript is actually at the bottom.
  if (isScrollable && isAtBottom) return false;

  return true;
}

export async function loadExplicitEarlierHistoryBatch({
  generation,
  batchSize,
  inFlightRef,
  isCurrentGeneration,
  hasUnloadedHistory,
  updateHasMoreHistoryForGeneration,
  setLoadingHistoryForGeneration,
  loadRemainingEntriesInBatches,
  emitHistoricEntriesForGeneration,
}: LoadExplicitEarlierHistoryBatchOptions): Promise<LoadExplicitEarlierHistoryBatchResult> {
  if (!isCurrentGeneration(generation)) return 'stale';
  if (inFlightRef.current) return 'deduped';

  if (!hasUnloadedHistory()) {
    updateHasMoreHistoryForGeneration(generation);
    return 'empty';
  }

  inFlightRef.current = true;
  setLoadingHistoryForGeneration(generation, true);

  try {
    const anyUpdated = await loadRemainingEntriesInBatches(batchSize);
    if (!isCurrentGeneration(generation)) return 'stale';

    if (anyUpdated) {
      emitHistoricEntriesForGeneration(generation);
    }
    updateHasMoreHistoryForGeneration(generation);

    return anyUpdated ? 'loaded' : 'empty';
  } finally {
    inFlightRef.current = false;
    setLoadingHistoryForGeneration(generation, false);
  }
}
