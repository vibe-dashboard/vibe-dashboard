import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorDiscoveredOptions } from '../../vibe-kanban/shared/types';
import { loadExecutorDiscovery } from '../../vibe-kanban/packages/web-core/src/shared/lib/loadExecutorDiscovery';

const transport = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/shared/lib/localApiTransport', () => ({
  openLocalApiWebSocket: transport.open,
}));

class Socket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

function options(loading = false): ExecutorDiscoveredOptions {
  return {
    model_selector: {
      providers: [],
      models: [],
      model_order: [],
      default_model: null,
      agents: [],
      permissions: [],
    },
    slash_commands: [],
    loading_models: loading,
    loading_agents: loading,
    loading_slash_commands: loading,
    error: null,
  };
}

let socket: Socket;
beforeEach(() => {
  socket = new Socket();
  transport.open.mockReset().mockResolvedValue(socket);
});

describe('executor discovery transport', () => {
  it('publishes partial results and resolves/closes when discovery is complete', async () => {
    const update = vi.fn();
    const result = loadExecutorDiscovery(
      '/options',
      'host-1',
      new AbortController().signal,
      update,
    );
    await Promise.resolve();
    socket.message({
      JsonPatch: [{ op: 'replace', path: '/options', value: options(true) }],
    });
    expect(update).toHaveBeenLastCalledWith(options(true));
    socket.message({
      JsonPatch: [{ op: 'replace', path: '/options', value: options() }],
    });
    await expect(result).resolves.toEqual(options());
    expect(socket.close).toHaveBeenCalledOnce();
    expect(transport.open).toHaveBeenCalledWith('/options', {
      hostScope: 'explicit',
      hostId: 'host-1',
    });
  });

  it('cancels immediately and prevents late messages from updating any cache', async () => {
    const controller = new AbortController();
    const update = vi.fn();
    const result = loadExecutorDiscovery(
      '/options',
      null,
      controller.signal,
      update,
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    const late = socket.onmessage;
    controller.abort();
    late?.({
      data: JSON.stringify({
        JsonPatch: [{ op: 'replace', path: '/options', value: options() }],
      }),
    } as MessageEvent);
    await rejected;
    expect(update).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('rejects backend errors rather than caching them as successful empty discovery', async () => {
    const update = vi.fn();
    const result = loadExecutorDiscovery(
      '/options',
      null,
      new AbortController().signal,
      update,
    );
    const rejected = expect(result).rejects.toThrow('Provider failed');
    await Promise.resolve();
    socket.message({
      JsonPatch: [
        {
          op: 'replace',
          path: '/options',
          value: { ...options(), error: 'Provider failed' },
        },
      ],
    });
    await rejected;
    expect(update).not.toHaveBeenCalled();
  });

  it('supports executors with no discovery and surfaces premature transport closes', async () => {
    const result = loadExecutorDiscovery(
      '/options',
      null,
      new AbortController().signal,
      vi.fn(),
    );
    await Promise.resolve();
    socket.message({ Ready: true });
    socket.message({ finished: true });
    await expect(result).resolves.toEqual(options());
    const failed = loadExecutorDiscovery(
      '/options',
      null,
      new AbortController().signal,
      vi.fn(),
    );
    const rejected = expect(failed).rejects.toThrow('closed before completing');
    await Promise.resolve();
    socket.onclose?.();
    await rejected;
  });
});
