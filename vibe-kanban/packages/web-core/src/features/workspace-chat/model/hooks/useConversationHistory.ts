import {
  ExecutionProcess,
  ExecutionProcessStatus,
  PatchType,
} from 'shared/types';
import { useExecutionProcessesContext } from '@/shared/hooks/useExecutionProcessesContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamJsonPatchEntries } from '@/shared/lib/streamJsonPatchEntries';
import { loadFiniteJsonPatchEntries } from '@/shared/lib/loadFiniteJsonPatchEntries';
import { sessionsApi, workspacesApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';
import type {
  AddEntryType,
  ConversationTimelineSource,
  ExecutionProcessStateStore,
  PatchTypeWithKey,
  UseConversationHistoryParams,
} from '@/shared/hooks/useConversationHistory/types';
import {
  getHistoricReplayRetryDelayMs,
  updateHistoricReplayFailures,
} from './historyReplayState';
import {
  hasUnloadedCompletedHistoryProcesses,
  loadExplicitEarlierHistoryBatch,
  shouldAutoReplayRemainingHistoryAfterInitialLoad,
} from './conversationHistoryLoadingPolicy';
import {
  conversationPreviewToExecutionProcessState,
  mergePreviewIntoExecutionProcessState,
} from '../conversationPreviewTimeline';

// Result type for the new UI's conversation history hook
export interface UseConversationHistoryResult {
  /** Whether the conversation only has a single coding agent turn (no follow-ups) */
  isFirstTurn: boolean;
  /** Whether a user-requested batch of older history entries is loading */
  isLoadingHistory: boolean;
  /** Whether there are older completed process logs that have not been loaded */
  hasMoreHistory: boolean;
  /** Loads one bounded batch of older history entries on explicit user request */
  loadEarlierHistory: () => Promise<void>;
  /** Error state when earlier conversation history could not be fully replayed */
  historyError: string | null;
  /** Whether failed history replay entries can be retried explicitly */
  canRetryHistory: boolean;
  /** Whether a manual retry is currently in progress */
  isRetryingHistory: boolean;
  /** Retry failed historic conversation history loads */
  retryHistory: () => void;
}
import {
  MIN_INITIAL_ENTRIES,
  REMAINING_BATCH_SIZE,
} from '@/shared/hooks/useConversationHistory/constants';

const HISTORIC_REPLAY_TIMEOUT_MS = 5000;
const HISTORIC_REPLAY_MAX_RETRIES = 3;
const HISTORIC_REPLAY_BACKGROUND_MAX_RETRIES = 3;
const HISTORIC_REPLAY_BACKGROUND_MAX_CONCURRENCY = 1;
const HISTORIC_REPLAY_ERROR =
  'Failed to load some earlier conversation messages.';

export const useConversationHistory = ({
  attempt,
  onTimelineUpdated,
  previewMode = 'session',
  scopeKey,
}: UseConversationHistoryParams): UseConversationHistoryResult => {
  const hostId = useHostId();
  const {
    executionProcessesVisible: executionProcessesRaw,
    isLoading,
    isConnected,
  } = useExecutionProcessesContext();
  const executionProcesses = useRef<ExecutionProcess[]>(executionProcessesRaw);
  const displayedExecutionProcesses = useRef<ExecutionProcessStateStore>({});
  const loadedInitialEntries = useRef(false);
  const emittedEmptyInitialRef = useRef(false);
  const emittedPreviewRef = useRef(false);
  const streamingProcessIdsRef = useRef<Set<string>>(new Set());
  const runningStreamControllersRef = useRef<Map<string, { close(): void }>>(
    new Map()
  );
  const onTimelineUpdatedRef = useRef<
    UseConversationHistoryParams['onTimelineUpdated'] | null
  >(null);
  const previousStatusMapRef = useRef<Map<string, ExecutionProcessStatus>>(
    new Map()
  );
  const failedHistoricProcessIdsRef = useRef<Set<string>>(new Set());
  const historicRetryAttemptsRef = useRef<Map<string, number>>(new Map());
  const historicRetryDueAtRef = useRef<Map<string, number>>(new Map());
  const historicRetryInFlightRef = useRef<Set<string>>(new Set());
  const historicRetryTimerRef = useRef<number | null>(null);
  const loadEarlierHistoryInFlightRef = useRef(false);
  const [isLoadingHistoryState, setIsLoadingHistory] = useState(false);
  const [isRetryingHistory, setIsRetryingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const scopeGenerationRef = useRef(0);
  const [failedHistoricProcessIds, setFailedHistoricProcessIds] = useState<
    Set<string>
  >(new Set());
  const isCurrentGeneration = useCallback(
    (generation: number) => scopeGenerationRef.current === generation,
    []
  );
  const setLoadingHistoryForGeneration = useCallback(
    (generation: number, value: boolean) => {
      if (!isCurrentGeneration(generation)) return;
      setIsLoadingHistory(value);
    },
    [isCurrentGeneration]
  );

  const clearHistoricRetryTimer = useCallback(() => {
    if (historicRetryTimerRef.current === null) return;
    window.clearTimeout(historicRetryTimerRef.current);
    historicRetryTimerRef.current = null;
  }, []);

  const clearHistoricRetryTracking = useCallback(
    (processId?: string) => {
      if (!processId) {
        clearHistoricRetryTimer();
        historicRetryAttemptsRef.current.clear();
        historicRetryDueAtRef.current.clear();
        historicRetryInFlightRef.current.clear();
        return;
      }

      historicRetryAttemptsRef.current.delete(processId);
      historicRetryDueAtRef.current.delete(processId);
      historicRetryInFlightRef.current.delete(processId);
    },
    [clearHistoricRetryTimer]
  );

  // Derive whether this is the first turn (no follow-up processes exist)
  const isFirstTurn = useMemo(() => {
    const codingAgentProcessCount = executionProcessesRaw.filter(
      (ep) =>
        ep.executor_action.typ.type === 'CodingAgentInitialRequest' ||
        ep.executor_action.typ.type === 'CodingAgentFollowUpRequest'
    ).length;
    return codingAgentProcessCount <= 1;
  }, [executionProcessesRaw]);

  const mergeIntoDisplayed = (
    mutator: (state: ExecutionProcessStateStore) => void
  ) => {
    const state = displayedExecutionProcesses.current;
    mutator(state);
  };

  const mergeIntoDisplayedForGeneration = useCallback(
    (
      generation: number,
      mutator: (state: ExecutionProcessStateStore) => void
    ): boolean => {
      if (!isCurrentGeneration(generation)) return false;
      mergeIntoDisplayed(mutator);
      return true;
    },
    [isCurrentGeneration]
  );

  // The hook owns transport, loading, and reconciliation.
  // It emits a source model that later derivation layers can transform further.

  const buildTimelineSource = useCallback(
    (
      executionProcessState: ExecutionProcessStateStore
    ): ConversationTimelineSource => ({
      executionProcessState,
      liveExecutionProcesses: executionProcesses.current,
    }),
    []
  );

  useEffect(() => {
    onTimelineUpdatedRef.current = onTimelineUpdated;
  }, [onTimelineUpdated]);

  const setHistoricProcessFailure = useCallback(
    (generation: number, processId: string, failed: boolean) => {
      setFailedHistoricProcessIds((prev) => {
        return updateHistoricReplayFailures(prev, {
          isCurrentScope: scopeGenerationRef.current === generation,
          processId,
          failed,
        });
      });
    },
    []
  );

  // Keep executionProcesses up to date
  useEffect(() => {
    executionProcesses.current = executionProcessesRaw.filter(
      (ep) =>
        ep.run_reason === 'setupscript' ||
        ep.run_reason === 'cleanupscript' ||
        ep.run_reason === 'archivescript' ||
        ep.run_reason === 'codingagent'
    );
  }, [executionProcessesRaw]);

  const loadEntriesForHistoricExecutionProcess = useCallback(
    async (executionProcess: ExecutionProcess, generation: number) => {
      let url = '';
      if (executionProcess.executor_action.typ.type === 'ScriptRequest') {
        url = `/api/execution-processes/${executionProcess.id}/raw-logs/ws`;
      } else {
        url = `/api/execution-processes/${executionProcess.id}/normalized-logs/ws`;
      }

      for (
        let attempt = 1;
        attempt <= HISTORIC_REPLAY_MAX_RETRIES;
        attempt += 1
      ) {
        try {
          return await loadFiniteJsonPatchEntries<PatchType>(url, {
            timeoutMs: HISTORIC_REPLAY_TIMEOUT_MS,
            replaySafeAppendOnly: true,
          });
        } catch (err) {
          if (scopeGenerationRef.current !== generation) {
            return null;
          }
          console.warn(
            `Error loading entries for historic execution process ${executionProcess.id} (attempt ${attempt}/${HISTORIC_REPLAY_MAX_RETRIES})`,
            err
          );
          if (attempt < HISTORIC_REPLAY_MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      return null;
    },
    []
  );

  const patchWithKey = (
    patch: PatchType,
    executionProcessId: string,
    index: number
  ) => {
    return {
      ...patch,
      patchKey: `${executionProcessId}:${index}`,
      executionProcessId,
    };
  };

  const flattenEntries = (
    executionProcessState: ExecutionProcessStateStore
  ): PatchTypeWithKey[] => {
    return Object.values(executionProcessState)
      .filter(
        (p) =>
          p.executionProcess.executor_action.typ.type ===
            'CodingAgentFollowUpRequest' ||
          p.executionProcess.executor_action.typ.type ===
            'CodingAgentInitialRequest' ||
          p.executionProcess.executor_action.typ.type === 'ReviewRequest'
      )
      .sort(
        (a, b) =>
          new Date(
            a.executionProcess.created_at as unknown as string
          ).getTime() -
          new Date(b.executionProcess.created_at as unknown as string).getTime()
      )
      .flatMap((p) => p.entries);
  };

  const hasUnloadedHistoricProcesses = useCallback((): boolean => {
    return hasUnloadedCompletedHistoryProcesses(
      executionProcesses.current,
      displayedExecutionProcesses.current
    );
  }, []);

  const updateHasMoreHistoryForGeneration = useCallback(
    (generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      setHasMoreHistory(hasUnloadedHistoricProcesses());
    },
    [hasUnloadedHistoricProcesses, isCurrentGeneration]
  );

  const getActiveAgentProcesses = (): ExecutionProcess[] => {
    return (
      executionProcesses?.current.filter(
        (p) =>
          p.status === ExecutionProcessStatus.running &&
          p.run_reason !== 'devserver'
      ) ?? []
    );
  };

  const closeRunningStream = useCallback((processId: string) => {
    const controller = runningStreamControllersRef.current.get(processId);
    if (!controller) return;
    runningStreamControllersRef.current.delete(processId);
    controller.close();
  }, []);

  const closeAllRunningStreams = useCallback(() => {
    for (const controller of runningStreamControllersRef.current.values()) {
      controller.close();
    }
    runningStreamControllersRef.current.clear();
  }, []);

  const emitEntries = useCallback(
    (
      executionProcessState: ExecutionProcessStateStore,
      addEntryType: AddEntryType,
      loading: boolean
    ) => {
      const timelineSource = buildTimelineSource(executionProcessState);
      let modifiedAddEntryType = addEntryType;

      const latestEntry = Object.values(executionProcessState)
        .sort(
          (a, b) =>
            new Date(
              a.executionProcess.created_at as unknown as string
            ).getTime() -
            new Date(
              b.executionProcess.created_at as unknown as string
            ).getTime()
        )
        .flatMap((processState) => processState.entries)
        .at(-1);

      if (
        latestEntry?.type === 'NORMALIZED_ENTRY' &&
        latestEntry.content.entry_type.type === 'tool_use' &&
        latestEntry.content.entry_type.tool_name === 'ExitPlanMode'
      ) {
        modifiedAddEntryType = 'plan';
      }

      onTimelineUpdatedRef.current?.(
        timelineSource,
        modifiedAddEntryType,
        loading
      );
    },
    [buildTimelineSource]
  );

  const emitEntriesForGeneration = useCallback(
    (
      generation: number,
      executionProcessState: ExecutionProcessStateStore,
      addEntryType: AddEntryType,
      loading: boolean
    ): boolean => {
      if (!isCurrentGeneration(generation)) return false;
      emitEntries(executionProcessState, addEntryType, loading);
      return true;
    },
    [emitEntries, isCurrentGeneration]
  );

  const retryHistoricProcessInBackground = useCallback(
    async (processId: string, generation: number) => {
      const process = executionProcesses.current.find(
        (p) => p.id === processId
      );
      if (!process || process.status === ExecutionProcessStatus.running) {
        return;
      }

      const entries = await loadEntriesForHistoricExecutionProcess(
        process,
        generation
      );
      if (!isCurrentGeneration(generation)) {
        return;
      }

      if (entries === null) {
        const attempt =
          (historicRetryAttemptsRef.current.get(processId) ?? 0) + 1;
        historicRetryAttemptsRef.current.set(processId, attempt);

        if (attempt < HISTORIC_REPLAY_BACKGROUND_MAX_RETRIES) {
          historicRetryDueAtRef.current.set(
            processId,
            Date.now() + getHistoricReplayRetryDelayMs(processId, attempt)
          );
        }

        setHistoricProcessFailure(generation, processId, true);
        return;
      }

      clearHistoricRetryTracking(processId);
      setHistoricProcessFailure(generation, processId, false);

      const entriesWithKey = entries.map((entry, index) =>
        patchWithKey(entry, process.id, index)
      );
      const didMerge = mergeIntoDisplayedForGeneration(generation, (state) => {
        state[process.id] = {
          executionProcess: process,
          entries: entriesWithKey,
        };
      });
      if (!didMerge) return;

      emitEntriesForGeneration(
        generation,
        displayedExecutionProcesses.current,
        'historic',
        false
      );
    },
    [
      clearHistoricRetryTracking,
      emitEntriesForGeneration,
      isCurrentGeneration,
      loadEntriesForHistoricExecutionProcess,
      mergeIntoDisplayedForGeneration,
      setHistoricProcessFailure,
    ]
  );

  const scheduleHistoricReplayRetry = useCallback(
    (generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      if (historicRetryTimerRef.current !== null) return;

      const failedIds = [...failedHistoricProcessIdsRef.current].filter(
        (id) => {
          if (historicRetryInFlightRef.current.has(id)) return false;
          return (
            (historicRetryAttemptsRef.current.get(id) ?? 0) <
            HISTORIC_REPLAY_BACKGROUND_MAX_RETRIES
          );
        }
      );
      if (failedIds.length === 0) return;

      let nextProcessId: string | null = null;
      let nextDueAt = Number.POSITIVE_INFINITY;

      for (const processId of failedIds) {
        const dueAt =
          historicRetryDueAtRef.current.get(processId) ?? Date.now();
        if (dueAt < nextDueAt) {
          nextDueAt = dueAt;
          nextProcessId = processId;
        }
      }

      if (!nextProcessId) return;

      const delay = Math.max(0, nextDueAt - Date.now());
      historicRetryTimerRef.current = window.setTimeout(() => {
        historicRetryTimerRef.current = null;

        if (!isCurrentGeneration(generation)) return;
        if (
          historicRetryInFlightRef.current.size >=
          HISTORIC_REPLAY_BACKGROUND_MAX_CONCURRENCY
        ) {
          scheduleHistoricReplayRetry(generation);
          return;
        }

        if (!failedHistoricProcessIdsRef.current.has(nextProcessId)) {
          clearHistoricRetryTracking(nextProcessId);
          scheduleHistoricReplayRetry(generation);
          return;
        }

        const attempts =
          historicRetryAttemptsRef.current.get(nextProcessId) ?? 0;
        if (attempts >= HISTORIC_REPLAY_BACKGROUND_MAX_RETRIES) {
          scheduleHistoricReplayRetry(generation);
          return;
        }

        historicRetryDueAtRef.current.delete(nextProcessId);
        historicRetryInFlightRef.current.add(nextProcessId);

        void retryHistoricProcessInBackground(
          nextProcessId,
          generation
        ).finally(() => {
          historicRetryInFlightRef.current.delete(nextProcessId);
          if (!isCurrentGeneration(generation)) return;
          scheduleHistoricReplayRetry(generation);
        });
      }, delay);
    },
    [
      clearHistoricRetryTracking,
      isCurrentGeneration,
      retryHistoricProcessInBackground,
    ]
  );

  const retryHistory = useCallback(() => {
    const generation = scopeGenerationRef.current;
    const failedProcessIds = [...failedHistoricProcessIdsRef.current];
    if (failedProcessIds.length === 0) return;

    clearHistoricRetryTimer();
    failedProcessIds.forEach((processId) => {
      historicRetryAttemptsRef.current.delete(processId);
      historicRetryDueAtRef.current.delete(processId);
    });

    setIsRetryingHistory(true);

    void Promise.all(
      failedProcessIds.map(async (processId) => {
        historicRetryInFlightRef.current.add(processId);
        try {
          await retryHistoricProcessInBackground(processId, generation);
        } finally {
          historicRetryInFlightRef.current.delete(processId);
        }
      })
    ).finally(() => {
      if (!isCurrentGeneration(generation)) return;
      setIsRetryingHistory(false);
      scheduleHistoricReplayRetry(generation);
    });
  }, [
    clearHistoricRetryTimer,
    isCurrentGeneration,
    retryHistoricProcessInBackground,
    scheduleHistoricReplayRetry,
  ]);

  useEffect(() => {
    failedHistoricProcessIdsRef.current = failedHistoricProcessIds;

    for (const processId of failedHistoricProcessIds) {
      if (
        historicRetryDueAtRef.current.has(processId) ||
        historicRetryInFlightRef.current.has(processId)
      ) {
        continue;
      }

      const nextAttempt =
        (historicRetryAttemptsRef.current.get(processId) ?? 0) + 1;
      if (nextAttempt > HISTORIC_REPLAY_BACKGROUND_MAX_RETRIES) {
        continue;
      }

      historicRetryDueAtRef.current.set(
        processId,
        Date.now() + getHistoricReplayRetryDelayMs(processId, nextAttempt)
      );
    }

    for (const processId of [...historicRetryAttemptsRef.current.keys()]) {
      if (!failedHistoricProcessIds.has(processId)) {
        clearHistoricRetryTracking(processId);
      }
    }

    scheduleHistoricReplayRetry(scopeGenerationRef.current);
  }, [
    clearHistoricRetryTracking,
    failedHistoricProcessIds,
    scheduleHistoricReplayRetry,
  ]);

  // This emits its own events as they are streamed
  const loadRunningAndEmit = useCallback(
    (executionProcess: ExecutionProcess, generation: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        let url = '';
        if (executionProcess.executor_action.typ.type === 'ScriptRequest') {
          url = `/api/execution-processes/${executionProcess.id}/raw-logs/ws`;
        } else {
          url = `/api/execution-processes/${executionProcess.id}/normalized-logs/ws`;
        }
        const controller = streamJsonPatchEntries<PatchType>(url, {
          replaySafeAppendOnly: true,
          retryOnUnexpectedClose: true,
          onEntries(entries) {
            if (!isCurrentGeneration(generation)) {
              finish(() => {
                controller.close();
                resolve();
              });
              return;
            }
            const patchesWithKey = entries.map((entry, index) =>
              patchWithKey(entry, executionProcess.id, index)
            );
            const didMerge = mergeIntoDisplayedForGeneration(
              generation,
              (state) => {
                state[executionProcess.id] = {
                  executionProcess,
                  entries: patchesWithKey,
                };
              }
            );
            if (!didMerge) {
              finish(() => {
                controller.close();
                resolve();
              });
              return;
            }
            emitEntriesForGeneration(
              generation,
              displayedExecutionProcesses.current,
              'running',
              false
            );
          },
          onFinished: () => {
            finish(() => {
              emitEntriesForGeneration(
                generation,
                displayedExecutionProcesses.current,
                'running',
                false
              );
              controller.close();
              resolve();
            });
          },
          onError: () => {
            if (!isCurrentGeneration(generation)) {
              finish(() => {
                controller.close();
                resolve();
              });
              return;
            }
            finish(() => {
              controller.close();
              reject();
            });
          },
        });
        runningStreamControllersRef.current.set(
          executionProcess.id,
          controller
        );
      });
    },
    [
      emitEntriesForGeneration,
      isCurrentGeneration,
      mergeIntoDisplayedForGeneration,
    ]
  );

  // Sometimes it can take a few seconds for the stream to start, wrap the loadRunningAndEmit method
  const loadRunningAndEmitWithBackoff = useCallback(
    async (executionProcess: ExecutionProcess, generation: number) => {
      for (let i = 0; i < 20; i++) {
        if (!isCurrentGeneration(generation)) return;
        try {
          await loadRunningAndEmit(executionProcess, generation);
          break;
        } catch (_) {
          if (!isCurrentGeneration(generation)) return;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    },
    [isCurrentGeneration, loadRunningAndEmit]
  );

  const loadHistoricEntries = useCallback(
    async (maxEntries?: number): Promise<ExecutionProcessStateStore> => {
      const localDisplayedExecutionProcesses: ExecutionProcessStateStore = {};
      const generation = scopeGenerationRef.current;

      if (!executionProcesses?.current) return localDisplayedExecutionProcesses;

      for (const executionProcess of [
        ...executionProcesses.current,
      ].reverse()) {
        if (!isCurrentGeneration(generation)) {
          return localDisplayedExecutionProcesses;
        }
        if (executionProcess.status === ExecutionProcessStatus.running)
          continue;

        const entries = await loadEntriesForHistoricExecutionProcess(
          executionProcess,
          generation
        );
        if (!isCurrentGeneration(generation)) {
          return localDisplayedExecutionProcesses;
        }
        if (entries === null) {
          setHistoricProcessFailure(generation, executionProcess.id, true);
          continue;
        }
        setHistoricProcessFailure(generation, executionProcess.id, false);
        const entriesWithKey = entries.map((e, idx) =>
          patchWithKey(e, executionProcess.id, idx)
        );

        localDisplayedExecutionProcesses[executionProcess.id] = {
          executionProcess,
          entries: entriesWithKey,
        };

        if (
          maxEntries != null &&
          flattenEntries(localDisplayedExecutionProcesses).length > maxEntries
        ) {
          break;
        }
      }

      return localDisplayedExecutionProcesses;
    },
    [
      executionProcesses,
      isCurrentGeneration,
      loadEntriesForHistoricExecutionProcess,
      setHistoricProcessFailure,
    ]
  );

  const loadRemainingEntriesInBatches = useCallback(
    async (batchSize: number): Promise<boolean> => {
      const generation = scopeGenerationRef.current;
      if (!executionProcesses?.current) return false;

      let anyUpdated = false;
      for (const executionProcess of [
        ...executionProcesses.current,
      ].reverse()) {
        if (!isCurrentGeneration(generation)) return false;
        const current = displayedExecutionProcesses.current;
        if (
          current[executionProcess.id] ||
          executionProcess.status === ExecutionProcessStatus.running
        )
          continue;

        const entries = await loadEntriesForHistoricExecutionProcess(
          executionProcess,
          generation
        );
        if (!isCurrentGeneration(generation)) return false;
        if (entries === null) {
          setHistoricProcessFailure(generation, executionProcess.id, true);
          continue;
        }
        setHistoricProcessFailure(generation, executionProcess.id, false);
        const entriesWithKey = entries.map((e, idx) =>
          patchWithKey(e, executionProcess.id, idx)
        );

        const didMerge = mergeIntoDisplayedForGeneration(
          generation,
          (state) => {
            state[executionProcess.id] = {
              executionProcess,
              entries: entriesWithKey,
            };
          }
        );
        if (!didMerge) return false;

        if (
          flattenEntries(displayedExecutionProcesses.current).length > batchSize
        ) {
          anyUpdated = true;
          break;
        }
        anyUpdated = true;
      }
      return anyUpdated;
    },
    [
      executionProcesses,
      isCurrentGeneration,
      loadEntriesForHistoricExecutionProcess,
      mergeIntoDisplayedForGeneration,
      setHistoricProcessFailure,
    ]
  );

  const ensureProcessVisible = useCallback((p: ExecutionProcess) => {
    mergeIntoDisplayed((state) => {
      if (!state[p.id]) {
        state[p.id] = {
          executionProcess: {
            id: p.id,
            created_at: p.created_at,
            updated_at: p.updated_at,
            executor_action: p.executor_action,
          },
          entries: [],
        };
      }
    });
  }, []);

  const idListKey = useMemo(
    () => executionProcessesRaw?.map((p) => p.id).join(','),
    [executionProcessesRaw]
  );

  const idStatusKey = useMemo(
    () => executionProcessesRaw?.map((p) => `${p.id}:${p.status}`).join(','),
    [executionProcessesRaw]
  );

  // Clean up entries for processes that have been removed (e.g., after reset)
  useEffect(() => {
    if (isLoading || !isConnected) return;
    const visibleProcessIds = new Set(executionProcessesRaw.map((p) => p.id));
    const displayedIds = Object.keys(displayedExecutionProcesses.current);
    let changed = false;

    for (const id of displayedIds) {
      if (!visibleProcessIds.has(id)) {
        closeRunningStream(id);
        delete displayedExecutionProcesses.current[id];
        changed = true;
      }
    }

    if (changed) {
      emitEntries(displayedExecutionProcesses.current, 'historic', false);
    }
  }, [
    closeRunningStream,
    idListKey,
    executionProcessesRaw,
    emitEntries,
    isLoading,
    isConnected,
  ]);

  useEffect(() => {
    scopeGenerationRef.current += 1;
    closeAllRunningStreams();
    clearHistoricRetryTracking();
    displayedExecutionProcesses.current = {};
    loadedInitialEntries.current = false;
    emittedEmptyInitialRef.current = false;
    emittedPreviewRef.current = false;
    loadEarlierHistoryInFlightRef.current = false;
    streamingProcessIdsRef.current.clear();
    previousStatusMapRef.current.clear();
    setIsLoadingHistory(false);
    setIsRetryingHistory(false);
    setHasMoreHistory(false);
    setFailedHistoricProcessIds(new Set());
    emitEntries(displayedExecutionProcesses.current, 'initial', true);
  }, [
    clearHistoricRetryTracking,
    closeAllRunningStreams,
    scopeKey,
    emitEntries,
  ]);

  useEffect(() => {
    if (previewMode === 'disabled') return;
    if (emittedPreviewRef.current) return;
    const generation = scopeGenerationRef.current;
    let cancelled = false;

    (async () => {
      try {
        const preview =
          previewMode === 'session' && attempt.session?.id
            ? await sessionsApi.getConversationPreview(
                attempt.session.id,
                MIN_INITIAL_ENTRIES,
                hostId
              )
            : await workspacesApi.getConversationPreview(
                attempt.id,
                MIN_INITIAL_ENTRIES,
                hostId
              );

        if (cancelled || !isCurrentGeneration(generation)) return;
        emittedPreviewRef.current = true;
        if (preview.messages.length === 0) return;

        const previewState =
          conversationPreviewToExecutionProcessState(preview);
        const didMerge = mergeIntoDisplayedForGeneration(
          generation,
          (state) => {
            mergePreviewIntoExecutionProcessState(
              state,
              previewState,
              executionProcesses.current
            );
          }
        );
        if (!didMerge) return;

        emitEntriesForGeneration(
          generation,
          displayedExecutionProcesses.current,
          'initial',
          false
        );
      } catch (error) {
        if (!cancelled && isCurrentGeneration(generation)) {
          console.warn('Failed to load conversation preview', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attempt.id,
    attempt.session?.id,
    emitEntriesForGeneration,
    hostId,
    isCurrentGeneration,
    mergeIntoDisplayedForGeneration,
    previewMode,
    scopeKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    const generation = scopeGenerationRef.current;
    (async () => {
      if (loadedInitialEntries.current) return;

      if (isLoading) return;

      if (executionProcesses.current.length === 0) {
        if (emittedEmptyInitialRef.current) return;
        emittedEmptyInitialRef.current = true;
        setLoadingHistoryForGeneration(generation, false);
        emitEntriesForGeneration(
          generation,
          displayedExecutionProcesses.current,
          'initial',
          false
        );
        return;
      }

      emittedEmptyInitialRef.current = false;

      const allInitialEntries = await loadHistoricEntries(MIN_INITIAL_ENTRIES);
      if (cancelled || !isCurrentGeneration(generation)) {
        setLoadingHistoryForGeneration(generation, false);
        return;
      }
      loadedInitialEntries.current = true;
      const didMerge = mergeIntoDisplayedForGeneration(generation, (state) => {
        Object.assign(state, allInitialEntries);
      });
      if (!didMerge) {
        setLoadingHistoryForGeneration(generation, false);
        return;
      }
      emitEntriesForGeneration(
        generation,
        displayedExecutionProcesses.current,
        'initial',
        false
      );

      if (shouldAutoReplayRemainingHistoryAfterInitialLoad()) {
        setLoadingHistoryForGeneration(generation, true);
        while (
          !cancelled &&
          (await loadRemainingEntriesInBatches(REMAINING_BATCH_SIZE))
        ) {
          if (cancelled || !isCurrentGeneration(generation)) {
            setLoadingHistoryForGeneration(generation, false);
            return;
          }
          emitEntriesForGeneration(
            generation,
            displayedExecutionProcesses.current,
            'historic',
            false
          );
        }
        if (!cancelled && isCurrentGeneration(generation)) {
          setLoadingHistoryForGeneration(generation, false);
        }
      }

      updateHasMoreHistoryForGeneration(generation);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    scopeKey,
    idListKey,
    isCurrentGeneration,
    isLoading,
    emitEntriesForGeneration,
    loadHistoricEntries,
    loadRemainingEntriesInBatches,
    mergeIntoDisplayedForGeneration,
    setLoadingHistoryForGeneration,
    updateHasMoreHistoryForGeneration,
  ]); // include idListKey so new processes trigger reload

  const loadEarlierHistory = useCallback(async () => {
    const generation = scopeGenerationRef.current;

    await loadExplicitEarlierHistoryBatch({
      generation,
      batchSize: REMAINING_BATCH_SIZE,
      inFlightRef: loadEarlierHistoryInFlightRef,
      isCurrentGeneration,
      hasUnloadedHistory: hasUnloadedHistoricProcesses,
      updateHasMoreHistoryForGeneration,
      setLoadingHistoryForGeneration,
      loadRemainingEntriesInBatches,
      emitHistoricEntriesForGeneration: (currentGeneration) =>
        emitEntriesForGeneration(
          currentGeneration,
          displayedExecutionProcesses.current,
          'historic',
          false
        ),
    });
  }, [
    emitEntriesForGeneration,
    hasUnloadedHistoricProcesses,
    isCurrentGeneration,
    loadRemainingEntriesInBatches,
    setLoadingHistoryForGeneration,
    updateHasMoreHistoryForGeneration,
  ]);

  useEffect(() => {
    const activeProcesses = getActiveAgentProcesses();
    if (activeProcesses.length === 0) return;
    const generation = scopeGenerationRef.current;

    for (const activeProcess of activeProcesses) {
      if (!displayedExecutionProcesses.current[activeProcess.id]) {
        const runningOrInitial =
          Object.keys(displayedExecutionProcesses.current).length > 1
            ? 'running'
            : 'initial';
        ensureProcessVisible(activeProcess);
        emitEntriesForGeneration(
          generation,
          displayedExecutionProcesses.current,
          runningOrInitial,
          false
        );
      }

      if (
        activeProcess.status === ExecutionProcessStatus.running &&
        !streamingProcessIdsRef.current.has(activeProcess.id)
      ) {
        streamingProcessIdsRef.current.add(activeProcess.id);
        void loadRunningAndEmitWithBackoff(activeProcess, generation).finally(
          () => {
            closeRunningStream(activeProcess.id);
            if (!isCurrentGeneration(generation)) return;
            streamingProcessIdsRef.current.delete(activeProcess.id);
          }
        );
      }
    }
  }, [
    scopeKey,
    idStatusKey,
    emitEntriesForGeneration,
    ensureProcessVisible,
    isCurrentGeneration,
    closeRunningStream,
    loadRunningAndEmitWithBackoff,
  ]);

  useEffect(() => {
    if (!executionProcessesRaw) return;

    const processesToReload: ExecutionProcess[] = [];

    for (const process of executionProcessesRaw) {
      const previousStatus = previousStatusMapRef.current.get(process.id);
      const currentStatus = process.status;

      if (
        previousStatus === ExecutionProcessStatus.running &&
        currentStatus !== ExecutionProcessStatus.running &&
        displayedExecutionProcesses.current[process.id]
      ) {
        processesToReload.push(process);
      }

      previousStatusMapRef.current.set(process.id, currentStatus);
    }

    if (processesToReload.length === 0) return;

    const generation = scopeGenerationRef.current;
    (async () => {
      let anyUpdated = false;

      for (const process of processesToReload) {
        if (!isCurrentGeneration(generation)) return;
        const entries = await loadEntriesForHistoricExecutionProcess(
          process,
          generation
        );
        if (!isCurrentGeneration(generation)) return;
        if (entries === null) {
          setHistoricProcessFailure(generation, process.id, true);
          continue;
        }
        setHistoricProcessFailure(generation, process.id, false);

        const entriesWithKey = entries.map((e, idx) =>
          patchWithKey(e, process.id, idx)
        );

        const didMerge = mergeIntoDisplayedForGeneration(
          generation,
          (state) => {
            state[process.id] = {
              executionProcess: process,
              entries: entriesWithKey,
            };
          }
        );
        if (!didMerge) return;
        anyUpdated = true;
      }

      if (anyUpdated && isCurrentGeneration(generation)) {
        emitEntriesForGeneration(
          generation,
          displayedExecutionProcesses.current,
          'running',
          false
        );
        updateHasMoreHistoryForGeneration(generation);
      }
    })();
  }, [
    idStatusKey,
    executionProcessesRaw,
    emitEntriesForGeneration,
    isCurrentGeneration,
    loadEntriesForHistoricExecutionProcess,
    mergeIntoDisplayedForGeneration,
    setHistoricProcessFailure,
    updateHasMoreHistoryForGeneration,
  ]);

  // If an execution process is removed, remove it from the state
  useEffect(() => {
    if (!executionProcessesRaw) return;

    const removedProcessIds = Object.keys(
      displayedExecutionProcesses.current
    ).filter((id) => !executionProcessesRaw.some((p) => p.id === id));

    if (removedProcessIds.length > 0) {
      mergeIntoDisplayed((state) => {
        removedProcessIds.forEach((id) => {
          delete state[id];
        });
      });
      setFailedHistoricProcessIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        removedProcessIds.forEach((id) => {
          clearHistoricRetryTracking(id);
          if (next.delete(id)) {
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      updateHasMoreHistoryForGeneration(scopeGenerationRef.current);
    }
  }, [
    clearHistoricRetryTracking,
    scopeKey,
    idListKey,
    executionProcessesRaw,
    updateHasMoreHistoryForGeneration,
  ]);

  const historyError =
    failedHistoricProcessIds.size > 0 ? HISTORIC_REPLAY_ERROR : null;
  const canRetryHistory = failedHistoricProcessIds.size > 0;

  return {
    isFirstTurn,
    isLoadingHistory: isLoadingHistoryState,
    hasMoreHistory,
    loadEarlierHistory,
    historyError,
    canRetryHistory,
    isRetryingHistory,
    retryHistory,
  };
};
