import type { Hono } from 'hono';
import { proxy } from 'hono/proxy';
import { resolveVibeApiBaseUrl } from './vk-client';

export function registerVkProxyRoutes(hono: Hono): void {
  for (const prefix of ['/vk-api', '/api']) {
    hono.all(`${prefix}/*`, async (c) => {
      const requestUrl = new URL(c.req.url);
      const baseUrl = resolveVibeApiBaseUrl();
      const target = `${baseUrl}${requestUrl.pathname.slice(prefix.length)}${requestUrl.search}`;
      const headers = new Headers(c.req.raw.headers);
      headers.set('host', new URL(baseUrl).host);
      headers.set('origin',
        process.env.VITE_VK_PROXY_ORIGIN ||
        process.env.VK_ALLOWED_ORIGINS?.split(',')
          .map((origin) => origin.trim())
          .find((origin) => origin && !origin.includes('*')) ||
        new URL(baseUrl).origin,
      );

      return proxy(target, {
        raw: new Request(c.req.raw, { headers }),
        strictConnectionProcessing: true,
        redirect: 'manual',
      });
    });
  }
}
