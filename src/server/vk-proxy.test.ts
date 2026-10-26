import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerVkProxyRoutes } from './vk-proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createApp() {
  const app = new Hono();
  registerVkProxyRoutes(app);
  return app;
}

describe('VK HTTP proxy', () => {
  it.each(['/vk-api', '/api'])('forwards every HTTP method through %s', async (prefix) => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local/api/');
    const requests: Request[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requests.push(input as Request);
      return new Response(null, { status: 204 });
    });

    const app = createApp();
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await app.request(`${prefix}/sessions/id?include=messages&include=logs`, {
        method,
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        ...(!['GET', 'HEAD'].includes(method) ? { body: '{"message":"hello"}' } : {}),
      });
      expect(response.status).toBe(204);
      const request = requests.at(-1)!;
      expect(request.url).toBe('http://vk.local/api/sessions/id?include=messages&include=logs');
      expect(request.method).toBe(method);
      expect(request.headers.get('authorization')).toBe('Bearer test');
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(request.headers.get('host')).toBe('vk.local');
      expect(await request.text()).toBe(['GET', 'HEAD'].includes(method) ? '' : '{"message":"hello"}');
    }
  });

  it('preserves binary multipart uploads', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local');
    let upstream: Request | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      upstream = input as Request;
      return Response.json({ ok: true });
    });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0, 128, 255])]), 'upload.bin');
    await createApp().request('/api/attachments/upload', { method: 'POST', body: form });
    expect(upstream!.url).toBe('http://vk.local/api/attachments/upload');
    const uploaded = (await upstream!.formData()).get('file') as File;
    expect(uploaded.name).toBe('upload.bin');
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
  });

  it('uses an allowed upstream origin for mutation requests', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local');
    vi.stubEnv('VITE_VK_PROXY_ORIGIN', '');
    vi.stubEnv('VK_ALLOWED_ORIGINS', 'https://*.example.com, https://dashboard.example.com');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await createApp().request('/vk-api/sessions', {
      method: 'POST',
      headers: { Origin: 'https://preview.example.com' },
    });
    expect((fetchMock.mock.calls[0]![0] as Request).headers.get('origin')).toBe('https://dashboard.example.com');
  });

  it('preserves upstream errors and removes stale encoded-body headers', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"conflict"}', {
      status: 409,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': '999',
        'Transfer-Encoding': 'chunked',
      },
    }));
    const response = await createApp().request('/vk-api/sessions');
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/json');
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding']) {
      expect(response.headers.has(name)).toBe(false);
    }
    expect(await response.json()).toEqual({ error: 'conflict' });
  });

  it('returns redirects to the caller instead of following them', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: '/api/auth/login' },
    }));
    const response = await createApp().request('/api/auth/status');
    expect((fetchMock.mock.calls[0]![0] as Request).redirect).toBe('manual');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/api/auth/login');
  });
});
