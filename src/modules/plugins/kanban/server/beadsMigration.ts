import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  applyWorkspaceBeadsSetup,
  type WorkspaceSetupInput,
} from './workspaceBeads.ts';

const execFile = promisify(execFileCallback);

export interface LegacyBeadRecord {
  sourceDb: string;
  beadId: string;
  title?: string;
  metadata: Record<string, unknown>;
  dependencies: Array<{ issueId: string; dependsOnId: string; type?: string }>;
  raw: Record<string, unknown>;
}

export interface CreationEvidence {
  beadId: string;
  cwd?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  source?: string;
}

export interface CreationEvidenceScan {
  evidence: CreationEvidence[];
  sourceCounts: Record<string, number>;
  filesScanned: number;
}

export interface WorkspaceRoot {
  workspaceId: string;
  root?: string | null;
  repos?: WorkspaceSetupInput['repos'];
}

export interface WorkspaceMigrationPlan {
  assignments: Record<string, string>;
  importsByWorkspace: Record<string, Array<{ sourceDb: string; beadId: string }>>;
  unresolved: Array<{ sourceDb: string; beadId: string; title?: string }>;
  hazards: {
    explicitConflicts: string[];
    duplicateSelected: string[];
    parentChildConflicts: string[];
    externalIssueMissingWorkspace: string[];
    evidenceConflicts: string[];
  };
  reports: {
    parentChildInferred: string[];
    parentChildConflicts: string[];
    nonParentEdges: string[];
    unknownRoots: string[];
  };
}

export interface BuildWorkspaceMigrationPlanInput {
  records: LegacyBeadRecord[];
  evidence: CreationEvidence[];
  workspaceRoots: WorkspaceRoot[];
  workspaceIdFilter?: string;
  worktreeBase?: string;
}

export function parseWorktreeCwd(
  cwd: string | null | undefined,
  slugToWorkspaceId: Map<string, string>,
  worktreeBase = '/var/tmp/vibe-kanban/worktrees',
): string | null {
  if (!cwd) return null;
  const relative = path.posix.relative(worktreeBase, cwd.replaceAll(path.sep, '/'));
  if (!relative || relative.startsWith('..') || path.posix.isAbsolute(relative)) return null;
  const slug = relative.split('/')[0];
  if (!slug) return null;
  return slugToWorkspaceId.get(slug) ?? null;
}

export function buildWorkspaceMigrationPlan(input: BuildWorkspaceMigrationPlanInput): WorkspaceMigrationPlan {
  const rootsByWorkspace = new Map(input.workspaceRoots.map((root) => [root.workspaceId, root]));
  const slugToWorkspaceId = new Map<string, string>();
  for (const root of input.workspaceRoots) {
    const rootPath = root.root?.replaceAll(path.sep, '/');
    if (!rootPath) continue;
    const slug = path.posix.basename(rootPath);
    if (slug) slugToWorkspaceId.set(slug, root.workspaceId);
  }

  const plan: WorkspaceMigrationPlan = {
    assignments: {},
    importsByWorkspace: {},
    unresolved: [],
    hazards: {
      explicitConflicts: [],
      duplicateSelected: [],
      parentChildConflicts: [],
      externalIssueMissingWorkspace: [],
      evidenceConflicts: [],
    },
    reports: {
      parentChildInferred: [],
      parentChildConflicts: [],
      nonParentEdges: [],
      unknownRoots: [],
    },
  };

  const recordsById = new Map<string, LegacyBeadRecord[]>();
  const recordsByKey = new Map<string, LegacyBeadRecord>();
  for (const record of input.records) {
    const list = recordsById.get(record.beadId) ?? [];
    list.push(record);
    recordsById.set(record.beadId, list);
    recordsByKey.set(recordKey(record), record);
  }

  const evidenceById = dedupeEvidence(input.evidence, slugToWorkspaceId, plan.hazards.evidenceConflicts, input.worktreeBase, input.workspaceIdFilter);
  for (const record of input.records) {
    const key = recordKey(record);
    const workspaceId = evidenceById.get(record.beadId) ?? null;
    if (workspaceId) plan.assignments[key] = workspaceId;
    if (!workspaceId && !input.workspaceIdFilter && isExternalIssueRecord(record.metadata)) {
      plan.hazards.externalIssueMissingWorkspace.push(`${record.sourceDb}:${record.beadId}`);
    }
  }

  inferParentChildAssignments(input.records, plan, recordsByKey, input.workspaceIdFilter);

  for (const record of input.records) {
    const workspaceId = plan.assignments[recordKey(record)];
    if (!workspaceId) {
      plan.unresolved.push({ sourceDb: record.sourceDb, beadId: record.beadId, title: record.title });
      continue;
    }
    if (input.workspaceIdFilter && workspaceId !== input.workspaceIdFilter) continue;
    const imports = plan.importsByWorkspace[workspaceId] ?? [];
    imports.push({ sourceDb: record.sourceDb, beadId: record.beadId });
    plan.importsByWorkspace[workspaceId] = imports;
    if (!rootsByWorkspace.has(workspaceId)) {
      plan.reports.unknownRoots.push(workspaceId);
    }
  }

  for (const [beadId, records] of recordsById) {
    const selected = records.filter((record) => {
      const workspaceId = plan.assignments[recordKey(record)];
      return workspaceId && (!input.workspaceIdFilter || workspaceId === input.workspaceIdFilter);
    });
    if (selected.length > 1) {
      plan.hazards.duplicateSelected.push(`${beadId}:${selected.map((record) => record.sourceDb).join(',')}`);
    }
  }

  plan.reports.unknownRoots = [...new Set(plan.reports.unknownRoots)].sort();
  return plan;
}

export function planHasHardHazards(plan: WorkspaceMigrationPlan): boolean {
  return plan.hazards.explicitConflicts.length > 0
    || plan.hazards.duplicateSelected.length > 0
    || plan.hazards.externalIssueMissingWorkspace.length > 0
    || plan.hazards.evidenceConflicts.length > 0;
}

export async function loadLegacySnapshots(legacyDir: string): Promise<LegacyBeadRecord[]> {
  const sourcesDir = path.join(legacyDir, 'sources');
  const sourceNames = await readdir(sourcesDir).catch(() => []);
  const out: LegacyBeadRecord[] = [];
  for (const sourceDb of sourceNames) {
    const exportPath = path.join(sourcesDir, sourceDb, 'export.jsonl');
    const content = await readFile(exportPath, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const record = normalizeLegacyRecord(sourceDb, parsed);
      if (record) out.push(record);
    }
  }
  return out;
}

export async function loadCreationEvidence(legacyDir: string, workspaceRoots: WorkspaceRoot[]): Promise<CreationEvidence[]> {
  return loadCreationEvidenceFile(path.join(legacyDir, 'bead-creation-evidence.jsonl'));
}

export async function loadCreationEvidenceFile(evidencePath: string): Promise<CreationEvidence[]> {
  const content = await readFile(evidencePath, 'utf8').catch(() => '');
  const out: CreationEvidence[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.beadId === 'string') {
      out.push({
        beadId: parsed.beadId,
        cwd: typeof parsed.cwd === 'string' ? parsed.cwd : null,
        workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
        source: typeof parsed.source === 'string' ? parsed.source : 'cache',
      });
    }
  }
  return out;
}

export async function scanProcessCreationEvidence(
  sessionsDir = '/home/vkuser/.local/share/vibe-kanban/sessions',
  beadIds?: string[],
): Promise<CreationEvidenceScan> {
  const files = beadIds?.length ? await listJsonlFilesMatchingBeadIds(sessionsDir, beadIds) : await listJsonlFiles(sessionsDir);
  const evidence: CreationEvidence[] = [];
  const sourceCounts: Record<string, number> = {};
  for (const file of files) {
    const content = await readFile(file, 'utf8').catch(() => '');
    if (!content.includes('bd ')) continue;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.includes('bd ')) continue;
      for (const item of processItemsFromJsonlLine(trimmed)) {
        const command = typeof item.command === 'string' ? item.command : '';
        if (!isBdCreateCommand(command)) continue;
        const cwd = typeof item.cwd === 'string' ? item.cwd : null;
        const beadId = beadIdFromCommandOutput(outputTextFromItem(item));
        if (!beadId) continue;
        const source = `process-jsonl:${path.basename(file)}`;
        evidence.push({ beadId, cwd, source });
        sourceCounts.processJsonl = (sourceCounts.processJsonl ?? 0) + 1;
      }
    }
  }
  return { evidence, sourceCounts, filesScanned: files.length };
}

export async function writeWorkspaceMigrationReport(reportPath: string, report: unknown): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function reconcileWorkspaceRoot(root: WorkspaceRoot): Promise<void> {
  if (!root.root) return;
  await applyWorkspaceBeadsSetup({
    workspaceId: root.workspaceId,
    workspaceDir: root.root,
    repos: root.repos ?? [],
  });
}

function normalizeLegacyRecord(sourceDb: string, raw: Record<string, unknown>): LegacyBeadRecord | null {
  const id = raw.id ?? raw.issue_id;
  if (typeof id !== 'string') return null;
  return {
    sourceDb,
    beadId: id,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    metadata: metadataObject(raw.metadata),
    dependencies: normalizeDependencies(id, raw.dependencies),
    raw,
  };
}

function normalizeDependencies(issueId: string, value: unknown): Array<{ issueId: string; dependsOnId: string; type?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ issueId: string; dependsOnId: string; type?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const dependsOnId = row.depends_on_id ?? row.dependsOnId;
    if (typeof dependsOnId !== 'string') continue;
    out.push({
      issueId: typeof row.issue_id === 'string' ? row.issue_id : issueId,
      dependsOnId,
      type: typeof row.type === 'string' ? row.type : undefined,
    });
  }
  return out;
}

function dedupeEvidence(
  evidence: CreationEvidence[],
  slugToWorkspaceId: Map<string, string>,
  conflicts: string[],
  worktreeBase?: string,
  workspaceIdFilter?: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of evidence) {
    if (!entry.cwd) continue;
    const resolved = parseWorktreeCwd(entry.cwd, slugToWorkspaceId, worktreeBase);
    if (!resolved) continue;
    const existing = out.get(entry.beadId);
    if (existing && existing !== resolved) {
      if (!workspaceIdFilter || existing === workspaceIdFilter || resolved === workspaceIdFilter) {
        conflicts.push(`${entry.beadId}:${existing}!=${resolved}`);
      }
      continue;
    }
    out.set(entry.beadId, resolved);
  }
  return out;
}

function inferParentChildAssignments(
  records: LegacyBeadRecord[],
  plan: WorkspaceMigrationPlan,
  recordsByKey: Map<string, LegacyBeadRecord>,
  workspaceIdFilter?: string,
): void {
  const inferred = new Set<string>();
  const conflicts = new Set<string>();
  const nonParentEdges = new Set(plan.reports.nonParentEdges);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      for (const edge of record.dependencies) {
        const type = edge.type ?? '';
        if (type !== 'parent-child') {
          nonParentEdges.add(`${record.sourceDb}:${record.beadId}->${edge.dependsOnId}:${type || 'unknown'}`);
          continue;
        }
        const child = recordKeyFromParts(record.sourceDb, edge.issueId);
        const parent = recordKeyFromParts(record.sourceDb, edge.dependsOnId);
        if (!recordsByKey.has(child) || !recordsByKey.has(parent)) continue;
        const childWorkspace = plan.assignments[child];
        const parentWorkspace = plan.assignments[parent];
        if (childWorkspace && parentWorkspace && childWorkspace !== parentWorkspace) {
          if (!workspaceIdFilter || childWorkspace === workspaceIdFilter || parentWorkspace === workspaceIdFilter) {
            conflicts.add(`${child}->${parent}:${childWorkspace}!=${parentWorkspace}`);
          }
          continue;
        }
        if (childWorkspace && !parentWorkspace) {
          plan.assignments[parent] = childWorkspace;
          inferred.add(`${parent}<=${child}:${childWorkspace}`);
          changed = true;
        } else if (parentWorkspace && !childWorkspace) {
          plan.assignments[child] = parentWorkspace;
          inferred.add(`${child}=>${parent}:${parentWorkspace}`);
          changed = true;
        }
      }
    }
  }
  plan.reports.parentChildInferred = [...inferred].sort();
  plan.reports.parentChildConflicts = [...conflicts].sort();
  plan.reports.nonParentEdges = [...nonParentEdges].sort();
}

function recordKey(record: Pick<LegacyBeadRecord, 'sourceDb' | 'beadId'>): string {
  return recordKeyFromParts(record.sourceDb, record.beadId);
}

function recordKeyFromParts(sourceDb: string, beadId: string): string {
  return `${sourceDb}\0${beadId}`;
}

function isExternalIssueRecord(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.external_issues)
    || typeof metadata.vdExternalIssueId === 'string'
    || typeof metadata.vdWorkspaceLinkId === 'string';
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(child));
    } else if (entry.isFile() && child.endsWith('.jsonl')) {
      files.push(child);
    }
  }
  return files.sort();
}

async function listJsonlFilesMatchingBeadIds(root: string, beadIds: string[]): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vd-beads-evidence-'));
  const patternPath = path.join(dir, 'bead-ids.txt');
  try {
    await writeFile(patternPath, [...new Set(beadIds)].sort().join('\n') + '\n');
    const { stdout } = await execFile(
      'rg',
      ['-l', '-F', '-f', patternPath, '--glob', '*.jsonl', root],
      { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 },
    ).catch((error: unknown) => {
      const maybe = error as { code?: number; stdout?: string };
      if (maybe.code === 1) return { stdout: '' };
      throw error;
    });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort();
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function processItemsFromJsonlLine(line: string): Array<Record<string, unknown>> {
  const parsed = parseJsonObject(line);
  if (!parsed) return [];
  const chunks = typeof parsed.Stdout === 'string' ? [parsed.Stdout] : [];
  const out = commandItemsFromObject(parsed);
  for (const chunk of chunks) {
    const inner = parseJsonObject(chunk.trim());
    if (!inner) continue;
    out.push(...commandItemsFromObject(inner));
  }
  return out;
}

function commandItemsFromObject(root: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.command === 'string' && typeof row.cwd === 'string') out.push(row);
    for (const child of Object.values(row)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return out;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isBdCreateCommand(command: string): boolean {
  return /\bbd\s+(create|new|q|todo)\b/.test(command);
}

function outputTextFromItem(item: Record<string, unknown>): string {
  return [
    item.aggregatedOutput,
    item.output,
    item.stdout,
    item.result,
    item.content,
  ].filter((value): value is string => typeof value === 'string').join('\n');
}

function beadIdFromCommandOutput(output: string): string | null {
  const parsed = parseJsonObject(output.trim());
  if (typeof parsed?.id === 'string') return parsed.id;
  const created = output.match(/(?:✓\s*)?Created (?:issue|bead):\s*([A-Za-z0-9][A-Za-z0-9._-]*)/);
  if (created?.[1]) return created[1];
  const bare = output.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bare) ? bare : null;
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return metadataObject(parsed);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } as Record<string, unknown> : {};
}
