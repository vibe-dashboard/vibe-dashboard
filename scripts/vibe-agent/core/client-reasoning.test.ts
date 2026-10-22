import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VibeClient } from './client.js';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  close = vi.fn();
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

const client = new VibeClient('http://test-vk:3007');
const profile = { executor: 'OPENCODE' as const, variant: 'CUSTOM' };
const session = { id: 'recipient-session', workspace_id: 'workspace' };
const model = { id: 'reasoner', provider_id: 'openai', reasoning_options: [{ id: 'medium' }] };
const snapshot = (loading = true) => ({ JsonPatch: [{ op: 'replace', path: '/options', value: {
  loading_models: loading, error: null,
  model_selector: { models: [], default_model: null },
} }] });

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true, data: { model_id: null },
  }))));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VK reasoning capability discovery', () => {
  it('waits past ready/models_loaded for the final default model and closes the socket', async () => {
    const result = client.getReasoningCapabilities(profile, session);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://test-vk:3007/api/agents/discovered-options/ws?executor=OPENCODE&workspace_id=workspace&session_id=recipient-session');
    expect(fetch).toHaveBeenCalledWith('http://test-vk:3007/api/agents/preset-options?executor=OPENCODE&variant=CUSTOM', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    socket.message(snapshot());
    socket.message({ Ready: true }); // Unrecognized messages cannot mark discovery complete.
    socket.message({ ready: true });
    socket.message({ JsonPatch: [
      { op: 'replace', path: '/options/model_selector/models', value: [model] },
      { op: 'replace', path: '/options/loading_models', value: false },
    ] });
    expect(socket.close).not.toHaveBeenCalled();
    socket.message({ JsonPatch: [{ op: 'replace', path: '/options/model_selector/default_model', value: 'openai/reasoner' }] });
    socket.message({ finished: true });
    await expect(result).resolves.toEqual({ model_id: null, default_model: 'openai/reasoner', models: [model] });
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected preset model instead of substituting the discovered default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { model_id: 'openai/reasoner' } }))));
    const result = client.getReasoningCapabilities(profile, session);
    const socket = FakeWebSocket.instances[0];
    socket.message({ JsonPatch: [{ op: 'replace', path: '/options', value: {
      loading_models: false, error: null,
      model_selector: { models: [model], default_model: 'other/model' },
    } }] });
    socket.message({ finished: true });
    await expect(result).resolves.toMatchObject({ model_id: 'openai/reasoner', default_model: 'other/model' });
  });

  it('times out and closes even if the stream never finishes', async () => {
    vi.useFakeTimers();
    const result = client.getReasoningCapabilities(profile, session, 50);
    const rejected = expect(result).rejects.toThrow('timed out');
    FakeWebSocket.instances[0].message(snapshot());
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'close'])('rejects %s before completion', async event => {
    const result = client.getReasoningCapabilities(profile, session);
    FakeWebSocket.instances[0].dispatchEvent(new Event(event));
    await expect(result).rejects.toThrow(/discovery/);
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('rejects a finished but incomplete stream', async () => {
    const result = client.getReasoningCapabilities(profile, session);
    FakeWebSocket.instances[0].message(snapshot());
    FakeWebSocket.instances[0].message({ finished: true });
    await expect(result).rejects.toThrow('incomplete');
  });

  it('rejects discovery error snapshots', async () => {
    const result = client.getReasoningCapabilities(profile, session);
    const socket = FakeWebSocket.instances[0];
    socket.message(snapshot(false));
    socket.message({ JsonPatch: [{ op: 'replace', path: '/options/error', value: 'provider unavailable' }] });
    socket.message({ finished: true });
    await expect(result).rejects.toThrow('incomplete');
  });

  it('rejects malformed frames and cleans up', async () => {
    const result = client.getReasoningCapabilities(profile, session);
    FakeWebSocket.instances[0].dispatchEvent(new MessageEvent('message', { data: '{invalid' }));
    await expect(result).rejects.toThrow();
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
