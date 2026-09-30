import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SpinnerIcon } from '@phosphor-icons/react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  findPreviousUserMessageIndex,
  type ConversationRow,
} from '../model/conversation-row-model';
import { deriveConversationEntries } from '../model/deriveConversationEntries';
import { deriveConversationTimeline } from '../model/deriveConversationTimeline';
import { useConversationVirtualizer } from '../model/useConversationVirtualizer';
import { useScrollCommandExecutor } from '../model/useScrollCommandExecutor';

import DisplayConversationEntry from './DisplayConversationEntry';
import { ApprovalFormProvider } from '@/shared/hooks/ApprovalForm';
import { useEntriesActions } from '../model/contexts/EntriesContext';
import {
  useResetProcess,
  type UseResetProcessResult,
} from '../model/hooks/useResetProcess';
import type {
  AddEntryType,
  ConversationTimelineSource,
  DisplayEntry,
} from '@/shared/hooks/useConversationHistory/types';
import {
  isAggregatedGroup,
  isAggregatedDiffGroup,
  isAggregatedThinkingGroup,
} from '@/shared/hooks/useConversationHistory/types';
import { useConversationHistory } from '../model/hooks/useConversationHistory';
import { shouldAutoLoadEarlierHistoryAtBoundary } from '../model/hooks/conversationHistoryLoadingPolicy';
import { useSetTokenUsageInfo } from '../model/contexts/EntriesContext';
import type { WorkspaceWithSession } from '@/shared/types/attempt';
import type { RepoWithTargetBranch } from 'shared/types';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import { ChatEmptyState } from '@vibe/ui/components/ChatEmptyState';
import { ChatScriptPlaceholder } from '@vibe/ui/components/ChatScriptPlaceholder';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { ScriptFixerDialog } from '@/shared/dialogs/scripts/ScriptFixerDialog';
import {
  isMobilePerfDiagnosticsEnabled,
  recordMobilePerfDiagnostic,
} from '@/shared/lib/mobilePerfDiagnostics';

const HISTORY_BOUNDARY_THRESHOLD_PX = 96;
const SCROLL_TO_INDEX_SETTLE_FRAMES = 4;

interface ConversationListProps {
  attempt: WorkspaceWithSession;
  repos?: RepoWithTargetBranch[];
  onAtBottomChange?: (atBottom: boolean) => void;
  sessionScopeId?: string;
  previewMode?: 'workspace' | 'session' | 'disabled';
}

export interface ConversationListHandle {
  scrollToPreviousUserMessage: () => void;
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
  adjustScrollBy: (delta: number) => void;
  getScrollElement: () => HTMLDivElement | null;
  scrollToEntryByPatchKey: (patchKey: string) => void;
  getVisibleUserMessagePatchKey: () => string | null;
}

function renderRowContent(
  entry: DisplayEntry,
  attempt: WorkspaceWithSession,
  resetAction: UseResetProcessResult,
  repos: RepoWithTargetBranch[]
): React.ReactNode {
  if (isAggregatedGroup(entry)) {
    return (
      <DisplayConversationEntry
        expansionKey={entry.patchKey}
        aggregatedGroup={entry}
        aggregatedDiffGroup={null}
        aggregatedThinkingGroup={null}
        entry={null}
        executionProcessId={entry.executionProcessId}
        workspaceWithSession={attempt}
        resetAction={resetAction}
        repos={repos}
      />
    );
  }

  if (isAggregatedDiffGroup(entry)) {
    return (
      <DisplayConversationEntry
        expansionKey={entry.patchKey}
        aggregatedGroup={null}
        aggregatedDiffGroup={entry}
        aggregatedThinkingGroup={null}
        entry={null}
        executionProcessId={entry.executionProcessId}
        workspaceWithSession={attempt}
        resetAction={resetAction}
        repos={repos}
      />
    );
  }

  if (isAggregatedThinkingGroup(entry)) {
    return (
      <DisplayConversationEntry
        expansionKey={entry.patchKey}
        aggregatedGroup={null}
        aggregatedDiffGroup={null}
        aggregatedThinkingGroup={entry}
        entry={null}
        executionProcessId={entry.executionProcessId}
        workspaceWithSession={attempt}
        resetAction={resetAction}
        repos={repos}
      />
    );
  }

  if (entry.type === 'STDOUT') {
    return <p>{entry.content}</p>;
  }
  if (entry.type === 'STDERR') {
    return <p>{entry.content}</p>;
  }

  if (entry.type === 'NORMALIZED_ENTRY') {
    return (
      <DisplayConversationEntry
        expansionKey={entry.patchKey}
        entry={entry.content}
        aggregatedGroup={null}
        aggregatedDiffGroup={null}
        aggregatedThinkingGroup={null}
        executionProcessId={entry.executionProcessId}
        workspaceWithSession={attempt}
        resetAction={resetAction}
        repos={repos}
      />
    );
  }

  return null;
}

export const ConversationList = forwardRef<
  ConversationListHandle,
  ConversationListProps
>(function ConversationList(
  {
    attempt,
    repos: reposProp = [],
    onAtBottomChange,
    sessionScopeId,
    previewMode = attempt.session ? 'session' : 'workspace',
  },
  ref
) {
  const { t } = useTranslation('common');
  const repos = reposProp;
  const resetAction = useResetProcess(attempt.id, attempt.session?.id);
  const conversationScopeKey = `${attempt.id}:${sessionScopeId ?? attempt.session?.id ?? 'new'}`;
  const [filteredEntries, setFilteredEntries] = useState<DisplayEntry[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasSetupScriptRun, setHasSetupScriptRun] = useState(false);
  const [hasCleanupScriptRun, setHasCleanupScriptRun] = useState(false);
  const [hasRunningProcess, setHasRunningProcess] = useState(false);
  const [isNearHistoryBoundary, setIsNearHistoryBoundary] = useState(true);
  const { setEntries, reset } = useEntriesActions();
  const setTokenUsageInfo = useSetTokenUsageInfo();
  const scriptOutputCacheRef = useRef<
    Map<string, { count: number; output: string }>
  >(new Map());
  const scrollOnEntriesChangedRef = useRef<
    ((addType: AddEntryType, isInitialLoad: boolean) => void) | null
  >(null);
  const prevEntriesRef = useRef<DisplayEntry[]>([]);
  const prevRowsRef = useRef<ConversationRow[]>([]);
  const lastScrollDiagnosticAtRef = useRef(0);
  const pendingUpdateRef = useRef<{
    source: ConversationTimelineSource;
    addType: AddEntryType;
    loading: boolean;
    isInitialLoad: boolean;
  } | null>(null);
  // rAF throttle: at most one state update per animation frame.
  // Replaces the previous 100ms trailing debounce which never fired during
  // continuous streaming (upstream rAF in streamJsonPatchEntries reset the
  // timer every ~16ms). TanStack Virtual has no internal batching — unlike
  // Virtuoso — so we need to drive renders explicitly via React state.
  // rAF naturally limits updates to the display refresh rate (~60fps) while
  // ensuring every frame reflects the latest data.
  const rafIdRef = useRef<number | null>(null);
  const autoLoadEarlierHistoryFrameRef = useRef<number | null>(null);
  const autoLoadEarlierHistoryRequestedRef = useRef(false);
  const autoLoadEarlierHistoryArmedRef = useRef(false);
  const conversationRows = useMemo(
    () => prevRowsRef.current,
    [filteredEntries]
  );

  // Use ref to access current repos without causing callback recreation
  const reposRef = useRef(repos);
  reposRef.current = repos;

  // Check if any repo has setup or cleanup scripts configured
  const hasSetupScript = repos.some((repo) => repo.setup_script);
  const hasCleanupScript = repos.some((repo) => repo.cleanup_script);

  // Handlers to open script fixer dialog for setup/cleanup scripts
  const handleConfigureSetup = useCallback(() => {
    const currentRepos = reposRef.current;
    if (currentRepos.length === 0) return;

    ScriptFixerDialog.show({
      scriptType: 'setup',
      repos: currentRepos,
      workspaceId: attempt.id,
      sessionId: attempt.session?.id,
    });
  }, [attempt.id, attempt.session?.id]);

  const handleConfigureCleanup = useCallback(() => {
    const currentRepos = reposRef.current;
    if (currentRepos.length === 0) return;

    ScriptFixerDialog.show({
      scriptType: 'cleanup',
      repos: currentRepos,
      workspaceId: attempt.id,
      sessionId: attempt.session?.id,
    });
  }, [attempt.id, attempt.session?.id]);

  // Determine if configure buttons should be shown
  const canConfigure = repos.length > 0;

  useEffect(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingUpdateRef.current = null;
    scriptOutputCacheRef.current.clear();
    setLoading(true);
    setHasSetupScriptRun(false);
    setHasCleanupScriptRun(false);
    setHasRunningProcess(false);
    setIsNearHistoryBoundary(true);
    autoLoadEarlierHistoryRequestedRef.current = false;
    autoLoadEarlierHistoryArmedRef.current = false;
    setFilteredEntries([]);
    setDataVersion(0);
    reset();
  }, [conversationScopeKey, reset]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (autoLoadEarlierHistoryFrameRef.current !== null) {
        cancelAnimationFrame(autoLoadEarlierHistoryFrameRef.current);
      }
    };
  }, []);

  // ---- TanStack Virtual plumbing ----
  const tanstackScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRetryFrameRef = useRef<number | null>(null);

  const updateIsNearHistoryBoundary = useCallback(() => {
    const scrollEl = tanstackScrollRef.current;
    const nextValue = scrollEl
      ? scrollEl.scrollTop <= HISTORY_BOUNDARY_THRESHOLD_PX
      : true;
    if (!nextValue) {
      autoLoadEarlierHistoryRequestedRef.current = false;
      autoLoadEarlierHistoryArmedRef.current = true;
    }
    if (scrollEl && isMobilePerfDiagnosticsEnabled()) {
      const now = performance.now();
      if (now - lastScrollDiagnosticAtRef.current > 1000) {
        lastScrollDiagnosticAtRef.current = now;
        recordMobilePerfDiagnostic('conversation.scroll', {
          has_workspace: true,
          has_session: !!attempt.session?.id,
          scroll_top: Math.round(scrollEl.scrollTop),
          scroll_height: scrollEl.scrollHeight,
          client_height: scrollEl.clientHeight,
          row_count: prevRowsRef.current.length,
          near_history_boundary: nextValue,
        });
      }
    }
    setIsNearHistoryBoundary((current) =>
      current === nextValue ? current : nextValue
    );
  }, [attempt.id, attempt.session?.id]);

  useEffect(() => {
    const scrollEl = tanstackScrollRef.current;
    if (!scrollEl) return;

    scrollEl.addEventListener('scroll', updateIsNearHistoryBoundary, {
      passive: true,
    });
    updateIsNearHistoryBoundary();

    return () => {
      scrollEl.removeEventListener('scroll', updateIsNearHistoryBoundary);
    };
  }, [updateIsNearHistoryBoundary]);

  const flushPendingUpdate = () => {
    rafIdRef.current = null;
    const pending = pendingUpdateRef.current;
    if (!pending) return;

    const diagnosticsEnabled = isMobilePerfDiagnosticsEnabled();
    const startedAt = diagnosticsEnabled ? performance.now() : 0;
    const previousEntryCount = prevEntriesRef.current.length;
    const previousRowCount = prevRowsRef.current.length;

    const derivedEntries = deriveConversationEntries({
      source: pending.source,
      scriptOutputCache: scriptOutputCacheRef.current,
    });

    setHasSetupScriptRun(derivedEntries.hasSetupScriptRun);
    setHasCleanupScriptRun(derivedEntries.hasCleanupScriptRun);
    setHasRunningProcess(derivedEntries.hasRunningProcess);
    setTokenUsageInfo(derivedEntries.latestTokenUsageInfo);

    const timelineStartedAt = diagnosticsEnabled ? performance.now() : 0;
    const derivedTimeline = deriveConversationTimeline(
      derivedEntries.entries,
      prevEntriesRef.current,
      prevRowsRef.current
    );

    prevEntriesRef.current = derivedTimeline.displayEntries;
    prevRowsRef.current = derivedTimeline.rows;

    setFilteredEntries(derivedTimeline.displayEntries);
    setDataVersion((current) => current + 1);
    setEntries(derivedEntries.entries);

    if (diagnosticsEnabled) {
      const finishedAt = performance.now();
      recordMobilePerfDiagnostic('conversation.timeline_flush', {
        has_workspace: true,
        has_session: !!attempt.session?.id,
        add_type: pending.addType,
        initial_load: pending.isInitialLoad,
        loading: pending.loading,
        entry_count: derivedTimeline.displayEntries.length,
        row_count: derivedTimeline.rows.length,
        previous_entry_count: previousEntryCount,
        previous_row_count: previousRowCount,
        derive_timeline_ms: Math.round(finishedAt - timelineStartedAt),
        total_duration_ms: Math.round(finishedAt - startedAt),
        has_running_process: derivedEntries.hasRunningProcess,
        setup_script_seen: derivedEntries.hasSetupScriptRun,
        cleanup_script_seen: derivedEntries.hasCleanupScriptRun,
      });
    }

    scrollOnEntriesChangedRef.current?.(pending.addType, pending.isInitialLoad);

    if (loading) {
      setLoading(pending.loading);
    }
  };

  const onTimelineUpdated = (
    source: ConversationTimelineSource,
    addType: AddEntryType,
    newLoading: boolean
  ) => {
    const alreadyScheduled = rafIdRef.current !== null;
    pendingUpdateRef.current = {
      source,
      addType,
      loading: newLoading,
      isInitialLoad: addType === 'initial',
    };

    if (isMobilePerfDiagnosticsEnabled()) {
      recordMobilePerfDiagnostic('conversation.timeline_update', {
        has_workspace: true,
        has_session: !!attempt.session?.id,
        add_type: addType,
        loading: newLoading,
        already_scheduled: alreadyScheduled,
      });
    }

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushPendingUpdate);
    }
  };

  const {
    isFirstTurn,
    isLoadingHistory,
    hasMoreHistory,
    loadEarlierHistory,
    historyError,
    canRetryHistory,
    isRetryingHistory,
    retryHistory,
  } = useConversationHistory({
    attempt,
    onTimelineUpdated,
    previewMode,
    scopeKey: conversationScopeKey,
  });

  const conversationVirtualizer = useConversationVirtualizer({
    rows: conversationRows,
    scrollContainerRef: tanstackScrollRef,
    onAtBottomChange,
  });

  useEffect(() => {
    if (!hasMoreHistory) {
      autoLoadEarlierHistoryRequestedRef.current = false;
      return;
    }

    if (!isNearHistoryBoundary || isLoadingHistory || historyError !== null) {
      return;
    }

    if (autoLoadEarlierHistoryFrameRef.current !== null) {
      cancelAnimationFrame(autoLoadEarlierHistoryFrameRef.current);
    }

    autoLoadEarlierHistoryFrameRef.current = requestAnimationFrame(() => {
      autoLoadEarlierHistoryFrameRef.current = null;
      const scrollEl = tanstackScrollRef.current;
      const isScrollable = scrollEl
        ? scrollEl.scrollHeight - scrollEl.clientHeight > 1
        : false;

      if (
        !shouldAutoLoadEarlierHistoryAtBoundary({
          hasMoreHistory,
          isNearHistoryBoundary,
          isLoadingHistory,
          hasHistoryError: historyError !== null,
          hasRequestedForCurrentBoundary:
            autoLoadEarlierHistoryRequestedRef.current,
          hasLeftInitialBoundary: autoLoadEarlierHistoryArmedRef.current,
          isScrollable,
          isAtBottom: conversationVirtualizer.checkIsAtBottom(),
        })
      ) {
        return;
      }

      autoLoadEarlierHistoryRequestedRef.current = true;
      void loadEarlierHistory();
    });

    return () => {
      if (autoLoadEarlierHistoryFrameRef.current !== null) {
        cancelAnimationFrame(autoLoadEarlierHistoryFrameRef.current);
        autoLoadEarlierHistoryFrameRef.current = null;
      }
    };
  }, [
    conversationVirtualizer,
    hasMoreHistory,
    historyError,
    isLoadingHistory,
    isNearHistoryBoundary,
    loadEarlierHistory,
  ]);

  const scrollExecutor = useScrollCommandExecutor({
    virtualizer: conversationVirtualizer.virtualizer,
    itemCount: conversationRows.length,
    dataVersion,
    checkIsAtBottom: conversationVirtualizer.checkIsAtBottom,
    scrollToBottom: conversationVirtualizer.scrollToBottom,
  });
  scrollOnEntriesChangedRef.current = scrollExecutor.onEntriesChanged;

  const scrollToIndexWithMeasurementRetry = useCallback(
    (
      index: number,
      options?: {
        align?: 'start' | 'center' | 'end';
        behavior?: 'auto' | 'smooth';
      }
    ) => {
      if (pendingScrollRetryFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollRetryFrameRef.current);
        pendingScrollRetryFrameRef.current = null;
      }

      const align = options?.align ?? 'start';
      const behavior = options?.behavior ?? 'auto';
      let remainingFrames = SCROLL_TO_INDEX_SETTLE_FRAMES;

      const scroll = (nextBehavior: 'auto' | 'smooth') => {
        conversationVirtualizer.scrollToIndex(index, {
          align,
          behavior: nextBehavior,
        });
      };

      const retry = () => {
        pendingScrollRetryFrameRef.current = null;
        if (remainingFrames <= 0) return;

        remainingFrames -= 1;
        scroll('auto');
        pendingScrollRetryFrameRef.current = requestAnimationFrame(retry);
      };

      scroll(behavior);
      pendingScrollRetryFrameRef.current = requestAnimationFrame(retry);
    },
    [conversationVirtualizer]
  );

  useEffect(() => {
    return () => {
      if (pendingScrollRetryFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollRetryFrameRef.current);
      }
    };
  }, []);

  // Determine if there are entries to show placeholders
  const hasEntries = conversationRows.length > 0;

  // Show placeholders only if script not configured AND not already run AND first turn
  const showSetupPlaceholder =
    !hasSetupScript && !hasSetupScriptRun && hasEntries;
  const showCleanupPlaceholder =
    !hasCleanupScript &&
    !hasCleanupScriptRun &&
    !hasRunningProcess &&
    hasEntries &&
    isFirstTurn;

  // Expose scroll functionality via ref — delegates to TanStack Virtual
  const scrollToPreviousUserMessage = useCallback(() => {
    const scrollEl = tanstackScrollRef.current;
    if (!scrollEl || conversationRows.length === 0) return;

    const containerTop = scrollEl.getBoundingClientRect().top;
    const rowNodes = Array.from(
      scrollEl.querySelectorAll<HTMLElement>('[data-row-index]')
    );

    let firstVisibleIndex = conversationRows.length - 1;

    for (const node of rowNodes) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= containerTop + 1) continue;
      const indexAttr = node.dataset.rowIndex;
      if (!indexAttr) continue;
      const parsedIndex = Number.parseInt(indexAttr, 10);
      if (!Number.isFinite(parsedIndex)) continue;
      firstVisibleIndex = parsedIndex;
      break;
    }

    const targetIndex = findPreviousUserMessageIndex(
      conversationRows,
      firstVisibleIndex
    );

    if (targetIndex < 0) return;

    scrollToIndexWithMeasurementRetry(targetIndex, {
      align: 'start',
      behavior: 'auto',
    });
  }, [conversationRows, scrollToIndexWithMeasurementRetry]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPreviousUserMessage: () => {
        scrollToPreviousUserMessage();
      },
      scrollToBottom: (behavior = 'smooth') => {
        conversationVirtualizer.scrollToBottom(behavior);
      },
      adjustScrollBy: (delta) => {
        if (Math.abs(delta) < 0.5) return;
        const scrollElement = tanstackScrollRef.current;
        if (!scrollElement) return;
        scrollElement.scrollTop += delta;
      },
      getScrollElement: () => tanstackScrollRef.current,
      scrollToEntryByPatchKey: (patchKey: string) => {
        const targetIndex = conversationRows.findIndex(
          (row) => row.entry.patchKey === patchKey
        );
        if (targetIndex < 0) return;
        scrollToIndexWithMeasurementRetry(targetIndex, {
          align: 'start',
          behavior: 'auto',
        });
      },
      getVisibleUserMessagePatchKey: () => {
        const scrollEl = tanstackScrollRef.current;
        if (!scrollEl || conversationRows.length === 0) return null;

        const containerTop = scrollEl.getBoundingClientRect().top;
        const rowNodes = Array.from(
          scrollEl.querySelectorAll<HTMLElement>('[data-row-index]')
        );

        let firstVisibleIndex = conversationRows.length - 1;

        for (const node of rowNodes) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom <= containerTop + 1) continue;
          const indexAttr = node.dataset.rowIndex;
          if (!indexAttr) continue;
          const parsedIndex = Number.parseInt(indexAttr, 10);
          if (!Number.isFinite(parsedIndex)) continue;
          firstVisibleIndex = parsedIndex;
          break;
        }

        // Find the nearest user message at or before the first visible index
        for (let i = firstVisibleIndex; i >= 0; i--) {
          if (conversationRows[i].isUserMessage) {
            return conversationRows[i].entry.patchKey;
          }
        }
        return null;
      },
    }),
    [
      conversationRows,
      conversationVirtualizer,
      scrollToIndexWithMeasurementRetry,
      scrollToPreviousUserMessage,
    ]
  );

  const showLoader = loading && conversationRows.length === 0;
  const showEmptyState = !loading && conversationRows.length === 0;
  const showHistoryStatus =
    !showLoader &&
    isNearHistoryBoundary &&
    (isLoadingHistory || historyError !== null);

  const { virtualItems, totalSize, measureElement } = conversationVirtualizer;

  return (
    <ApprovalFormProvider>
      <div className="relative h-full overflow-hidden">
        {showLoader && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <SpinnerIcon className="size-6 animate-spin text-low" />
          </div>
        )}
        <div
          ref={tanstackScrollRef}
          className="relative h-full overflow-y-auto scrollbar-none"
          style={{ overflowAnchor: 'none', contain: 'strict' }}
        >
          {showHistoryStatus && (
            <div className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-double">
              {isLoadingHistory ? (
                <div className="rounded border bg-panel px-double py-3">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex w-full flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-16 animate-pulse rounded-full bg-foreground/10" />
                        <div className="h-2.5 flex-1 animate-pulse rounded-full bg-foreground/[0.06]" />
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-24 animate-pulse rounded-full bg-foreground/[0.07]"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="h-2.5 w-32 animate-pulse rounded-full bg-foreground/[0.05]"
                          style={{ animationDelay: '150ms' }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-low">
                      {t('conversation.loadingEarlierMessages')}
                    </span>
                  </div>
                </div>
              ) : historyError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-3">
                    {t('conversation.historyLoadError', {
                      defaultValue:
                        'Failed to load some earlier conversation messages. You can keep working, but older history may be incomplete until the retry succeeds.',
                    })}
                    {canRetryHistory && (
                      <div className="pointer-events-auto">
                        <PrimaryButton
                          variant="tertiary"
                          onClick={retryHistory}
                          disabled={isRetryingHistory}
                          actionIcon={isRetryingHistory ? 'spinner' : undefined}
                          value={t('retry')}
                        />
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}

          <div className="pt-2">
            {showSetupPlaceholder && (
              <div className="my-base px-double">
                <ChatScriptPlaceholder
                  type="setup"
                  onConfigure={canConfigure ? handleConfigureSetup : undefined}
                />
              </div>
            )}
          </div>

          {showEmptyState && (
            <div className="flex min-h-full items-center justify-center px-double py-12">
              <ChatEmptyState
                title={t('conversation.emptyTitle', {
                  defaultValue: 'Send a message to start the conversation.',
                })}
                description={t('conversation.emptyDescription', {
                  defaultValue:
                    'Your workspace conversation will appear here once a new turn starts.',
                })}
              />
            </div>
          )}

          {conversationRows.length > 0 && (
            <div
              style={{
                height: `${totalSize}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const row = conversationRows[virtualItem.index];
                if (!row) return null;
                return (
                  <div
                    key={row.semanticKey}
                    data-index={virtualItem.index}
                    data-row-index={virtualItem.index}
                    data-semantic-key={row.semanticKey}
                    ref={measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {renderRowContent(row.entry, attempt, resetAction, repos)}
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer placeholder */}
          <div className="pb-2">
            {showCleanupPlaceholder && (
              <div className="my-base px-double">
                <ChatScriptPlaceholder
                  type="cleanup"
                  onConfigure={
                    canConfigure ? handleConfigureCleanup : undefined
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </ApprovalFormProvider>
  );
});

export default ConversationList;
