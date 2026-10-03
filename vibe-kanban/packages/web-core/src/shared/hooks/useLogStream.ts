import { useEffect, useState, useRef } from 'react';
import type { PatchType } from 'shared/types';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';

type LogEntry = Extract<PatchType, { type: 'STDOUT' } | { type: 'STDERR' }>;
type LogPatch = { path?: string; value?: PatchType };

interface UseLogStreamResult {
  logs: LogEntry[];
  error: string | null;
}

export const useLogStream = (processId: string): UseLogStreamResult => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logsRef = useRef<LogEntry[]>([]);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIntentionallyClosed = useRef<boolean>(false);
  // Prevent reconnection after the server signals the stream is done
  const finishedRef = useRef<boolean>(false);
  // Track current processId to prevent stale WebSocket messages from contaminating logs
  const currentProcessIdRef = useRef<string>(processId);

  useEffect(() => {
    if (!processId) {
      return;
    }

    let cancelled = false;

    // Update the ref to track the current processId
    currentProcessIdRef.current = processId;

    // Clear logs when process changes
    setLogs([]);
    logsRef.current = [];
    setError(null);
    finishedRef.current = false;

    const open = () => {
      // Don't reconnect if the stream already signalled finished
      if (finishedRef.current) {
        return;
      }

      // Capture processId at the time of opening the WebSocket
      const capturedProcessId = processId;
      void (async () => {
        try {
          const ws = await openLocalApiWebSocket(
            `/api/execution-processes/${processId}/raw-logs/ws`
          );

          if (cancelled || currentProcessIdRef.current !== capturedProcessId) {
            ws.close();
            return;
          }

          wsRef.current = ws;
          isIntentionallyClosed.current = false;

          ws.onopen = () => {
            // Ignore if processId has changed since WebSocket was opened
            if (
              cancelled ||
              currentProcessIdRef.current !== capturedProcessId
            ) {
              ws.close();
              return;
            }
            setError(null);
            retryCountRef.current = 0;
          };

          // Handle WebSocket messages
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);

              // Handle different message types based on LogMsg enum
              if ('JsonPatch' in data) {
                const patches = data.JsonPatch as LogPatch[];
                const nextLogs = [...logsRef.current];
                let didChange = false;

                patches.forEach((patch, patchIndex) => {
                  const value = patch?.value;
                  if (!value || !value.type) return;

                  switch (value.type) {
                    case 'STDOUT':
                    case 'STDERR': {
                      const entryIndex = getPatchEntryIndex(
                        patch.path,
                        nextLogs.length + patchIndex
                      );
                      const nextEntry: LogEntry = {
                        type: value.type,
                        content: value.content,
                      };
                      const currentEntry = nextLogs[entryIndex];
                      if (areLogEntriesEqual(currentEntry, nextEntry)) {
                        return;
                      }
                      nextLogs[entryIndex] = nextEntry;
                      didChange = true;
                      break;
                    }
                    // Ignore other patch types (NORMALIZED_ENTRY, DIFF, etc.)
                    default:
                      break;
                  }
                });

                if (didChange) {
                  const normalizedLogs = nextLogs.filter(
                    (entry): entry is LogEntry => entry !== undefined
                  );
                  logsRef.current = normalizedLogs;
                  setLogs(normalizedLogs);
                }
              } else if (data.finished === true) {
                finishedRef.current = true;
                isIntentionallyClosed.current = true;
                ws.close();
              }
            } catch (e) {
              console.error('Failed to parse message:', e);
            }
          };

          ws.onerror = () => {
            // Don't set error here — onclose always fires after onerror
            // and handles retry logic. Setting error eagerly hides logs
            // that were already received.
          };

          ws.onclose = (event) => {
            // Don't retry for stale WebSocket connections
            if (
              cancelled ||
              currentProcessIdRef.current !== capturedProcessId
            ) {
              return;
            }
            // Retry any unexpected closure, including clean 1000 closes caused by
            // proxies, restarts, or intermediaries.
            if (!isIntentionallyClosed.current && !finishedRef.current) {
              const next = retryCountRef.current + 1;
              retryCountRef.current = next;
              if (next <= 6) {
                const delay = Math.min(1500, 250 * 2 ** (next - 1));
                retryTimerRef.current = setTimeout(() => open(), delay);
              } else {
                setError('Connection failed');
              }
            } else if (event.code === 1000) {
              setError(null);
            }
          };
        } catch (error) {
          if (cancelled || currentProcessIdRef.current !== capturedProcessId) {
            return;
          }
          const next = retryCountRef.current + 1;
          retryCountRef.current = next;
          if (next <= 6) {
            const delay = Math.min(1500, 250 * 2 ** (next - 1));
            retryTimerRef.current = setTimeout(() => open(), delay);
          } else {
            setError('Connection failed');
          }
        }
      })();
    };

    open();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        isIntentionallyClosed.current = true;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [processId]);

  return { logs, error };
};

function getPatchEntryIndex(
  path: string | undefined,
  fallback: number
): number {
  if (!path) return fallback;

  const match = /^\/entries\/(\d+)$/.exec(path);
  if (!match) return fallback;

  const entryIndex = Number.parseInt(match[1]!, 10);
  return Number.isNaN(entryIndex) ? fallback : entryIndex;
}

function areLogEntriesEqual(
  left: LogEntry | undefined,
  right: LogEntry
): boolean {
  return left?.type === right.type && left?.content === right.content;
}
