import { describe, expect, it, vi } from 'vitest';
import {
  commandAppearance,
  type AppearanceCliService,
  type FlagMap,
} from './vk.js';
import type { AppearanceHistoryDto, AppearanceRevisionDto } from './vk-service.js';

const revision = (revisionId: string, parentRevisionId?: string): AppearanceRevisionDto => ({
  revisionId,
  ...(parentRevisionId ? { parentRevisionId } : {}),
  snapshot: `snapshot:${revisionId}`,
  actor: { id: 'trusted-cli', kind: 'cli' },
  source: 'cli',
  committedAt: '2026-09-16T00:00:00.000Z',
  summary: `revision ${revisionId}`,
});

function fixture() {
  const head = revision('rev-2', 'rev-1');
  const history: AppearanceHistoryDto = { head, revisions: [revision('rev-1'), head] };
  const service: AppearanceCliService = {
    inspectAppearance: vi.fn(async () => history),
    getAppearanceSnapshot: vi.fn(async revisionId => ({ revisionId, snapshot: `snapshot:${revisionId}` })),
    diffAppearance: vi.fn(async (from, to) => ({ from, to, changes: ['skin'] })),
    commandAppearance: vi.fn(async command => ({ ok: true as const, revision: { ...head, summary: String(command.type) } })),
  };
  const output: string[] = [];
  const run = (positional: string[], flags: FlagMap = {}) => commandAppearance(positional, flags, service, value => output.push(value));
  return { service, output, run };
}

describe('vk appearance commands', () => {
  it('directly inspects history, snapshots the requested/default head, and diffs revisions', async () => {
    const { service, output, run } = fixture();

    await run(['inspect']);
    expect(JSON.parse(output.pop()!)).toMatchObject({ head: { revisionId: 'rev-2' } });

    await run(['snapshot', 'rev-1']);
    expect(service.getAppearanceSnapshot).toHaveBeenLastCalledWith('rev-1');
    expect(output.pop()).toBe('snapshot:rev-1');

    await run(['snapshot']);
    expect(service.getAppearanceSnapshot).toHaveBeenLastCalledWith('rev-2');

    await run(['diff', 'rev-1']);
    expect(service.diffAppearance).toHaveBeenCalledWith('rev-1', 'rev-2');
    expect(JSON.parse(output.pop()!)).toMatchObject({ from: 'rev-1', to: 'rev-2' });
  });

  it.each(['restore', 'revert', 'redo'] as const)(
    'submits confirmed %s with the current or explicit expected head',
    async type => {
      const { service, run } = fixture();
      await run([type, 'rev-1'], { yes: true, expected: 'expected-head', summary: 'operator summary' });
      expect(service.commandAppearance).toHaveBeenCalledWith({
        type,
        expectedCurrentRevisionId: 'expected-head',
        targetRevisionId: 'rev-1',
        actor: { id: process.env.USER || 'vk-cli', kind: 'cli' },
        summary: 'operator summary',
      });
    },
  );

  it('submits undo without a target and defaults expected head', async () => {
    const { service, run } = fixture();
    await run(['undo'], { yes: true });
    expect(service.commandAppearance).toHaveBeenCalledWith(expect.objectContaining({
      type: 'undo',
      expectedCurrentRevisionId: 'rev-2',
    }));
    expect(service.commandAppearance).toHaveBeenCalledWith(expect.not.objectContaining({ targetRevisionId: expect.anything() }));
  });

  it('refuses mutations without confirmation before calling the command service', async () => {
    const { service, run } = fixture();
    await expect(run(['restore', 'rev-1'])).rejects.toThrow('explicit --yes confirmation');
    expect(service.commandAppearance).not.toHaveBeenCalled();
  });

  it('surfaces stale-head and authentication failures from the command boundary', async () => {
    const { service, run } = fixture();
    vi.mocked(service.commandAppearance)
      .mockRejectedValueOnce(new Error('stale expected head'))
      .mockRejectedValueOnce(new Error('appearance CLI authentication required'));
    await expect(run(['undo'], { yes: true, expected: 'stale' })).rejects.toThrow('stale expected head');
    await expect(run(['undo'], { yes: true })).rejects.toThrow('authentication required');
  });

  it('rejects malformed direct command usage', async () => {
    const { run } = fixture();
    await expect(run(['diff'])).rejects.toThrow('appearance diff');
    await expect(run(['restore'], { yes: true })).rejects.toThrow('appearance restore');
    await expect(run(['unknown'])).rejects.toThrow('Unknown appearance command');
  });
});
