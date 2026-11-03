import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeLocalApiRequest,
  openLocalApiWebSocket,
  setLocalApiTransport,
} from '@vibe/web-core/shared/lib/localApiTransport';
import { VkLocalApiTransport } from './vkLocalApiTransport';

afterEach(() => {
  setLocalApiTransport(null);
  vi.unstubAllGlobals();
});

describe('direct VK WebSocket transport', () => {
  it.each([
    ['https://vk.example.test', 'wss://vk.example.test'],
    ['http://localhost:3007', 'ws://localhost:3007'],
    ['wss://vk.example.test', 'wss://vk.example.test'],
    ['ws://localhost:3007', 'ws://localhost:3007'],
  ])('connects streams to %s and preserves host scope and query parameters', async (origin, expectedOrigin) => {
    const socket = {} as WebSocket;
    const WebSocketConstructor = vi.fn(function () { return socket; });
    vi.stubGlobal('WebSocket', WebSocketConstructor);
    vi.stubGlobal('window', { location: { href: 'https://preview.example.test/' } });
    setLocalApiTransport(new VkLocalApiTransport(origin));

    expect(await openLocalApiWebSocket(
      '/api/execution-processes/stream/session/ws?session_id=abc&show_soft_deleted=true',
      { hostScope: 'explicit', hostId: 'host-1' },
    )).toBe(socket);
    expect(WebSocketConstructor).toHaveBeenCalledWith(
      `${expectedOrigin}/api/host/host-1/execution-processes/stream/session/ws?session_id=abc&show_soft_deleted=true`,
    );
  });

  it('rebases absolute stream URLs built from the preview origin', async () => {
    const WebSocketConstructor = vi.fn(function () {});
    vi.stubGlobal('WebSocket', WebSocketConstructor);
    vi.stubGlobal('window', { location: { href: 'https://preview.example.test/' } });
    setLocalApiTransport(new VkLocalApiTransport('https://vk.example.test'));

    await openLocalApiWebSocket(
      'wss://preview.example.test/api/workspaces/123/git/diff/ws?stats_only=true',
      { hostScope: 'none' },
    );

    expect(WebSocketConstructor).toHaveBeenCalledWith(
      'wss://vk.example.test/api/workspaces/123/git/diff/ws?stats_only=true',
    );
  });

  it('keeps HTTP requests on their existing route with their body and credentials', async () => {
    const response = new Response('{}');
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    setLocalApiTransport(new VkLocalApiTransport('https://vk.example.test'));

    expect(await makeLocalApiRequest('/api/scratch/test', {
      hostScope: 'none',
      method: 'PUT',
      body: '{"draft":"hello"}',
      credentials: 'include',
    })).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith('/api/scratch/test', {
      method: 'PUT',
      body: '{"draft":"hello"}',
      credentials: 'include',
    });
  });

  it('resolves relative stream paths from the API root on nested dashboard routes', async () => {
    const WebSocketConstructor = vi.fn(function () {});
    vi.stubGlobal('WebSocket', WebSocketConstructor);
    vi.stubGlobal('window', {
      location: { href: 'https://preview.example.test/dashboard/workspaces/123' },
    });
    setLocalApiTransport(new VkLocalApiTransport('https://vk.example.test'));

    await openLocalApiWebSocket('api/approvals/stream/ws', { hostScope: 'none' });

    expect(WebSocketConstructor).toHaveBeenCalledWith(
      'wss://vk.example.test/api/approvals/stream/ws',
    );
  });
});
