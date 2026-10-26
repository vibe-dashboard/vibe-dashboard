import { useCallback, useEffect, useMemo } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useHostId } from '@/shared/providers/HostIdProvider';
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
  const hostId = useHostId();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['scratch', hostId, scratchType, id] as const,
    [hostId, scratchType, id]
  );
  const { data: cachedScratch } = useQuery<Scratch | null>({
    queryKey,
    queryFn: skipToken,
    gcTime: 30 * 60_000,
  });

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
  const rawScratch = (
    serverEnabled ? (isInitialized ? data?.scratch : cachedScratch) : null
  ) as (Scratch & { deleted?: boolean }) | null | undefined;
  const scratch = rawScratch?.deleted ? null : rawScratch;

  useEffect(() => {
    if (serverEnabled && isInitialized)
      queryClient.setQueryData(queryKey, data?.scratch ?? null);
  }, [serverEnabled, isInitialized, queryClient, queryKey, data]);

  const updateScratchForId = useCallback(
    async (targetId: string, update: UpdateScratch) => {
      await scratchApi.update(scratchType, targetId, update);
      queryClient.setQueryData<Scratch | null>(
        ['scratch', hostId, scratchType, targetId],
        (old) => (old ? { ...old, ...update } : old)
      );
    },
    [scratchType, hostId, queryClient]
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
      queryClient.setQueryData(
        ['scratch', hostId, scratchType, targetId],
        null
      );
    },
    [scratchType, hostId, queryClient]
  );

  const deleteScratch = useCallback(async () => {
    await deleteScratchForId(id);
  }, [id, deleteScratchForId]);

  const isLoading = !isInitialized && !error;

  const serverResult: UseScratchResult = {
    scratch: scratch ?? null,
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
