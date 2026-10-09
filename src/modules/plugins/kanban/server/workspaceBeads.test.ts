import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderWorkspaceBeadsInstructionBlock,
  deterministicExternalIssueBeadId,
  ensureExternalIssueWorkspaceBead,
  seedWorkspaceBeadsInstructionConfig,
} from './workspaceBeads';

describe('workspaceBeads', () => {
  it('generates deterministic bd-safe external issue bead ids', () => {
    const id = deterministicExternalIssueBeadId('44d6b46d-459f-4b19-8034-d85e6c1fd80a', {
      provider: 'jira',
      site: 'TEAM.atlassian.net',
      key: 'VD-123',
      id: '10001',
    });

    expect(id).toBe(deterministicExternalIssueBeadId('44D6B46D-459F-4B19-8034-D85E6C1FD80A', {
      provider: 'jira',
      site: 'team.atlassian.net',
      key: 'vd-123',
      id: '10001',
    }));
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  it('seeds user append fragment once without overwriting custom content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vd-beads-settings-'));
    try {
      await seedWorkspaceBeadsInstructionConfig({ settingsDirectory: root });
      const userAppend = path.join(root, 'workspace-instructions', 'beads-user-append.md');
      await writeFile(userAppend, 'custom local note\n');
      await seedWorkspaceBeadsInstructionConfig({ settingsDirectory: root });

      expect(await readFile(userAppend, 'utf8')).toBe('custom local note\n');
      const instructions = await renderWorkspaceBeadsInstructionBlock({
        settingsDirectory: root,
        beadsDirectory: '/var/lib/vd/beads',
      });
      expect(instructions).toContain('Run `bd` commands from this workspace root/top-level directory.');
      expect(instructions).toContain('custom local note');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('repairs deterministic external issue bead creation after first bd failure', async () => {
    const calls: string[][] = [];
    let failCreate = true;
    await expect(ensureExternalIssueWorkspaceBead({
      externalIssue: { provider: 'jira', key: 'VD-123', url: 'https://example.test/VD-123', site: 'example.test' },
      workspace: { workspaceId: 'workspace-1' },
      externalIssueId: 'external-1',
      linkId: 'link-1',
    }, {
      beadsDirectory: '/tmp/beads',
      runBd: async (args) => {
        calls.push(args);
        if (args[0] === 'show') throw new Error('missing');
        if (args[0] === 'create' && failCreate) {
          failCreate = false;
          throw new Error('bd failed');
        }
        return { stdout: '' };
      },
    })).rejects.toThrow('bd failed');

    const repaired = await ensureExternalIssueWorkspaceBead({
      externalIssue: { provider: 'jira', key: 'VD-123', url: 'https://example.test/VD-123', site: 'example.test' },
      workspace: { workspaceId: 'workspace-1' },
      externalIssueId: 'external-1',
      linkId: 'link-1',
    }, {
      beadsDirectory: '/tmp/beads',
      runBd: async (args) => {
        calls.push(args);
        if (args[0] === 'show') throw new Error('missing');
        return { stdout: '' };
      },
    });

    expect(repaired.beadId).toMatch(/^vde-/);
    expect(calls.filter((args) => args[0] === 'create')).toHaveLength(2);
  });
});
