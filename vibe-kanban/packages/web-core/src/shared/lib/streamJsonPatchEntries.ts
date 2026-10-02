// streamJsonPatchEntries.ts - WebSocket JSON patch streaming utility
import { produce } from 'immer';
import type { Operation } from 'rfc6902';
import { applyUpsertPatch } from '@/shared/lib/jsonPatch';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';
import {
  getWsRetryDecision,
  markWsStreamHealthy,
} from '@/shared/lib/wsStreamRetryPolicy';

type PatchContainer<E = unknown> = { entries: E[] };

export interface StreamOptions<E = unknown> {
  initial?: PatchContainer<E>;
  /** called after each successful patch application */
  onEntries?: (entries: E[]) => void;
  onConnect?: () => void;
  onError?: (err: unknown) => void;
  /** called once when a "finished" event is received */
  onFinished?: (entries: E[]) => void;
  /** replay-safe streams can retry after unexpected closes */
  retryOnUnexpectedClose?: boolean;
  /** apply replay deduplication for append-only history replays */
  replaySafeAppendOnly?: boolean;
  maxRetries?: number;
  retryDelayMs?: (attempt: number) => number;
}

interface StreamController<E = unknown> {
  /** Current entries array (immutable snapshot) */
  getEntries(): E[];
  /** Full { entries } snapshot */
  getSnapshot(): PatchContainer<E>;
  /** Best-effort connection state */
  isConnected(): boolean;
  /** Subscribe to updates; returns an unsubscribe function */
  onChange(cb: (entries: E[]) => void): () => void;
  /** Close the stream */
  close(): void;
}

/**
 * Connect to a WebSocket endpoint that emits JSON messages containing:
 *   {"JsonPatch": [{"op": "add", "path": "/entries/0", "value": {...}}, ...]}
 *   {"Finished": ""}
 *
 * Maintains an in-memory { entries: [] } snapshot and returns a controller.
 *
 * Messages are batched per animation frame and applied using immer for
 * structural sharing, avoiding a full deep clone on every message.
 */
export function streamJsonPatchEntries<E = unknown>(
  url: string,
  opts: StreamOptions<E> = {}
): StreamController<E> {
  let connected = false;
  let closed = false;
  let ws: WebSocket | null = null;
  let snapshot: PatchContainer<E> = structuredClone(
    opts.initial ?? ({ entries: [] } as PatchContainer<E>)
  );
  let finished = false;
  const maxRetries = opts.maxRetries ?? 6;
  let retryState = {
    retryAttempts: 0,
    hasReceivedPayload: false,
  };
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const subscribers = new Set<(entries: E[]) => void>();
  if (opts.onEntries) subscribers.add(opts.onEntries);

  // --- rAF batching state ---
  let pendingOps: Operation[] = [];
  let rafId: number | null = null;

  const notify = () => {
    for (const cb of subscribers) {
      try {
        cb(snapshot.entries);
      } catch {
        /* swallow subscriber errors */
      }
    }
  };

  const flush = () => {
    rafId = null;
    if (pendingOps.length === 0) return;

    const ops = dedupeOps(pendingOps);
    pendingOps = [];

    const filteredOps = opts.replaySafeAppendOnly
      ? filterReplayOps(snapshot.entries, ops)
      : ops;
    if (filteredOps.length === 0) return;

    snapshot = produce(snapshot, (draft) => {
      applyUpsertPatch(draft, filteredOps);
    });
    notify();
  };

  const handleMessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);

      // Handle JsonPatch messages — accumulate ops for next rAF flush
      if (msg.JsonPatch) {
        retryState = markWsStreamHealthy(retryState);
        const raw = msg.JsonPatch as Operation[];
        pendingOps.push(...raw);
        if (rafId === null) {
          rafId = requestAnimationFrame(flush);
        }
      }

      // Handle Finished messages — flush synchronously before closing
      if (msg.finished !== undefined) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        flush();
        retryState = markWsStreamHealthy(retryState);
        finished = true;
        opts.onFinished?.(snapshot.entries);
        ws?.close();
      }
    } catch (err) {
      opts.onError?.(err);
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    clearReconnectTimer();

    void (async () => {
      try {
        const opened = await openLocalApiWebSocket(url);

        if (closed) {
          opened.close();
          return;
        }

        ws = opened;
        const handleOpen = () => {
          connected = true;
          opts.onConnect?.();
        };

        ws.addEventListener('open', handleOpen);

        ws.addEventListener('message', handleMessage);

        ws.addEventListener('error', () => {
          connected = false;
        });

        ws.addEventListener('close', () => {
          connected = false;
          ws = null;
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }

          if (closed || finished) {
            return;
          }

          const { attempt, shouldRetry } = getWsRetryDecision(
            retryState,
            maxRetries
          );

          if (opts.retryOnUnexpectedClose === true && shouldRetry) {
            retryState = {
              ...retryState,
              retryAttempts: attempt,
            };
            const delay =
              opts.retryDelayMs?.(attempt) ??
              Math.min(1500, 250 * 2 ** (attempt - 1));
            reconnectTimer = setTimeout(() => connect(), delay);
            return;
          }

          opts.onError?.(new Error('WebSocket stream closed unexpectedly'));
        });

        if (ws.readyState === WebSocket.OPEN) {
          handleOpen();
        }
      } catch (error) {
        if (!closed) {
          const { attempt, shouldRetry } = getWsRetryDecision(
            retryState,
            maxRetries
          );

          if (opts.retryOnUnexpectedClose === true && shouldRetry) {
            retryState = {
              ...retryState,
              retryAttempts: attempt,
            };
            const delay =
              opts.retryDelayMs?.(attempt) ??
              Math.min(1500, 250 * 2 ** (attempt - 1));
            reconnectTimer = setTimeout(() => connect(), delay);
            return;
          }

          opts.onError?.(error);
        }
      }
    })();
  };

  connect();

  return {
    getEntries(): E[] {
      return snapshot.entries;
    },
    getSnapshot(): PatchContainer<E> {
      return snapshot;
    },
    isConnected(): boolean {
      return connected;
    },
    onChange(cb: (entries: E[]) => void): () => void {
      subscribers.add(cb);
      // push current state immediately
      cb(snapshot.entries);
      return () => subscribers.delete(cb);
    },
    close(): void {
      closed = true;
      clearReconnectTimer();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      ws?.close();
      subscribers.clear();
      connected = false;
    },
  };
}

/**
 * Dedupe multiple ops that touch the same path within a batch.
 * Last write for a path wins, while preserving the overall left-to-right
 * order of the *kept* final operations.
 *
 * Example:
 *   add /entries/4, replace /entries/4  -> keep only the final replace
 */
function dedupeOps(ops: Operation[]): Operation[] {
  const lastIndexByPath = new Map<string, number>();
  ops.forEach((op, i) => lastIndexByPath.set(op.path, i));

  // Keep only the last op for each path, in ascending order of their final index
  const keptIndices = [...lastIndexByPath.values()].sort((a, b) => a - b);
  return keptIndices.map((i) => ops[i]!);
}

function filterReplayOps<E>(
  currentEntries: E[],
  ops: Operation[]
): Operation[] {
  return ops.flatMap((op) => {
    const entryIndex = getEntryIndex(op.path);
    if (entryIndex === null || op.op === 'remove') {
      return [op];
    }

    const nextValue = 'value' in op ? (op.value as E | undefined) : undefined;
    if (nextValue === undefined) {
      return [op];
    }

    const hasCurrentValue = entryIndex < currentEntries.length;
    if (!hasCurrentValue) {
      return [op];
    }

    const currentValue = currentEntries[entryIndex];
    if (areEntryValuesEqual(currentValue, nextValue)) {
      return [];
    }

    if (op.op === 'add') {
      return [{ ...op, op: 'replace' as const }];
    }

    return [op];
  });
}

function getEntryIndex(path: string): number | null {
  const match = /^\/entries\/(\d+)$/.exec(path);
  if (!match) return null;

  const entryIndex = Number.parseInt(match[1]!, 10);
  return Number.isNaN(entryIndex) ? null : entryIndex;
}

function areEntryValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
