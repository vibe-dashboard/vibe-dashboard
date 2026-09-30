import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalApiTransport } from './localApiTransport';
import { loadFiniteJsonPatchEntries } from './loadFiniteJsonPatchEntries';

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

describe('loadFiniteJsonPatchEntries', () => {
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

  it('rejects when the finite stream never finishes', async () => {
    const ws = new FakeWebSocket();

    setLocalApiTransport({
      request: vi.fn(),
      openWebSocket: () => ws as unknown as WebSocket,
    });

    const pending = loadFiniteJsonPatchEntries('/test', {
      timeoutMs: 1000,
      replaySafeAppendOnly: true,
    });
    const rejection = expect(pending).rejects.toThrow(
      'Finite stream timed out'
    );

    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
  });
});
