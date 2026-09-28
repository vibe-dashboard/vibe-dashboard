import { createHash, randomUUID } from 'node:crypto';
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
Add local workspace instruction customizations here.
This file is seeded once and is not overwritten by VD updates.
-->`;

export interface WorkspaceOverlayFile {
  path: string;
  content: string;
}

export interface WorkspaceOverlayManagedBlock {
  path: string;
  marker: string;
  content: string;
}

export interface WorkspaceOverlay {
  files: WorkspaceOverlayFile[];
  managed_blocks: WorkspaceOverlayManagedBlock[];
}

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
    const content = await readFile(path.resolve(root, fragment), 'utf8').catch(() => '');
    if (content.trim()) rendered.push(content.trim());
  }
  return rendered.join('\n\n');
}

export async function buildWorkspaceBeadsOverlay(
  workspaceId: string,
  options: WorkspaceBeadsOptions = {},
): Promise<WorkspaceOverlay> {
  const target = workspaceBeadsDir(workspaceId, options);
  const manifest = await loadWorkspaceBeadsManifest(options);
  const instructions = await renderWorkspaceBeadsInstructionBlock(options);
  return {
    files: [{ path: '.beads/redirect', content: `${target}\n` }],
    managed_blocks: manifest.target_files.map((targetFile) => ({
      path: targetFile,
      marker: 'workspace-instructions',
      content: instructions,
    })),
  };
}

export async function ensureWorkspaceBeadsDatabase(workspaceId: string, options: WorkspaceBeadsOptions = {}): Promise<void> {
  const dir = workspaceBeadsDir(workspaceId, options);
  await mkdir(dir, { recursive: true });
  await writeIfMissing(path.join(dir, 'config.yaml'), 'dolt:\n  shared-server: false\n');
  await chmod(dir, 0o700).catch(() => undefined);
  const runBd = options.runBd ?? defaultRunBd;
  await runBd(['init', '--init-if-missing', '--skip-agents', '--non-interactive', '--prefix', 'vdw'], { cwd: path.dirname(dir) });
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
    await runBd(['create', '--id', beadId, '--title', title, '--description', description, '--metadata', JSON.stringify(metadata), '--type', 'task'], { cwd });
  }

  return { beadId, beadsDirKey: workspaceBeadsDirKey(workspaceId) };
}

export async function defaultRunBd(args: string[], options: { cwd: string }): Promise<{ stdout: string }> {
  const env = { ...process.env };
  delete env.BEADS_DOLT_SHARED_SERVER;
  delete env.BEADS_DOLT_SERVER_HOST;
  delete env.BEADS_DOLT_SERVER_PORT;
  return execFile('bd', args, { cwd: options.cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
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
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
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

export function newWorkspaceId(): string {
  return randomUUID();
}
