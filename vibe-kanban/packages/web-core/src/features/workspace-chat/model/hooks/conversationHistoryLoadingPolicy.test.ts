import { describe, expect, it, vi } from 'vitest';

import { ExecutionProcessStatus } from 'shared/types';

import {
  hasUnloadedCompletedHistoryProcesses,
  loadExplicitEarlierHistoryBatch,
  shouldAutoLoadEarlierHistoryAtBoundary,
  shouldAutoReplayRemainingHistoryAfterInitialLoad,
} from './conversationHistoryLoadingPolicy';

describe('conversationHistoryLoadingPolicy', () => {
  it('does not auto-replay all earlier history after the initial batch', () => {
    expect(shouldAutoReplayRemainingHistoryAfterInitialLoad()).toBe(false);
  });

  it('reports more history when completed processes remain unloaded', () => {
    expect(
      hasUnloadedCompletedHistoryProcesses(
        [
          { id: 'latest', status: ExecutionProcessStatus.completed },
          { id: 'older', status: ExecutionProcessStatus.completed },
        ],
        {
          latest: {
            executionProcess: {
              id: 'latest',
              created_at: null,
              updated_at: null,
              executor_action: {
                typ: { type: 'CodingAgentFollowUpRequest' },
              },
            },
            entries: [],
          },
        }
      )
    ).toBe(true);
  });

  it('does not treat live running processes as unloaded earlier history', () => {
    expect(
      hasUnloadedCompletedHistoryProcesses(
        [{ id: 'running', status: ExecutionProcessStatus.running }],
        {}
      )
    ).toBe(false);
  });

  it('auto-loads earlier history only after reaching the top boundary', () => {
    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        hasMoreHistory: true,
        isNearHistoryBoundary: true,
        isLoadingHistory: false,
        hasHistoryError: false,
        hasRequestedForCurrentBoundary: false,
        hasLeftInitialBoundary: true,
        isScrollable: true,
        isAtBottom: false,
      })
    ).toBe(true);

    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        hasMoreHistory: true,
        isNearHistoryBoundary: false,
        isLoadingHistory: false,
        hasHistoryError: false,
        hasRequestedForCurrentBoundary: false,
        hasLeftInitialBoundary: true,
        isScrollable: true,
        isAtBottom: false,
      })
    ).toBe(false);
  });

  it('does not auto-load while already loading, errored, requested, or settled at bottom', () => {
    const base = {
      hasMoreHistory: true,
      isNearHistoryBoundary: true,
      isLoadingHistory: false,
      hasHistoryError: false,
      hasRequestedForCurrentBoundary: false,
      hasLeftInitialBoundary: true,
      isScrollable: true,
      isAtBottom: false,
    };

    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        ...base,
        isLoadingHistory: true,
      })
    ).toBe(false);
    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        ...base,
        hasHistoryError: true,
      })
    ).toBe(false);
    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        ...base,
        hasRequestedForCurrentBoundary: true,
      })
    ).toBe(false);
    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        ...base,
        isAtBottom: true,
      })
    ).toBe(false);
  });

  it('does not auto-load from the initial boundary state before the reader scrolls away', () => {
    expect(
      shouldAutoLoadEarlierHistoryAtBoundary({
        hasMoreHistory: true,
        isNearHistoryBoundary: true,
        isLoadingHistory: false,
        hasHistoryError: false,
        hasRequestedForCurrentBoundary: false,
        hasLeftInitialBoundary: false,
        isScrollable: true,
        isAtBottom: false,
      })
    ).toBe(false);
  });

  it('loads one explicit earlier-history batch and dedupes concurrent calls', async () => {
    let resolveBatch!: (value: boolean) => void;
    const batchPromise = new Promise<boolean>((resolve) => {
      resolveBatch = resolve;
    });

    const inFlightRef = { current: false };
    const loadRemainingEntriesInBatches = vi.fn(() => batchPromise);
    const emitHistoricEntriesForGeneration = vi.fn(() => true);
    const setLoadingHistoryForGeneration = vi.fn();
    const updateHasMoreHistoryForGeneration = vi.fn();

    const options = {
      generation: 1,
      batchSize: 50,
      inFlightRef,
      isCurrentGeneration: vi.fn(() => true),
      hasUnloadedHistory: vi.fn(() => true),
      updateHasMoreHistoryForGeneration,
      setLoadingHistoryForGeneration,
      loadRemainingEntriesInBatches,
      emitHistoricEntriesForGeneration,
    };

    const first = loadExplicitEarlierHistoryBatch(options);
    const second = loadExplicitEarlierHistoryBatch(options);

    await expect(second).resolves.toBe('deduped');
    expect(loadRemainingEntriesInBatches).toHaveBeenCalledTimes(1);

    resolveBatch(true);

    await expect(first).resolves.toBe('loaded');
    expect(loadRemainingEntriesInBatches).toHaveBeenCalledWith(50);
    expect(emitHistoricEntriesForGeneration).toHaveBeenCalledWith(1);
    expect(updateHasMoreHistoryForGeneration).toHaveBeenCalledWith(1);
    expect(setLoadingHistoryForGeneration).toHaveBeenNthCalledWith(1, 1, true);
    expect(setLoadingHistoryForGeneration).toHaveBeenLastCalledWith(1, false);
  });
});
