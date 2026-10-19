import { afterEach, describe, expect, it, vi } from 'vitest';
import { VKService } from './vk-service.js';

describe('VKService Preview URL helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits customerSlug from preview URL generation when callers use configured defaults', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return jsonResponse({
        success: true,
        data: {
          previewSlotId: 'slot-1',
          workspaceToken: '0123456789abcdef',
          repoSlug: 'repo',
          slotSlug: 'web',
          customerSlug: 'preview',
          host: 'web-repo-0123456789abcdef-preview.example.test',
          url: 'https://web-repo-0123456789abcdef-preview.example.test/',
        },
      });
    }));

    await new VKService().getPreviewSlotUrl('workspace-1', 'slot-1', {});

    expect(requests[0]?.url).toMatch(/\/api\/workspaces\/workspace-1\/execution\/preview-slots\/slot-1\/url$/);
  });

  it('sends DELETE for PreviewServer run config and slot deletes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return jsonResponse({ success: true, data: null });
    }));
    const service = new VKService();

    await service.deletePreviewSlot('workspace-1', 'slot-1');
    await service.deleteRunConfig('workspace-1', 'config-1');

    expect(requests).toContainEqual(expect.objectContaining({
      url: expect.stringMatching(/\/api\/workspaces\/workspace-1\/execution\/preview-slots\/slot-1$/),
      init: expect.objectContaining({ method: 'DELETE' }),
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      url: expect.stringMatching(/\/api\/workspaces\/workspace-1\/execution\/run-configs\/config-1$/),
      init: expect.objectContaining({ method: 'DELETE' }),
    }));
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
