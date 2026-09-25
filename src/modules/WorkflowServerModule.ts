import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serverRegistry } from 'springboard/server/register';
import { registerWorkflowRoutes } from '../server/workflow-routes';
import { registerPluginAssetRoutes } from '../server/plugin-asset-routes';
import { registerPluginAdminRoutes } from '../server/plugin-admin-routes';
import { registerPreviewResolverRoutes } from '../server/preview-resolver-routes';
import { registerAppearanceRoutes } from '../server/appearance-routes';
import { FileAppearanceRevisionStore } from '../server/appearance-revision-store.node';
import { AppearanceRevisionService } from '../theme/skins/appearanceRevisions';
import { createDefaultAppearanceSnapshot } from '../theme/skins/defaultAppearanceSnapshot';
import { compileAppearanceSnapshotCandidate } from '../theme/skins/appearanceCandidate';
import { workflowRegistry } from '../workflows/registry';
import type { CachedRepoAlias } from '../workflows/github-ci';

const execFileAsync = promisify(execFile);
const reposRoot = process.env.VK_REPOS_ROOT || join(process.env.HOME || '/home/vkuser', 'repos');
const pluginInstallRoot = process.env.VD_PLUGIN_INSTALL_ROOT || join(process.cwd(), 'plugins');
const appearanceHistoryPath = process.env.VK_APPEARANCE_HISTORY_PATH || join(process.env.HOME || '/home/vkuser', '.config', 'vibe-kanban', 'appearance-history.json');
let cachedGitRepos: CachedRepoAlias[] | null = null;
let appearanceService: Promise<AppearanceRevisionService> | undefined;

async function openAppearanceService(): Promise<AppearanceRevisionService> {
  const store = new FileAppearanceRevisionStore(appearanceHistoryPath);
  const options = {
    store,
    genesisSnapshot: createDefaultAppearanceSnapshot(),
    compileActivation: async (snapshot: Parameters<typeof compileAppearanceSnapshotCandidate>[0]) => {
      const candidate = await compileAppearanceSnapshotCandidate(snapshot);
      return candidate.ok ? {
        sourceDigest: candidate.sourceDigest,
        artifactDigest: candidate.artifact?.digest ?? null,
        compilerVersion: 1 as const,
        policyVersion: 1 as const,
      } : undefined;
    },
    authorize: ({ actor, source }: Parameters<NonNullable<Parameters<typeof AppearanceRevisionService.open>[0]['authorize']>>[0]) => actor.kind === source || source === 'undo' || source === 'redo' || source === 'revert' || source === 'restore',
  };
  try { return await AppearanceRevisionService.open(options); }
  catch (error) {
    if (!await store.recoverLastKnownGood()) throw error;
    console.error('Recovered last-known-good appearance history after primary storage corruption', error);
    return AppearanceRevisionService.open(options);
  }
}

serverRegistry.registerServerModule((api) => {
  registerWorkflowRoutes(api.hono, {
    registry: workflowRegistry,
    repoAliasCache: {
      get: getCachedGitRepos,
      set: setCachedGitRepos,
      refresh: refreshCachedGitRepos,
    },
  });
  registerPluginAssetRoutes(api.hono, { installRoot: pluginInstallRoot });
  registerPluginAdminRoutes(api.hono);
  registerPreviewResolverRoutes(api.hono);
  registerAppearanceRoutes(api.hono, {
    getService: () => appearanceService ??= openAppearanceService(),
    allowRead: () => process.env.VK_APPEARANCE_READ_DISABLED !== 'true',
    // Current deployments are single-user. Appearance routes intentionally use
    // the normal local app route boundary instead of a bespoke skin-editor
    // auth header; read-only mode still revokes mutations at command execution.
    allowMutation: () => process.env.VK_APPEARANCE_READ_ONLY !== 'true',
  });
});

async function getCachedGitRepos(): Promise<CachedRepoAlias[]> {
  cachedGitRepos ??= await hydrateLocalGitRepoAliases(reposRoot);
  return cachedGitRepos;
}

function setCachedGitRepos(repos: CachedRepoAlias[]): void {
  cachedGitRepos = repos;
}

async function refreshCachedGitRepos(): Promise<CachedRepoAlias[]> {
  cachedGitRepos = await hydrateLocalGitRepoAliases(reposRoot);
  return cachedGitRepos;
}

async function hydrateLocalGitRepoAliases(root: string): Promise<CachedRepoAlias[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    console.warn('Failed to read local git repo root for alias cache', { root, error });
    return [];
  }

  const repos = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry): Promise<CachedRepoAlias | null> => {
      const repoPath = join(root, entry.name);
      const aliases = await getGitRemoteAliases(repoPath);
      return aliases.length > 0 ? { name: entry.name, aliases } : null;
    }));

  return repos.filter((repo): repo is CachedRepoAlias => repo !== null);
}

async function getGitRemoteAliases(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
    const remote = stdout.trim();
    return remote ? [remote] : [];
  } catch {
    return [];
  }
}
