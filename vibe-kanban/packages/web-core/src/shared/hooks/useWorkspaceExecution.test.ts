/**
 * @vitest-environment jsdom
 */

import React, { act, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStopExecutionMutationKey } from './useWorkspaceExecution';
import { useWorkspaceExecution } from './useWorkspaceExecution';
import {
  ExecutionProcessesContext,
  type ExecutionProcessesContextType,
} from './useExecutionProcessesContext';
import { sessionsApi } from '@/shared/lib/api';
import type { ExecutionProcess } from 'shared/types';

vi.mock('@/shared/lib/api', () => ({
  executionProcessesApi: {
    getDetails: vi.fn(),
  },
  sessionsApi: {
    stopExecution: vi.fn().mockResolvedValue(undefined),
  },
}));

const stopExecutionMock = vi.mocked(sessionsApi.stopExecution);

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
});

describe('getStopExecutionMutationKey', () => {
  it('scopes stop pending state by session', () => {
    expect(getStopExecutionMutationKey('workspace-1', 'session-1')).toEqual([
      'stopSessionExecution',
      'workspace-1',
      'session-1',
    ]);
    expect(getStopExecutionMutationKey('workspace-1', 'session-2')).toEqual([
      'stopSessionExecution',
      'workspace-1',
      'session-2',
    ]);
  });
});

describe('useWorkspaceExecution', () => {
  it('stops the provider session when the process list is empty', async () => {
    await renderAndStop({
      sessionId: 'provider-session',
      executionProcessesVisible: [],
    });

    expect(stopExecutionMock).toHaveBeenCalledWith('provider-session');
  });

  it('stops the provider session when visible processes contain a stale session id', async () => {
    await renderAndStop({
      sessionId: 'provider-session',
      executionProcessesVisible: [
        {
          id: 'process-1',
          session_id: 'stale-session',
          run_reason: 'codingagent',
          status: 'running',
        } as ExecutionProcess,
      ],
    });

    expect(stopExecutionMock).toHaveBeenCalledWith('provider-session');
  });
});

async function renderAndStop(
  contextOverrides: Partial<ExecutionProcessesContextType>
) {
  const queryClient = new QueryClient();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const contextValue: ExecutionProcessesContextType = {
    sessionId: undefined,
    executionProcessesAll: [],
    executionProcessesByIdAll: {},
    isAttemptRunningAll: false,
    executionProcessesVisible: [],
    executionProcessesByIdVisible: {},
    isAttemptRunningVisible: false,
    isLoading: false,
    isConnected: true,
    error: null,
    ...contextOverrides,
  };

  function StopOnMount() {
    const { stopExecution } = useWorkspaceExecution('workspace-1');
    const didStop = useRef(false);

    useEffect(() => {
      if (didStop.current) return;
      didStop.current = true;
      void stopExecution();
    }, [stopExecution]);

    return null;
  }

  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          ExecutionProcessesContext.Provider,
          { value: contextValue },
          React.createElement(StopOnMount)
        )
      )
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    root.unmount();
  });
  container.remove();
}
