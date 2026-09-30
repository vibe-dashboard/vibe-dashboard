import { useMemo, useCallback } from 'react';
import {
  useMutation,
  useMutationState,
  useQueries,
} from '@tanstack/react-query';
import { executionProcessesApi, sessionsApi } from '@/shared/lib/api';
import { useExecutionProcessesContext } from '@/shared/hooks/useExecutionProcessesContext';
import type { AttemptData } from '@/shared/lib/types';
import type { ExecutionProcess } from 'shared/types';

export function getStopExecutionMutationKey(
  workspaceId: string | undefined,
  sessionId: string | undefined
) {
  return ['stopSessionExecution', workspaceId, sessionId] as const;
}

export function useWorkspaceExecution(workspaceId?: string) {
  const {
    sessionId,
    executionProcessesVisible: executionProcesses,
    isAttemptRunningVisible: isAttemptRunning,
    isLoading: streamLoading,
  } = useExecutionProcessesContext();

  const stopMutationKey = useMemo(
    () => getStopExecutionMutationKey(workspaceId, sessionId),
    [workspaceId, sessionId]
  );

  const stopMutation = useMutation({
    mutationKey: stopMutationKey,
    mutationFn: async () => {
      if (!workspaceId || !sessionId) return;
      await sessionsApi.stopExecution(sessionId);
    },
  });

  const isStopping =
    useMutationState({
      filters: {
        mutationKey: stopMutationKey,
        status: 'pending',
      },
    }).length > 0;

  // Get setup script processes that need detailed info
  const setupProcesses = useMemo(() => {
    if (!executionProcesses.length) return [] as ExecutionProcess[];
    return executionProcesses.filter((p) => p.run_reason === 'setupscript');
  }, [executionProcesses]);

  // Fetch details for setup processes
  const processDetailQueries = useQueries({
    queries: setupProcesses.map((process) => ({
      queryKey: ['processDetails', process.id],
      queryFn: () => executionProcessesApi.getDetails(process.id),
      enabled: !!process.id,
    })),
  });

  // Build attempt data combining processes and details
  const attemptData: AttemptData = useMemo(() => {
    if (!executionProcesses.length) {
      return { processes: [], runningProcessDetails: {} };
    }

    // Build runningProcessDetails from the detail queries
    const runningProcessDetails: Record<string, ExecutionProcess> = {};

    setupProcesses.forEach((process, index) => {
      const detailQuery = processDetailQueries[index];
      if (detailQuery?.data) {
        runningProcessDetails[process.id] = detailQuery.data;
      }
    });

    return {
      processes: executionProcesses,
      runningProcessDetails,
    };
  }, [executionProcesses, setupProcesses, processDetailQueries]);

  const stopExecution = useCallback(async () => {
    if (!workspaceId || isStopping) return;

    try {
      await stopMutation.mutateAsync();
    } catch (error) {
      console.error('Failed to stop executions:', error);
      throw error;
    }
  }, [workspaceId, isStopping, stopMutation]);

  const isLoading =
    streamLoading || processDetailQueries.some((q) => q.isLoading);
  const isFetching =
    streamLoading || processDetailQueries.some((q) => q.isFetching);

  return {
    // Data
    processes: executionProcesses,
    attemptData,
    runningProcessDetails: attemptData.runningProcessDetails,

    // Status
    isAttemptRunning,
    isLoading,
    isFetching,

    // Actions
    stopExecution,
    isStopping,
  };
}
