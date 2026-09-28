#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
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

if (command === 'workspace-setup') {
  await runWorkspaceSetup();
} else if (command === 'punt') {
  await runPunt(args.slice(1));
} else if (command === 'migrate-shared-server') {
  await runSharedServerMigration(args.slice(1));
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
  console.error('Usage: vd-beads workspace-setup');
  console.error('       vd-beads punt --bead <id> --from-workspace <id> --to-workspace <id> [--yes]');
  console.error('       vd-beads punt --bead <id> --from-workspace <id> --new-workspace --repo <repo_id>:<branch> [--append-to-prompt <text>] [--executor CODEX] [--no-start] [--yes]');
  console.error('       vd-beads migrate-shared-server --dry-run|--apply');
  console.error('       vd-beads migrate-repo-scoped --dry-run|--apply');
  process.exit(2);
}

async function runWorkspaceSetup(): Promise<void> {
  const workspaceId = process.env.VK_WORKSPACE_ID;
  const workspaceDir = process.env.VK_WORKSPACE_DIR ?? process.cwd();
  if (!workspaceId) throw new Error('VK_WORKSPACE_ID is required');
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

async function runSharedServerMigration(migrationArgs: string[]): Promise<void> {
  const apply = migrationArgs.includes('--apply');
  const beadsDir = resolveVdBeadsDirectory();
  const settingsDir = resolveVkSettingsDirectory();
  const sharedDir = process.env.VD_SHARED_BEADS_SOURCE ?? '/home/vkuser/.beads/shared-server';
  const bdConfigPath = process.env.VD_BD_CONFIG_PATH ?? path.join(process.env.HOME ?? '/home/vkuser', '.config', 'bd', 'config.yaml');
  const sharedSourceExists = existsSync(sharedDir);
  const bdConfigExisted = existsSync(bdConfigPath);
  const report: Record<string, unknown> = {
    command: 'migrate-shared-server',
    mode: apply ? 'apply' : 'dry-run',
    beadsDir,
    settingsDir,
    sharedDir,
    bdConfigPath,
    offlineRequired: true,
    sharedSourceExists,
  };

  if (!apply) {
    console.log(JSON.stringify({ ...report, actions: [
      'require VD_BEADS_MIGRATION_OFFLINE_APPROVED=true for apply',
      'copy shared-server directory into timestamped backup',
      'export bd JSONL from shared source when bd can read it',
      'initialize embedded aggregate targets',
      'write non-shared steady-state bd config',
      'verify initialized targets with bd export',
    ] }, null, 2));
    return;
  }

  if (process.env.VD_BEADS_MIGRATION_OFFLINE_APPROVED !== 'true') {
    throw new Error('Refusing apply without VD_BEADS_MIGRATION_OFFLINE_APPROVED=true');
  }

  await mkdir(beadsDir, { recursive: true });
  await mkdir(settingsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(beadsDir, 'backups', `shared-server-${stamp}`);
  await mkdir(backupDir, { recursive: true });

  if (sharedSourceExists) {
    await cp(sharedDir, path.join(backupDir, 'shared-server'), { recursive: true, force: false, errorOnExist: true });
  }
  if (bdConfigExisted) {
    await cp(bdConfigPath, path.join(backupDir, 'bd-config.yaml'), { force: false, errorOnExist: true });
  }

  const exportPath = path.join(backupDir, 'shared-export.jsonl');
  const exportResult = sharedSourceExists
    ? await bdLegacyShared(['--global', 'export', '--all'], process.cwd()).catch((error) => ({ error: String(error) }))
    : { skipped: 'no shared source exists' };
  if ('error' in exportResult) {
    await restoreOriginalBdConfig(bdConfigPath, backupDir, bdConfigExisted);
    throw new Error(`Legacy shared-server export failed; refusing to rewrite bd config. Backup directory: ${backupDir}. Export error: ${exportResult.error}`);
  }
  if ('stdout' in exportResult) {
    if (!exportResult.stdout.trim()) {
      await restoreOriginalBdConfig(bdConfigPath, backupDir, bdConfigExisted);
      throw new Error(`Legacy shared-server export was empty despite shared source existing; refusing to rewrite bd config. Backup directory: ${backupDir}`);
    }
    await writeFile(exportPath, exportResult.stdout);
  }

  await ensureEmbeddedDb(path.join(beadsDir, 'aggregate-workspaces'), 'vdw');
  await ensureEmbeddedDb(path.join(beadsDir, 'aggregate-all-beads'), 'vda');
  let importResult: { stdout: string } | { skipped: string } = { skipped: 'no export available' };
  if ('stdout' in exportResult) {
    importResult = await bd(['import', exportPath, '--json'], path.join(beadsDir, 'aggregate-all-beads'));
  }
  const aggregateCheck = await bd(['export', '--json'], path.join(beadsDir, 'aggregate-workspaces'));
  const allBeadsCheck = await bd(['export'], path.join(beadsDir, 'aggregate-all-beads'));
  const nonSharedConfig = 'no-git-ops: true\nno-push: true\n\ndolt:\n  shared-server: false\n  auto-commit: on\n  auto-push: false\n';
  await mkdir(path.dirname(bdConfigPath), { recursive: true });
  await writeFile(bdConfigPath, nonSharedConfig);
  await writeFile(path.join(settingsDir, 'bd-config.default.yaml'), nonSharedConfig);

  console.log(JSON.stringify({
    ...report,
    backupDir,
    backedUpBdConfig: existsSync(path.join(backupDir, 'bd-config.yaml')),
    exportPath: 'stdout' in exportResult ? exportPath : null,
    exportError: 'error' in exportResult ? exportResult.error : null,
    initialized: ['aggregate-workspaces', 'aggregate-all-beads'],
    importResult: 'stdout' in importResult ? JSON.parse(importResult.stdout || '{}') : importResult,
    verifiedAggregateExportBytes: aggregateCheck.stdout.length,
    verifiedAllBeadsExportLines: allBeadsCheck.stdout.trim() ? allBeadsCheck.stdout.trim().split('\n').length : 0,
  }, null, 2));
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

  const destinationWorkspaceId = toWorkspaceId ?? randomUUID();
  const destinationBeadId = puntDestinationBeadId(beadId, fromWorkspaceId, destinationWorkspaceId);
  const prompt = buildPuntPrompt(destinationBeadId, appendToPrompt);
  const executor = readFlag(puntArgs, '--executor', false) ?? 'CODEX';
  const name = readFlag(puntArgs, '--name', false) ?? `Punted ${destinationBeadId}`;
  const plan = { beadId, fromWorkspaceId, destinationWorkspaceId, destinationBeadId, ...(newWorkspace ? { newWorkspace: { repos, start, prompt } } : {}) };
  console.log(JSON.stringify(plan, null, 2));
  if (!yes) await confirmOrThrow('Execute this punt? Type "yes" to continue: ');

  await ensureEmbeddedWorkspaceDb(destinationWorkspaceId);
  await createDestinationPending(beadId, fromWorkspaceId, destinationWorkspaceId, destinationBeadId);

  if (newWorkspace && start) {
    await vkPost('/api/workspaces/start', {
      workspace_id: destinationWorkspaceId,
      name,
      repos: repos.map((repo) => ({ repo_id: repo.repo, target_branch: repo.branch })),
      linked_issue: null,
      executor_config: { executor },
      prompt,
      attachment_ids: null,
    });
  } else if (newWorkspace) {
    await vkPost('/api/workspaces/create-only', {
      workspace_id: destinationWorkspaceId,
      name,
      repos: repos.map((repo) => ({ repo_id: repo.repo, target_branch: repo.branch })),
      linked_issue: null,
      attachment_ids: null,
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

async function ensureEmbeddedWorkspaceDb(workspaceId: string): Promise<void> {
  await ensureEmbeddedDb(workspaceCwd(workspaceId), 'vdw');
}

async function ensureEmbeddedDb(cwd: string, prefix: string): Promise<void> {
  await mkdir(path.join(cwd, '.beads'), { recursive: true });
  await writeFile(path.join(cwd, '.beads', 'config.yaml'), 'no-git-ops: true\nno-push: true\n\ndolt:\n  shared-server: false\n', { flag: 'wx' }).catch(() => undefined);
  await bd(['init', '--init-if-missing', '--skip-agents', '--non-interactive', '--prefix', prefix], cwd);
}

async function runUserSetupCommands(workspaceDir: string): Promise<void> {
  const config = path.join(resolveVkSettingsDirectory(), 'workspace-beads.toml');
  if (!existsSync(config)) return;
  const content = await import('node:fs/promises').then((fs) => fs.readFile(config, 'utf8'));
  for (const command of parseStringArray(content, 'extra_setup_commands')) {
    await execFile('/bin/sh', ['-lc', command], { cwd: workspaceDir, env: process.env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  }
}

async function vkPost(route: string, body: unknown): Promise<void> {
  const raw = (process.env.VIBE_API_URL || process.env.VK_API_URL || 'http://localhost:3007').replace(/\/+$/, '');
  const baseUrl = raw.endsWith('/api') ? raw.slice(0, -4) : raw;
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

async function bdLegacyShared(commandArgs: string[], cwd: string): Promise<{ stdout: string }> {
  const env = { ...process.env };
  delete env.BEADS_DIR;
  env.BEADS_DOLT_SHARED_SERVER = 'true';
  env.BEADS_DOLT_SERVER_HOST = env.BEADS_DOLT_SERVER_HOST ?? '127.0.0.1';
  env.BEADS_DOLT_SERVER_PORT = env.BEADS_DOLT_SERVER_PORT ?? '3308';
  return execFile('bd', commandArgs, { cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
}

async function restoreOriginalBdConfig(bdConfigPath: string, backupDir: string, bdConfigExisted: boolean): Promise<void> {
  if (bdConfigExisted) {
    await mkdir(path.dirname(bdConfigPath), { recursive: true });
    await cp(path.join(backupDir, 'bd-config.yaml'), bdConfigPath, { force: true });
  } else {
    await rm(bdConfigPath, { force: true });
  }
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
    if (values[index] === flag && values[index + 1]) out.push(values[index + 1]);
  }
  return out;
}

function parseStringArray(toml: string, key: string): string[] {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]\\s*$`, 'm'));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
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
