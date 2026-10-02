#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function resolveVkSettingsDirectory(): string {
  return process.env.VK_SETTINGS_DIRECTORY ?? '/var/lib/vd/vk-config';
}

function resolveVdBeadsDirectory(): string {
  return process.env.VD_BEADS_DIRECTORY ?? '/var/lib/vd/beads';
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'punt') {
  await runPunt(args.slice(1));
} else if (command === 'migrate-shared-server') {
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;
  const beadsDir = resolveVdBeadsDirectory();
  const settingsDir = resolveVkSettingsDirectory();
  const sharedEnvPresent = ['BEADS_DOLT_SHARED_SERVER', 'BEADS_DOLT_SERVER_HOST', 'BEADS_DOLT_SERVER_PORT']
    .filter((key) => process.env[key] !== undefined);

  console.log(JSON.stringify({
    command,
    mode: dryRun ? 'dry-run' : 'apply',
    beadsDir,
    settingsDir,
    sharedEnvPresent,
    actions: [
      'require app/agent downtime',
      'backup/export shared-server data before moving',
      'initialize embedded workspace databases under VD_BEADS_DIRECTORY',
      'verify migrated counts and metadata',
      'remove shared-server env/config from steady state',
    ],
  }, null, 2));

  if (apply) {
    if (process.env.VD_BEADS_MIGRATION_OFFLINE_APPROVED !== 'true') {
      throw new Error('Refusing apply without VD_BEADS_MIGRATION_OFFLINE_APPROVED=true');
    }
    await mkdir(beadsDir, { recursive: true });
    await mkdir(settingsDir, { recursive: true });
    console.log('Offline migration guard passed. Run backup/export and per-workspace migration steps from this checkpoint.');
  }
} else if (command === 'migrate-repo-scoped') {
  const apply = args.includes('--apply');
  console.log(JSON.stringify({
    command,
    mode: apply ? 'apply' : 'dry-run',
    repoScanRoots: ['/home/vkuser/repos'],
    note: 'Repo-scoped beads with metadata.VK_WORKSPACE_ID are migration inputs only.',
  }, null, 2));
  if (apply && !existsSync(resolveVdBeadsDirectory())) {
    throw new Error('VD_BEADS_DIRECTORY does not exist; run migrate-shared-server first');
  }
} else {
  console.error('Usage: vd-beads punt --bead <id> --from-workspace <id> --to-workspace <id> [--yes]');
  console.error('       vd-beads punt --bead <id> --from-workspace <id> --new-workspace --repo <repo_id>:<branch> [--append-to-prompt <text>] [--executor CODEX] [--no-start] [--yes]');
  console.error('Usage: vd-beads migrate-shared-server --dry-run|--apply');
  console.error('       vd-beads migrate-repo-scoped --dry-run|--apply');
  process.exit(2);
}

async function runPunt(puntArgs: string[]): Promise<void> {
  const beadId = readFlag(puntArgs, '--bead');
  const fromWorkspaceId = readFlag(puntArgs, '--from-workspace');
  const toWorkspaceId = readFlag(puntArgs, '--to-workspace');
  const newWorkspace = puntArgs.includes('--new-workspace');
  const appendToPrompt = readFlag(puntArgs, '--append-to-prompt', false);
  const start = !puntArgs.includes('--no-start');
  const yes = puntArgs.includes('--yes');
  const repos = readRepeatedFlag(puntArgs, '--repo').map(parseRepoBranch);

  if (!beadId || !fromWorkspaceId) throw new Error('punt requires --bead and --from-workspace');
  if (!toWorkspaceId && !newWorkspace) throw new Error('punt requires --to-workspace or --new-workspace');
  if (toWorkspaceId && newWorkspace) throw new Error('choose either --to-workspace or --new-workspace');
  if (newWorkspace && repos.length === 0) throw new Error('--new-workspace requires at least one --repo <repo_id>:<branch>');

  const destinationWorkspaceId = toWorkspaceId ?? randomUUID();
  const destinationBeadId = puntDestinationBeadId(beadId, fromWorkspaceId, destinationWorkspaceId);
  const prompt = buildPuntPrompt(destinationBeadId, appendToPrompt);

  const plan = {
    beadId,
    fromWorkspaceId,
    destinationWorkspaceId,
    destinationBeadId,
    ...(newWorkspace ? { newWorkspace: { repos, start, prompt } } : {}),
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!yes) await confirmOrThrow('Execute this punt? Type "yes" to continue: ');

  await ensureEmbeddedWorkspaceDb(destinationWorkspaceId);
  await copyAndCloseBead(beadId, fromWorkspaceId, destinationWorkspaceId, destinationBeadId);

  if (newWorkspace && start) {
    const executor = readFlag(puntArgs, '--executor', false) ?? 'CODEX';
    const name = readFlag(puntArgs, '--name', false) ?? `Punted ${destinationBeadId}`;
    const body = {
      workspace_id: destinationWorkspaceId,
      name,
      repos: repos.map((repo) => ({ repo_id: repo.repo, target_branch: repo.branch })),
      linked_issue: null,
      executor_config: { executor },
      prompt,
      attachment_ids: null,
      workspace_overlay: await buildOverlay(destinationWorkspaceId),
    };
    await vkPost('/workspaces/start', body);
  }
}

async function copyAndCloseBead(beadId: string, fromWorkspaceId: string, toWorkspaceId: string, destinationBeadId: string): Promise<void> {
  const sourceCwd = workspaceCwd(fromWorkspaceId);
  const destinationCwd = workspaceCwd(toWorkspaceId);
  const source = await bdJson(['show', beadId, '--json'], sourceCwd);
  const issue = Array.isArray(source) ? source[0] : source;
  const sourceMetadata = metadataObject(issue?.metadata);
  await bd(['create', '--id', destinationBeadId, '--title', issue?.title ?? beadId, '--description', issue?.description ?? '', '--metadata', JSON.stringify({
    ...sourceMetadata,
    move: { state: 'pending', sourceWorkspaceId: fromWorkspaceId, sourceBeadId: beadId, destinationWorkspaceId: toWorkspaceId },
  })], destinationCwd).catch(async () => {
    await bd(['update', destinationBeadId, '--metadata', JSON.stringify({
      ...sourceMetadata,
      move: { state: 'pending', sourceWorkspaceId: fromWorkspaceId, sourceBeadId: beadId, destinationWorkspaceId: toWorkspaceId },
    })], destinationCwd);
  });
  await bd(['update', beadId, '--metadata', JSON.stringify({
    ...sourceMetadata,
    move: { state: 'moved', destinationWorkspaceId: toWorkspaceId, destinationBeadId },
  })], sourceCwd);
  await bd(['close', beadId, '--reason', `Moved to ${toWorkspaceId}:${destinationBeadId}`], sourceCwd);
  await bd(['update', destinationBeadId, '--metadata', JSON.stringify({
    ...sourceMetadata,
    move: { state: 'complete', sourceWorkspaceId: fromWorkspaceId, sourceBeadId: beadId, destinationWorkspaceId: toWorkspaceId },
  })], destinationCwd);
}

async function ensureEmbeddedWorkspaceDb(workspaceId: string): Promise<void> {
  const cwd = workspaceCwd(workspaceId);
  await mkdir(path.join(cwd, '.beads'), { recursive: true });
  await writeFile(path.join(cwd, '.beads', 'config.yaml'), 'dolt:\n  shared-server: false\n', { flag: 'wx' }).catch(() => undefined);
  await bd(['init', '--init-if-missing', '--skip-agents', '--non-interactive', '--prefix', 'vdw'], cwd);
}

async function buildOverlay(workspaceId: string): Promise<{ files: Array<{ path: string; content: string }>; managed_blocks: Array<{ path: string; marker: string; content: string }> }> {
  const instructions = '## Workspace Beads\n\nRun `bd` commands from this workspace root/top-level directory.\nThis workspace uses `.beads/redirect` to store beads in persisted VD storage.\nDo not initialize beads inside repository subdirectories.';
  return {
    files: [{ path: '.beads/redirect', content: `${path.join(resolveVdBeadsDirectory(), 'workspaces', workspaceId, '.beads')}\n` }],
    managed_blocks: ['AGENTS.md', 'CLAUDE.md'].map((file) => ({ path: file, marker: 'workspace-instructions', content: instructions })),
  };
}

async function vkPost(route: string, body: unknown): Promise<void> {
  const baseUrl = (process.env.VIBE_API_URL || process.env.VK_API_URL || 'http://localhost:3007').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`VK API ${route} failed: ${response.status} ${response.statusText}`);
}

async function bdJson(commandArgs: string[], cwd: string): Promise<any> {
  const { stdout } = await bd(commandArgs, cwd);
  return JSON.parse(stdout);
}

async function bd(commandArgs: string[], cwd: string): Promise<{ stdout: string }> {
  const env = { ...process.env };
  delete env.BEADS_DOLT_SHARED_SERVER;
  delete env.BEADS_DOLT_SERVER_HOST;
  delete env.BEADS_DOLT_SERVER_PORT;
  return execFile('bd', commandArgs, { cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
}

function workspaceCwd(workspaceId: string): string {
  return path.join(resolveVdBeadsDirectory(), 'workspaces', workspaceId);
}

function puntDestinationBeadId(sourceBeadId: string, fromWorkspaceId: string, toWorkspaceId: string): string {
  return `vdp-${createHash('sha256').update(`${fromWorkspaceId}\0${toWorkspaceId}\0${sourceBeadId}`).digest('base64url').slice(0, 32)}`;
}

function buildPuntPrompt(destinationBeadId: string, appendToPrompt?: string): string {
  return [`Start work from bead ${destinationBeadId}.`, 'Run bd from the workspace root and inspect the bead before making changes.', appendToPrompt?.trim() ?? ''].filter(Boolean).join('\n\n');
}

function parseRepoBranch(value: string): { repo: string; branch: string } {
  const index = value.indexOf(':');
  if (index <= 0 || index === value.length - 1) throw new Error(`Invalid --repo value: ${value}`);
  return { repo: value.slice(0, index), branch: value.slice(index + 1) };
}

function readFlag(values: string[], flag: string, required = true): string | undefined {
  const index = values.indexOf(flag);
  const value = index >= 0 ? values[index + 1] : undefined;
  if (required && !value) throw new Error(`Missing ${flag}`);
  return value;
}

function readRepeatedFlag(values: string[], flag: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === flag && values[index + 1]) out.push(values[index + 1]);
  }
  return out;
}

async function confirmOrThrow(question: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  if (answer !== 'yes') throw new Error('Cancelled');
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } as Record<string, unknown> : {};
}
