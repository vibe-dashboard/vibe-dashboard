import { useCallback } from 'react';
import { useJsonPatchWsStream } from '@/shared/hooks/useJsonPatchWsStream';
import { useAppRuntime } from '@/shared/hooks/useAppRuntime';
import { useLocalStorageScratch } from '@/shared/hooks/useLocalStorageScratch';
import { scratchApi } from '@/shared/lib/api';
import { ScratchType, type Scratch, type UpdateScratch } from 'shared/types';

type ScratchState = {
  scratch: Scratch | null;
};

export interface UseScratchResult {
  scratch: Scratch | null;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
  updateScratch: (update: UpdateScratch) => Promise<void>;
  deleteScratch: () => Promise<void>;
  updateScratchForId: (
    targetId: string,
    update: UpdateScratch
  ) => Promise<void>;
  deleteScratchForId: (targetId: string) => Promise<void>;
}

interface UseScratchOptions {
  /** Whether to enable the scratch connection. Defaults to true. */
  enabled?: boolean;
}

/**
 * Runtime-aware scratch storage hook.
 *
 * - Local runtime: streams a single scratch item via WebSocket (JSON Patch)
 *   backed by the server-side SQLite scratch table.
 * - Remote runtime: persists scratch data in localStorage for the stable
 *   cloud domain (cloud.vibekanban.com).
 */
export const useScratch = (
  scratchType: ScratchType,
  id: string,
  options?: UseScratchOptions
): UseScratchResult => {
  const runtime = useAppRuntime();
  const isRemote = runtime === 'remote';

  // --- localStorage path (remote-web) ---
  const localResult = useLocalStorageScratch(scratchType, id, {
    enabled: isRemote && (options?.enabled ?? true),
  });

  // --- WebSocket/API path (local-web) ---
  const serverEnabled =
    !isRemote && (options?.enabled ?? true) && id.length > 0;
  const endpoint = serverEnabled
    ? scratchApi.getStreamUrl(scratchType, id)
    : undefined;

  const initialData = useCallback((): ScratchState => ({ scratch: null }), []);

  const { data, isConnected, isInitialized, error } =
    useJsonPatchWsStream<ScratchState>(endpoint, serverEnabled, initialData);

  // Treat deleted scratches as null
  const rawScratch = data?.scratch as (Scratch & { deleted?: boolean }) | null;
  const scratch = rawScratch?.deleted ? null : rawScratch;

  const updateScratchForId = useCallback(
    async (targetId: string, update: UpdateScratch) => {
      await scratchApi.update(scratchType, targetId, update);
    },
    [scratchType]
  );

  const updateScratch = useCallback(
    async (update: UpdateScratch) => {
      await updateScratchForId(id, update);
    },
    [id, updateScratchForId]
  );

  const deleteScratchForId = useCallback(
    async (targetId: string) => {
      await scratchApi.delete(scratchType, targetId);
    },
    [scratchType]
  );

  const deleteScratch = useCallback(async () => {
    await deleteScratchForId(id);
  }, [id, deleteScratchForId]);

  const isLoading = !isInitialized && !error;

  const serverResult: UseScratchResult = {
    scratch,
    isLoading,
    isConnected,
    error,
    updateScratch,
    deleteScratch,
    updateScratchForId,
    deleteScratchForId,
  };

  return isRemote ? localResult : serverResult;
};
