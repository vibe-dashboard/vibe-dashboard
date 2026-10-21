import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { VkRuntimeRelease } from './vk-runtime-release';
import { createSandboxPlan } from './vk-mocked-sandbox';

describe('content-addressed VK runtime releases', () => {
  const hash = 'a'.repeat(64);

  it('plans a remote runtime with QA enabled and embedded frontend routing', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/workspace/vibe-kanban-vscode-web',
      env: { VK_MOCKED_VK_BACKEND: 'ci-release', VK_MOCKED_CONTENT_HASH: hash },
      ports: {
        vkBackend: 50000,
        vkFrontend: 50001,
        vkPreviewProxy: 50002,
        vdDashboard: 50003,
        vdServer: 50004,
        vdCaddy: 50005,
      },
      caddyfile: '# Vibe Dashboard app',
    });
    expect(plan.setupCommands.map((spec) => spec.name)).toEqual([
      'vk-download-runtime-release',
    ]);
    expect(plan.setupCommands[0]?.env.VK_MOCKED_CONTENT_HASH).toBe(hash);
    expect(plan.commands[0]?.command).toContain(`vk-assets-sha256-${hash}`);
    expect(plan.commands[0]?.env.VK_QA_MODE).toBe('1');
    expect(plan.caddyfile).toContain('handle @vk_release_assets');
  });

  it('verifies content identity and rejects a tampered runtime archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-runtime-release-'));
    try {
      const release = new VkRuntimeRelease(root, hash);
      await mkdir(release.artifactRoot, { recursive: true });
      const platform = `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`;
      const archiveName = `vibe-kanban-${platform}.tar.gz`;
      const checksum = createHash('sha256').update('archive').digest('hex');
      const manifest = {
        release_tag: release.tag,
        vk_content_hash: hash,
        vk_sha: 'b'.repeat(40),
        platforms: {
          [platform]: {
            assets: {
              'vibe-kanban': { file: archiveName, sha256: checksum },
            },
          },
        },
      };
      await writeFile(
        join(release.artifactRoot, 'manifest.json'),
        JSON.stringify(manifest),
      );
      await writeFile(join(release.artifactRoot, archiveName), 'archive');
      await writeFile(
        join(release.artifactRoot, `${archiveName}.sha256`),
        `${checksum}  ${archiveName}\n`,
      );
      await expect(release.verify()).resolves.toBeUndefined();
      await writeFile(join(release.artifactRoot, archiveName), 'tampered');
      await expect(release.verify()).rejects.toThrow('manifest checksum');
      manifest.vk_content_hash = 'c'.repeat(64);
      await writeFile(
        join(release.artifactRoot, 'manifest.json'),
        JSON.stringify(manifest),
      );
      await expect(release.verify()).rejects.toThrow('requested content');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
