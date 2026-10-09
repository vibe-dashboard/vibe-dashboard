import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExternalProvider } from '../../../../store/kysely_types';
import type { ExternalIssueRef, VKWorkspaceRef } from './workspaceMappings';

const execFile = promisify(execFileCallback);

export const DEFAULT_VK_SETTINGS_DIRECTORY = '/var/lib/vd/vk-config';
export const DEFAULT_VD_BEADS_DIRECTORY = '/var/lib/vd/beads';
export const WORKSPACE_BEADS_DIR_KEY_PREFIX = 'workspace:';

const REQUIRED_FRAGMENT = `## Workspace Beads

Run \`bd\` commands from this workspace root/top-level directory.
This workspace uses \`.beads/redirect\` to store beads in persisted VD storage.
Do not initialize beads inside repository subdirectories.`;

const DEFAULT_USER_APPEND = `<!--
Seeded once by VD; this file is not overwritten by VD updates.
-->`;

export interface BdCommandRunner {
  (args: string[], options: { cwd: string }): Promise<{ stdout: string }>;
}

export interface WorkspaceBeadsOptions {
  settingsDirectory?: string;
  beadsDirectory?: string;
  runBd?: BdCommandRunner;
}

export interface ExternalIssueBeadInput {
  externalIssue: ExternalIssueRef;
  workspace: VKWorkspaceRef;
  linkId: string;
  externalIssueId: string;
  isPrimary?: boolean;
}

export interface WorkspaceBeadPointer {
  beadId: string;
  beadsDirKey: string;
}

export interface WorkspaceSetupInput {
  workspaceId: string;
  workspaceDir: string;
  repos: Array<{ id?: string; name: string; displayName?: string; path?: string; targetBranch?: string }>;
}

export function resolveVkSettingsDirectory(options: WorkspaceBeadsOptions = {}): string {
  return options.settingsDirectory ?? process.env.VK_SETTINGS_DIRECTORY ?? DEFAULT_VK_SETTINGS_DIRECTORY;
}

export function resolveVdBeadsDirectory(options: WorkspaceBeadsOptions = {}): string {
  return options.beadsDirectory ?? process.env.VD_BEADS_DIRECTORY ?? DEFAULT_VD_BEADS_DIRECTORY;
}

export function workspaceBeadsDir(workspaceId: string, options: WorkspaceBeadsOptions = {}): string {
  return path.join(resolveVdBeadsDirectory(options), 'workspaces', workspaceId, '.beads');
}

export function workspaceBeadsDirKey(workspaceId: string): string {
  return `${WORKSPACE_BEADS_DIR_KEY_PREFIX}${workspaceId}`;
}

export function deterministicExternalIssueBeadId(
  workspaceId: string,
  issue: Pick<ExternalIssueRef, 'provider' | 'site' | 'key' | 'id'>,
): string {
  const material = [
    workspaceId.trim().toLowerCase(),
    issue.provider,
    issue.site?.trim().toLowerCase() ?? '',
    issue.key.trim().toLowerCase(),
    issue.id?.trim().toLowerCase() ?? '',
  ].join('\0');
  return `vde-${createHash('sha256').update(material).digest('base64url').slice(0, 32)}`;
}

export function deterministicWorkspaceBeadId(workspaceId: string): string {
  return `vdw-${workspaceId.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`;
}

export async function seedWorkspaceBeadsInstructionConfig(options: WorkspaceBeadsOptions = {}): Promise<void> {
  const root = resolveVkSettingsDirectory(options);
  const fragmentsDir = path.join(root, 'workspace-instructions');
  await mkdir(fragmentsDir, { recursive: true });

  const manifestPath = path.join(root, 'workspace-beads.toml');
  await writeIfMissing(manifestPath, [
    'required_fragments = ["workspace-instructions/beads-required.md"]',
    'append_fragments = ["workspace-instructions/beads-user-append.md"]',
    'target_files = ["AGENTS.md", "CLAUDE.md"]',
    '',
  ].join('\n'));
  await writeFile(path.join(fragmentsDir, 'beads-required.md'), `${REQUIRED_FRAGMENT}\n`);
  await writeIfMissing(path.join(fragmentsDir, 'beads-user-append.md'), `${DEFAULT_USER_APPEND}\n`);
}

export async function renderWorkspaceBeadsInstructionBlock(options: WorkspaceBeadsOptions = {}): Promise<string> {
  await seedWorkspaceBeadsInstructionConfig(options);
  const root = resolveVkSettingsDirectory(options);
  const manifest = await loadWorkspaceBeadsManifest(options);
  const fragments = [...manifest.required_fragments, ...manifest.append_fragments];
  const rendered: string[] = [];
  for (const fragment of fragments) {
    const content = await readFile(resolveSettingsPath(root, fragment), 'utf8').catch(() => '');
    if (content.trim()) rendered.push(content.trim());
  }
  return rendered.join('\n\n');
}

export async function applyWorkspaceBeadsSetup(input: WorkspaceSetupInput, options: WorkspaceBeadsOptions = {}): Promise<void> {
  await ensureWorkspaceBeadsDatabase(input.workspaceId, options);
  await writeWorkspaceRedirect(input.workspaceId, input.workspaceDir, options);
  await upsertWorkspaceInstructionBlocks(input.workspaceDir, options);
  await upsertWorkspaceIndexBead(input, options);
}

export async function upsertWorkspaceIndexBead(input: WorkspaceSetupInput, options: WorkspaceBeadsOptions = {}): Promise<WorkspaceBeadPointer> {
  const aggregateDir = path.join(resolveVdBeadsDirectory(options), 'aggregate-workspaces');
  await ensureEmbeddedBeadsDatabase(aggregateDir, 'task', options);
  const beadId = deterministicWorkspaceBeadId(input.workspaceId);
  const runBd = options.runBd ?? defaultRunBd;
  const repos = input.repos.map((repo) => ({
    name: repo.name,
    ...(repo.id ? { id: repo.id } : {}),
    ...(repo.displayName ? { displayName: repo.displayName } : {}),
    ...(repo.path ? { path: repo.path } : {}),
    ...(repo.targetBranch ? { targetBranch: repo.targetBranch } : {}),
  }));
  const metadata = {
    kind: 'workspace',
    vkWorkspaceId: input.workspaceId,
    workspaceDir: input.workspaceDir,
    beadsDirKey: workspaceBeadsDirKey(input.workspaceId),
    repos,
  };
  const title = `Workspace ${input.workspaceId}`;
  const description = [
    `Workspace: ${input.workspaceId}`,
    `Directory: ${input.workspaceDir}`,
    '',
    'Repositories:',
    ...repos.map((repo) => `- ${repo.name}${repo.targetBranch ? ` (${repo.targetBranch})` : ''}`),
  ].join('\n');
  try {
    await runBd(['show', beadId, '--json'], { cwd: aggregateDir });
    await runBd(['update', beadId, '--title', title, '--description', description, '--metadata', JSON.stringify(metadata)], { cwd: aggregateDir });
  } catch {
    await runBd(['create', '--force', '--id', beadId, '--title', title, '--description', description, '--metadata', JSON.stringify(metadata), '--type', 'task'], { cwd: aggregateDir });
  }
  return { beadId, beadsDirKey: 'aggregate:workspaces' };
}

export async function ensureWorkspaceBeadsDatabase(workspaceId: string, options: WorkspaceBeadsOptions = {}): Promise<void> {
  await ensureEmbeddedBeadsDatabase(path.dirname(workspaceBeadsDir(workspaceId, options)), 'task', options);
}

export async function ensureExternalIssueWorkspaceBead(
  input: ExternalIssueBeadInput,
  options: WorkspaceBeadsOptions = {},
): Promise<WorkspaceBeadPointer> {
  const workspaceId = input.workspace.workspaceId;
  await ensureWorkspaceBeadsDatabase(workspaceId, options);
  const cwd = path.dirname(workspaceBeadsDir(workspaceId, options));
  const beadId = deterministicExternalIssueBeadId(workspaceId, input.externalIssue);
  const runBd = options.runBd ?? defaultRunBd;
  const metadata = {
    external_issues: [{
      provider: input.externalIssue.provider,
      key: input.externalIssue.key,
      url: input.externalIssue.url,
      ...(input.externalIssue.site ? { site: input.externalIssue.site } : {}),
      ...(input.externalIssue.id ? { id: input.externalIssue.id } : {}),
    }],
    vdExternalIssueId: input.externalIssueId,
    vdWorkspaceLinkId: input.linkId,
    vkWorkspaceId: workspaceId,
    beadsDirKey: workspaceBeadsDirKey(workspaceId),
    kind: 'external_issue',
  };
  const title = `[${providerLabel(input.externalIssue.provider)} ${input.externalIssue.key}] ${externalIssueTitle(input.externalIssue)}`;
  const description = [
    `Source: ${input.externalIssue.url}`,
    `Provider: ${input.externalIssue.provider}`,
    `Key: ${input.externalIssue.key}`,
    '',
    externalIssueBody(input.externalIssue),
  ].join('\n').trim();

  try {
    await runBd(['show', beadId, '--json'], { cwd });
    await runBd(['update', beadId, '--title', title, '--description', description, '--metadata', JSON.stringify(metadata)], { cwd });
  } catch {
    await runBd(['create', '--force', '--id', beadId, '--title', title, '--description', description, '--metadata', JSON.stringify(metadata), '--type', 'task'], { cwd });
  }

  return { beadId, beadsDirKey: workspaceBeadsDirKey(workspaceId) };
}

export async function defaultRunBd(args: string[], options: { cwd: string }): Promise<{ stdout: string }> {
  const env = { ...process.env };
  delete env.BEADS_DOLT_SHARED_SERVER;
  delete env.BEADS_DOLT_SERVER_HOST;
  delete env.BEADS_DOLT_SERVER_PORT;
  env.BEADS_DIR = path.join(options.cwd, '.beads');
  return execFile('bd', args, { cwd: options.cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
}

async function writeWorkspaceRedirect(workspaceId: string, workspaceDir: string, options: WorkspaceBeadsOptions): Promise<void> {
  const markerDir = path.join(workspaceDir, '.beads');
  await mkdir(markerDir, { recursive: true });
  await writeFile(path.join(markerDir, 'redirect'), `${workspaceBeadsDir(workspaceId, options)}\n`);
}

async function upsertWorkspaceInstructionBlocks(workspaceDir: string, options: WorkspaceBeadsOptions): Promise<void> {
  const manifest = await loadWorkspaceBeadsManifest(options);
  const instructions = await renderWorkspaceBeadsInstructionBlock(options);
  for (const targetFile of manifest.target_files) {
    await upsertManagedBlock(resolveWorkspacePath(workspaceDir, targetFile), 'workspace-instructions', instructions);
  }
}

async function upsertManagedBlock(filePath: string, marker: string, content: string): Promise<void> {
  const begin = `<!-- BEGIN VD MANAGED BLOCK: ${marker} -->`;
  const end = `<!-- END VD MANAGED BLOCK: ${marker} -->`;
  const block = `${begin}\n${content.trim()}\n${end}`;
  const existing = await readFile(filePath, 'utf8').catch(() => '');
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trimEnd() ? '\n\n' : ''}${block}\n`;
  await writeFile(filePath, next);
}

async function ensureEmbeddedBeadsDatabase(cwd: string, prefix: string, options: WorkspaceBeadsOptions = {}): Promise<void> {
  await mkdir(path.join(cwd, '.beads'), { recursive: true });
  await writeIfMissing(path.join(cwd, '.beads', 'config.yaml'), 'no-git-ops: true\nno-push: true\n\ndolt:\n  shared-server: false\n');
  await chmod(path.join(cwd, '.beads'), 0o700).catch(() => undefined);
  const runBd = options.runBd ?? defaultRunBd;
  await runBd(['init', '--init-if-missing', '--skip-agents', '--non-interactive', '--prefix', prefix], { cwd });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveSettingsPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Workspace beads fragment escapes VK_SETTINGS_DIRECTORY: ${relativePath}`);
  }
  return resolved;
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Workspace instruction target escapes workspace: ${relativePath}`);
  }
  return resolved;
}

function parseWorkspaceBeadsManifest(toml: string): { required_fragments: string[]; append_fragments: string[]; target_files: string[] } {
  return {
    required_fragments: parseStringArray(toml, 'required_fragments'),
    append_fragments: parseStringArray(toml, 'append_fragments'),
    target_files: parseStringArray(toml, 'target_files').filter((entry) => entry.trim()),
  };
}

async function loadWorkspaceBeadsManifest(options: WorkspaceBeadsOptions): Promise<{ required_fragments: string[]; append_fragments: string[]; target_files: string[] }> {
  await seedWorkspaceBeadsInstructionConfig(options);
  const root = resolveVkSettingsDirectory(options);
  const manifest = parseWorkspaceBeadsManifest(await readFile(path.join(root, 'workspace-beads.toml'), 'utf8'));
  return {
    ...manifest,
    target_files: manifest.target_files.length > 0 ? manifest.target_files : ['AGENTS.md', 'CLAUDE.md'],
  };
}

function parseStringArray(toml: string, key: string): string[] {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]\\s*$`, 'm'));
  const rawItems = match?.[1];
  if (!rawItems) return [];
  return [...rawItems.matchAll(/"([^"]+)"/g)]
    .map((entry) => entry[1])
    .filter((value): value is string => typeof value === 'string');
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

function providerLabel(provider: ExternalProvider): string {
  if (provider === 'jira') return 'Jira';
  if (provider === 'github') return 'GitHub';
  return 'Linear';
}

function externalIssueTitle(issue: ExternalIssueRef): string {
  const metadataTitle = issue.metadata?.title;
  return typeof metadataTitle === 'string' && metadataTitle.trim() ? metadataTitle.trim() : issue.key;
}

function externalIssueBody(issue: ExternalIssueRef): string {
  const body = issue.metadata?.body ?? issue.metadata?.description;
  return typeof body === 'string' ? body : '';
}
