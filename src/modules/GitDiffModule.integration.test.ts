import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleAPI } from 'springboard';
import type { AllModules } from 'springboard/module_registry/module_registry';
import './GitDiffModule';

const state = vi.hoisted(() => ({
  factory: null as null | ((api: ModuleAPI) => Promise<AllModules['GitDiff']>),
  getWorkspace: vi.fn(),
  getWorkspaceRepos: vi.fn(),
}));
vi.mock('springboard', () => ({ default: {
  registerModule: (_name: string, _options: unknown, factory: typeof state.factory) => { state.factory = factory; },
} }));
vi.mock('../server/vk-client', () => ({
  VibeKanbanServerClient: class {
    getWorkspace = state.getWorkspace;
    getWorkspaceRepos = state.getWorkspaceRepos;
  },
}));

const exec = promisify(execFile);
let workspaceDir: string;
let actions: AllModules['GitDiff']['actions'];
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'vd-diff-test-'));
  state.getWorkspace.mockReset().mockResolvedValue({ container_ref: workspaceDir });
  state.getWorkspaceRepos.mockReset();
  const module = await state.factory!({ createActions: (value: unknown) => value } as ModuleAPI);
  actions = module.actions;
});
afterEach(async () => { await rm(workspaceDir, { recursive: true, force: true }); });

async function createRepo(name: string, target: string) {
  const dir = join(workspaceDir, name);
  await mkdir(dir);
  await git(dir, 'init', '-b', target);
  await writeFile(join(dir, 'file.txt'), 'base\n');
  await git(dir, 'add', 'file.txt');
  await git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Base');
  const base = await git(dir, 'rev-parse', 'HEAD');
  await git(dir, 'switch', '-c', 'feature');
  await writeFile(join(dir, 'file.txt'), 'changed\n');
  await git(dir, 'add', 'file.txt');
  await git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', `Change ${name}`);
  const head = await git(dir, 'rev-parse', 'HEAD');
  return { base, head };
}

describe('GitDiff workspace loading', () => {
  it('loads only API-attached first-level checkouts with their own target branches, ignoring display-name collisions', async () => {
    const api = await createRepo('api', 'main');
    const web = await createRepo('web', 'release');
    await createRepo('unattached', 'main');
    state.getWorkspaceRepos.mockResolvedValue([
      { id: 'web-id', name: 'web', display_name: 'api', target_branch: 'release' },
      { id: 'api-id', name: 'api', display_name: 'web', target_branch: 'main' },
    ]);
    const result = await actions.loadDiff({ workspaceId: 'workspace-id', workspaceDir });
    expect(result.repos.map(({ relativePath, targetBranch, baseRef, headRef }) => ({ relativePath, targetBranch, baseRef, headRef })))
      .toEqual([
        { relativePath: 'web', targetBranch: 'release', baseRef: web.base, headRef: web.head },
        { relativePath: 'api', targetBranch: 'main', baseRef: api.base, headRef: api.head },
      ]);
    expect(result.repos.every((repo) => repo.patch.includes('+changed'))).toBe(true);
    expect(state.getWorkspaceRepos).toHaveBeenCalledWith('workspace-id');
  });

  it('surfaces API failure instead of silently scanning directories', async () => {
    state.getWorkspaceRepos.mockRejectedValue(new Error('VK unavailable'));
    await expect(actions.loadDiff({ workspaceId: 'workspace-id', workspaceDir })).rejects.toThrow('VK unavailable');
  });

  it('returns a repo-specific error for a missing checkout', async () => {
    state.getWorkspaceRepos.mockResolvedValue([{ name: 'missing', target_branch: 'main' }]);
    const result = await actions.loadDiff({ workspaceId: 'workspace-id', workspaceDir });
    expect(result.repos[0]?.error).toContain('checkout is missing or invalid');
    expect(result.repos[0]?.relativePath).toBe('missing');
  });

  it('resolves commit and range endpoints independently of the branch comparison', async () => {
    const repo = await createRepo('api', 'main');
    state.getWorkspaceRepos.mockResolvedValue([{ name: 'api', target_branch: 'main' }]);
    for (const compareMode of [
      { type: 'commit', headRef: repo.head },
      { type: 'range', baseRef: repo.base, headRef: repo.head },
    ] as const) {
      const result = await actions.loadDiff({ workspaceId: 'workspace-id', workspaceDir, compareModes: { api: compareMode } });
      expect(result.repos[0]).toMatchObject({ baseRef: repo.base, headRef: repo.head, patch: expect.stringContaining('+changed') });
    }
  });

  it('rejects a workspace directory that does not match VK metadata', async () => {
    await expect(actions.loadDiff({ workspaceId: 'workspace-id', workspaceDir: `${workspaceDir}/other` }))
      .rejects.toThrow('workspaceDir does not match workspace');
    expect(state.getWorkspaceRepos).not.toHaveBeenCalled();
  });
});
