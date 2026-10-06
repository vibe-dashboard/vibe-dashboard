import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceMigrationPlan,
  loadLegacySnapshots,
  parseWorktreeCwd,
  planHasHardHazards,
  type LegacyBeadRecord,
} from './beadsMigration';
import { applyWorkspaceBeadsSetup } from './workspaceBeads';

const ws1 = '44d6b46d-459f-4b19-8034-d85e6c1fd80a';
const ws2 = '22222222-2222-4222-8222-222222222222';

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
    expect(plan.assignments['vkw-1234567890abcdefghijklmnopqrstuv']).toBe(ws1);
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

    expect(plan.assignments['vkw-1234567890abcdefghijklmnopqrstuv']).toBe(ws1);
    expect(plan.unresolved.map((item) => item.beadId)).toEqual(['vkvw-677.9.1']);
  });

  it('infers one-sided parent-child assignments only', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('child', { metadata: { VK_WORKSPACE_ID: ws1 }, dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
        record('parent'),
        record('related', { dependencies: [{ issueId: 'related', dependsOnId: 'other', type: 'related' }] }),
        record('other'),
      ],
      evidence: [],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }],
    });

    expect(plan.assignments.parent).toBe(ws1);
    expect(plan.reports.parentChildInferred).toContain(`parent<=child:${ws1}`);
    expect(plan.assignments.other).toBeUndefined();
    expect(plan.reports.nonParentEdges).toContain('related->other:related');
  });

  it('hard-fails explicit different-workspace parent-child and duplicate selected ids', () => {
    const plan = buildWorkspaceMigrationPlan({
      records: [
        record('dup', { sourceDb: 'a', metadata: { VK_WORKSPACE_ID: ws1 } }),
        record('dup', { sourceDb: 'b', metadata: { VK_WORKSPACE_ID: ws1 } }),
        record('child', { metadata: { VK_WORKSPACE_ID: ws1 }, dependencies: [{ issueId: 'child', dependsOnId: 'parent', type: 'parent-child' }] }),
        record('parent', { metadata: { VK_WORKSPACE_ID: ws2 } }),
      ],
      evidence: [],
      workspaceRoots: [{ workspaceId: ws1, root: '/var/tmp/vibe-kanban/worktrees/44d6-vd-beads-per-wor' }, { workspaceId: ws2, root: '/var/tmp/vibe-kanban/worktrees/other' }],
    });

    expect(plan.hazards.duplicateSelected[0]).toContain('dup:a,b');
    expect(plan.hazards.parentChildConflicts[0]).toContain(`${ws1}!=${ws2}`);
    expect(planHasHardHazards(plan)).toBe(true);
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

  it('plans unknown workspace imports as DB-only while known roots can be reconciled', async () => {
    const root = await mkdtempClean('vd-known-root-');
    try {
      const plan = buildWorkspaceMigrationPlan({
        records: [record('known', { metadata: { VK_WORKSPACE_ID: ws1 } }), record('unknown', { metadata: { VK_WORKSPACE_ID: 'missing-root' } })],
        evidence: [],
        workspaceRoots: [{ workspaceId: ws1, root, repos: [{ name: 'repo', targetBranch: 'main' }] }],
      });
      expect(plan.reports.unknownRoots).toEqual(['missing-root']);

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
});

async function mkdtempClean(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(dir, { recursive: true });
  return dir;
}
