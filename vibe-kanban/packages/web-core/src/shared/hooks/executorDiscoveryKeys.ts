import type { BaseCodingAgent } from 'shared/types';

export const executorDiscoveryKeys = {
  all: ['executorDiscovery'] as const,
  byHost: (hostId: string | null) => ['executorDiscovery', hostId] as const,
  byScope: (
    hostId: string | null,
    agent: BaseCodingAgent | null | undefined,
    workspaceId?: string,
    sessionId?: string,
    repoId?: string
  ) =>
    [
      'executorDiscovery',
      hostId,
      agent ?? null,
      workspaceId ?? null,
      sessionId ?? null,
      repoId ?? null,
    ] as const,
};
