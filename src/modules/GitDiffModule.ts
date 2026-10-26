import springboard from 'springboard';
import type { ModuleAPI } from 'springboard';
import type { RepoWithBranch } from '../server/vk-client';

export interface DiffRouteRepo {
  name: string;
  path: string;
  relativePath: string;
  branch: string | null;
  targetBranch: string | null;
  baseRef: string | null;
  commits: Array<{
    sha: string;
    subject: string;
    createdAt: string;
    linesAdded: number;
    linesRemoved: number;
  }>;
  files: Array<{ path: string; status: string }>;
  headRef: string;
  compareMode: DiffCompareMode;
  patch: string;
  error?: string;
}

export type DiffCompareMode =
  | { type: 'branch' }
  | { type: 'commit'; headRef: string }
  | { type: 'range'; baseRef: string; headRef?: string };

export interface DiffRouteResponse {
  workspaceDir: string;
  repos: DiffRouteRepo[];
}

type GitDiffModuleReturnValue = Awaited<ReturnType<typeof createGitDiffModule>>;

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    GitDiff: GitDiffModuleReturnValue;
  }
}

const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 24 * 1024 * 1024;

springboard.registerModule('GitDiff', { rpcMode: 'remote' }, async (moduleAPI) => {
  return createGitDiffModule(moduleAPI);
});

async function createGitDiffModule(moduleAPI: ModuleAPI) {
  const actions = moduleAPI.createActions({
    loadDiff: async (args: {
      workspaceId: string;
      workspaceDir: string;
      compareModes?: Record<string, DiffCompareMode>;
    }): Promise<DiffRouteResponse> => {
      const workspaceId = args.workspaceId.trim();
      const workspaceDir = args.workspaceDir.trim();
      if (!workspaceId) {
        throw new Error('workspaceId is required');
      }
      if (!workspaceDir) {
        throw new Error('workspaceDir is required');
      }

      // @platform "node"
      const { VibeKanbanServerClient } = await import('../server/vk-client');
      const client = new VibeKanbanServerClient();
      const workspace = await client.getWorkspace(workspaceId);
      if (workspace.container_ref !== workspaceDir) {
        throw new Error('workspaceDir does not match workspace');
      }

      const workspaceRepos = await client.getWorkspaceRepos(workspaceId);
      const repos = await loadWorkspaceDiffs(
        workspaceDir,
        workspaceRepos,
        parseCompareModes(args.compareModes),
      );
      return { workspaceDir, repos };
      // @platform end

      throw new Error('GitDiff.loadDiff can only run on the server');
    },
  });

  return { actions };
}

export function parseHeadRefs(
  value: Record<string, string> | null | undefined,
): Map<string, string> {
  if (!value) return new Map();
  const entries: Array<[string, string]> = [];
  for (const [key, rawRef] of Object.entries(value)) {
    if (typeof rawRef !== 'string') continue;
    const ref = rawRef.trim();
    if (ref.length > 0) entries.push([key, ref]);
  }
  return new Map(entries);
}

export function parseCompareModes(
  value: Record<string, DiffCompareMode> | null | undefined,
): Map<string, DiffCompareMode> {
  if (!value) return new Map();
  const entries: Array<[string, DiffCompareMode]> = [];
  for (const [key, mode] of Object.entries(value)) {
    if (!isDiffCompareMode(mode)) continue;
    if (mode.type === 'branch') {
      entries.push([key, { type: 'branch' }]);
    } else if (mode.type === 'commit') {
      entries.push([key, { type: 'commit', headRef: mode.headRef.trim() }]);
    } else {
      entries.push([
        key,
        {
          type: 'range',
          baseRef: mode.baseRef.trim(),
          ...(mode.headRef?.trim() ? { headRef: mode.headRef.trim() } : {}),
        },
      ]);
    }
  }
  return new Map(entries);
}

function isDiffCompareMode(value: unknown): value is DiffCompareMode {
  if (!value || typeof value !== 'object') return false;
  const mode = value as Partial<DiffCompareMode>;
  if (mode.type === 'branch') return true;
  if (mode.type === 'commit') {
    return typeof mode.headRef === 'string' && mode.headRef.trim().length > 0;
  }
  if (mode.type === 'range') {
    return typeof mode.baseRef === 'string' && mode.baseRef.trim().length > 0;
  }
  return false;
}

async function loadWorkspaceDiffs(
  workspaceDir: string,
  workspaceRepos: RepoWithBranch[],
  compareModes: Map<string, DiffCompareMode>,
): Promise<DiffRouteRepo[]> {
  const repoPaths = selectWorkspaceRepoPaths(workspaceDir, workspaceRepos);
  return Promise.all(
    repoPaths.map((repoPath, index) =>
      loadRepoDiff(workspaceDir, repoPath, workspaceRepos[index]!, compareModes),
    ),
  );
}

// VK creates each attached checkout at workspaceDir/repo.name. The workspace
// itself is not a repository; display names and unrelated directories are not
// checkout identities. API failures must surface rather than change the scope.
export function selectWorkspaceRepoPaths(
  workspaceDir: string,
  workspaceRepos: Array<Pick<RepoWithBranch, 'name'>>,
): string[] {
  const names = new Set<string>();
  return workspaceRepos.map(({ name }) => {
    if (
      !name || name.trim() !== name || name === '.' || name === '..' ||
      /[/\\\0]/.test(name)
    ) {
      throw new Error(`Invalid workspace repository directory '${name}'`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate workspace repository directory '${name}'`);
    }
    names.add(name);
    return join(workspaceDir, name);
  });
}

async function isGitRepo(path: string): Promise<boolean> {
  try {
    const gitPath = join(path, '.git');
    await stat(gitPath);
    await git(path, ['rev-parse', '--show-toplevel']);
    return true;
  } catch {
    return false;
  }
}

async function loadRepoDiff(
  workspaceDir: string,
  repoPath: string,
  workspaceRepo: RepoWithBranch,
  compareModes: Map<string, DiffCompareMode>,
): Promise<DiffRouteRepo> {
  const relativePath = relative(workspaceDir, repoPath) || '.';
  const name = workspaceRepo.name;
  const targetBranch = workspaceRepo.target_branch;
  const compareMode = compareModes.get(relativePath) ?? ({ type: 'branch' } as const);

  try {
    if (!(await isGitRepo(repoPath))) {
      throw new Error(`Workspace repository checkout is missing or invalid: ${repoPath}`);
    }
    const branch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchHeadRef = await resolveHeadRef(repoPath, 'HEAD');
    const branchBaseRef = targetBranch
      ? await resolveBaseRef(repoPath, targetBranch, branchHeadRef)
      : await resolveDefaultBaseRef(repoPath, branchHeadRef);
    const comparison = await resolveDiffComparison(
      repoPath,
      compareMode,
      branchHeadRef,
      branchBaseRef,
    );
    const patch = await git(repoPath, [
      'diff',
      '--find-renames',
      ...comparison.diffRange,
    ]);
    const files = parseNameStatus(
      await git(repoPath, [
        'diff',
        '--name-status',
        '--find-renames',
        ...comparison.diffRange,
      ]),
    );
    const commits = parseCommits(
      await git(repoPath, [
        'log',
        '--format=commit%x00%H%x00%s%x00%aI',
        '--numstat',
        '-50',
        ...(branchBaseRef ? [`${branchBaseRef}..HEAD`] : ['HEAD']),
      ]),
    );

    return {
      name,
      path: repoPath,
      relativePath,
      branch,
      targetBranch,
      baseRef: comparison.baseRef,
      headRef: comparison.headRef,
      compareMode: comparison.compareMode,
      commits,
      files,
      patch,
    };
  } catch (error) {
    return {
      name,
      path: repoPath,
      relativePath,
      branch: null,
      targetBranch,
      baseRef: null,
      headRef: compareMode.type === 'commit' ? compareMode.headRef : compareMode.type === 'range' ? compareMode.headRef ?? 'HEAD' : 'HEAD',
      compareMode,
      commits: [],
      files: [],
      patch: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type ResolvedDiffComparison = {
  baseRef: string | null;
  headRef: string;
  compareMode: DiffCompareMode;
  diffRange: string[];
};

async function resolveDiffComparison(
  repoPath: string,
  compareMode: DiffCompareMode,
  branchHeadRef: string,
  branchBaseRef: string | null,
): Promise<ResolvedDiffComparison> {
  if (compareMode.type === 'commit') {
    const headRef = await resolveHeadRef(repoPath, compareMode.headRef);
    const baseRef = await resolveFirstParentRef(repoPath, headRef);
    return {
      baseRef,
      headRef,
      compareMode: { type: 'commit', headRef },
      diffRange: [baseRef, headRef],
    };
  }

  if (compareMode.type === 'range') {
    const baseRef = await resolveHeadRef(repoPath, compareMode.baseRef);
    const headRef = await resolveHeadRef(
      repoPath,
      compareMode.headRef || branchHeadRef,
    );
    return {
      baseRef,
      headRef,
      compareMode: { type: 'range', baseRef, headRef },
      diffRange: [baseRef, headRef],
    };
  }

  if (!branchBaseRef) {
    throw new Error('Could not resolve the repository target branch. Fetch its history and refresh.');
  }
  return {
    baseRef: branchBaseRef,
    headRef: branchHeadRef,
    compareMode: { type: 'branch' },
    diffRange: [`${branchBaseRef}...${branchHeadRef}`],
  };
}

async function resolveFirstParentRef(
  repoPath: string,
  headRef: string,
): Promise<string> {
  const revision = await git(repoPath, ['rev-list', '--parents', '-n', '1', headRef]);
  const [, firstParent] = revision.trim().split(/\s+/);
  return firstParent || '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
}

async function resolveHeadRef(
  repoPath: string,
  requestedHeadRef: string,
): Promise<string> {
  const ref = requestedHeadRef.trim() || 'HEAD';
  if (!isSafeGitRef(ref)) {
    throw new Error(`Invalid git ref '${requestedHeadRef}'`);
  }
  return git(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

export function isSafeGitRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= 200 &&
    !ref.startsWith('-') &&
    !ref.includes('..') &&
    !ref.includes('@{') &&
    /^[A-Za-z0-9_./-]+$/.test(ref)
  );
}

async function resolveBaseRef(
  repoPath: string,
  targetBranch: string,
  headRef: string,
): Promise<string | null> {
  const candidates = [
    targetBranch,
    `origin/${targetBranch}`,
    `refs/remotes/origin/${targetBranch}`,
  ];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ['merge-base', headRef, candidate]);
    }
  }
  return null;
}

async function resolveDefaultBaseRef(
  repoPath: string,
  headRef: string,
): Promise<string | null> {
  const candidates = ['origin/main', 'origin/master', 'main', 'master'];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ['merge-base', headRef, candidate]);
    }
  }
  return null;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

function parseNameStatus(
  output: string,
): Array<{ path: string; status: string }> {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = '', firstPath = '', secondPath] = line.split('\t');
      return {
        status,
        path: secondPath || firstPath,
      };
    });
}

export function parseCommits(
  output: string,
): Array<{
  sha: string;
  subject: string;
  createdAt: string;
  linesAdded: number;
  linesRemoved: number;
}> {
  const commits: Array<{
    sha: string;
    subject: string;
    createdAt: string;
    linesAdded: number;
    linesRemoved: number;
  }> = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [marker, sha = '', subject = '', createdAt = ''] = trimmed.split('\0');
    if (marker === 'commit') {
      commits.push({ sha, subject, createdAt, linesAdded: 0, linesRemoved: 0 });
      continue;
    }
    const current = commits.at(-1);
    if (!current) continue;
    const [added, removed] = trimmed.split('\t');
    current.linesAdded += parseNumstatCount(added);
    current.linesRemoved += parseNumstatCount(removed);
  }

  return commits;
}

function parseNumstatCount(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function git(cwd: string, args: string[]): Promise<string> {
  // @platform "node"
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
  // @platform end

  throw new Error('git can only run on the server');
}

async function stat(path: string) {
  // @platform "node"
  const fs = await import('node:fs/promises');
  return fs.stat(path);
  // @platform end

  throw new Error('stat can only run on the server');
}

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function relative(from: string, to: string): string {
  const normalizedFrom = from.replace(/\/+$/, '');
  if (to === normalizedFrom) return '';
  if (to.startsWith(`${normalizedFrom}/`)) {
    return to.slice(normalizedFrom.length + 1);
  }
  return to;
}
