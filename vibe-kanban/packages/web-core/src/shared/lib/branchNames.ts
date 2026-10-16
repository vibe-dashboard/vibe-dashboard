import type { GitBranch } from 'shared/types';

export function branchNamesConflictAsSelfTarget(
  sourceBranch: string,
  targetBranch: string,
  targetIsRemote: boolean
): boolean {
  if (sourceBranch === targetBranch) return true;
  if (!targetIsRemote) return false;

  const slashIndex = targetBranch.indexOf('/');
  if (slashIndex === -1) return false;

  return targetBranch.slice(slashIndex + 1) === sourceBranch;
}

export function isBranchSelfTargetForSource(
  branch: Pick<GitBranch, 'name' | 'is_remote'>,
  sourceBranch: string
): boolean {
  return branchNamesConflictAsSelfTarget(
    sourceBranch,
    branch.name,
    branch.is_remote
  );
}

export function filterSelfTargetBranches(
  branches: GitBranch[],
  sourceBranch: string | null | undefined
): GitBranch[] {
  if (!sourceBranch) return branches;
  return branches.filter(
    (branch) => !isBranchSelfTargetForSource(branch, sourceBranch)
  );
}
