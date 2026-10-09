#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { promisify } from 'node:util';
import {
  applyWorkspaceBeadsSetup,
  deterministicWorkspaceBeadId,
  resolveVdBeadsDirectory,
  resolveVkSettingsDirectory,
} from '../src/modules/plugins/kanban/server/workspaceBeads.ts';

const execFile = promisify(execFileCallback);

const args = process.argv.slice(2);
const command = args[0];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  if (command === 'workspace-setup') {
    await runWorkspaceSetup();
  } else if (command === 'punt') {
    await runPunt(args.slice(1));
  } else {
    console.error('Usage: vd-beads workspace-setup');
    console.error('       vd-beads punt --bead <id> --from-workspace <id> --to-workspace <id> [--yes]');
    console.error('       vd-beads punt --bead <id> --from-workspace <id> --new-workspace --name <name> --repo <repo_id>:<branch> [--append-to-prompt <text>] [--executor CODEX] [--no-start] [--yes]');
    process.exit(2);
  }
}

async function runWorkspaceSetup(): Promise<void> {
  const workspaceId = process.env.VK_WORKSPACE_ID;
  const workspaceDir = process.env.VK_WORKSPACE_DIR;
  if (!workspaceId) throw new Error('VK_WORKSPACE_ID is required');
  if (!workspaceDir) throw new Error('VK_WORKSPACE_DIR is required');
  const repos = parseReposJson(process.env.VK_WORKSPACE_REPOS_JSON ?? '[]');
  await applyWorkspaceBeadsSetup({ workspaceId, workspaceDir, repos });
  await runUserSetupCommands(workspaceDir);
  console.log(JSON.stringify({
    ok: true,
    workspaceId,
    workspaceBeadId: deterministicWorkspaceBeadId(workspaceId),
    repoCount: repos.length,
  }));
}

async function runPunt(puntArgs: string[]): Promise<void> {
  const beadId = readFlag(puntArgs, '--bead');
  const fromWorkspaceId = readFlag(puntArgs, '--from-workspace');
  const toWorkspaceId = readFlag(puntArgs, '--to-workspace', false);
  const newWorkspace = puntArgs.includes('--new-workspace');
  const appendToPrompt = readFlag(puntArgs, '--append-to-prompt', false);
  const start = !puntArgs.includes('--no-start');
  const yes = puntArgs.includes('--yes');
  const repos = readRepeatedFlag(puntArgs, '--repo').map(parseRepoBranch);

  if (!beadId || !fromWorkspaceId) throw new Error('punt requires --bead and --from-workspace');
  if (!toWorkspaceId && !newWorkspace) throw new Error('punt requires --to-workspace or --new-workspace');
  if (toWorkspaceId && newWorkspace) throw new Error('choose either --to-workspace or --new-workspace');
  if (newWorkspace && repos.length === 0) throw new Error('--new-workspace requires at least one --repo <repo_id>:<branch>');

  const executor = readFlag(puntArgs, '--executor', false) ?? 'CODEX';
  const requestedName = readFlag(puntArgs, '--name', false);
  if (newWorkspace && !requestedName) throw new Error('--new-workspace requires --name');
  const initialDestinationWorkspaceId = toWorkspaceId ?? '(created by VK)';
  const plan = { beadId, fromWorkspaceId, destinationWorkspaceId: initialDestinationWorkspaceId, ...(newWorkspace ? { newWorkspace: { repos, start } } : {}) };
  console.log(JSON.stringify(plan, null, 2));
  if (!yes) await confirmOrThrow('Execute this punt? Type "yes" to continue: ');

  let destinationWorkspaceId = toWorkspaceId;
  if (newWorkspace) {
    const created = await vkPost<{ workspace: { id: string; name?: string | null } }>('/api/workspaces/create-only', {
      name: requestedName,
      repos: repos.map((repo) => ({ repo_id: repo.repo, target_branch: repo.branch })),
      linked_issue: null,
      attachment_ids: null,
    });
    destinationWorkspaceId = created.workspace.id;
  }

  if (!destinationWorkspaceId) throw new Error('destination workspace was not created');
  const destinationBeadId = puntDestinationBeadId(beadId, fromWorkspaceId, destinationWorkspaceId);
  const prompt = buildPuntPrompt(destinationBeadId, appendToPrompt);
  await createDestinationPending(beadId, fromWorkspaceId, destinationWorkspaceId, destinationBeadId);

  if (newWorkspace && start) {
    const session = await vkPost<{ id: string }>('/api/sessions', {
      workspace_id: destinationWorkspaceId,
      executor,
      name: requestedName,
    });
    await vkPost(`/api/sessions/${encodeURIComponent(session.id)}/follow-up`, {
      prompt,
      executor_config: { executor },
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
  }

  if (!newWorkspace || start) {
    await closeSourceAndCompleteDestination(beadId, fromWorkspaceId, destinationWorkspaceId, destinationBeadId);
  }
}

async function createDestinationPending(beadId: string, fromWorkspaceId: string, toWorkspaceId: string, destinationBeadId: string): Promise<void> {
  const sourceCwd = workspaceCwd(fromWorkspaceId);
  const destinationCwd = workspaceCwd(toWorkspaceId);
  const source = await bdJson(['show', beadId, '--json'], sourceCwd);
  const issue = Array.isArray(source) ? source[0] : source;
  const sourceMetadata = metadataObject(issue?.metadata);
  const metadata = { ...sourceMetadata, move: { state: 'pending', sourceWorkspaceId: fromWorkspaceId, sourceBeadId: beadId, destinationWorkspaceId: toWorkspaceId } };
  await bd(['create', '--force', '--id', destinationBeadId, '--title', issue?.title ?? beadId, '--description', issue?.description ?? '', '--metadata', JSON.stringify(metadata), '--type', 'task'], destinationCwd).catch(async () => {
    await bd(['update', destinationBeadId, '--metadata', JSON.stringify(metadata)], destinationCwd);
  });
}

async function closeSourceAndCompleteDestination(beadId: string, fromWorkspaceId: string, toWorkspaceId: string, destinationBeadId: string): Promise<void> {
  const sourceCwd = workspaceCwd(fromWorkspaceId);
  const destinationCwd = workspaceCwd(toWorkspaceId);
  const source = await bdJson(['show', beadId, '--json'], sourceCwd);
  const sourceMetadata = metadataObject((Array.isArray(source) ? source[0] : source)?.metadata);
  await bd(['update', beadId, '--metadata', JSON.stringify({ ...sourceMetadata, move: { state: 'moved', destinationWorkspaceId: toWorkspaceId, destinationBeadId } })], sourceCwd);
  await bd(['close', beadId, '--reason', `Moved to ${toWorkspaceId}:${destinationBeadId}`], sourceCwd).catch(() => undefined);
  await bd(['update', destinationBeadId, '--metadata', JSON.stringify({ ...sourceMetadata, move: { state: 'complete', sourceWorkspaceId: fromWorkspaceId, sourceBeadId: beadId, destinationWorkspaceId: toWorkspaceId } })], destinationCwd);
}

async function runUserSetupCommands(workspaceDir: string): Promise<void> {
  const config = path.join(resolveVkSettingsDirectory(), 'workspace-beads.toml');
  if (!existsSync(config)) return;
  const content = await readFile(config, 'utf8');
  for (const command of parseStringArray(content, 'extra_setup_commands')) {
    await execFile('/bin/sh', ['-lc', command], { cwd: workspaceDir, env: process.env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  }
}

async function vkPost<T = unknown>(route: string, body: unknown): Promise<T> {
  const raw = (process.env.VIBE_API_URL || process.env.VK_API_URL || 'http://localhost:3007').replace(/\/+$/, '');
  const baseUrl = raw.endsWith('/api') ? raw.slice(0, -4) : raw;
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`VK API ${route} failed: ${response.status} ${response.statusText}`);
  const parsed = await response.json() as { success?: boolean; data?: T; message?: string };
  if (parsed.success === false) throw new Error(parsed.message ?? `VK API ${route} returned unsuccessful response`);
  return (parsed.data ?? parsed) as T;
}

async function bdJson(commandArgs: string[], cwd: string): Promise<any> {
  const { stdout } = await bd(commandArgs, cwd);
  return JSON.parse(stdout);
}

async function bd(commandArgs: string[], cwd: string, embedded = true): Promise<{ stdout: string }> {
  const env = { ...process.env };
  if (embedded) {
    delete env.BEADS_DOLT_SHARED_SERVER;
    delete env.BEADS_DOLT_SERVER_HOST;
    delete env.BEADS_DOLT_SERVER_PORT;
    env.BEADS_DIR = path.join(cwd, '.beads');
  }
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

function parseReposJson(value: string): Array<{ id?: string; name: string; displayName?: string; path?: string; targetBranch?: string }> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((repo): repo is { id?: string; name: string; displayName?: string; path?: string; targetBranch?: string } => (
    !!repo && typeof repo === 'object' && typeof (repo as { name?: unknown }).name === 'string'
  ));
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
    const value = values[index + 1];
    if (values[index] === flag && value) out.push(value);
  }
  return out;
}

function parseStringArray(toml: string, key: string): string[] {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]\\s*$`, 'm'));
  const rawItems = match?.[1];
  if (!rawItems) return [];
  return [...rawItems.matchAll(/"([^"]+)"/g)]
    .map((entry) => entry[1])
    .filter((value): value is string => typeof value === 'string');
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
