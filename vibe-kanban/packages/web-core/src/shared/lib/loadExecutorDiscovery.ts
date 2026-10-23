import { produce } from 'immer';
import type { Operation } from 'rfc6902';
import type { ExecutorDiscoveredOptions } from 'shared/types';
import { applyUpsertPatch } from '@/shared/lib/jsonPatch';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';

export function loadExecutorDiscovery(
  endpoint: string,
  hostId: string | null,
  signal: AbortSignal,
  onOptions: (options: ExecutorDiscoveredOptions) => void
): Promise<ExecutorDiscoveredOptions> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined;
    let settled = false;
    let ready = false;
    let snapshot: { options: ExecutorDiscoveredOptions | null } = {
      options: null,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (socket) {
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled) return;
      const options =
        snapshot.options ??
        (ready
          ? {
              model_selector: {
                providers: [],
                models: [],
                model_order: [],
                default_model: null,
                agents: [],
                permissions: [],
              },
              slash_commands: [],
              loading_models: false,
              loading_agents: false,
              loading_slash_commands: false,
              error: null,
            }
          : null);
      if (!options) {
        fail(new Error('Executor discovery returned no options'));
        return;
      }
      if (options.error) {
        fail(new Error(options.error));
        return;
      }
      settled = true;
      cleanup();
      resolve({
        ...options,
        loading_models: false,
        loading_agents: false,
        loading_slash_commands: false,
      });
    };
    const abort = () =>
      fail(new DOMException('Executor discovery cancelled', 'AbortError'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(
      () => fail(new Error('Executor discovery timed out')),
      30_000
    );

    void openLocalApiWebSocket(endpoint, { hostScope: 'explicit', hostId })
      .then((opened) => {
        if (settled) {
          opened.close();
          return;
        }
        socket = opened;
        socket.onmessage = (event) => {
          if (settled) return;
          try {
            const message = JSON.parse(event.data) as {
              JsonPatch?: Operation[];
              finished?: boolean;
              Ready?: boolean;
            };
            if (message.Ready) ready = true;
            if (message.JsonPatch) {
              snapshot = produce(snapshot, (draft) => {
                applyUpsertPatch(draft, message.JsonPatch!);
              });
              const options = snapshot.options;
              if (options?.error) {
                fail(new Error(options.error));
                return;
              }
              if (options) {
                onOptions(options);
                if (
                  !options.loading_models &&
                  !options.loading_agents &&
                  !options.loading_slash_commands
                )
                  finish();
              }
            }
            if (message.finished) finish();
          } catch (error) {
            fail(error);
          }
        };
        socket.onerror = () =>
          fail(new Error('Executor discovery connection failed'));
        socket.onclose = () =>
          fail(new Error('Executor discovery closed before completing'));
      })
      .catch(fail);
  });
}
