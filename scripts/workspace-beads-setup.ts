#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  applyWorkspaceBeadsSetup,
  deterministicWorkspaceBeadId,
  resolveVkSettingsDirectory,
} from '../src/modules/plugins/kanban/server/workspaceBeads.ts';

const execFile = promisify(execFileCallback);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
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

async function runUserSetupCommands(workspaceDir: string): Promise<void> {
  const config = path.join(resolveVkSettingsDirectory(), 'workspace-beads.toml');
  if (!existsSync(config)) return;
  const content = await readFile(config, 'utf8');
  for (const command of parseStringArray(content, 'extra_setup_commands')) {
    await execFile('/bin/sh', ['-lc', command], { cwd: workspaceDir, env: process.env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  }
}

function parseReposJson(value: string): Array<{ id?: string; name: string; displayName?: string; path?: string; targetBranch?: string }> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((repo): repo is { id?: string; name: string; displayName?: string; path?: string; targetBranch?: string } => (
    !!repo && typeof repo === 'object' && typeof (repo as { name?: unknown }).name === 'string'
  ));
}

function parseStringArray(toml: string, key: string): string[] {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]\\s*$`, 'm'));
  const rawItems = match?.[1];
  if (!rawItems) return [];
  return [...rawItems.matchAll(/"([^"]+)"/g)]
    .map((entry) => entry[1])
    .filter((value): value is string => typeof value === 'string');
}
