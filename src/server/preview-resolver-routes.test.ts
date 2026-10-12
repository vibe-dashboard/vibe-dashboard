import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPreviewResolverRoutes } from './preview-resolver-routes';
import type { PreviewResolveRequest } from './vk-client';

describe('registerPreviewResolverRoutes', () => {
  const originalSiteOrigin = process.env.SITE_ORIGIN;
  const routeClient = {
    resolvePreview: vi.fn(),
    getRunConfigs: vi.fn(),
    upsertRunConfig: vi.fn(),
    upsertPreviewSlot: vi.fn(),
    startRunConfig: vi.fn(),
    startPreviewSlot: vi.fn(),
    getPreviewSlotUrl: vi.fn(),
  };

  afterEach(() => {
    if (originalSiteOrigin === undefined) {
      delete process.env.SITE_ORIGIN;
    } else {
      process.env.SITE_ORIGIN = originalSiteOrigin;
    }
  });

  it('proxies named preview resolve payloads to VK', async () => {
    const resolvePreview = vi.fn(async () => ({
      status: 'ready' as const,
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
    }));
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const payload: PreviewResolveRequest = {
      host: '0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev',
      workspaceToken: '0123456789abcdef',
      repoSlug: 'vibekanban',
      slotSlug: 'web',
      customerSlug: 'mickmister',
      ensure: true,
      method: 'GET',
      path: '/',
    };
    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
    });
    expect(resolvePreview).toHaveBeenCalledWith(payload);
  });

  it('rejects impossible tokens locally without calling VK', async () => {
    const resolvePreview = vi.fn();
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify({
        host: '0123456789abcdeg-vibekanban-web-mickmister.vibedashboard.dev',
        workspaceToken: '0123456789abcdeg',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        ensure: true,
        method: 'GET',
        path: '/',
      }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'not_found',
      message: 'Invalid preview workspace token',
    });
    expect(resolvePreview).not.toHaveBeenCalled();
  });

  it('proxies run config declaration and canonical URL generation routes', async () => {
    delete process.env.SITE_ORIGIN;
    const client = {
      ...routeClient,
      getRunConfigs: vi.fn(async () => ({
        run_configs: [],
        preview_slots: [],
        preview_url_parts: [],
      })),
      upsertRunConfig: vi.fn(async (workspaceId, body) => ({ id: 'rc1', ...body })),
      upsertPreviewSlot: vi.fn(async (workspaceId, body) => ({ id: 'slot1', ...body })),
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev',
        url: 'https://0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    await app.request('/internal/preview/workspaces/ws1/run-configs');
    await app.request('/internal/preview/workspaces/ws1/run-configs', {
      method: 'POST',
      body: JSON.stringify({
        repo_id: 'repo1',
        slug: 'web',
        name: 'Web',
        command: 'npm run dev',
        kind: 'long_running',
        enabled: true,
      }),
    });
    await app.request('/internal/preview/workspaces/ws1/preview-slots', {
      method: 'POST',
      body: JSON.stringify({
        repo_id: 'repo1',
        run_config_id: 'rc1',
        slot_slug: 'web',
        title: 'Web',
        enabled: true,
      }),
    });
    const urlResponse = await app.request(
      '/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister',
    );

    expect(client.getRunConfigs).toHaveBeenCalledWith('ws1');
    expect(client.upsertRunConfig).toHaveBeenCalledWith('ws1', expect.objectContaining({ slug: 'web' }));
    expect(client.upsertPreviewSlot).toHaveBeenCalledWith('ws1', expect.objectContaining({ slot_slug: 'web' }));
    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: undefined,
      urlScheme: undefined,
    });
    await expect(urlResponse.json()).resolves.toMatchObject({
      url: 'https://0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev/',
    });
  });

  it('uses SITE_ORIGIN host as canonical URL fallback', async () => {
    process.env.SITE_ORIGIN = 'https://customer.example/app';
    const client = {
      ...routeClient,
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister.customer.example',
        url: 'https://0123456789abcdef-vibekanban-web-mickmister.customer.example/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request(
      '/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister',
    );

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: 'customer.example',
      urlScheme: 'https',
    });
    await expect(response.json()).resolves.toMatchObject({
      url: 'https://0123456789abcdef-vibekanban-web-mickmister.customer.example/',
    });
  });

  it('ignores baseDomain query overrides in favor of SITE_ORIGIN', async () => {
    process.env.SITE_ORIGIN = 'https://customer.example';
    const client = {
      ...routeClient,
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister.customer.example',
        url: 'https://0123456789abcdef-vibekanban-web-mickmister.customer.example/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    const response = await app.request(
      '/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister&baseDomain=override.example',
    );

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: 'customer.example',
      urlScheme: 'https',
    });
    await expect(response.json()).resolves.toMatchObject({
      url: 'https://0123456789abcdef-vibekanban-web-mickmister.customer.example/',
    });
  });

  it('uses HTTP SITE_ORIGIN scheme and port for canonical URL fallback', async () => {
    process.env.SITE_ORIGIN = 'http://localhost:3001';
    const client = {
      ...routeClient,
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister.localhost:3001',
        url: 'http://0123456789abcdef-vibekanban-web-mickmister.localhost:3001/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    await app.request('/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister');

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: 'localhost:3001',
      urlScheme: 'http',
    });
  });

  it('ignores non-HTTP SITE_ORIGIN for canonical URL fallback', async () => {
    process.env.SITE_ORIGIN = 'ftp://customer.example';
    const client = {
      ...routeClient,
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister',
        url: 'https://0123456789abcdef-vibekanban-web-mickmister/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    await app.request('/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister');

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: undefined,
      urlScheme: undefined,
    });
  });

  it('ignores malformed SITE_ORIGIN for canonical URL fallback', async () => {
    process.env.SITE_ORIGIN = 'not a url';
    const client = {
      ...routeClient,
      getPreviewSlotUrl: vi.fn(async () => ({
        previewSlotId: 'slot1',
        workspaceToken: '0123456789abcdef',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        host: '0123456789abcdef-vibekanban-web-mickmister',
        url: 'https://0123456789abcdef-vibekanban-web-mickmister/',
      })),
    };
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: client });

    await app.request('/internal/preview/workspaces/ws1/preview-slots/slot1/url?customerSlug=mickmister');

    expect(client.getPreviewSlotUrl).toHaveBeenCalledWith('ws1', 'slot1', {
      customerSlug: 'mickmister',
      baseDomain: undefined,
      urlScheme: undefined,
    });
  });
});
