import { createHash } from 'node:crypto';
import { defaultRunBd, ensureWorkspaceBeadsDatabase, workspaceBeadsDir, type BdCommandRunner, type WorkspaceBeadsOptions } from './workspaceBeads';

export interface PuntExistingWorkspace {
  kind: 'existing';
  workspaceId: string;
}

export interface PuntNewWorkspace {
  kind: 'new';
  workspaceId: string;
  repos: Array<{ repo: string; branch: string }>;
  appendToPrompt?: string;
  start: boolean;
}

export interface PuntBeadArgs {
  beadId: string;
  fromWorkspaceId: string;
  destination: PuntExistingWorkspace | PuntNewWorkspace;
}

interface BdIssue {
  id: string;
  title?: string;
  description?: string;
  metadata?: unknown;
}

export async function puntBead(args: PuntBeadArgs, options: WorkspaceBeadsOptions = {}): Promise<{ destinationBeadId: string; prompt?: string }> {
  const runBd = options.runBd ?? defaultRunBd;
  const sourceCwd = workspaceCwd(args.fromWorkspaceId, options);
  const destinationWorkspaceId = args.destination.workspaceId;
  const destinationCwd = workspaceCwd(destinationWorkspaceId, options);
  await ensureWorkspaceBeadsDatabase(destinationWorkspaceId, options);

  const source = await readBead(args.beadId, sourceCwd, runBd);
  const destinationBeadId = puntDestinationBeadId(args.beadId, args.fromWorkspaceId, destinationWorkspaceId);
  const sourceMetadata = metadataObject(source.metadata);
  const pendingMetadata = {
    ...sourceMetadata,
    move: {
      state: 'pending',
      sourceWorkspaceId: args.fromWorkspaceId,
      sourceBeadId: args.beadId,
      destinationWorkspaceId,
    },
  };

  if (!(await beadExists(destinationBeadId, destinationCwd, runBd))) {
    await runBd([
      'create',
      '--id',
      destinationBeadId,
      '--title',
      source.title ?? args.beadId,
      '--description',
      source.description ?? '',
      '--metadata',
      JSON.stringify(pendingMetadata),
    ], { cwd: destinationCwd });
  } else {
    await runBd(['update', destinationBeadId, '--metadata', JSON.stringify(pendingMetadata)], { cwd: destinationCwd });
  }

  await runBd([
    'update',
    args.beadId,
    '--metadata',
    JSON.stringify({
      ...sourceMetadata,
      move: {
        state: 'moved',
        destinationWorkspaceId,
        destinationBeadId,
      },
    }),
  ], { cwd: sourceCwd });
  await runBd(['close', args.beadId, '--reason', `Moved to ${destinationWorkspaceId}:${destinationBeadId}`], { cwd: sourceCwd });

  await runBd([
    'update',
    destinationBeadId,
    '--metadata',
    JSON.stringify({
      ...sourceMetadata,
      move: {
        state: 'complete',
        sourceWorkspaceId: args.fromWorkspaceId,
        sourceBeadId: args.beadId,
        destinationWorkspaceId,
      },
    }),
  ], { cwd: destinationCwd });

  const prompt = args.destination.kind === 'new'
    ? buildPuntNewWorkspacePrompt(destinationBeadId, args.destination.appendToPrompt)
    : undefined;

  return { destinationBeadId, ...(prompt ? { prompt } : {}) };
}

export function buildPuntNewWorkspacePrompt(destinationBeadId: string, appendToPrompt?: string): string {
  return [
    `Start work from bead ${destinationBeadId}.`,
    'Run bd from the workspace root and inspect the bead before making changes.',
    appendToPrompt?.trim() ?? '',
  ].filter(Boolean).join('\n\n');
}

function puntDestinationBeadId(sourceBeadId: string, fromWorkspaceId: string, toWorkspaceId: string): string {
  return `vdp-${createHash('sha256').update(`${fromWorkspaceId}\0${toWorkspaceId}\0${sourceBeadId}`).digest('base64url').slice(0, 32)}`;
}

async function readBead(beadId: string, cwd: string, runBd: BdCommandRunner): Promise<BdIssue> {
  const { stdout } = await runBd(['show', beadId, '--json'], { cwd });
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function beadExists(beadId: string, cwd: string, runBd: BdCommandRunner): Promise<boolean> {
  try {
    await runBd(['show', beadId, '--json'], { cwd });
    return true;
  } catch {
    return false;
  }
}

function workspaceCwd(workspaceId: string, options: WorkspaceBeadsOptions): string {
  return workspaceBeadsDir(workspaceId, options).replace(/\/\.beads$/, '');
}

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } as Record<string, unknown> : {};
}
