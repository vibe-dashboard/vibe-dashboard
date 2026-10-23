import { afterEach, describe, expect, it, vi } from 'vitest';
import { VKService } from './vk-service.js';
import { formatRawLogEntry, formatRawLogs, validateAndUpsertExternalPreviewSlot } from './vk.js';

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

  it('validates external preview targets before upserting them', async () => {
    const calls: string[] = [];
    const target = {
      type: 'external_redirect' as const,
      url_template: 'https://{branchSlug}.preview.example.test',
      allowed_host_template: '{branchSlug}.preview.example.test',
      project_slug: null,
    };
    const body = {
      id: null,
      repo_id: 'repo-1',
      run_config_id: null,
      target,
      slot_slug: 'web',
      title: 'Web',
      description: 'Hosted preview',
      enabled: true,
    };
    const client = {
      getRunConfigs: vi.fn(async () => ({
        run_configs: [], preview_url_parts: [], preview_slots: [{
          ...body, id: 'slot-1', created_at: '', updated_at: '',
        }],
      })),
      validatePreviewSlotTarget: vi.fn(async () => {
        calls.push('validate');
        return { valid: true, destination: 'https://feature.preview.example.test', errors: [] };
      }),
      upsertPreviewSlot: vi.fn(async () => {
        calls.push('upsert');
        return { ...body, id: 'slot-1', created_at: '', updated_at: '' };
      }),
    };

    const result = await validateAndUpsertExternalPreviewSlot(client, 'workspace-1', body);

    expect(calls).toEqual(['validate', 'upsert']);
    expect(result.destination).toBe('https://feature.preview.example.test');
    expect(client.validatePreviewSlotTarget).toHaveBeenCalledWith('workspace-1', { repo_id: 'repo-1', target });
    expect(client.upsertPreviewSlot).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ id: 'slot-1' }));
  });

  it('posts external target dry-runs to the workspace validation endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return jsonResponse({ success: true, data: {
        valid: true, destination: 'https://feature.preview.example.test', errors: [],
      } });
    }));
    const body = {
      repo_id: 'repo-1',
      target: {
        type: 'external_redirect' as const,
        url_template: 'https://{branchSlug}.preview.example.test',
        allowed_host_template: '{branchSlug}.preview.example.test',
      },
    };

    await new VKService().validatePreviewSlotTarget('workspace-1', body);

    expect(requests).toEqual([{
      url: expect.stringMatching(/\/workspaces\/workspace-1\/execution\/preview-slots\/validate-target$/),
      init: expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    }]);
  });

  it('does not write an external preview slot when validation fails', async () => {
    const client = {
      getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [], preview_url_parts: [] })),
      validatePreviewSlotTarget: vi.fn(async () => ({ valid: false, errors: ['host mismatch'] })),
      upsertPreviewSlot: vi.fn(),
    };
    const body = {
      id: null,
      repo_id: 'repo-1',
      run_config_id: null,
      target: {
        type: 'external_redirect' as const,
        url_template: 'https://wrong.example.test',
        allowed_host_template: 'allowed.example.test',
        project_slug: null,
      },
      slot_slug: 'web',
      title: 'Web',
      description: null,
      enabled: true,
    };

    await expect(validateAndUpsertExternalPreviewSlot(client, 'workspace-1', body))
      .rejects.toThrow('host mismatch');
    expect(client.upsertPreviewSlot).not.toHaveBeenCalled();
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
