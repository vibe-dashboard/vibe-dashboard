import type { RepoWithTargetBranch, Workspace } from 'shared/types';

export interface WorkspaceBranchPanelState {
  label: string;
  canRename: boolean;
  helpText?: string;
}

export function getEffectiveRepoSourceBranch(
  workspace: Pick<Workspace, 'branch'>,
  repo: Pick<RepoWithTargetBranch, 'create_branch' | 'checkout_branch'>
): string {
  return repo.create_branch === false
    ? (repo.checkout_branch ?? workspace.branch)
    : workspace.branch;
}

export function getWorkspaceBranchPanelState(
  workspace: Pick<Workspace, 'branch'> | undefined,
  repos: Pick<RepoWithTargetBranch, 'create_branch' | 'checkout_branch'>[]
): WorkspaceBranchPanelState {
  const fallback = workspace?.branch ?? '';
  const directRepos = repos.filter((repo) => repo.create_branch === false);

  if (directRepos.length === 0) {
    return { label: fallback, canRename: true };
  }

  const directBranches = Array.from(
    new Set(
      directRepos
        .map((repo) => repo.checkout_branch?.trim())
        .filter((branch): branch is string => Boolean(branch))
    )
  );

  return {
    label:
      directBranches.length === 1
        ? directBranches[0]!
        : 'Multiple direct checkout branches',
    canRename: false,
    helpText:
      'Branch rename is unavailable for direct-branch workspaces because the checked-out branch is user-owned. Rename it outside VK if needed.',
  };
}
