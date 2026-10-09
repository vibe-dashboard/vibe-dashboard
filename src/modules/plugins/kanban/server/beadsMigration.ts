import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  applyWorkspaceBeadsSetup,
  type WorkspaceSetupInput,
} from './workspaceBeads.ts';

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
  sourceCounts: CreationEvidenceSourceCounts;
  filesScanned: number;
}

export interface CreationEvidenceSourceCounts {
  sameRecordCwd: number;
  fileDominantCwd: number;
  mentionedNoCwd: number;
  worktreeCwdRecords: number;
  homeRepoCwdRecords: number;
  otherCwdRecords: number;
}

export interface CreationEvidenceScanProgress {
  phase: 'file-discovery-start' | 'file-discovery-complete' | 'scan-progress' | 'scan-complete';
  root: string;
  beadIds?: number;
  candidateFiles?: number;
  filesScanned?: number;
  evidenceRecords?: number;
  mentionedBeads?: number;
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

export interface PreparedWorkspaceImport {
  records: Record<string, unknown>[];
  strippedDependencies: string[];
}

export interface ExpandedWorkspaceImport {
  records: LegacyBeadRecord[];
  contextRecordKeys: string[];
  missingAncestorKeys: string[];
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

export function prepareWorkspaceImportRecords(records: LegacyBeadRecord[]): PreparedWorkspaceImport {
  const selectedIds = new Set(records.map((record) => record.beadId));
  const strippedDependencies: string[] = [];
  const prepared = records.map((record) => {
    const raw = JSON.parse(JSON.stringify(record.raw)) as Record<string, unknown>;
    if (!Array.isArray(raw.dependencies)) return raw;
    const kept: unknown[] = [];
    for (const item of raw.dependencies) {
      if (!item || typeof item !== 'object') {
        kept.push(item);
        continue;
      }
      const dependency = item as Record<string, unknown>;
      const dependsOnId = dependency.depends_on_id ?? dependency.dependsOnId;
      if (typeof dependsOnId !== 'string' || selectedIds.has(dependsOnId)) {
        kept.push(item);
        continue;
      }
      const type = typeof dependency.type === 'string' ? dependency.type : 'unknown';
      strippedDependencies.push(`${record.sourceDb}:${record.beadId}->${dependsOnId}:${type}`);
    }
    raw.dependencies = kept;
    raw.dependency_count = kept.length;
    return raw;
  });
  return { records: prepared, strippedDependencies };
}

export function expandWorkspaceImportAncestors(
  records: LegacyBeadRecord[],
  recordsByKey: Map<string, LegacyBeadRecord>,
  recordsById = new Map<string, LegacyBeadRecord[]>(),
): ExpandedWorkspaceImport {
  const out = [...records];
  const included = new Set(records.map(recordKey));
  const contextRecordKeys: string[] = [];
  const missingAncestorKeys: string[] = [];
  for (const record of records) {
    for (const ancestorId of beadAncestorIds(record.beadId)) {
      const key = recordKeyFromParts(record.sourceDb, ancestorId);
      if (included.has(key)) continue;
      const ancestor = recordsByKey.get(key) ?? recordsById.get(ancestorId)?.[0];
      if (!ancestor) {
        missingAncestorKeys.push(key);
        continue;
      }
      const ancestorKey = recordKey(ancestor);
      if (included.has(ancestorKey)) continue;
      included.add(ancestorKey);
      contextRecordKeys.push(ancestorKey);
      out.push(ancestor);
    }
  }
  return {
    records: out,
    contextRecordKeys: [...new Set(contextRecordKeys)].sort(),
    missingAncestorKeys: [...new Set(missingAncestorKeys)].sort(),
  };
}

function beadAncestorIds(beadId: string): string[] {
  const out: string[] = [];
  let current = beadId;
  while (current.includes('.')) {
    current = current.slice(0, current.lastIndexOf('.'));
    out.push(current);
  }
  return out;
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
  onProgress?: (progress: CreationEvidenceScanProgress) => void,
): Promise<CreationEvidenceScan> {
  onProgress?.({ phase: 'file-discovery-start', root: sessionsDir, beadIds: beadIds?.length });
  const files = await sortFilesByMtime(await listJsonlFiles(sessionsDir));
  onProgress?.({ phase: 'file-discovery-complete', root: sessionsDir, beadIds: beadIds?.length, candidateFiles: files.length });
  const evidence: CreationEvidence[] = [];
  const sourceCounts: Record<string, number> = {
    sameRecordCwd: 0,
    fileDominantCwd: 0,
    mentionedNoCwd: 0,
    worktreeCwdRecords: 0,
    homeRepoCwdRecords: 0,
    otherCwdRecords: 0,
  };
  const emitted = new Set<string>();
  const mentioned = new Set<string>();
  const beadPattern = beadIdMentionPattern(beadIds);
  const beadIdSet = beadIds?.length ? new Set(beadIds) : null;
  let filesScanned = 0;
  for (const file of files) {
    filesScanned += 1;
    const fileMentions = new Set<string>();
    const fileWorktreeCwds: string[] = [];
    for await (const line of readJsonlLines(file)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseJsonObject(trimmed);
      const cwds = parsed ? cwdValuesFromJsonRecord(parsed) : [];
      const worktreeCwds = cwds.filter((cwd) => cwd.startsWith('/var/tmp/vibe-kanban/worktrees/'));
      fileWorktreeCwds.push(...worktreeCwds);
      for (const cwd of cwds) {
        if (cwd.startsWith('/var/tmp/vibe-kanban/worktrees/')) {
          sourceCounts.worktreeCwdRecords += 1;
        } else if (cwd.startsWith('/home/vkuser/repos/')) {
          sourceCounts.homeRepoCwdRecords += 1;
        } else {
          sourceCounts.otherCwdRecords += 1;
        }
      }
      const ids = beadIdsFromText(trimmed, beadPattern, beadIdSet);
      if (ids.length === 0) continue;
      for (const beadId of ids) {
        mentioned.add(beadId);
        fileMentions.add(beadId);
        if (emitted.has(beadId) || worktreeCwds.length === 0) continue;
        evidence.push({
          beadId,
          cwd: worktreeCwds[0],
          source: `bead-id-scan:same-record:${path.basename(file)}`,
        });
        emitted.add(beadId);
        sourceCounts.sameRecordCwd += 1;
      }
    }
    const dominantFileCwd = mostCommon(fileWorktreeCwds);
    if (dominantFileCwd) {
      for (const beadId of fileMentions) {
        if (emitted.has(beadId)) continue;
        evidence.push({
          beadId,
          cwd: dominantFileCwd,
          source: `bead-id-scan:file-dominant:${path.basename(file)}`,
        });
        emitted.add(beadId);
        sourceCounts.fileDominantCwd += 1;
      }
    } else {
      for (const beadId of fileMentions) {
        if (!emitted.has(beadId)) sourceCounts.mentionedNoCwd += 1;
      }
    }
    if (filesScanned === 1 || filesScanned % 250 === 0 || filesScanned === files.length) {
      onProgress?.({
        phase: 'scan-progress',
        root: sessionsDir,
        candidateFiles: files.length,
        filesScanned,
        evidenceRecords: evidence.length,
        mentionedBeads: mentioned.size,
      });
    }
  }
  onProgress?.({
    phase: 'scan-complete',
    root: sessionsDir,
    candidateFiles: files.length,
    filesScanned,
    evidenceRecords: evidence.length,
    mentionedBeads: mentioned.size,
  });
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

async function* readJsonlLines(file: string): AsyncGenerator<string> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } catch {
    // Session logs can be removed while scanning; missing evidence is reported as unresolved.
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function sortFilesByMtime(files: string[]): Promise<string[]> {
  const rows = await Promise.all(files.map(async (file) => ({
    file,
    mtimeMs: await stat(file).then((entry) => entry.mtimeMs).catch(() => 0),
  })));
  return rows.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file)).map((row) => row.file);
}

function beadIdMentionPattern(beadIds?: string[]): RegExp {
  if (!beadIds?.length) return /(?<![A-Za-z0-9_.-])[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*(?![A-Za-z0-9_.-])/g;
  const prefixes = [...new Set(beadIds.map((id) => id.match(/^(.+)-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/)?.[1]).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (prefixes.length === 0) return /$^/g;
  return new RegExp(`(?<![A-Za-z0-9_.-])(?:${prefixes.map(escapeRegExp).join('|')})-[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)*(?![A-Za-z0-9_.-])`, 'g');
}

function beadIdsFromText(text: string, pattern: RegExp, allowed: Set<string> | null): string[] {
  pattern.lastIndex = 0;
  const out = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const beadId = match[0];
    if (!allowed || allowed.has(beadId)) out.add(beadId);
  }
  return [...out];
}

function cwdValuesFromJsonRecord(root: Record<string, unknown>): string[] {
  const out: string[] = [];
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && visited < 5000) {
    visited += 1;
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const row = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(row)) {
      if (typeof child === 'string') {
        if (key === 'cwd' || key === 'workdir' || key === 'working_dir' || key === 'current_working_directory') {
          out.push(child);
          continue;
        }
        if (key === 'arguments') {
          const parsed = parseJsonObject(child.trim());
          if (parsed) stack.push(parsed);
          continue;
        }
        const trimmed = child.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 2_000_000) {
          const parsed = parseJsonValue(trimmed);
          if (parsed) stack.push(parsed);
        }
      } else if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }
  return out;
}

function parseJsonValue(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
