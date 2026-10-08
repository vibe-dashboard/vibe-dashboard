import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

describe('vd-beads migrations', () => {
  it('dry-runs shared-server migration without mutating config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vd-beads-cli-'));
    try {
      const configPath = path.join(root, 'config.yaml');
      await writeFile(configPath, 'legacy: true\n');
      const { stdout } = await runVdBeads(['migrate-shared-server', '--dry-run'], {
        VD_BEADS_DIRECTORY: path.join(root, 'beads'),
        VK_SETTINGS_DIRECTORY: path.join(root, 'settings'),
        VD_SHARED_BEADS_SOURCE: path.join(root, 'shared-server'),
        VD_BD_CONFIG_PATH: configPath,
      });
      expect(JSON.parse(stdout)).toMatchObject({ command: 'migrate-shared-server', mode: 'dry-run' });
      expect(await readFile(configPath, 'utf8')).toBe('legacy: true\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies shared-server migration into raw legacy snapshots before rewriting config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vd-beads-cli-'));
    try {
      const bin = await fakeBd(root, false);
      const shared = path.join(root, 'shared-server');
      await mkdir(path.join(shared, 'dolt', 'beads_global'), { recursive: true });
      await mkdir(path.join(root, 'beads', 'legacy-all-beads'), { recursive: true });
      await writeFile(path.join(root, 'beads', 'legacy-all-beads', 'bead-creation-evidence.jsonl'), '{"beadId":"preserved","cwd":"/old"}\n');
      const configPath = path.join(root, 'config.yaml');
      await writeFile(configPath, 'dolt:\n  shared-server: true\n');

      const { stdout } = await runVdBeads(['migrate-shared-server', '--apply'], {
        PATH: `${bin}:${process.env.PATH}`,
        VD_BEADS_MIGRATION_OFFLINE_APPROVED: 'true',
        VD_BEADS_DIRECTORY: path.join(root, 'beads'),
        VK_SETTINGS_DIRECTORY: path.join(root, 'settings'),
        VD_SHARED_BEADS_SOURCE: shared,
        VD_BD_CONFIG_PATH: configPath,
      });

      const report = JSON.parse(stdout);
      expect(report.legacySources).toMatchObject([{ sourceDb: 'beads_global', records: 1 }]);
      expect(await readFile(path.join(root, 'beads', 'legacy-all-beads', 'sources', 'beads_global', 'export.jsonl'), 'utf8')).toContain('"id":"legacy-1"');
      expect(await readFile(path.join(root, 'beads', 'legacy-all-beads', 'bead-creation-evidence.jsonl'), 'utf8')).toContain('"beadId":"preserved"');
      expect(await readFile(configPath, 'utf8')).toContain('shared-server: false');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when legacy export fails and preserves bd config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vd-beads-cli-'));
    try {
      const bin = await fakeBd(root, true);
      const shared = path.join(root, 'shared-server');
      await mkdir(path.join(shared, 'dolt', 'beads_global'), { recursive: true });
      const configPath = path.join(root, 'config.yaml');
      await writeFile(configPath, 'dolt:\n  shared-server: true\n');

      await expect(runVdBeads(['migrate-shared-server', '--apply'], {
        PATH: `${bin}:${process.env.PATH}`,
        VD_BEADS_MIGRATION_OFFLINE_APPROVED: 'true',
        VD_BEADS_DIRECTORY: path.join(root, 'beads'),
        VK_SETTINGS_DIRECTORY: path.join(root, 'settings'),
        VD_SHARED_BEADS_SOURCE: shared,
        VD_BD_CONFIG_PATH: configPath,
      })).rejects.toThrow();
      expect(await readFile(configPath, 'utf8')).toBe('dolt:\n  shared-server: true\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function runVdBeads(args: string[], env: NodeJS.ProcessEnv) {
  return execFile(process.execPath, ['--experimental-strip-types', path.join(process.cwd(), 'scripts', 'vd-beads.ts'), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

async function fakeBd(root: string, failExport: boolean): Promise<string> {
  const bin = path.join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const script = path.join(bin, 'bd');
  await writeFile(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'export' && args.includes('--all')) {
  if (${failExport ? 'true' : 'false'}) process.exit(7);
  const metadataPath = path.join(process.cwd(), '.beads', 'metadata.json');
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};
  const sourceDb = metadata.dolt_database || 'beads_global';
  process.stdout.write(JSON.stringify({_type:'issue', id:'legacy-1', title:'Legacy', metadata:{sourceDb}}) + '\\n');
  process.exit(0);
}
if (args[0] === 'export') {
  process.stdout.write(args.includes('--json') ? '{}' : '');
  process.exit(0);
}
process.exit(0);
`);
  await chmod(script, 0o755);
  return bin;
}
