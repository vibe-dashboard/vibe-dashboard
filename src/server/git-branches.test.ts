import { describe, expect, it, vi } from 'vitest';
import { GitBranchPrepareError, prepareSelectedBranch } from './git-branches';

type ExecCall = { file: string; args: readonly string[] };

function fakeExec(options: {
  remoteRefs?: Set<string>;
  localRefs?: Set<string>;
  upstreams?: Record<string, string>;
  worktreePaths?: Record<string, string>;
}) {
  const calls: ExecCall[] = [];
  const exec = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push({ file, args });
    const command = args[2];
    if (command === 'check-ref-format') return { stdout: '', stderr: '' };
    if (command === 'show-ref') {
      const ref = args.at(-1) ?? '';
      const exists = ref.startsWith('refs/remotes/')
        ? options.remoteRefs?.has(ref)
        : options.localRefs?.has(ref);
      if (exists) return { stdout: '', stderr: '' };
      throw new Error(`missing ${ref}`);
    }
    if (command === 'for-each-ref') {
      const format = args.find((entry) => entry.startsWith('--format='));
      const ref = args.at(-1) ?? '';
      const branch = ref.replace(/^refs\/heads\//, '');
      if (format === '--format=%(upstream:short)') {
        return { stdout: options.upstreams?.[branch] ?? '', stderr: '' };
      }
      if (format === '--format=%(worktreepath)') {
        return { stdout: options.worktreePaths?.[branch] ?? '', stderr: '' };
      }
    }
    if (command === 'branch') return { stdout: '', stderr: '' };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  });
  return { exec, calls };
}

describe('prepareSelectedBranch', () => {
  it('creates a local tracking branch for a remote-only selected branch', async () => {
    const { exec, calls } = fakeExec({
      remoteRefs: new Set(['refs/remotes/origin/feature/demo']),
      localRefs: new Set(),
    });

    await expect(
      prepareSelectedBranch('/repo', 'origin/feature/demo', 'origin', { execFile: exec }),
    ).resolves.toEqual({ checkoutBranch: 'feature/demo', created: true });

    expect(calls.some((call) =>
      call.args.join('\0') === '-C\0/repo\0branch\0--track\0feature/demo\0origin/feature/demo',
    )).toBe(true);
  });

  it('reuses an existing local branch only when it tracks the selected remote', async () => {
    const { exec } = fakeExec({
      remoteRefs: new Set(['refs/remotes/origin/feature/demo']),
      localRefs: new Set(['refs/heads/feature/demo']),
      upstreams: { 'feature/demo': 'origin/feature/demo' },
    });

    await expect(
      prepareSelectedBranch('/repo', 'origin/feature/demo', 'origin', { execFile: exec }),
    ).resolves.toEqual({ checkoutBranch: 'feature/demo', created: false });
  });

  it('fails clearly when the derived local branch tracks another upstream', async () => {
    const { exec } = fakeExec({
      remoteRefs: new Set(['refs/remotes/origin/feature/demo']),
      localRefs: new Set(['refs/heads/feature/demo']),
      upstreams: { 'feature/demo': 'upstream/feature/demo' },
    });

    await expect(
      prepareSelectedBranch('/repo', 'origin/feature/demo', 'origin', { execFile: exec }),
    ).rejects.toMatchObject({
      name: 'GitBranchPrepareError',
      status: 409,
      message: expect.stringContaining('already tracks upstream/feature/demo'),
    } satisfies Partial<GitBranchPrepareError>);
  });
});
