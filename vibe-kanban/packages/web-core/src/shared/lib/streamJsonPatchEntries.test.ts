import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalApiTransport } from './localApiTransport';
import { streamJsonPatchEntries } from './streamJsonPatchEntries';

type Listener = (event?: any) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close() {
    this.emit('close', { code: 1000, wasClean: true });
  }

  emit(type: string, event?: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  emitMessage(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) });
  }
}

describe('streamJsonPatchEntries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return globalThis.setTimeout(() => cb(0), 0);
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    setLocalApiTransport(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('surfaces an unexpected close to callers', async () => {
    const ws = new FakeWebSocket();
    const onError = vi.fn();

    setLocalApiTransport({
      request: vi.fn(),
      openWebSocket: () => ws as unknown as WebSocket,
    });

    streamJsonPatchEntries('/test', { onError });
    await vi.runAllTimersAsync();

    ws.emit('close', { code: 1006, wasClean: false });

    expect(onError).toHaveBeenCalled();
  });

  it('retries replay-safe streams without clearing identical replayed entries', async () => {
    const first = new FakeWebSocket();
    const second = new FakeWebSocket();
    const sockets = [first, second];
    const onEntries = vi.fn();

    setLocalApiTransport({
      request: vi.fn(),
      openWebSocket: () => sockets.shift()! as unknown as WebSocket,
    });

    const controller = streamJsonPatchEntries('/test', {
      onEntries,
      replaySafeAppendOnly: true,
      retryOnUnexpectedClose: true,
    });

    await vi.runAllTimersAsync();

    first.emitMessage({
      JsonPatch: [{ op: 'add', path: '/entries/0', value: 'first' }],
    });
    await vi.runAllTimersAsync();
    expect(controller.getEntries()).toEqual(['first']);

    first.emit('close', { code: 1006, wasClean: false });
    await vi.runAllTimersAsync();

    second.emitMessage({
      JsonPatch: [{ op: 'add', path: '/entries/0', value: 'first' }],
    });
    await vi.runAllTimersAsync();

    expect(controller.getEntries()).toEqual(['first']);

    second.emitMessage({
      JsonPatch: [{ op: 'add', path: '/entries/1', value: 'second' }],
    });
    await vi.runAllTimersAsync();

    expect(controller.getEntries()).toEqual(['first', 'second']);
    expect(onEntries).toHaveBeenLastCalledWith(['first', 'second']);
  });

  it('resets retry budget after a healthy reconnect', async () => {
    const sockets = Array.from({ length: 9 }, () => new FakeWebSocket());
    const availableSockets = [...sockets];
    const onError = vi.fn();

    setLocalApiTransport({
      request: vi.fn(),
      openWebSocket: () => availableSockets.shift()! as unknown as WebSocket,
    });

    const controller = streamJsonPatchEntries('/test', {
      onError,
      retryOnUnexpectedClose: true,
      replaySafeAppendOnly: true,
    });

    await vi.runAllTimersAsync();

    sockets[0]!.emit('close', { code: 1006, wasClean: false });
    await vi.runAllTimersAsync();
    sockets[1]!.emit('close', { code: 1006, wasClean: false });
    await vi.runAllTimersAsync();

    sockets[2]!.emitMessage({
      JsonPatch: [{ op: 'add', path: '/entries/0', value: 'healthy' }],
    });
    await vi.runAllTimersAsync();
    expect(controller.getEntries()).toEqual(['healthy']);

    for (const socket of sockets.slice(2, 8)) {
      socket.emit('close', { code: 1006, wasClean: false });
      await vi.runAllTimersAsync();
    }

    expect(onError).not.toHaveBeenCalled();
  });

  it('stops retrying after repeated closes before any payload arrives', async () => {
    const sockets = Array.from({ length: 7 }, () => new FakeWebSocket());
    const availableSockets = [...sockets];
    const onError = vi.fn();

    setLocalApiTransport({
      request: vi.fn(),
      openWebSocket: () => availableSockets.shift()! as unknown as WebSocket,
    });

    streamJsonPatchEntries('/test', {
      onError,
      retryOnUnexpectedClose: true,
    });
    await vi.runAllTimersAsync();

    for (const socket of sockets) {
      socket.emit('close', { code: 1006, wasClean: false });
      await vi.runAllTimersAsync();
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'WebSocket stream closed unexpectedly',
      })
    );
  });
});
