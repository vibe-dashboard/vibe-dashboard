import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandAppearance,
  type AppearanceCliService,
  type FlagMap,
} from './vk.js';
import { VKService, type AppearanceHistoryDto, type AppearanceRevisionDto } from './vk-service.js';
import { Hono } from 'hono';

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
        summary: 'operator summary',
      });
      expect(service.commandAppearance).toHaveBeenCalledWith(expect.not.objectContaining({
        actor: expect.anything(),
        source: expect.anything(),
      }));
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

  it('sends CLI mutations to the unified command boundary with a host-issued credential', async () => {
    vi.stubEnv('VK_APPEARANCE_CLI_TOKEN', 'cli-token-0123456789');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      revision: revision('rev-3', 'rev-2'),
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await new VKService().commandAppearance({
      type: 'undo',
      expectedCurrentRevisionId: 'rev-2',
      summary: 'Undo via test',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/api/appearance/commands'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cli-token-0123456789',
        },
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('cli-commands');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      type: 'undo',
      expectedCurrentRevisionId: 'rev-2',
      summary: 'Undo via test',
    });
  });

  it('refuses CLI mutations before network I/O when the host credential is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new VKService().commandAppearance({
      type: 'undo',
      expectedCurrentRevisionId: 'rev-2',
      summary: 'Undo via test',
    })).rejects.toThrow('appearance CLI authentication required');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed direct command usage', async () => {
    const { run } = fixture();
    await expect(run(['diff'])).rejects.toThrow('appearance diff');
    await expect(run(['restore'], { yes: true })).rejects.toThrow('appearance restore');
    await expect(run(['unknown'])).rejects.toThrow('Unknown appearance command');
  });

  it('conforms through VKService, authenticated Hono routes, and the real revision path', async () => {
    const dynamicImport = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const revisions = await dynamicImport('../../../src/theme/skins/appearanceRevisions.ts');
    const defaults = await dynamicImport('../../../src/theme/skins/defaultAppearanceSnapshot.ts');
    const authentication = await dynamicImport('../../../src/server/appearance-auth.node.ts');
    const routes = await dynamicImport('../../../src/server/appearance-routes.ts');
    vi.stubEnv('VK_APPEARANCE_CLI_TOKEN', 'route-cli-token-0123456789');
    const revisionService = await revisions.AppearanceRevisionService.open({ store: new revisions.MemoryAppearanceRevisionStore(), genesisSnapshot: defaults.createDefaultAppearanceSnapshot() });
    const genesis = revisionService.inspect().head;
    const changed = JSON.parse(genesis.snapshot); changed.provenance.generator = 'route-backed-cli';
    const seeded = await revisionService.apply({ expectedCurrentRevisionId: genesis.revisionId, snapshot: JSON.stringify(changed), actor: { id: 'seed', kind: 'user' }, source: 'user', summary: 'seed' });
    expect(seeded.ok).toBe(true);
    const app = new Hono();
    routes.registerAppearanceRoutes(app, { getService: async () => revisionService, authenticateMutation: authentication.createAppearanceMutationAuthenticator({ browserOrigin: 'http://localhost', cliToken: 'route-cli-token-0123456789' }) });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init));
    const actual = new VKService(); const output: string[] = [];
    const run = (args: string[], flags: FlagMap = {}) => commandAppearance(args, flags, actual, value => output.push(value));
    await run(['inspect']); expect(JSON.parse(output.pop()!)).toMatchObject({ retention: { mode: 'retain-all' } });
    await run(['snapshot', genesis.revisionId]); expect(output.pop()).toBe(genesis.snapshot);
    await run(['diff', genesis.revisionId]); expect(JSON.parse(output.pop()!)).toHaveProperty('changes');
    await expect(run(['restore', genesis.revisionId])).rejects.toThrow('explicit --yes confirmation');
    await expect(run(['undo'], { yes: true, expected: 'stale' })).rejects.toMatchObject({ code: 'stale-revision', status: 409 });
    await run(['undo'], { yes: true }); let head = revisionService.inspect().head;
    await run(['redo', seeded.revision.revisionId], { yes: true, expected: head.revisionId }); head = revisionService.inspect().head;
    await run(['revert', head.revisionId], { yes: true, expected: head.revisionId }); head = revisionService.inspect().head;
    await run(['restore', genesis.revisionId], { yes: true, expected: head.revisionId });
    expect(revisionService.inspect().revisions.every((item: any) => item.actor.kind === 'system' || item.actor.id === 'seed' || item.actor.id === 'local-cli')).toBe(true);
  });

});
