/// <reference types="node" />

import { execFile } from 'node:child_process';
import { access, readdir, realpath } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import {
  appendBeadsFormResponse,
  assertMetadataWithinIssueJsonGuard,
  buildPrettySummary,
  getBeadsForms,
  getSupportedBeadsForms,
  selectBeadsForm,
  withBeadsFormsSummary,
  validateSubmittedValues,
  normalizeSubmittedValues,
  type BeadLike,
  type BeadsFormDefinition,
  type JsonObject,
} from './beadsFormCore.ts';
import { buildBeadsFormSessionNotification, isValidBeadsFormSessionId } from './beadsFormSessionNotification.ts';

const execFileAsync = promisify(execFile);
const DEFAULT_VD_BEADS_DIRECTORY = '/var/lib/vd/beads';

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type BeadsClientOptions = {
  bdPath?: string;
  execFile?: ExecFileLike;
  now?: () => Date;
  actor?: string;
  reviewLabel?: string;
  notifySession?: (sessionId: string, message: string) => Promise<unknown>;
};

export type SubmitBeadsFormInput = {
  dir: string;
  beadId: string;
  formId: string;
  values: JsonObject;
};

export type SubmitBeadsFormResult = {
  beadId: string;
  formId: string;
  values: JsonObject;
  submittedAt: string;
  submittedBy: string;
  prettySummary: string;
  metadata: JsonObject;
  reviewLabel: string;
  warnings: string[];
};

export type BeadsWorkspaceRepo = {
  id: string;
  name: string;
  display_name?: string;
  target_branch?: string;
};

export type BeadsRepoListResult = {
  repo: BeadsWorkspaceRepo;
  dir: string;
  dirExists?: boolean;
  initialized: boolean;
  beads: BeadLike[];
  unscopedCount: number;
  otherWorkspaceCount: number;
  error?: string;
};

export type ListWorkspaceBeadsResult = {
  workspaceId: string;
  repos: BeadsRepoListResult[];
};

export type PendingBeadsFormEntry = {
  workspaceId: string;
  repoDir: string;
  repoName: string;
  bead: Pick<BeadLike, 'id' | 'title' | 'description' | 'createdAt' | 'updatedAt'>;
  form: Pick<BeadsFormDefinition, 'id' | 'title' | 'description'> & { responseCount: number };
};

export type PendingBeadsFormQueueResult = {
  reposRoot: string;
  repoLimit: number;
  reposScanned: number;
  entries: PendingBeadsFormEntry[];
  skipped: Array<{ repoDir: string; reason: string }>;
  updateStrategy: {
    mode: 'explicit-refresh';
    rationale: string;
  };
};

export class BeadsClient {
  private readonly bdPath: string;
  private readonly exec: ExecFileLike;
  private readonly now: () => Date;
  private readonly actor: string;
  private readonly reviewLabel: string;
  private readonly notifySession?: (sessionId: string, message: string) => Promise<unknown>;

  constructor(options: BeadsClientOptions = {}) {
    this.bdPath = options.bdPath ?? 'bd';
    this.exec = options.execFile ?? ((file, args, opts) => execFileAsync(file, [...args], opts));
    this.now = options.now ?? (() => new Date());
    this.actor = options.actor ?? 'user';
    this.reviewLabel = options.reviewLabel ?? 'needs-agent-review';
    this.notifySession = options.notifySession;
  }

  async readBead(dir: string, beadId: string): Promise<BeadLike> {
    try {
      const listed = await this.listBeadsById(dir, beadId);
      const bead = listed.find((candidate) => candidate.id === beadId);
      if (!bead) throw new Error(`Bead not found: ${beadId}`);
      if (isObject(bead.metadata)) return bead;
    } catch (error) {
      if (isBeadNotFoundError(error, beadId)) throw error;
      // Older bd versions or schema-skewed list output can fail here. Fall back
      // to the slower show path so direct bead URLs and submissions still work.
    }
    return this.readBeadByShow(dir, beadId);
  }

  private async readBeadByShow(dir: string, beadId: string): Promise<BeadLike> {
    const { stdout } = await this.exec(this.bdPath, ['--readonly', 'show', beadId, '--json', '--long'], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const text = String(stdout);
    const jsonStart = text.indexOf('[');
    const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
    const beads = JSON.parse(jsonText) as BeadLike[];
    const bead = beads.find((candidate) => candidate.id === beadId);
    if (!bead) throw new Error(`Bead not found: ${beadId}`);
    return bead;
  }

  async readForms(dir: string, beadId: string): Promise<{ bead: BeadLike; forms: BeadsFormDefinition[] }> {
    const bead = await this.readBead(dir, beadId);
    return { bead, forms: getBeadsForms(bead.metadata) };
  }

  async listWorkspaceBeads(input: {
    workspaceId: string;
    workspaceDir: string;
    agentWorkingDir?: string | null;
    repos: BeadsWorkspaceRepo[];
    includeOtherWorkspaces?: boolean;
    beadId?: string;
  }): Promise<ListWorkspaceBeadsResult> {
    const dir = workspaceBeadsStoreDir(input.workspaceId);
    const repo = { id: 'workspace', name: 'Workspace beads', display_name: 'Workspace beads' };
    if (!await pathExists(dir)) {
      return {
        workspaceId: input.workspaceId,
        repos: [{
          repo,
          dir,
          dirExists: false,
          initialized: false,
          beads: [],
          unscopedCount: 0,
          otherWorkspaceCount: 0,
        }],
      };
    }
    const repos = [await this.listRepoBeads({
      dir,
      dirExists: true,
      repo,
      workspaceId: input.workspaceId,
      includeOtherWorkspaces: true,
      filterByWorkspaceMetadata: false,
      beadId: input.beadId,
    })];
    return { workspaceId: input.workspaceId, repos };
  }

  async listPendingBeadsFormQueue(input: {
    beadsDirectory?: string;
    repoLimit?: number;
  } = {}): Promise<PendingBeadsFormQueueResult> {
    const requestedReposRoot = join(input.beadsDirectory ?? vdBeadsDirectory(), 'workspaces');
    const repoLimit = input.repoLimit ?? 80;
    let workspaceStores: Array<{ workspaceId: string; storeDir: string }>;
    let reposRoot: string;
    try {
      reposRoot = await realpath(requestedReposRoot);
      workspaceStores = (await readdir(reposRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') && name !== 'node_modules')
        .sort((a, b) => a.localeCompare(b))
        .slice(0, repoLimit)
        .map((workspaceId) => ({ workspaceId, storeDir: join(reposRoot, workspaceId, '.beads') }));
    } catch (error) {
      return {
        reposRoot: requestedReposRoot,
        repoLimit,
        reposScanned: 0,
        entries: [],
        skipped: [{ repoDir: requestedReposRoot, reason: error instanceof Error ? error.message : String(error) }],
        updateStrategy: pendingQueueUpdateStrategy(),
      };
    }

    const entries: PendingBeadsFormEntry[] = [];
    const skipped: Array<{ repoDir: string; reason: string }> = [];
    const storeResults = await mapWithConcurrency(workspaceStores, 5, async ({ workspaceId, storeDir }) => {
      try {
        if (!await pathExists(storeDir)) {
          return { storeDir, entries: [], reason: 'workspace beads store not initialized' };
        }
        return { storeDir, entries: await this.listPendingFormsInWorkspaceStore(workspaceId, storeDir) };
      } catch (error) {
        if (isNoBeadsDatabaseError(error)) {
          return { storeDir, entries: [], reason: 'not initialized for beads' };
        }
        return { storeDir, entries: [], reason: error instanceof Error ? error.message : String(error) };
      }
    });
    for (const result of storeResults) {
      entries.push(...result.entries);
      if (result.reason) skipped.push({ repoDir: result.storeDir, reason: result.reason });
    }
    entries.sort(comparePendingEntriesMostRecent);

    return {
      reposRoot,
      repoLimit,
      reposScanned: workspaceStores.length,
      entries,
      skipped,
      updateStrategy: pendingQueueUpdateStrategy(),
    };
  }

  private async listPendingFormsInWorkspaceStore(workspaceId: string, storeDir: string): Promise<PendingBeadsFormEntry[]> {
    const candidates = new Map<string, BeadLike>();
    const listed = parseBdJsonArray<BeadLike>((await this.exec(this.bdPath, [
      '--readonly',
      'list',
      '--json',
      '--all',
      '--limit',
      '0',
      '--has-metadata-key',
      'beadFormsSummary',
    ], {
      cwd: storeDir,
      timeout: 15_000,
      maxBuffer: 1024 * 1024 * 5,
    })).stdout);
    for (const bead of listed) {
      if (bead.id) candidates.set(bead.id, bead);
    }

    return Array.from(candidates.values()).flatMap((bead) => {
      if (isClosedBead(bead)) return [];
      const forms = getSupportedBeadsForms(bead.metadata)
        .filter((form) => isPendingForm(bead, form));
      return forms.map((form) => ({
        workspaceId,
        repoDir: storeDir,
        repoName: basename(workspaceId),
        bead: {
          id: bead.id,
          ...(bead.title ? { title: bead.title } : {}),
          ...(bead.description ? { description: bead.description } : {}),
          ...(beadCreatedAt(bead) ? { createdAt: beadCreatedAt(bead) } : {}),
          ...(beadUpdatedAt(bead) ? { updatedAt: beadUpdatedAt(bead) } : {}),
        },
        form: {
          id: form.id,
          title: form.title,
          ...(form.description ? { description: form.description } : {}),
          responseCount: form.responses?.length ?? 0,
        },
      }));
    });
  }

  private async listRepoBeads(input: {
    dir: string;
    dirExists: boolean;
    repo: BeadsWorkspaceRepo;
    workspaceId: string;
    includeOtherWorkspaces: boolean;
    filterByWorkspaceMetadata?: boolean;
    beadId?: string;
  }): Promise<BeadsRepoListResult> {
    if (!input.dirExists) {
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: false,
        initialized: false,
        beads: [],
        unscopedCount: 0,
        otherWorkspaceCount: 0,
        error: `Repo directory not found: ${input.dir}`,
      };
    }

    try {
      let beads = input.beadId
        ? await this.listBeadsById(input.dir, input.beadId)
        : await this.listFormBearingBeads(input.dir);
      if (input.beadId && beads.some((bead) => bead.id === input.beadId && !isObject(bead.metadata))) {
        const shown = await this.tryReadSingleBead(input.dir, input.beadId);
        if (shown.length > 0) beads = shown;
      }
      const unscopedCount = beads.filter((bead) => !getMetadataString(bead.metadata, 'VK_WORKSPACE_ID')).length;
      const otherWorkspaceCount = beads.filter((bead) => {
        const beadWorkspaceId = getMetadataString(bead.metadata, 'VK_WORKSPACE_ID');
        return !!beadWorkspaceId && beadWorkspaceId !== input.workspaceId;
      }).length;
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: true,
        initialized: true,
        beads: input.includeOtherWorkspaces
          || input.filterByWorkspaceMetadata === false
          ? beads
          : beads.filter((bead) => getMetadataString(bead.metadata, 'VK_WORKSPACE_ID') === input.workspaceId),
        unscopedCount,
        otherWorkspaceCount,
      };
    } catch (error) {
      if (isNoBeadsDatabaseError(error)) {
        return {
          repo: input.repo,
          dir: input.dir,
          dirExists: true,
          initialized: false,
          beads: [],
          unscopedCount: 0,
          otherWorkspaceCount: 0,
        };
      }
      return {
        repo: input.repo,
        dir: input.dir,
        dirExists: true,
        initialized: true,
        beads: [],
        unscopedCount: 0,
        otherWorkspaceCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async listBeadsById(dir: string, beadId: string): Promise<BeadLike[]> {
    const { stdout } = await this.exec(this.bdPath, ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', beadId], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    return parseBdJsonArray<BeadLike>(stdout);
  }

  private async listFormBearingBeads(dir: string): Promise<BeadLike[]> {
    const byId = new Map<string, BeadLike>();
    for (const metadataKey of ['beadForms', 'beadsWeb']) {
      const { stdout } = await this.exec(this.bdPath, [
        '--readonly',
        'list',
        '--json',
        '--all',
        '--limit',
        '0',
        '--has-metadata-key',
        metadataKey,
      ], {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10,
      });
      for (const bead of parseBdJsonArray<BeadLike>(stdout)) {
        if (bead.id) byId.set(bead.id, bead);
      }
    }
    return Array.from(byId.values());
  }

  private async tryReadSingleBead(dir: string, beadId: string): Promise<BeadLike[]> {
    try {
      return [await this.readBeadByShow(dir, beadId)];
    } catch (error) {
      if (isBeadNotFoundError(error, beadId)) return [];
      throw error;
    }
  }

  async submitForm(input: SubmitBeadsFormInput): Promise<SubmitBeadsFormResult> {
    const bead = await this.readBead(input.dir, input.beadId);
    const form = selectBeadsForm(bead.metadata, input.formId);
    if (!form) throw new Error(`Form not found: ${input.formId}`);

    const values = normalizeSubmittedValues(form, input.values);
    const validationErrors = validateSubmittedValues(form, values);
    if (validationErrors.length > 0) throw new Error(validationErrors.join('\n'));

    const prettySummary = buildPrettySummary(form, values);
    const submittedAt = this.now().toISOString();
    const submittedBy = this.actor;
    const metadata = withBeadsFormsSummary(appendBeadsFormResponse(bead.metadata, form.id, {
      submittedBy,
      submittedAt,
      values,
      prettySummary,
    }));

    await this.updateMetadata(input.dir, input.beadId, metadata);
    const warnings: string[] = [];
    const sessionId = isObject(bead.metadata) ? bead.metadata.VK_SESSION_ID : undefined;
    if (isValidBeadsFormSessionId(sessionId)) {
      try {
        if (!this.notifySession) throw new Error('creating-session notification service is unavailable');
        await this.notifySession(sessionId, buildBeadsFormSessionNotification({
          beadId: input.beadId,
          form,
          values,
          submittedAt,
          submittedBy,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Form response was saved, but notifying its creating session failed: ${message}; do not submit again.`);
        await this.addReviewLabelFallback(input.dir, input.beadId, warnings);
      }
    } else {
      await this.addReviewLabelFallback(input.dir, input.beadId, warnings);
    }

    return {
      beadId: input.beadId,
      formId: input.formId,
      values,
      submittedAt,
      submittedBy,
      prettySummary,
      metadata,
      reviewLabel: this.reviewLabel,
      warnings,
    };
  }

  private async addReviewLabelFallback(dir: string, beadId: string, warnings: string[]): Promise<void> {
    try {
      await this.addLabel(dir, beadId, this.reviewLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Form response was saved, but adding label "${this.reviewLabel}" failed: ${message}`);
    }
  }

  async updateMetadata(dir: string, beadId: string, metadata: JsonObject): Promise<void> {
    assertMetadataWithinIssueJsonGuard(metadata);
    const tempDir = await mkdtemp(join(tmpdir(), 'beadsform-'));
    const metadataPath = join(tempDir, 'metadata.json');
    try {
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      await this.exec(this.bdPath, ['update', beadId, '--metadata', `@${metadataPath}`], {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 5,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async addLabel(dir: string, beadId: string, label: string): Promise<void> {
    await this.exec(this.bdPath, ['update', beadId, '--add-label', label], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }

  async removeLabel(dir: string, beadId: string, label: string): Promise<void> {
    await this.exec(this.bdPath, ['update', beadId, '--remove-label', label], {
      cwd: dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }
}

function workspaceBeadsStoreDir(workspaceId: string): string {
  return join(vdBeadsDirectory(), 'workspaces', workspaceId, '.beads');
}

function vdBeadsDirectory(): string {
  return process.env.VD_BEADS_DIRECTORY || DEFAULT_VD_BEADS_DIRECTORY;
}

async function pathExists(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

function pendingQueueUpdateStrategy(): PendingBeadsFormQueueResult['updateStrategy'] {
  return {
    mode: 'explicit-refresh',
    rationale: 'Use an explicit refresh action for the MVP. bd list --watch is display-oriented, while readonly bounded scans of persisted workspace stores avoid long-lived filesystem/database watchers and unexpected migrations.',
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function comparePendingEntriesMostRecent(left: PendingBeadsFormEntry, right: PendingBeadsFormEntry): number {
  const leftTime = Date.parse(left.bead.updatedAt ?? left.bead.createdAt ?? '');
  const rightTime = Date.parse(right.bead.updatedAt ?? right.bead.createdAt ?? '');
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(rightTime) ? 1 : -1;
  return `${left.repoName}:${left.bead.id}:${left.form.id}`.localeCompare(`${right.repoName}:${right.bead.id}:${right.form.id}`);
}

function beadCreatedAt(bead: BeadLike): string | undefined {
  return bead.createdAt ?? bead.created_at;
}

function beadUpdatedAt(bead: BeadLike): string | undefined {
  return bead.updatedAt ?? bead.updated_at;
}

function isClosedBead(bead: BeadLike): boolean {
  return bead.status?.trim().toLowerCase() === 'closed';
}

function isPendingForm(bead: BeadLike, form: BeadsFormDefinition): boolean {
  const summary = isObject(bead.metadata) && isObject(bead.metadata.beadFormsSummary)
    ? bead.metadata.beadFormsSummary
    : undefined;
  if (summary && Array.isArray(summary.pendingFormIds)) {
    return summary.pendingFormIds.includes(form.id);
  }
  return false;
}

export function createNodeBeadsClient(options?: BeadsClientOptions): BeadsClient {
  return new BeadsClient(options);
}

function parseBdJsonArray<T>(stdout: string | Buffer): T[] {
  const text = String(stdout);
  const jsonStart = text.indexOf('[');
  if (jsonStart < 0) return [];
  return JSON.parse(text.slice(jsonStart)) as T[];
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getMetadataString(metadata: unknown, key: string): string | undefined {
  if (!isObject(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isNoBeadsDatabaseError(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '',
    error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '',
  ].join('\n');
  return /no beads database found/i.test(text);
}

function isBeadNotFoundError(error: unknown, beadId: string): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '',
    error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '',
  ].join('\n');
  return new RegExp(`\\b${escapeRegExp(beadId)}\\b.*not found|not found.*\\b${escapeRegExp(beadId)}\\b`, 'i').test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
