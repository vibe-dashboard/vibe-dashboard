import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BeadsClient, type ExecFileLike } from './beadsClient.node';

function beadJson(metadata: unknown) {
  return JSON.stringify([{ id: 'beads-web-biu', title: 'Plan', metadata }]);
}

const reviewMetadata = {
  beadForms: {
    forms: [{
      id: 'review',
      title: 'Review',
      html: '<form></form>',
      controls: [{ id: 'comment_control', name: 'comment', type: 'textarea', required: true }],
    }],
  },
};

async function withWorkspaceBeadsStore(workspaceId: string): Promise<{ base: string; store: string; restore: () => void }> {
  const base = await mkdtemp(join(tmpdir(), 'vd-beads-'));
  const store = join(base, 'workspaces', workspaceId, '.beads');
  await mkdir(store, { recursive: true });
  const previous = process.env.VD_BEADS_DIRECTORY;
  process.env.VD_BEADS_DIRECTORY = base;
  return {
    base,
    store,
    restore: () => {
      if (previous === undefined) {
        delete process.env.VD_BEADS_DIRECTORY;
      } else {
        process.env.VD_BEADS_DIRECTORY = previous;
      }
    },
  };
}

describe('BeadsClient', () => {
  it('reads a bead with bd show --json --long', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec).toHaveBeenCalledWith('bd', ['--readonly', 'show', 'beads-web-biu', '--json', '--long'], expect.objectContaining({ cwd: '/repo' }));
  });

  it('submits a response by re-reading, updating metadata with @file, and adding review label', async () => {
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const exec = vi.fn<ExecFileLike>(async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (args[0] === '--readonly' && args[1] === 'show') return { stdout: beadJson(reviewMetadata), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', values: { comment: 'LGTM' } });

    expect(result.prettySummary).toContain('- comment: LGTM');
    expect(result.warnings).toEqual([]);
    expect(result.metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['--readonly', 'show', 'beads-web-biu'],
      ['update', 'beads-web-biu', '--metadata'],
      ['update', 'beads-web-biu', '--add-label'],
    ]);
    expect(calls[1]?.args[3]).toMatch(/^@/);
    expect(calls[2]?.args).toContain('needs-agent-review');
  });

  it('returns a warning instead of failing when review label add fails after metadata persistence', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly' && args[1] === 'show') return { stdout: beadJson(reviewMetadata), stderr: '' };
      if (args.includes('--add-label')) throw new Error('label failed');
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', values: { comment: 'LGTM' } });

    expect(result.warnings).toEqual([
      'Form response was saved, but adding label "needs-agent-review" failed: label failed',
    ]);
  });

  it('lists workspace beads once from the persisted workspace beads store', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const store = await withWorkspaceBeadsStore('workspace-1');
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(store.store);
      if (args[0] === '--readonly' && args[1] === 'list') {
        expect(args).toContain('--has-metadata-key');
        if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
        return { stdout: JSON.stringify([
          { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
          { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
          { id: 'unscoped', title: 'Unscoped', metadata: { beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
        ]), stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }, { id: 'repo-b', name: 'repo-b' }],
      });

      expect(result.repos).toHaveLength(1);
      expect(result.repos[0]).toMatchObject({
        repo: { id: 'workspace', name: 'Workspace beads' },
        dir: store.store,
        initialized: true,
        unscopedCount: 1,
        otherWorkspaceCount: 1,
      });
      expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current', 'other', 'unscoped']);
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      store.restore();
    }
  });

  it('reports an uninitialized workspace when the persisted workspace beads store is missing', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const base = await mkdtemp(join(tmpdir(), 'vd-beads-'));
    const previous = process.env.VD_BEADS_DIRECTORY;
    process.env.VD_BEADS_DIRECTORY = base;
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: '[]', stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }],
      });

      expect(result.repos[0]).toMatchObject({ initialized: false, beads: [] });
      expect(exec).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.VD_BEADS_DIRECTORY;
      } else {
        process.env.VD_BEADS_DIRECTORY = previous;
      }
    }
  });

  it('uses form-bearing list metadata for workspace discovery without bulk showing every bead', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const store = await withWorkspaceBeadsStore('workspace-1');
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(store.store);
      if (args[0] === '--readonly' && args[1] === 'show') throw new Error(`unexpected bulk show: ${args.join(' ')}`);
      expect(args).toEqual(['--readonly', 'list', '--json', '--all', '--limit', '0', '--has-metadata-key', args.includes('beadsWeb') ? 'beadsWeb' : 'beadForms']);
      if (args.includes('beadsWeb')) return { stdout: '[]', stderr: '' };
      return { stdout: JSON.stringify([
        { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
        { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }],
      });

      expect(result.repos[0]!.beads.map((bead) => bead.id)).toEqual(['current', 'other']);
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      store.restore();
    }
  });

  it('looks for a selected bead once in the workspace beads store', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const store = await withWorkspaceBeadsStore('workspace-1');
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(store.store);
      expect(args).not.toContain('--has-metadata-key');
      expect(args).not.toContain('unrelated-1');
      if (args[1] === 'show') throw new Error(`unexpected show for ${options.cwd}: ${args.join(' ')}`);
      return { stdout: JSON.stringify([
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }, { id: 'repo-b', name: 'repo-b' }],
        beadId: 'selected',
      });

      expect(result.repos.flatMap((repo) => repo.beads.map((bead) => bead.id))).toEqual(['selected']);
      expect(exec.mock.calls.map(([, args]) => args)).toEqual([
        ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
      ]);
      expect(exec.mock.calls.some(([, args]) => args.includes('--has-metadata-key'))).toBe(false);
    } finally {
      store.restore();
    }
  });

  it('falls back to one targeted show when selected list metadata is insufficient', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const store = await withWorkspaceBeadsStore('workspace-1');
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(store.store);
      if (args[0] === '--readonly' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ id: 'selected', title: 'Selected without metadata' }]), stderr: '' };
      }
      if (args[0] === '--readonly' && args[1] === 'show') {
        return { stdout: JSON.stringify([{ id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } }]), stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }],
        beadId: 'selected',
      });

      expect(result.repos[0]!.beads[0]).toMatchObject({ id: 'selected', metadata: { VK_WORKSPACE_ID: 'workspace-1' } });
      expect(exec.mock.calls.map(([, args]) => args)).toEqual([
        ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
        ['--readonly', 'show', 'selected', '--json', '--long'],
      ]);
    } finally {
      store.restore();
    }
  });

  it('does not show when selected list metadata is sufficient to render forms', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'beads-workspace-'));
    const store = await withWorkspaceBeadsStore('workspace-1');
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(options.cwd).toBe(store.store);
      if (args[1] === 'show') throw new Error(`unexpected show: ${args.join(' ')}`);
      return { stdout: JSON.stringify([
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
      ]), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listWorkspaceBeads({
        workspaceId: 'workspace-1',
        workspaceDir,
        repos: [{ id: 'repo-a', name: 'repo-a' }],
        beadId: 'selected',
      });

      expect(result.repos[0]!.beads[0]).toMatchObject({ id: 'selected', metadata: { VK_WORKSPACE_ID: 'workspace-1' } });
      expect(exec.mock.calls.map(([, args]) => args)).toEqual([
        ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'selected'],
      ]);
    } finally {
      store.restore();
    }
  });

  it('lists pending bead forms from a bounded ~/repos-style scan without mutating bead databases', async () => {
    const reposRoot = await mkdtemp(join(tmpdir(), 'beads-repos-'));
    await mkdir(join(reposRoot, 'repo-a'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-b'), { recursive: true });
    await mkdir(join(reposRoot, 'repo-c'), { recursive: true });
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args[0]).toBe('--readonly');
      if (options.cwd.endsWith('repo-a') && args[1] === 'list') {
        if (args.includes('beadFormsSummary')) return { stdout: JSON.stringify([
          { id: 'summary_done', title: 'Summary done', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: false, pendingResponseCount: 0, formIds: ['summary_done_form'], pendingFormIds: [] }, beadForms: { forms: [{ id: 'summary_done_form', title: 'Done', html: '<form></form>' }] } } },
        ]), stderr: '' };
        return { stdout: args.includes('beadForms') ? JSON.stringify([
          { id: 'pending', title: 'Pending bead', metadata: { beadForms: { forms: [{ id: 'review', title: 'Review', html: '<form></form>' }] } } },
          { id: 'done', title: 'Done bead', metadata: { beadForms: { forms: [{ id: 'done_form', title: 'Done', html: '<form></form>', responses: [{ submittedAt: 'now', submittedBy: 'user', values: {} }] }] } } },
          { id: 'closed', title: 'Closed bead', status: 'closed', metadata: { beadForms: { forms: [{ id: 'closed_form', title: 'Closed', html: '<form></form>' }] } } },
        ]) : '[]', stderr: '' };
      }
      if (options.cwd.endsWith('repo-b')) {
        throw Object.assign(new Error('Command failed: bd list'), { stderr: 'Error: no beads database found' });
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    const result = await client.listPendingBeadsFormQueue({ reposRoot, repoLimit: 2 });

    expect(result.reposScanned).toBe(2);
    expect(result.repoLimit).toBe(2);
    expect(result.reposRoot).toBe(reposRoot);
    expect(result.entries).toEqual([{
      repoDir: join(reposRoot, 'repo-a'),
      repoName: 'repo-a',
      bead: { id: 'pending', title: 'Pending bead' },
      form: { id: 'review', title: 'Review', responseCount: 0 },
    }]);
    expect(result.skipped).toEqual([{ repoDir: join(reposRoot, 'repo-b'), reason: 'not initialized for beads' }]);
    expect(result.updateStrategy.mode).toBe('explicit-refresh');
    expect(exec.mock.calls.some(([, args]) => args.includes('update'))).toBe(false);
    expect(exec.mock.calls.some(([, args]) => args.includes('show'))).toBe(false);
  });
});
