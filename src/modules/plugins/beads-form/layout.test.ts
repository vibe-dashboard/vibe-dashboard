import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

describe('BeadsForm plugin layout', () => {
  it('owns its module, browser entry point, and node entry point without legacy runtime files', async () => {
    const pluginRoot = new URL('./', import.meta.url);
    expect(await exists(new URL('module.tsx', pluginRoot))).toBe(true);
    expect(await exists(new URL('index.ts', pluginRoot))).toBe(true);
    expect(await exists(new URL('node.ts', pluginRoot))).toBe(true);

    expect(await exists(new URL('../../BeadsFormModule.tsx', pluginRoot))).toBe(false);
    expect(await exists(new URL('../../../lib/beadsFormCore.ts', pluginRoot))).toBe(false);
    expect(await exists(new URL('../../../lib/beadsClient.node.ts', pluginRoot))).toBe(false);
    expect(await exists(new URL('../../../server/beads-form-media-routes.ts', pluginRoot))).toBe(false);
  });

  it('keeps browser and node public entry points narrow', async () => {
    const pluginRoot = new URL('./', import.meta.url);
    const browserEntry = await readFile(new URL('index.ts', pluginRoot), 'utf8');
    const nodeEntry = await readFile(new URL('node.ts', pluginRoot), 'utf8');

    expect(browserEntry).toContain("from './beadsFormNavigation'");
    expect(browserEntry).not.toContain('.node');
    expect(nodeEntry).toContain("from './beadsClient.node.ts'");
    expect(nodeEntry).toContain("from './beadsFormMetadataGuard.ts'");
    expect(nodeEntry).toContain("from './beadsFormAttachmentRefs.ts'");
    expect(nodeEntry).toContain("from './beadsFormDevServer.ts'");
  });
});
