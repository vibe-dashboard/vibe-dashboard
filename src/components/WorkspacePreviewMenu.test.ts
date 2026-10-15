import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceRunConfigsResponse } from '../server/vk-client';
import {
  enabledPreviewSlots,
  fetchPreviewSlotUrl,
  openPreviewSlotInNewTab,
} from './WorkspacePreviewMenu';

describe('WorkspacePreviewMenu helpers', () => {
  it('returns enabled slots from every repository', () => {
    const data = {
      run_configs: [],
      preview_url_parts: [],
      preview_slots: [
        { id: 'a', repo_id: 'repo-a', enabled: true },
        { id: 'b', repo_id: 'repo-b', enabled: false },
        { id: 'c', repo_id: 'repo-c', enabled: true },
      ],
    } as unknown as WorkspaceRunConfigsResponse;

    expect(enabledPreviewSlots(data).map((slot) => slot.id)).toEqual(['a', 'c']);
  });

  it('requests the canonical server URL without constructing a domain', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://preview.example.test' }), {
        status: 200,
      }),
    );

    await expect(
      fetchPreviewSlotUrl('workspace/id', 'slot id', fetchImpl as typeof fetch),
    ).resolves.toBe('https://preview.example.test');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/internal/preview/workspaces/workspace%2Fid/preview-slots/slot%20id/url',
    );
  });

  it('surfaces canonical URL failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('not ready', { status: 409 }));
    await expect(
      fetchPreviewSlotUrl('workspace', 'slot', fetchImpl as typeof fetch),
    ).rejects.toThrow('not ready');
  });

  it('rejects non-web preview URLs', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'javascript:alert(1)' }), {
        status: 200,
      }),
    );
    await expect(
      fetchPreviewSlotUrl('workspace', 'slot', fetchImpl as typeof fetch),
    ).rejects.toThrow('protocol');
  });

  it('opens a synchronous safe tab before resolving the canonical URL', async () => {
    const replace = vi.fn();
    const opened = {
      opener: {} as unknown,
      document: { head: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    } as unknown as Window;
    const openImpl = vi.fn(() => opened);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://preview.example.test' }), {
        status: 200,
      }),
    );

    await openPreviewSlotInNewTab(
      'workspace',
      'slot',
      openImpl as typeof window.open,
      fetchImpl as typeof fetch,
    );

    expect(openImpl).toHaveBeenCalledWith('about:blank', '_blank');
    expect(opened.opener).toBeNull();
    expect(opened.document.head.innerHTML).toContain('no-referrer');
    expect(replace).toHaveBeenCalledWith('https://preview.example.test');
  });

  it('reports a blocked popup before making the URL request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      openPreviewSlotInNewTab(
        'workspace',
        'slot',
        (() => null) as typeof window.open,
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
