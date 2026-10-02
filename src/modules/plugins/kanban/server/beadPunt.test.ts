import { describe, expect, it } from 'vitest';
import { buildPuntNewWorkspacePrompt, puntBead } from './beadPunt';

describe('beadPunt', () => {
  it('uses two-phase destination metadata and closes source as moved', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const result = await puntBead({
      beadId: 'src-1',
      fromWorkspaceId: 'ws-a',
      destination: { kind: 'existing', workspaceId: 'ws-b' },
    }, {
      beadsDirectory: '/tmp/beads',
      runBd: async (args, options) => {
        calls.push({ args, cwd: options.cwd });
        if (args[0] === 'show' && args[1] === 'src-1') {
          return { stdout: JSON.stringify([{ id: 'src-1', title: 'Source', description: 'Body', metadata: { kept: true } }]) };
        }
        if (args[0] === 'show') throw new Error('missing');
        return { stdout: '' };
      },
    });

    expect(result.destinationBeadId).toMatch(/^vdp-/);
    const create = calls.find((call) => call.args[0] === 'create');
    expect(create).toBeDefined();
    expect(create?.args).toContain(result.destinationBeadId);
    expect(JSON.parse(create?.args[(create?.args.indexOf('--metadata') ?? -1) + 1] ?? '{}').move.state).toBe('pending');

    const close = calls.find((call) => call.args[0] === 'close');
    expect(close?.args).toEqual(['close', 'src-1', '--reason', `Moved to ws-b:${result.destinationBeadId}`]);

    const destinationComplete = calls.filter((call) => call.args[0] === 'update' && call.args[1] === result.destinationBeadId).at(-1);
    expect(JSON.parse(destinationComplete?.args[(destinationComplete?.args.indexOf('--metadata') ?? -1) + 1] ?? '{}').move.state).toBe('complete');
  });

  it('builds canned new workspace prompt with optional append text', () => {
    expect(buildPuntNewWorkspacePrompt('vdp-123', 'Extra context.')).toContain('Start work from bead vdp-123.');
    expect(buildPuntNewWorkspacePrompt('vdp-123', 'Extra context.')).toContain('Extra context.');
  });
});
