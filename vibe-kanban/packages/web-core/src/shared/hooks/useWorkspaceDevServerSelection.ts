import { useCallback, useMemo } from 'react';
import { useScratch } from '@/shared/hooks/useScratch';
import {
  ScratchType,
  type RepoWithTargetBranch,
  type ScratchPayload,
  type WorkspaceDevServerSelectionData,
} from 'shared/types';

interface UseWorkspaceDevServerSelectionResult {
  selectedRepoIds: string[];
  selectableRepoIds: string[];
  setSelectedRepoIds: (repoIds: string[]) => Promise<void>;
  isLoading: boolean;
}

function hasDevServerScripts(repo: RepoWithTargetBranch): boolean {
  if (repo.dev_server_scripts.length > 0) {
    return true;
  }

  return !!repo.dev_server_script?.trim();
}

export function useWorkspaceDevServerSelection(
  workspaceId: string | undefined,
  repos: RepoWithTargetBranch[]
): UseWorkspaceDevServerSelectionResult {
  const enabled = !!workspaceId;
  const { scratch, updateScratch, isLoading } = useScratch(
    ScratchType.WORKSPACE_DEV_SERVER_SELECTION,
    workspaceId ?? '',
    { enabled }
  );

  const payload = scratch?.payload as ScratchPayload | undefined;
  const scratchData: WorkspaceDevServerSelectionData | undefined =
    payload?.type === 'WORKSPACE_DEV_SERVER_SELECTION'
      ? payload.data
      : undefined;

  const selectableRepoIds = useMemo(
    () => repos.filter(hasDevServerScripts).map((repo) => repo.id),
    [repos]
  );

  const selectedRepoIds = useMemo(() => {
    const saved = scratchData?.selected_repo_ids ?? [];
    const selectable = new Set(selectableRepoIds);
    const filtered = saved.filter((repoId) => selectable.has(repoId));

    if (filtered.length > 0) {
      return filtered;
    }

    return selectableRepoIds;
  }, [scratchData?.selected_repo_ids, selectableRepoIds]);

  const setSelectedRepoIds = useCallback(
    async (repoIds: string[]) => {
      const selectable = new Set(selectableRepoIds);
      const filtered = repoIds.filter((repoId) => selectable.has(repoId));

      await updateScratch({
        payload: {
          type: 'WORKSPACE_DEV_SERVER_SELECTION',
          data: { selected_repo_ids: filtered },
        },
      });
    },
    [selectableRepoIds, updateScratch]
  );

  return {
    selectedRepoIds,
    selectableRepoIds,
    setSelectedRepoIds,
    isLoading,
  };
}
