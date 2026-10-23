import { useQuery } from '@tanstack/react-query';
import type { BaseCodingAgent, ExecutorConfig } from 'shared/types';
import { agentsApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';

export const presetOptionsKeys = {
  all: ['preset-options'] as const,
  byProfile: (
    executor: BaseCodingAgent | null,
    variant: string | null,
    hostId: string | null = null
  ) => ['preset-options', hostId, executor, variant] as const,
};

export function usePresetOptions(
  executor: BaseCodingAgent | null,
  variant: string | null
) {
  const hostId = useHostId();
  return useQuery<ExecutorConfig | null>({
    queryKey: presetOptionsKeys.byProfile(executor, variant, hostId),
    queryFn: () =>
      executor ? agentsApi.getPresetOptions({ executor, variant }) : null,
    enabled: !!executor,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
