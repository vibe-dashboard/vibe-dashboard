import { useEffect, useMemo } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExecutionProcess, ExecutorConfig } from 'shared/types';
import { getLatestConfigFromProcesses } from '@/shared/lib/executor';
import { useHostId } from '@/shared/providers/HostIdProvider';

export function useSessionExecutorConfig(
  workspaceId: string | undefined,
  sessionId: string | undefined,
  processes: ExecutionProcess[],
  isLoading: boolean
): ExecutorConfig | null {
  const hostId = useHostId();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () =>
      [
        'sessionExecutorConfig',
        hostId,
        workspaceId ?? null,
        sessionId ?? null,
      ] as const,
    [hostId, workspaceId, sessionId]
  );
  const { data: cached } = useQuery<ExecutorConfig | null>({
    queryKey,
    queryFn: skipToken,
    gcTime: 30 * 60_000,
  });
  const streamed = useMemo(
    () =>
      getLatestConfigFromProcesses(
        processes.filter((process) => process.session_id === sessionId)
      ),
    [processes, sessionId]
  );

  useEffect(() => {
    if (sessionId && (!isLoading || streamed)) {
      queryClient.setQueryData(queryKey, streamed);
    }
  }, [queryClient, queryKey, sessionId, streamed, isLoading]);

  if (!sessionId) return null;
  return streamed ?? (isLoading ? (cached ?? null) : null);
}
