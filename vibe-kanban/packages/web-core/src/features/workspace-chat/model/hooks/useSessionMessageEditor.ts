import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScratchType,
  type DraftFollowUpData,
  type ExecutorConfig,
} from 'shared/types';
import { useScratch } from '@/shared/hooks/useScratch';
import { useDebouncedCallback } from '@/shared/hooks/useDebouncedCallback';
import {
  acknowledgeStoredScratchDraft,
  areScratchDraftValuesEqual,
  clearStoredScratchDraft,
  readStoredScratchDraft,
  writeStoredScratchDraft,
} from '@/shared/lib/scratchDraftStore';

interface UseSessionMessageEditorOptions {
  /** Scratch ID (workspaceId for new session, sessionId for existing) */
  scratchId: string | undefined;
}

export function resolveSessionMessageScratchId(params: {
  approvalId: string | undefined;
  isNewSessionMode: boolean;
  workspaceId: string | undefined;
  sessionId: string | undefined;
}): string | undefined {
  return (
    params.approvalId ??
    (params.isNewSessionMode ? params.workspaceId : params.sessionId)
  );
}

interface UseSessionMessageEditorResult {
  /** Current message value */
  localMessage: string;
  /** Set local message directly */
  setLocalMessage: (value: string) => void;
  /** Scratch data (message and variant) */
  scratchData: DraftFollowUpData | undefined;
  /** Whether scratch is loading */
  isScratchLoading: boolean;
  /** Whether the initial value has been applied from scratch */
  hasInitialValue: boolean;
  /** Save message and executor config to scratch */
  saveToScratch: (
    message: string,
    executorConfig: ExecutorConfig
  ) => Promise<void>;
  /** Clear only the browser-local dirty draft mirror */
  discardLocalDraft: () => void;
  /** Best-effort delete of the authoritative draft scratch */
  deleteDraftScratch: () => Promise<void>;
  /** Delete the draft scratch */
  clearDraft: () => Promise<void>;
  /** Cancel pending debounced save */
  cancelDebouncedSave: () => void;
  /** Handle message change with debounced save */
  handleMessageChange: (value: string, executorConfig: ExecutorConfig) => void;
}

function logDeleteDraftScratchFailure(error: unknown): void {
  console.debug('Failed to delete follow-up draft scratch', error);
}

export function discardFollowUpLocalDraft(scratchId: string | undefined): void {
  if (!scratchId) return;
  clearStoredScratchDraft(ScratchType.DRAFT_FOLLOW_UP, scratchId);
}

export async function deleteDraftScratchBestEffort(
  deleteScratch: () => Promise<void>,
  onError: (error: unknown) => void = logDeleteDraftScratchFailure
): Promise<void> {
  try {
    await deleteScratch();
  } catch (error) {
    // The server may already have consumed/deleted the scratch during a
    // successful submit. The local draft mirror is the critical state to
    // clear so a stale submitted message cannot repopulate on reload.
    onError(error);
  }
}

export async function clearFollowUpDraft(params: {
  scratchId: string | undefined;
  cancelDebouncedSave: () => void;
  deleteScratch: () => Promise<void>;
  onDeleteError?: (error: unknown) => void;
}): Promise<void> {
  params.cancelDebouncedSave();
  discardFollowUpLocalDraft(params.scratchId);
  await deleteDraftScratchBestEffort(
    params.deleteScratch,
    params.onDeleteError
  );
}

export async function restoreQueuedFollowUpDraftAfterCancel(params: {
  queuedMessage: string | null;
  queuedConfig: ExecutorConfig | null;
  cancelQueue: () => Promise<void>;
  setLocalMessage: (value: string) => void;
  setExecutorOverrides: (config: Partial<ExecutorConfig>) => void;
  handleMessageChange: (value: string, executorConfig: ExecutorConfig) => void;
  saveToScratch: (
    message: string,
    executorConfig: ExecutorConfig
  ) => Promise<void>;
}): Promise<void> {
  await params.cancelQueue();

  const { queuedMessage, queuedConfig } = params;

  if (queuedMessage !== null) {
    params.setLocalMessage(queuedMessage);
  }

  if (queuedConfig) {
    params.setExecutorOverrides(queuedConfig);
  }

  if (queuedMessage !== null && queuedConfig) {
    params.handleMessageChange(queuedMessage, queuedConfig);
    await params.saveToScratch(queuedMessage, queuedConfig);
  }
}

/**
 * Hook to manage message editing with draft persistence.
 * Handles local state, debounced saves to scratch, and sync on load.
 */
export function useSessionMessageEditor({
  scratchId,
}: UseSessionMessageEditorOptions): UseSessionMessageEditorResult {
  const {
    scratch,
    deleteScratch,
    updateScratchForId,
    isLoading: isScratchLoading,
    isConnected: isScratchConnected,
  } = useScratch(ScratchType.DRAFT_FOLLOW_UP, scratchId ?? '');

  const scratchData: DraftFollowUpData | undefined =
    scratch?.payload?.type === 'DRAFT_FOLLOW_UP'
      ? scratch.payload.data
      : undefined;

  const [localMessage, setLocalMessage] = useState('');
  const [hasInitialValue, setHasInitialValue] = useState(false);

  const saveToScratch = useCallback(
    async (
      targetScratchId: string,
      message: string,
      executorConfig: ExecutorConfig
    ) => {
      if (!targetScratchId) return;
      const payload: DraftFollowUpData = {
        message,
        executor_config: executorConfig,
        session_command: null,
      };
      try {
        await updateScratchForId(targetScratchId, {
          payload: {
            type: 'DRAFT_FOLLOW_UP',
            data: payload,
          },
        });
      } catch (e) {
        console.error('Failed to save follow-up draft', e);
      }
    },
    [updateScratchForId]
  );

  const {
    debounced: debouncedSave,
    cancel: cancelDebouncedSave,
    flush: flushDebouncedSave,
  } = useDebouncedCallback(saveToScratch, 500);

  // Track whether initial load has happened to avoid re-syncing during typing
  const hasLoadedRef = useRef(false);

  // Reset load state and clear message when scratchId changes (e.g., switching to approval mode)
  useEffect(() => {
    return () => {
      flushDebouncedSave();
    };
  }, [scratchId, flushDebouncedSave]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setHasInitialValue(false);
    const cachedDraft = scratchId
      ? readStoredScratchDraft<DraftFollowUpData>(
          ScratchType.DRAFT_FOLLOW_UP,
          scratchId
        )
      : null;
    setLocalMessage(cachedDraft?.dirty ? cachedDraft.value.message : '');
  }, [scratchId]);

  // Sync local message from scratch only on initial load
  useEffect(() => {
    if (isScratchLoading) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const cachedDraft = scratchId
      ? readStoredScratchDraft<DraftFollowUpData>(
          ScratchType.DRAFT_FOLLOW_UP,
          scratchId
        )
      : null;
    const serverData = scratchData ?? null;

    if (
      scratchId &&
      cachedDraft &&
      serverData &&
      areScratchDraftValuesEqual(cachedDraft.value, serverData)
    ) {
      writeStoredScratchDraft(
        ScratchType.DRAFT_FOLLOW_UP,
        scratchId,
        serverData,
        false
      );
    }

    const preferredDraft =
      cachedDraft?.dirty === true ? cachedDraft.value : null;

    setLocalMessage(preferredDraft?.message ?? serverData?.message ?? '');
    setHasInitialValue(true);
  }, [isScratchLoading, scratchData, scratchId]);

  useEffect(() => {
    if (!scratchId || !scratchData) return;

    acknowledgeStoredScratchDraft(
      ScratchType.DRAFT_FOLLOW_UP,
      scratchId,
      scratchData
    );
  }, [scratchData, scratchId]);

  useEffect(() => {
    if (!scratchId || !isScratchConnected) return;

    const cachedDraft = readStoredScratchDraft<DraftFollowUpData>(
      ScratchType.DRAFT_FOLLOW_UP,
      scratchId
    );
    if (!cachedDraft?.dirty) return;

    void saveToScratch(
      scratchId,
      cachedDraft.value.message,
      cachedDraft.value.executor_config
    );
  }, [isScratchConnected, saveToScratch, scratchId]);

  const saveCurrentScratch = useCallback(
    async (message: string, executorConfig: ExecutorConfig) => {
      if (!scratchId) return;
      await saveToScratch(scratchId, message, executorConfig);
    },
    [saveToScratch, scratchId]
  );

  const discardLocalDraft = useCallback(() => {
    discardFollowUpLocalDraft(scratchId);
  }, [scratchId]);

  const deleteDraftScratch = useCallback(
    () => deleteDraftScratchBestEffort(deleteScratch),
    [deleteScratch]
  );

  const clearDraft = useCallback(
    () =>
      clearFollowUpDraft({
        scratchId,
        cancelDebouncedSave,
        deleteScratch,
      }),
    [cancelDebouncedSave, deleteScratch, scratchId]
  );

  // Handle message change with debounced save
  // Pass executor profile at call-time to avoid stale closure
  const handleMessageChange = useCallback(
    (value: string, executorConfig: ExecutorConfig) => {
      setLocalMessage(value);
      if (scratchId) {
        writeStoredScratchDraft(
          ScratchType.DRAFT_FOLLOW_UP,
          scratchId,
          {
            message: value,
            executor_config: executorConfig,
          },
          true
        );
        debouncedSave(scratchId, value, executorConfig);
      }
    },
    [debouncedSave, scratchId]
  );

  return {
    localMessage,
    setLocalMessage,
    scratchData,
    isScratchLoading,
    hasInitialValue,
    saveToScratch: saveCurrentScratch,
    discardLocalDraft,
    deleteDraftScratch,
    clearDraft,
    cancelDebouncedSave,
    handleMessageChange,
  };
}
