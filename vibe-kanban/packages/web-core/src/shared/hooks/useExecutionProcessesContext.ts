import { useContext } from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import type { ExecutionProcess } from 'shared/types';

export type ExecutionProcessesContextType = {
  sessionId: string | undefined;

  executionProcessesAll: ExecutionProcess[];
  executionProcessesByIdAll: Record<string, ExecutionProcess>;
  isAttemptRunningAll: boolean;

  executionProcessesVisible: ExecutionProcess[];
  executionProcessesByIdVisible: Record<string, ExecutionProcess>;
  isAttemptRunningVisible: boolean;

  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
};

export const ExecutionProcessesContext =
  createHmrContext<ExecutionProcessesContextType | null>(
    'ExecutionProcessesContext',
    null
  );

export const useExecutionProcessesContext = () => {
  const ctx = useContext(ExecutionProcessesContext);
  if (!ctx) {
    throw new Error(
      'useExecutionProcessesContext must be used within ExecutionProcessesProvider'
    );
  }
  return ctx;
};
