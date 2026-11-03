import { useCallback, useEffect, useRef, useState } from 'react';
import { v5 as uuidv5 } from 'uuid';
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
  /** Stable embedded-surface identity. Omitted by standalone VK. */
  surfaceId?: string;
}

export function resolveSessionMessageDraftStorageId(
  scratchId: string | undefined,
  surfaceId?: string
): string | undefined {
  if (!scratchId) return undefined;
  return surfaceId ? `surface:${surfaceId}:${scratchId}` : scratchId;
}

export function resolveSessionMessageDraftServerId(
  scratchId: string | undefined,
  surfaceId?: string
): string | undefined {
  if (!scratchId || !surfaceId) return scratchId;
  return uuidv5(
    JSON.stringify(['vd:inline-agent-draft:v1', surfaceId, scratchId]),
    uuidv5.URL
  );
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
  surfaceId,
}: UseSessionMessageEditorOptions): UseSessionMessageEditorResult {
  const draftStorageId = resolveSessionMessageDraftStorageId(
    scratchId,
    surfaceId
  );
  const serverScratchId = resolveSessionMessageDraftServerId(
    scratchId,
    surfaceId
  );
  const {
    scratch,
    deleteScratch,
    updateScratchForId,
    isLoading: isScratchLoading,
    isConnected: isScratchConnected,
  } = useScratch(ScratchType.DRAFT_FOLLOW_UP, serverScratchId ?? '');

  const scratchData: DraftFollowUpData | undefined =
    scratch?.payload?.type === 'DRAFT_FOLLOW_UP'
      ? scratch.payload.data
      : undefined;

  const [localMessage, setLocalMessage] = useState('');
  const [hasInitialValue, setHasInitialValue] = useState(false);
  const pendingScratchWrite = useRef<Promise<void>>(Promise.resolve());

  const saveToScratch = useCallback(
    (
      targetScratchId: string,
      targetStorageId: string,
      message: string,
      executorConfig: ExecutorConfig
    ) => {
      if (!targetScratchId) return Promise.resolve();
      const payload: DraftFollowUpData = {
        message,
        executor_config: executorConfig,
        session_command: null,
      };
      const write = pendingScratchWrite.current.then(async () => {
        try {
          await updateScratchForId(targetScratchId, {
            payload: {
              type: 'DRAFT_FOLLOW_UP',
              data: payload,
            },
          });
          const cachedDraft = readStoredScratchDraft<DraftFollowUpData>(
            ScratchType.DRAFT_FOLLOW_UP,
            targetStorageId
          );
          if (
            cachedDraft?.value.message === message &&
            areScratchDraftValuesEqual(
              cachedDraft.value.executor_config,
              executorConfig
            )
          ) {
            writeStoredScratchDraft(
              ScratchType.DRAFT_FOLLOW_UP,
              targetStorageId,
              payload,
              false
            );
          }
        } catch (e) {
          console.error('Failed to save follow-up draft', e);
        }
      });
      pendingScratchWrite.current = write;
      return write;
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
  }, [draftStorageId, flushDebouncedSave]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setHasInitialValue(false);
    const cachedDraft = draftStorageId
      ? readStoredScratchDraft<DraftFollowUpData>(
          ScratchType.DRAFT_FOLLOW_UP,
          draftStorageId
        )
      : null;
    setLocalMessage(cachedDraft?.dirty ? cachedDraft.value.message : '');
  }, [draftStorageId, scratchId]);

  // Sync local message from scratch only on initial load
  useEffect(() => {
    if (isScratchLoading) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const cachedDraft = draftStorageId
      ? readStoredScratchDraft<DraftFollowUpData>(
          ScratchType.DRAFT_FOLLOW_UP,
          draftStorageId
        )
      : null;
    const serverData = scratchData ?? null;

    if (
      draftStorageId &&
      cachedDraft &&
      serverData &&
      areScratchDraftValuesEqual(cachedDraft.value, serverData)
    ) {
      writeStoredScratchDraft(
        ScratchType.DRAFT_FOLLOW_UP,
        draftStorageId,
        serverData,
        false
      );
    }

    const preferredDraft =
      cachedDraft?.dirty === true ? cachedDraft.value : null;

    setLocalMessage(preferredDraft?.message ?? serverData?.message ?? '');
    setHasInitialValue(true);
  }, [draftStorageId, isScratchLoading, scratchData]);

  useEffect(() => {
    if (!draftStorageId || !scratchData) return;

    acknowledgeStoredScratchDraft(
      ScratchType.DRAFT_FOLLOW_UP,
      draftStorageId,
      scratchData
    );
  }, [draftStorageId, scratchData]);

  useEffect(() => {
    if (!serverScratchId || !draftStorageId || !isScratchConnected) return;

    const cachedDraft = readStoredScratchDraft<DraftFollowUpData>(
      ScratchType.DRAFT_FOLLOW_UP,
      draftStorageId
    );
    if (!cachedDraft?.dirty) return;

    void saveToScratch(
      serverScratchId,
      draftStorageId,
      cachedDraft.value.message,
      cachedDraft.value.executor_config
    );
  }, [draftStorageId, isScratchConnected, saveToScratch, serverScratchId]);

  const saveCurrentScratch = useCallback(
    async (message: string, executorConfig: ExecutorConfig) => {
      if (!serverScratchId || !draftStorageId) return;
      writeStoredScratchDraft(
        ScratchType.DRAFT_FOLLOW_UP,
        draftStorageId,
        { message, executor_config: executorConfig, session_command: null },
        true
      );
      await saveToScratch(
        serverScratchId,
        draftStorageId,
        message,
        executorConfig
      );
    },
    [draftStorageId, saveToScratch, serverScratchId]
  );

  const discardLocalDraft = useCallback(() => {
    discardFollowUpLocalDraft(draftStorageId);
  }, [draftStorageId]);

  const deleteDraftScratch = useCallback(() => {
    const write = pendingScratchWrite.current.then(() =>
      deleteDraftScratchBestEffort(deleteScratch)
    );
    pendingScratchWrite.current = write;
    return write;
  }, [deleteScratch]);

  const clearDraft = useCallback(
    () =>
      clearFollowUpDraft({
        scratchId: draftStorageId,
        cancelDebouncedSave,
        deleteScratch: deleteDraftScratch,
      }),
    [cancelDebouncedSave, deleteDraftScratch, draftStorageId]
  );

  // Handle message change with debounced save
  // Pass executor profile at call-time to avoid stale closure
  const handleMessageChange = useCallback(
    (value: string, executorConfig: ExecutorConfig) => {
      setLocalMessage(value);
      if (serverScratchId && draftStorageId) {
        writeStoredScratchDraft(
          ScratchType.DRAFT_FOLLOW_UP,
          draftStorageId,
          {
            message: value,
            executor_config: executorConfig,
            session_command: null,
          },
          true
        );
        debouncedSave(serverScratchId, draftStorageId, value, executorConfig);
      }
    },
    [debouncedSave, draftStorageId, serverScratchId]
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
