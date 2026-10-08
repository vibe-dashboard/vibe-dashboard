import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceMigrationPlan,
  expandWorkspaceImportAncestors,
  loadLegacySnapshots,
  parseWorktreeCwd,
  planHasHardHazards,
  prepareWorkspaceImportRecords,
  scanProcessCreationEvidence,
  type LegacyBeadRecord,
} from './beadsMigration';
import { applyWorkspaceBeadsSetup } from './workspaceBeads';

const ws1 = '44d6b46d-459f-4b19-8034-d85e6c1fd80a';
const ws2 = '22222222-2222-4222-8222-222222222222';

function key(sourceDb: string, beadId: string): string {
  return `${sourceDb}\0${beadId}`;
}

function record(id: string, extra: Partial<LegacyBeadRecord> = {}): LegacyBeadRecord {
  return {
    sourceDb: extra.sourceDb ?? 'vkvw',
    beadId: id,
    title: extra.title,
    metadata: extra.metadata ?? {},
    dependencies: extra.dependencies ?? [],
    raw: extra.raw ?? { id },
  };
}

describe('beadsMigration planner', () => {
  it('assigns cwd subdirectories by worktree slug without requiring the path to exist', () => {
    const roots = [{ workspaceId: ws1, root: `/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor` }];
    const plan = buildWorkspaceMigrationPlan({
      records: [record('vkw-1234567890abcdefghijklmnopqrstuv')],
      evidence: [{ beadId: 'vkw-1234567890abcdefghijklmnopqrstuv', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo/src' }],
      workspaceRoots: roots,
    });

    expect(parseWorktreeCwd('/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo', new Map([['44d6-vd-beads-per-wor', ws1]]))).toBe(ws1);
    expect(plan.assignments[key('vkvw', 'vkw-1234567890abcdefghijklmnopqrstuv')]).toBe(ws1);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('dedupes creation evidence and prefers resolved cwd evidence over null evidence', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [record('vkw-1234567890abcdefghijklmnopqrstuv'), record('vkvw-677.9.1', { title: 'Review Gate: approve V1 non-PR branch reuse design' })],
      evidence: [
        { beadId: 'vkw-1234567890abcdefghijklmnopqrstuv', cwd: null, source: 'session' },
        { beadId: 'vkw-1234567890abcdefghijklmnopqrstuv', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo', source: 'cwd' },
        { beadId: 'vkvw-677.9.1', cwd: null, source: 'session' },
      ],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('vkvw', 'vkw-1234567890abcdefghijklmnopqrstuv')]).toBe(ws1);
    expect(plan.unresolved.map((item) => item.beadId)).toEqual(['vkvw-677.9.1']);
  });

  it('uses cwd-derived workspace and ignores fallback workspaceId disagreement', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [record('bead-1')],
      evidence: [{
        beadId: 'bead-1',
        cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo',
        workspaceId: ws2,
        source: 'vk-sqlite-session',
      }],
      workspaceRoots: [
        { workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' },
        { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' },
      ],
    });

    expect(plan.assignments[key('vkvw', 'bead-1')]).toBe(ws1);
    expect(plan.hazards.evidenceConflicts).toEqual([]);
    expect(planHasHardHazards(plan)).toBe(false);
  });

  it('ignores fallback workspaceId when cwd evidence is absent', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [record('bead-1')],
      evidence: [{ beadId: 'bead-1', cwd: null, workspaceId: ws2, source: 'vk-sqlite-session' }],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('vkvw', 'bead-1')]).toBeUndefined();
    expect(plan.unresolved.map((item) => item.beadId)).toEqual(['bead-1']);
  });

  it('hard-fails conflicting cwd-derived evidence for one bead', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [record('bead-1')],
      evidence: [
        { beadId: 'bead-1', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' },
        { beadId: 'bead-1', cwd: '/var/tmp/vibe-kanban/worktrees/other/repo' },
      ],
      workspaceRoots: [
        { workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' },
        { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' },
      ],
    });

    expect(plan.hazards.evidenceConflicts).toEqual([`bead-1:${ws1}!=${ws2}`]);
    expect(planHasHardHazards(plan)).toBe(true);
  });

  it('ignores metadata alone and assigns only from cwd evidence', () => {
    const records = [
      record('vkw-1234567890abcdefghijklmnopqrstuv', { metadata: { VK_SESSION_ID: 'session-1' } }),
      record('vkvw-677.9.1', { title: 'Review Gate: approve V1 non-PR branch reuse design' }),
      record('vkvw-8xaj.18.4.11', { title: 'Add typed UIC recent session delete action' }),
    ];
    const plan = buildWorkspaceMigrationPlan({
      records,
      evidence: [{ beadId: 'vkw-1234567890abcdefghijklmnopqrstuv', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/vibe-kanban-vscode-web' }],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('vkvw', 'vkw-1234567890abcdefghijklmnopqrstuv')]).toBe(ws1);
    expect(plan.unresolved.map((item) => item.beadId)).toEqual(['vkvw-677.9.1', 'vkvw-8xaj.18.4.11']);
  });

  it('infers one-sided parent-child assignments only', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('child', { dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
        record('parent'),
        record('related', { dependencies: [{ issueId: 'related', dependsOnId: 'other', type: 'related' }] }),
        record('other'),
      ],
      evidence: [{ beadId: 'child', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' }],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('vkvw', 'parent')]).toBe(ws1);
    expect(plan.reports.parentChildInferred).toContain(`${key('vkvw', 'parent')}<=${key('vkvw', 'child')}:${ws1}`);
    expect(plan.assignments[key('vkvw', 'other')]).toBeUndefined();
    expect(plan.reports.nonParentEdges).toContain('vkvw:related->other:related');
  });

  it('hard-fails duplicate bead ids selected by cwd evidence', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('same-id', { sourceDb: 'selected' }),
        record('same-id', { sourceDb: 'legacy' }),
      ],
      evidence: [{ beadId: 'same-id', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' }],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('selected', 'same-id')]).toBe(ws1);
    expect(plan.assignments[key('legacy', 'same-id')]).toBe(ws1);
    expect(plan.hazards.duplicateSelected[0]).toContain('same-id:selected,legacy');
  });

  it('runs parent-child inference to a fixed point', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('grandparent'),
        record('parent', { dependencies: [{ issueId: 'parent', dependsOnId: 'grandparent', type: 'parent-child' }] }),
        record('child', { dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
      ],
      evidence: [{ beadId: 'child', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' }],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments[key('vkvw', 'parent')]).toBe(ws1);
    expect(plan.assignments[key('vkvw', 'grandparent')]).toBe(ws1);
    expect(plan.reports.parentChildInferred).toEqual([...new Set(plan.reports.parentChildInferred)]);
  });

  it('reports different-workspace parent-child and hard-fails duplicate selected ids', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('dup', { sourceDb: 'a' }),
        record('dup', { sourceDb: 'b' }),
        record('child', { dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
        record('parent'),
      ],
      evidence: [
        { beadId: 'dup', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' },
        { beadId: 'child', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' },
        { beadId: 'parent', cwd: '/var/tmp/vibe-kanban/worktrees/other/repo' },
      ],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }, { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' }],
    });

    expect(plan.hazards.duplicateSelected[0]).toContain('dup:a,b');
    expect(plan.hazards.parentChildConflicts).toEqual([]);
    expect(plan.reports.parentChildConflicts[0]).toContain(`${ws1}!=${ws2}`);
    expect(planHasHardHazards(plan)).toBe(true);
  });

  it('does not hard-fail cross-workspace parent-child reports by themselves', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('child', { dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
        record('parent'),
      ],
      evidence: [
        { beadId: 'child', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' },
        { beadId: 'parent', cwd: '/var/tmp/vibe-kanban/worktrees/other/repo' },
      ],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }, { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' }],
    });

    expect(plan.hazards.parentChildConflicts).toEqual([]);
    expect(plan.reports.parentChildConflicts[0]).toContain(`${ws1}!=${ws2}`);
    expect(planHasHardHazards(plan)).toBe(false);
  });

  it('strips dependency edges whose target is outside the workspace import', () => {
    const prepared = prepareWorkspaceImportRecords([
      record('child', {
        raw: {
          id: 'child',
          dependency_count: 2,
          dependencies: [
            { issue_id: 'child', depends_on_id: 'local-parent', type: 'parent-child' },
            { issue_id: 'child', depends_on_id: 'remote-parent', type: 'parent-child' },
          ],
        },
      }),
      record('local-parent', { raw: { id: 'local-parent' } }),
    ]);

    expect(prepared.strippedDependencies).toEqual(['vkvw:child->remote-parent:parent-child']);
    expect(prepared.records[0]).toMatchObject({
      dependency_count: 1,
      dependencies: [{ issue_id: 'child', depends_on_id: 'local-parent', type: 'parent-child' }],
    });
  });

  it('adds dotted id ancestor records as import context', () => {
    const child = record('task-1.2.3');
    const parent = record('task-1.2');
    const grandparent = record('task-1');
    const expanded = expandWorkspaceImportAncestors(
      [child],
      new Map([
        [key('vkvw', 'task-1.2.3'), child],
        [key('vkvw', 'task-1.2'), parent],
        [key('vkvw', 'task-1'), grandparent],
      ]),
    );

    expect(expanded.records.map((item) => item.beadId)).toEqual(['task-1.2.3', 'task-1.2', 'task-1']);
    expect(expanded.contextRecordKeys).toEqual([key('vkvw', 'task-1'), key('vkvw', 'task-1.2')]);
    expect(expanded.missingAncestorKeys).toEqual([]);
  });

  it('scopes pilot hard hazards to selected workspace records', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('target'),
        record('other-child', { dependencies: [{ issueId: 'other-child', dependsOnId: 'other-parent', type: 'parent-child' }] }),
        record('other-parent'),
        record('external-missing', { metadata: { external_issues: [{ provider: 'jira', key: 'VD-1' }] } }),
      ],
      evidence: [
        { beadId: 'target', cwd: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor/repo' },
        { beadId: 'other-child', cwd: '/var/tmp/vibe-kanban/worktrees/other/repo' },
        { beadId: 'other-parent', cwd: '/var/tmp/vibe-kanban/worktrees/third/repo' },
      ],
      workspaceRoots: [
        { workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' },
        { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' },
        { workspaceId: '33333333-3333-4333-8333-333333333333', root: '/var/tmp/vibe-kanban/worktrees/third' },
      ],
      workspaceIdFilter: ws1,
    });

    expect(plan.importsByWorkspace[ws1]).toEqual([{ sourceDb: 'vkvw', beadId: 'target' }]);
    expect(plan.hazards.parentChildConflicts).toEqual([]);
    expect(plan.hazards.externalIssueMissingWorkspace).toEqual([]);
    expect(planHasHardHazards(plan)).toBe(false);
  });

  it('reports known unresolved beads as legacy and external records without workspace as hard hazards', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('vkvw-677.9.1', { title: 'Review Gate: approve V1 non-PR branch reuse design' }),
        record('vkvw-8xaj.18.4.11', { title: 'Add typed UIC recent session delete action' }),
        record('external', { metadata: { external_issues: [{ provider: 'jira', key: 'VD-1' }] } }),
      ],
      evidence: [],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.unresolved.map((item) => item.beadId)).toEqual(['vkvw-677.9.1', 'vkvw-8xaj.18.4.11', 'external']);
    expect(plan.hazards.externalIssueMissingWorkspace).toEqual(['vkvw:external']);
  });

  it('plans known cwd-derived workspace imports for reconciliation', async () => {
    const root = await mkdtempClean('vd-known-root-');
    try {
      const plan = buildWorkspaceMigrationPlan({
        records: [record('known'), record('unknown')],
        evidence: [
          { beadId: 'known', cwd: `${root}/repo` },
          { beadId: 'unknown', cwd: '/var/tmp/vibe-kanban/worktrees/missing/repo' },
        ],
        workspaceRoots: [{ workspaceId: ws1, root, repos: [{ name: 'repo', targetBranch: 'main' }] }],
      });
      expect(plan.importsByWorkspace[ws1]).toEqual([{ sourceDb: 'vkvw', beadId: 'known' }]);
      expect(plan.reports.unknownRoots).toEqual([]);

      await writeFile(path.join(root, 'AGENTS.md'), 'human note\n');
      await applyWorkspaceBeadsSetup(
        { workspaceId: ws1, workspaceDir: root, repos: [{ name: 'repo', targetBranch: 'main' }] },
        { beadsDirectory: path.join(root, 'persisted'), settingsDirectory: path.join(root, 'settings'), runBd: async () => ({ stdout: '' }) },
      );

      expect(await readFile(path.join(root, '.beads', 'redirect'), 'utf8')).toContain(ws1);
      expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toContain('BEGIN VD MANAGED BLOCK');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads raw JSONL snapshots with source identity', async () => {
    const dir = await mkdtempClean('legacy-all-beads-');
    try {
      await mkdir(path.join(dir, 'sources', 'global'), { recursive: true });
      await writeFile(path.join(dir, 'sources', 'global', 'export.jsonl'), `${JSON.stringify({ id: 'a', metadata: { VK_WORKSPACE_ID: ws1 } })}\n`);

      const records = await loadLegacySnapshots(dir);
      expect(records).toMatchObject([{ sourceDb: 'global', beadId: 'a', metadata: { VK_WORKSPACE_ID: ws1 } }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('extracts bd create cwd evidence from process JSONL', async () => {
    const dir = await mkdtempClean('process-jsonl-');
    try {
      const processDir = path.join(dir, 'aa', 'session', 'processes');
      await mkdir(processDir, { recursive: true });
      const item = {
        method: 'item/completed',
        params: {
          item: {
            type: 'commandExecution',
            command: '/bin/bash -lc \'bd create "Support unmanaged imported workspace working directories" --json\'',
            cwd: '/var/tmp/vibe-kanban/worktrees/cd92-vk-import-existi/Vktest',
            aggregatedOutput: `${JSON.stringify({ id: 'Vktest-6m8e', title: 'redacted' })}\n`,
          },
        },
      };
      await writeFile(path.join(processDir, 'process.jsonl'), `${JSON.stringify({ Stdout: `${JSON.stringify(item)}\n` })}\n`);

      const scan = await scanProcessCreationEvidence(dir);
      expect(scan.filesScanned).toBe(1);
      expect(scan.evidence).toEqual([{
        beadId: 'Vktest-6m8e',
        cwd: '/var/tmp/vibe-kanban/worktrees/cd92-vk-import-existi/Vktest',
        source: 'bead-id-scan:same-record:process.jsonl',
      }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function mkdtempClean(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(dir, { recursive: true });
  return dir;
}
