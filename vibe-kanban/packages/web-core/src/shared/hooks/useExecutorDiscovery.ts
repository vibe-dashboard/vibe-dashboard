import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BaseCodingAgent, ExecutorDiscoveredOptions } from 'shared/types';
import { agentsApi } from '@/shared/lib/api';
import { loadExecutorDiscovery } from '@/shared/lib/loadExecutorDiscovery';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { executorDiscoveryKeys } from './executorDiscoveryKeys';

function keepResolvedOptions(
  next: ExecutorDiscoveredOptions,
  cached: ExecutorDiscoveredOptions | undefined
): ExecutorDiscoveredOptions {
  if (!cached) return next;
  const keepModels = next.loading_models && !cached.loading_models;
  const keepAgents = next.loading_agents && !cached.loading_agents;
  const keepCommands =
    next.loading_slash_commands && !cached.loading_slash_commands;
  return {
    ...next,
    model_selector: {
      ...next.model_selector,
      ...(keepModels
        ? {
            providers: cached.model_selector.providers,
            models: cached.model_selector.models,
            model_order: cached.model_selector.model_order,
            default_model: cached.model_selector.default_model,
          }
        : {}),
      ...(keepAgents
        ? {
            agents: cached.model_selector.agents,
            permissions: cached.model_selector.permissions,
          }
        : {}),
    },
    slash_commands: keepCommands ? cached.slash_commands : next.slash_commands,
    loading_models: keepModels ? false : next.loading_models,
    loading_agents: keepAgents ? false : next.loading_agents,
    loading_slash_commands: keepCommands ? false : next.loading_slash_commands,
  };
}

function useExecutorDiscovery(
  agent: BaseCodingAgent | null | undefined,
  opts?: { workspaceId?: string; sessionId?: string; repoId?: string }
) {
  const { workspaceId, sessionId, repoId } = opts ?? {};
  const hostId = useHostId();
  const queryClient = useQueryClient();
  const queryKey = executorDiscoveryKeys.byScope(
    hostId,
    agent,
    workspaceId,
    sessionId,
    repoId
  );
  const query = useQuery<ExecutorDiscoveredOptions>({
    queryKey,
    enabled: !!agent,
    staleTime: (cachedQuery) => {
      const options = cachedQuery.state.data;
      return options &&
        !options.loading_models &&
        !options.loading_agents &&
        !options.loading_slash_commands
        ? 5 * 60_000
        : 0;
    },
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: ({ signal }) =>
      loadExecutorDiscovery(
        agentsApi.getDiscoveredOptionsStreamUrl(agent!, {
          workspaceId,
          sessionId,
          repoId,
        }),
        hostId,
        signal,
        (options) =>
          queryClient.setQueryData<ExecutorDiscoveredOptions>(
            queryKey,
            (cached) => keepResolvedOptions(options, cached)
          )
      ),
  });

  return {
    options: agent ? (query.data ?? null) : null,
    error: query.error?.message ?? null,
    isConnected: query.isFetching,
    isInitialized: !!query.data,
    retry: query.refetch,
  };
}

export function useModelSelectorConfig(
  agent: BaseCodingAgent | null | undefined,
  opts?: { workspaceId?: string; sessionId?: string; repoId?: string }
) {
  const { options, error, isConnected, isInitialized, retry } =
    useExecutorDiscovery(agent, opts);

  return {
    config: options?.model_selector ?? null,
    loadingModels: !error && (options?.loading_models ?? !!agent),
    loadingAgents: !error && (options?.loading_agents ?? !!agent),
    error,
    isConnected,
    isInitialized,
    retry,
  };
}

export function useSlashCommands(
  agent: BaseCodingAgent | null | undefined,
  opts?: { workspaceId?: string; sessionId?: string; repoId?: string }
) {
  const { options, error, isConnected, isInitialized } = useExecutorDiscovery(
    agent,
    opts
  );

  return {
    commands: options?.slash_commands ?? [],
    discovering: options?.loading_slash_commands ?? false,
    error,
    isConnected,
    isInitialized,
  };
}
