import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
      nonParentEdges: [],
      unknownRoots: [],
    },
  };

  const recordsById = new Map<string, LegacyBeadRecord[]>();
  for (const record of input.records) {
    const list = recordsById.get(record.beadId) ?? [];
    list.push(record);
    recordsById.set(record.beadId, list);
  }

  const explicitById = new Map<string, { workspaceId: string | null; conflict?: string }>();
  for (const record of input.records) {
    const explicit = explicitWorkspaceId(record.metadata);
    if (explicit.conflict) {
      plan.hazards.explicitConflicts.push(`${record.sourceDb}:${record.beadId}:${explicit.conflict}`);
    }
    const existing = explicitById.get(record.beadId);
    if (existing?.workspaceId && explicit.workspaceId && existing.workspaceId !== explicit.workspaceId) {
      plan.hazards.explicitConflicts.push(`${record.beadId}:${existing.workspaceId}!=${explicit.workspaceId}`);
      continue;
    }
    explicitById.set(record.beadId, {
      workspaceId: existing?.workspaceId ?? explicit.workspaceId,
      conflict: existing?.conflict ?? explicit.conflict,
    });
  }

  const evidenceById = dedupeEvidence(input.evidence, slugToWorkspaceId, plan.hazards.evidenceConflicts, input.worktreeBase);
  for (const record of input.records) {
    const explicit = explicitById.get(record.beadId)?.workspaceId;
    const workspaceId = explicit ?? evidenceById.get(record.beadId) ?? null;
    if (workspaceId) plan.assignments[record.beadId] = workspaceId;
    if (!workspaceId && isExternalIssueRecord(record.metadata)) {
      plan.hazards.externalIssueMissingWorkspace.push(`${record.sourceDb}:${record.beadId}`);
    }
  }

  inferParentChildAssignments(input.records, plan, explicitById);

  for (const record of input.records) {
    const workspaceId = plan.assignments[record.beadId];
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
      const workspaceId = plan.assignments[record.beadId];
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
    || plan.hazards.parentChildConflicts.length > 0
    || plan.hazards.externalIssueMissingWorkspace.length > 0;
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
  const evidencePath = path.join(legacyDir, 'bead-creation-evidence.jsonl');
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

export function buildSessionCreationEvidence(
  records: LegacyBeadRecord[],
  sessions: Array<{ sessionId: string; workspaceId: string; workspaceRoot?: string | null; agentWorkingDir?: string | null }>,
): CreationEvidence[] {
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const out: CreationEvidence[] = [];
  for (const record of records) {
    const sessionId = typeof record.metadata.VK_SESSION_ID === 'string' ? record.metadata.VK_SESSION_ID : null;
    if (!sessionId) continue;
    const session = sessionsById.get(sessionId);
    if (!session) continue;
    out.push({
      beadId: record.beadId,
      sessionId,
      workspaceId: session.workspaceId,
      cwd: joinWorkspaceCwd(session.workspaceRoot, session.agentWorkingDir),
      source: 'vk-sqlite-session',
    });
  }
  return out;
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

function explicitWorkspaceId(metadata: Record<string, unknown>): { workspaceId: string | null; conflict?: string } {
  const values = ['VK_WORKSPACE_ID', 'vkWorkspaceId', 'workspaceId']
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  const unique = [...new Set(values)];
  if (unique.length > 1) return { workspaceId: unique[0], conflict: unique.join('!=') };
  return { workspaceId: unique[0] ?? null };
}

function dedupeEvidence(
  evidence: CreationEvidence[],
  slugToWorkspaceId: Map<string, string>,
  conflicts: string[],
  worktreeBase?: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of evidence) {
    const hasCwd = !!entry.cwd;
    const cwdWorkspaceId = parseWorktreeCwd(entry.cwd, slugToWorkspaceId, worktreeBase);
    if (hasCwd && cwdWorkspaceId && entry.workspaceId && cwdWorkspaceId !== entry.workspaceId) {
      conflicts.push(`${entry.beadId}:cwd:${cwdWorkspaceId}!=fallback:${entry.workspaceId}`);
    }
    const resolved = hasCwd ? cwdWorkspaceId : entry.workspaceId ?? null;
    if (!resolved) continue;
    const existing = out.get(entry.beadId);
    if (existing && existing !== resolved) {
      conflicts.push(`${entry.beadId}:${existing}!=${resolved}`);
      continue;
    }
    out.set(entry.beadId, resolved);
  }
  return out;
}

function joinWorkspaceCwd(workspaceRoot: string | null | undefined, agentWorkingDir: string | null | undefined): string | null {
  if (!workspaceRoot) return null;
  if (!agentWorkingDir) return workspaceRoot;
  return path.join(workspaceRoot, agentWorkingDir);
}

function inferParentChildAssignments(
  records: LegacyBeadRecord[],
  plan: WorkspaceMigrationPlan,
  explicitById: Map<string, { workspaceId: string | null; conflict?: string }>,
): void {
  for (const record of records) {
    for (const edge of record.dependencies) {
      const type = edge.type ?? '';
      if (type !== 'parent-child') {
        plan.reports.nonParentEdges.push(`${record.beadId}->${edge.dependsOnId}:${type || 'unknown'}`);
        continue;
      }
      const child = edge.issueId;
      const parent = edge.dependsOnId;
      const childWorkspace = plan.assignments[child];
      const parentWorkspace = plan.assignments[parent];
      const childExplicit = explicitById.get(child)?.workspaceId;
      const parentExplicit = explicitById.get(parent)?.workspaceId;
      if (childExplicit && parentExplicit && childExplicit !== parentExplicit) {
        plan.hazards.parentChildConflicts.push(`${child}->${parent}:${childExplicit}!=${parentExplicit}`);
        continue;
      }
      if (childWorkspace && !parentWorkspace && !parentExplicit) {
        plan.assignments[parent] = childWorkspace;
        plan.reports.parentChildInferred.push(`${parent}<=${child}:${childWorkspace}`);
      } else if (parentWorkspace && !childWorkspace && !childExplicit) {
        plan.assignments[child] = parentWorkspace;
        plan.reports.parentChildInferred.push(`${child}=>${parent}:${parentWorkspace}`);
      }
    }
  }
}

function isExternalIssueRecord(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.external_issues)
    || typeof metadata.vdExternalIssueId === 'string'
    || typeof metadata.vdWorkspaceLinkId === 'string';
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
