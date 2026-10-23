import { afterEach, describe, expect, it, vi } from 'vitest';
import { VKService } from './vk-service.js';
import { formatRawLogEntry, formatRawLogs } from './vk.js';

const fakeSockets: Array<{
  emit: (type: string, value: unknown) => void;
  terminated: boolean;
}> = [];

class FakeWebSocket {
    private handlers = new Map<string, Array<(value: { data: unknown }) => void>>();
    terminated = false;

    constructor(_url: string | URL) {
      fakeSockets.push(this);
    }

    addEventListener(type: string, handler: (value: { data: unknown }) => void) {
      const handlers = this.handlers.get(type) ?? [];
      handlers.push(handler);
      this.handlers.set(type, handlers);
    }

    emit(type: string, value: unknown) {
      for (const handler of this.handlers.get(type) ?? []) handler({ data: value });
    }

    close() {
      this.terminated = true;
    }
}

describe('VKService Preview URL helpers', () => {
  afterEach(() => {
    fakeSockets.length = 0;
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
          host: 'web-repo-0123456789abcdef--preview.example.test',
          url: 'https://web-repo-0123456789abcdef--preview.example.test/',
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

  it('restarts a stored preview slot by stopping its active linked process first', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/execution/run-configs')) {
        return jsonResponse({ success: true, data: {
          run_configs: [], preview_slots: [], preview_url_parts: [], preview_process_links: [{
            id: 'link-1', workspace_id: 'workspace-1', repo_id: 'repo-1', run_config_id: 'config-1',
            preview_slot_id: 'slot-1', execution_process_id: 'process-1', assigned_port: 4000,
            status_snapshot: 'ready', started_at: '', updated_at: '',
          }],
        } });
      }
      if (url.endsWith('/preview-slots/slot-1/start')) {
        return jsonResponse({ success: true, data: { upstream: 'http://127.0.0.1:4001' } });
      }
      return jsonResponse({ success: true, data: null });
    }));

    await new VKService().restartPreviewSlot('workspace-1', 'slot-1');

    expect(requests.map(request => [request.url, request.init?.method, request.init?.body])).toEqual([
      [expect.stringMatching(/\/workspaces\/workspace-1\/execution\/run-configs$/), undefined, undefined],
      [expect.stringMatching(/\/workspaces\/workspace-1\/execution\/preview-processes\/process-1\/stop$/), 'POST', JSON.stringify({ previewSlotId: 'slot-1' })],
      [expect.stringMatching(/\/workspaces\/workspace-1\/execution\/preview-slots\/slot-1\/start$/), 'POST', undefined],
    ]);
  });

  it('formats human preview logs without exposing backend envelopes', () => {
    expect(formatRawLogEntry({ type: 'STDOUT', content: 'ready\n' })).toBe('ready\n');
    expect(formatRawLogEntry({ type: 'STDERR', content: 'failed' })).toBe('[stderr] failed\n');
  });

  it('formats preview logs as a stable JSON array', () => {
    const logs = [{ type: 'STDOUT' as const, content: 'ready\n' }];
    expect(JSON.parse(formatRawLogs(logs, true))).toEqual(logs);
  });

  it('bounds fetched logs and follows only when requested', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const seen: string[] = [];
    const result = new VKService().fetchRawLogs('process-1', {
      follow: true,
      timeoutMs: 0,
      maxEntries: 2,
      onEntry: entry => seen.push(entry.content),
    });
    const socket = fakeSockets[0]!;
    socket.emit('message', Buffer.from(JSON.stringify({
      JsonPatch: ['one', 'two', 'three'].map(content => ({ value: { type: 'STDOUT', content } })),
      Ready: {},
    })));
    expect(socket.terminated).toBe(false);
    socket.emit('message', Buffer.from(JSON.stringify({
      JsonPatch: [{ value: { type: 'STDERR', content: 'four' } }],
      finished: true,
    })));

    await expect(result).resolves.toEqual([
      { type: 'STDOUT', content: 'three' },
      { type: 'STDERR', content: 'four' },
    ]);
    expect(seen).toEqual(['one', 'two', 'three', 'four']);
    expect(socket.terminated).toBe(true);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
