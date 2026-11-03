import {
  setLocalApiTransport,
  type LocalApiRequestOptions,
  type LocalApiTransport,
} from '@vibe/web-core/shared/lib/localApiTransport';

export class VkLocalApiTransport implements LocalApiTransport {
  private readonly webSocketOrigin: string;

  constructor(origin: string) {
    const url = new URL(origin);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      throw new Error('VK WebSocket origin must use HTTP, HTTPS, WS, or WSS');
    }
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:'
      ? 'wss:'
      : 'ws:';
    this.webSocketOrigin = url.origin;
  }

  request(pathOrUrl: string, init: LocalApiRequestOptions = {}): Promise<Response> {
    const {
      hostScope: _hostScope,
      hostId: _hostId,
      relayHostId: _relayHostId,
      ...requestInit
    } = init;
    return fetch(pathOrUrl, requestInit);
  }

  openWebSocket(pathOrUrl: string): WebSocket {
    const endpoint = new URL(pathOrUrl, new URL('/', window.location.href));
    return new WebSocket(
      `${this.webSocketOrigin}${endpoint.pathname}${endpoint.search}`,
    );
  }
}

const origin = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env?.VITE_VK_WEBSOCKET_ORIGIN;

if (origin) {
  setLocalApiTransport(new VkLocalApiTransport(origin));
}
