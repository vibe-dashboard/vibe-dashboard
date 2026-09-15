import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsClient, clearCompletedBeadsFormSubmitResults, type ExecFileLike } from './beadsClient.node';

function beadJson(metadata: unknown) {
  return JSON.stringify([{ id: 'beads-web-biu', title: 'Plan', metadata }]);
}

function storedForm(id = 'review', title = 'Review', extra: Record<string, unknown> = {}) {
  return {
    format: 'standard' as const,
    id,
    goal: `Answer ${title}.`,
    title,
    questions: [{
      type: 'textarea' as const,
      id: 'comment',
      title: 'Comment',
      description: 'Share a comment.',
      required: true,
    }],
    ...extra,
  };
}

const reviewMetadata = {
  beadForms: {
    forms: [storedForm()],
  },
};
const submissionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  beforeEach(() => clearCompletedBeadsFormSubmitResults());
  it('persists first and notifies exactly the valid creating session without adding the fallback label', async () => {
    const order: string[] = [];
    const sessionId = '2e56418d-2829-4e2f-aab7-105c5aab41dc';
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: sessionId }), stderr: '' };
      order.push(args.includes('--metadata') ? 'persist' : 'label');
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (targetSessionId: string, message: string) => {
      order.push('notify');
      expect(targetSessionId).toBe(sessionId);
      expect(message).toContain('beads-web-biu');
      expect(message).toContain('"questions"');
      expect(message).toContain('<beadsFormSubmission>');
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(order).toEqual(['persist', 'notify']);
    expect(notifySession).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['absent', undefined],
    ['invalid', 'session; unsafe'],
  ])('uses the review-label fallback for %s creating-session metadata', async (_case, sessionId) => {
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') {
        return { stdout: beadJson({ ...reviewMetadata, ...(sessionId ? { VK_SESSION_ID: sessionId } : {}) }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(notifySession).not.toHaveBeenCalled();
    expect(exec.mock.calls.some(([, args]) => args.includes('--add-label'))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('returns saved success with a visible no-resubmit warning and fallback label when notification fails', async () => {
    const order: string[] = [];
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' }), stderr: '' };
      order.push(args.includes('--metadata') ? 'persist' : 'label');
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      notifySession: async () => {
        order.push('notify');
        throw new Error('session offline');
      },
    });

    const input = { dir: '/repo-warning-replay', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } };
    const result = await client.submitForm(input);
    const retry = await client.submitForm(input);

    expect(order).toEqual(['persist', 'notify', 'label']);
    expect(result.values).toEqual({ comment: 'LGTM', allow_code_file_changes: false });
    expect(result.warnings.join(' ')).toContain('response was saved');
    expect(result.warnings.join(' ')).toContain('do not submit again');
    expect(retry).toEqual(result);
  });

  it('replays timeout warnings to queued same-id callers without another write, send, or fallback', async () => {
    vi.useFakeTimers();
    const calls = { persist: 0, notify: 0, fallback: 0 };
    let markNotifyStarted!: () => void;
    const notifyStarted = new Promise<void>((resolve) => { markNotifyStarted = resolve; });
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson({ ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' }), stderr: '' };
      if (args.includes('--metadata')) calls.persist += 1;
      if (args.includes('--add-label')) calls.fallback += 1;
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      notifySession: async () => {
        calls.notify += 1;
        markNotifyStarted();
        await new Promise((_, reject) => setTimeout(() => reject(new Error('notification timed out')), 100));
      },
    });
    const input = { dir: '/repo-timeout-replay', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } };
    const results = Promise.all([client.submitForm(input), client.submitForm(input)]);
    await notifyStarted;
    await vi.advanceTimersByTimeAsync(100);
    const [first, second] = await results;

    expect(second).toEqual(first);
    expect(first.warnings.join(' ')).toContain('do not submit again');
    expect(calls).toEqual({ persist: 1, notify: 1, fallback: 1 });
    vi.useRealTimers();
  });

  it('routes independent aggregate-source submissions to each source creator exactly once', async () => {
    const sessionsByDir: Record<string, string> = {
      '/repo-a': '11111111-1111-4111-8111-111111111111',
      '/repo-b': '22222222-2222-4222-8222-222222222222',
    };
    const metadataByDir: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(sessionsByDir).map(([dir, session]) => [dir, { ...reviewMetadata, VK_SESSION_ID: session }]),
    );
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      if (args[0] === '--readonly') {
        return { stdout: beadJson(metadataByDir[options.cwd]), stderr: '' };
      }
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        metadataByDir[options.cwd] = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    const sourceA = { dir: '/repo-a', beadId: 'beads-web-biu', formId: 'review', submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', values: { comment: 'A' } };
    const sourceB = { dir: '/repo-b', beadId: 'beads-web-biu', formId: 'review', submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', values: { comment: 'B' } };
    await client.submitForm(sourceA);
    await client.submitForm(sourceA);
    await client.submitForm(sourceB);
    await client.submitForm(sourceB);

    expect(notifySession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      sessionsByDir['/repo-a'],
      sessionsByDir['/repo-b'],
    ]);
  });

  it('deduplicates a lost-response retry by durable submissionId and allows a different id', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let persistCount = 0;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
        persistCount += 1;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async (_sessionId: string, _message: string) => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    const input = { dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'first' } };
    const first = await client.submitForm(input);
    const retry = await client.submitForm({ ...input, values: { comment: 'retry must not replace saved data' } });
    await client.submitForm({ ...input, submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', values: { comment: 'second' } });

    expect(retry).toMatchObject({ submittedAt: first.submittedAt, values: first.values, submissionId });
    expect(persistCount).toBe(2);
    expect(notifySession).toHaveBeenCalledTimes(2);
    const responses = ((metadata.beadFormResponses as { responsesByFormId: Record<string, unknown[]> }).responsesByFormId.review);
    expect(responses).toHaveLength(2);
  });

  it('serializes concurrent same-id retries into one persistence and one notification', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let updates = 0;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
        updates += 1;
      }
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async () => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });
    const input = { dir: '/repo-concurrent-same', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'once' } };

    const [first, second] = await Promise.all([client.submitForm(input), client.submitForm(input)]);

    expect(second).toMatchObject({ submissionId, values: first.values, submittedAt: first.submittedAt });
    expect(updates).toBe(1);
    expect(notifySession).toHaveBeenCalledTimes(1);
    expect((metadata.beadFormResponses as { responsesByFormId: { review: unknown[] } }).responsesByFormId.review).toHaveLength(1);
  });

  it('serializes concurrent different ids without losing either response', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    const notifySession = vi.fn(async () => undefined);
    const client = new BeadsClient({ execFile: exec, notifySession });

    await Promise.all([
      client.submitForm({ dir: '/repo-concurrent-different', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'one' } }),
      client.submitForm({ dir: '/repo-concurrent-different', beadId: 'beads-web-biu', formId: 'review', submissionId: '22222222-2222-4222-8222-222222222222', values: { comment: 'two' } }),
    ]);

    const responses = (metadata.beadFormResponses as { responsesByFormId: { review: Array<{ values: { comment: string } }> } }).responsesByFormId.review;
    expect(responses.map((response) => response.values.comment)).toEqual(['one', 'two']);
    expect(notifySession).toHaveBeenCalledTimes(2);
  });

  it('releases the keyed lock after persistence and notification failures', async () => {
    let metadata: Record<string, unknown> = { ...reviewMetadata, VK_SESSION_ID: '2e56418d-2829-4e2f-aab7-105c5aab41dc' };
    let failPersistence = true;
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly') return { stdout: beadJson(metadata), stderr: '' };
      const metadataArg = args.find((arg) => arg.startsWith('@'));
      if (metadataArg && failPersistence) { failPersistence = false; throw new Error('disk failed'); }
      if (metadataArg) metadata = JSON.parse(await readFile(metadataArg.slice(1), 'utf8')) as Record<string, unknown>;
      return { stdout: '', stderr: '' };
    });
    let failNotification = true;
    const notifySession = vi.fn(async () => {
      if (failNotification) { failNotification = false; throw new Error('notify timeout'); }
    });
    const client = new BeadsClient({ execFile: exec, notifySession });

    await expect(client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'fails' } })).rejects.toThrow('disk failed');
    const warned = await client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '11111111-1111-4111-8111-111111111111', values: { comment: 'saved with warning' } });
    expect(warned.warnings.join(' ')).toContain('do not submit again');
    await expect(client.submitForm({ dir: '/repo-lock-cleanup', beadId: 'beads-web-biu', formId: 'review', submissionId: '33333333-3333-4333-8333-333333333333', values: { comment: 'later' } })).resolves.toMatchObject({ submissionId: '33333333-3333-4333-8333-333333333333' });
  });

  it('rejects malformed or oversized submission ids before reading or mutating the bead', async () => {
    const exec = vi.fn<ExecFileLike>();
    const client = new BeadsClient({ execFile: exec });
    await expect(client.submitForm({
      dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId: 'unsafe; id', values: {},
    })).rejects.toThrow('expected a UUID');
    expect(exec).not.toHaveBeenCalled();
  });
  it('reads a bead with targeted bd list metadata before falling back to show', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' }));
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec).toHaveBeenCalledWith('bd', ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'beads-web-biu'], expect.objectContaining({ cwd: '/repo' }));
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('falls back to bd show when targeted list lacks metadata', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[1] === 'list') return { stdout: JSON.stringify([{ id: 'beads-web-biu', title: 'Plan' }]), stderr: '' };
      return { stdout: beadJson({ beadForms: { forms: [] } }), stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    await expect(client.readBead('/repo', 'beads-web-biu')).resolves.toMatchObject({ id: 'beads-web-biu' });
    expect(exec.mock.calls.map(([, args]) => args)).toEqual([
      ['--readonly', 'list', '--json', '--all', '--limit', '0', '--id', 'beads-web-biu'],
      ['--readonly', 'show', 'beads-web-biu', '--json', '--long'],
    ]);
  });

  it('reads legacy standard forms with stale generated fields and a missing goal', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({
      stdout: beadJson({
        beadForms: {
          forms: [{
            format: 'standard',
            id: 'legacy_review',
            title: 'Legacy Review',
            questions: [{
              type: 'textarea',
              id: 'comment',
              title: 'Comment',
              description: 'Share a comment.',
            }],
            html: '<form><input name="stale"></form>',
            controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
          }],
        },
      }),
      stderr: '',
    }));
    const client = new BeadsClient({ execFile: exec });

    const result = await client.readForms('/repo', 'beads-web-biu');

    expect(result.forms[0]).toMatchObject({
      id: 'legacy_review',
      goal: 'Answer Legacy Review.',
      title: 'Legacy Review',
    });
    expect(result.forms[0]!.html).toContain('name="comment"');
    expect(result.forms[0]!.html).not.toContain('name="stale"');
  });

  it('submits a response by re-reading, updating metadata with @file, and adding review label', async () => {
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const exec = vi.fn<ExecFileLike>(async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (args[0] === '--readonly' && args[1] === 'list') return { stdout: beadJson(reviewMetadata), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({
      execFile: exec,
      now: () => new Date('2026-06-29T00:00:00Z'),
      actor: 'reviewer',
    });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

    expect(result.submittedAt).toBe('2026-06-29T00:00:00.000Z');
    expect(result.submittedBy).toBe('reviewer');
    expect(result.prettySummary).toContain('- comment: LGTM');
    expect(result.warnings).toEqual([]);
    expect(result.metadata.beadFormResponses).toMatchObject({
      responsesByFormId: {
        review: [{
          submittedAt: '2026-06-29T00:00:00.000Z',
          submittedBy: 'reviewer',
          values: { comment: 'LGTM' },
        }],
      },
    });
    expect(result.metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['--readonly', 'list', '--json'],
      ['update', 'beads-web-biu', '--metadata'],
      ['update', 'beads-web-biu', '--add-label'],
    ]);
    expect(calls[1]?.args[3]).toMatch(/^@/);
    expect(calls[2]?.args).toContain('needs-agent-review');
  });

  it('returns a warning instead of failing when review label add fails after metadata persistence', async () => {
    const exec = vi.fn<ExecFileLike>(async (_file, args) => {
      if (args[0] === '--readonly' && args[1] === 'list') return { stdout: beadJson(reviewMetadata), stderr: '' };
      if (args.includes('--add-label')) throw new Error('label failed');
      return { stdout: '', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec, now: () => new Date('2026-06-29T00:00:00Z') });

    const result = await client.submitForm({ dir: '/repo', beadId: 'beads-web-biu', formId: 'review', submissionId, values: { comment: 'LGTM' } });

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
          { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
          { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [storedForm()] } } },
          { id: 'unscoped', title: 'Unscoped', metadata: { beadForms: { forms: [storedForm()] } } },
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
        { id: 'current', title: 'Current', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
        { id: 'other', title: 'Other', metadata: { VK_WORKSPACE_ID: 'workspace-2', beadForms: { forms: [storedForm()] } } },
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
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
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
        return { stdout: JSON.stringify([{ id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } }]), stderr: '' };
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
        { id: 'selected', title: 'Selected', metadata: { VK_WORKSPACE_ID: 'workspace-1', beadForms: { forms: [storedForm()] } } },
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

  it('lists pending bead forms from persisted workspace stores without mutating bead databases', async () => {
    const beadsRoot = await mkdtemp(join(tmpdir(), 'vd-beads-'));
    const workspaceAStore = join(beadsRoot, 'workspaces', 'workspace-a', '.beads');
    const workspaceBRoot = join(beadsRoot, 'workspaces', 'workspace-b');
    const workspaceCStore = join(beadsRoot, 'workspaces', 'workspace-c', '.beads');
    await mkdir(workspaceAStore, { recursive: true });
    await mkdir(workspaceBRoot, { recursive: true });
    await mkdir(workspaceCStore, { recursive: true });
    const previous = process.env.VD_BEADS_DIRECTORY;
    process.env.VD_BEADS_DIRECTORY = beadsRoot;
    const exec = vi.fn<ExecFileLike>(async (_file, args, options) => {
      expect(args[0]).toBe('--readonly');
      expect(options.cwd).not.toContain('/repos/');
      if (options.cwd === workspaceAStore && args[1] === 'list') {
        if (args.includes('beadFormsSummary')) return { stdout: JSON.stringify([
          { id: 'summary_done', title: 'Summary done', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: false, pendingResponseCount: 0, formIds: ['summary_done_form'], pendingFormIds: [] }, beadForms: { forms: [storedForm('summary_done_form', 'Done')] } } },
          { id: 'task-pending', title: 'Pending bead', metadata: { beadFormsSummary: { hasForms: true, hasPendingAnswer: true, pendingResponseCount: 1, formIds: ['review'], pendingFormIds: ['review'] }, beadForms: { forms: [storedForm('review', 'Review')] } } },
        ]), stderr: '' };
        return { stdout: args.includes('beadForms') ? JSON.stringify([
          { id: 'task-pending', title: 'Pending bead', metadata: { beadForms: { forms: [storedForm('review', 'Review')] } } },
          { id: 'done', title: 'Done bead', metadata: { beadForms: { forms: [storedForm('done_form', 'Done', { responses: [{ submittedAt: 'now', submittedBy: 'user', values: {} }] })] } } },
          { id: 'closed', title: 'Closed bead', status: 'closed', metadata: { beadForms: { forms: [storedForm('closed_form', 'Closed')] } } },
        ]) : '[]', stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    const client = new BeadsClient({ execFile: exec });

    try {
      const result = await client.listPendingBeadsFormQueue({ repoLimit: 2 });

      expect(result.reposScanned).toBe(2);
      expect(result.repoLimit).toBe(2);
      expect(result.reposRoot).toBe(join(beadsRoot, 'workspaces'));
      expect(result.entries).toEqual([{
        workspaceId: 'workspace-a',
        repoDir: workspaceAStore,
        repoName: 'workspace-a',
        bead: { id: 'task-pending', title: 'Pending bead' },
        form: { id: 'review', title: 'Review', responseCount: 0 },
      }]);
      expect(result.skipped).toEqual([{ repoDir: join(workspaceBRoot, '.beads'), reason: 'workspace beads store not initialized' }]);
      expect(result.updateStrategy.mode).toBe('explicit-refresh');
      expect(exec.mock.calls.some(([, args]) => args.includes('update'))).toBe(false);
      expect(exec.mock.calls.some(([, args]) => args.includes('show'))).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.VD_BEADS_DIRECTORY;
      } else {
        process.env.VD_BEADS_DIRECTORY = previous;
      }
    }
  });
});
