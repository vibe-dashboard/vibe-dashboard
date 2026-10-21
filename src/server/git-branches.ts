import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FindBranchesContainingCommitOptions {
  execFile?: ExecFileLike;
}

export interface PrepareSelectedBranchOptions {
  execFile?: ExecFileLike;
}

export interface PreparedSelectedBranch {
  checkoutBranch: string;
  created: boolean;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export class GitBranchLookupError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GitBranchLookupError';
    this.status = status;
  }
}

export class GitBranchPrepareError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GitBranchPrepareError';
    this.status = status;
  }
}

export async function findBranchesContainingCommit(
  repoPath: string,
  commit: string,
  options: FindBranchesContainingCommitOptions = {},
): Promise<string[]> {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new GitBranchLookupError('A 7-40 character commit SHA is required.', 400);
  }

  const exec = options.execFile ?? defaultExecFile;
  try {
    const { stdout } = await exec('git', [
      '-C',
      repoPath,
      'for-each-ref',
      '--contains',
      commit,
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
    ]);
    return Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => normalizeRefName(line.trim()))
          .filter((branch): branch is string => Boolean(branch)),
      ),
    );
  } catch (error) {
    throw new GitBranchLookupError(
      `Could not find branches containing commit ${commit}. Fetch the repository and verify the commit exists, then try again. ${formatExecError(error)}`,
    );
  }
}

export async function prepareSelectedBranch(
  repoPath: string,
  branch: string,
  remoteName: string,
  options: PrepareSelectedBranchOptions = {},
): Promise<PreparedSelectedBranch> {
  const trimmedBranch = branch.trim();
  const trimmedRemote = remoteName.trim();
  if (!(trimmedBranch && trimmedRemote)) {
    throw new GitBranchPrepareError('branch and remoteName are required.', 400);
  }
  if (trimmedBranch === `${trimmedRemote}/HEAD`) {
    throw new GitBranchPrepareError('Remote HEAD cannot be used as a workspace branch.', 400);
  }

  const exec = options.execFile ?? defaultExecFile;
  const remotePrefix = `${trimmedRemote}/`;
  const isRemoteBranch = trimmedBranch.startsWith(remotePrefix);
  const checkoutBranch = isRemoteBranch
    ? trimmedBranch.slice(remotePrefix.length)
    : trimmedBranch;
  if (!checkoutBranch) {
    throw new GitBranchPrepareError('A checkout branch name is required.', 400);
  }

  await assertValidBranchName(repoPath, checkoutBranch, exec);

  if (isRemoteBranch) {
    await assertRefExists(repoPath, `refs/remotes/${trimmedBranch}`, exec, `Remote branch ${trimmedBranch} was not found.`);
  } else {
    await assertRefExists(repoPath, `refs/heads/${checkoutBranch}`, exec, `Local branch ${checkoutBranch} was not found.`);
  }

  const localExists = await refExists(repoPath, `refs/heads/${checkoutBranch}`, exec);
  if (localExists) {
    await assertBranchNotCheckedOut(repoPath, checkoutBranch, exec);
    if (isRemoteBranch) {
      const upstream = await getBranchUpstream(repoPath, checkoutBranch, exec);
      if (upstream !== trimmedBranch) {
        throw new GitBranchPrepareError(
          upstream
            ? `Local branch ${checkoutBranch} already tracks ${upstream}, not ${trimmedBranch}. Choose the local branch or rename it manually before retrying.`
            : `Local branch ${checkoutBranch} already exists without tracking ${trimmedBranch}. Choose the local branch or set its upstream manually before retrying.`,
          409,
        );
      }
    }
    return { checkoutBranch, created: false };
  }

  if (!isRemoteBranch) {
    throw new GitBranchPrepareError(`Local branch ${checkoutBranch} was not found.`, 404);
  }

  try {
    await exec('git', ['-C', repoPath, 'branch', '--track', checkoutBranch, trimmedBranch]);
  } catch (error) {
    throw new GitBranchPrepareError(
      `Could not create local tracking branch ${checkoutBranch} for ${trimmedBranch}. ${formatExecError(error)}`,
      409,
    );
  }
  return { checkoutBranch, created: true };
}

function normalizeRefName(refName: string): string | null {
  if (refName.startsWith('refs/heads/')) {
    return refName.slice('refs/heads/'.length);
  }
  if (refName.startsWith('refs/remotes/')) {
    const branch = refName.slice('refs/remotes/'.length);
    return branch.endsWith('/HEAD') ? null : branch;
  }
  return null;
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, [...args]);
}

async function assertValidBranchName(
  repoPath: string,
  branch: string,
  exec: ExecFileLike,
): Promise<void> {
  try {
    await exec('git', ['-C', repoPath, 'check-ref-format', '--branch', branch]);
  } catch {
    throw new GitBranchPrepareError(`Invalid branch name: ${branch}`, 400);
  }
}

async function refExists(
  repoPath: string,
  ref: string,
  exec: ExecFileLike,
): Promise<boolean> {
  try {
    await exec('git', ['-C', repoPath, 'show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

async function assertRefExists(
  repoPath: string,
  ref: string,
  exec: ExecFileLike,
  message: string,
): Promise<void> {
  if (!(await refExists(repoPath, ref, exec))) {
    throw new GitBranchPrepareError(message, 404);
  }
}

async function getBranchUpstream(
  repoPath: string,
  branch: string,
  exec: ExecFileLike,
): Promise<string | null> {
  const { stdout } = await exec('git', [
    '-C',
    repoPath,
    'for-each-ref',
    '--format=%(upstream:short)',
    `refs/heads/${branch}`,
  ]);
  return stdout.trim() || null;
}

async function assertBranchNotCheckedOut(
  repoPath: string,
  branch: string,
  exec: ExecFileLike,
): Promise<void> {
  const { stdout } = await exec('git', [
    '-C',
    repoPath,
    'for-each-ref',
    '--format=%(worktreepath)',
    `refs/heads/${branch}`,
  ]);
  const worktreePath = stdout.trim();
  if (worktreePath) {
    throw new GitBranchPrepareError(
      `Branch ${branch} is already checked out in another worktree at ${worktreePath}. Choose a different branch or close that worktree before retrying.`,
      409,
    );
  }
}

function formatExecError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
