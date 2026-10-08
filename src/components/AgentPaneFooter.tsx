import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {
  vkClient,
  type DraftFollowUpData,
  type Executor,
  type ExecutorConfig,
  type QueueStatus,
  type Session,
} from '../lib/vk-client';
import {
  PERMISSION_POLICY_VALUES,
  SUPPORTED_EXECUTORS,
  agentDraftStorageKey,
  draftFromQueuedMessage,
  isCodingAgentProcessRunning,
  normalizeExecutorConfig,
  normalizePermissionPolicy,
  parseAgentDraft,
  serializeAgentDraft,
} from '../lib/agentComposerState';

export const AGENT_PANE_FOOTER_HEIGHT_PX = 196;

type Busy = 'idle' | 'sending' | 'queueing' | 'cancelling' | 'stopping';
type ExecutionState = 'loading' | 'idle' | 'running' | 'error';

interface ExecutionProcess {
  id: string;
  session_id: string;
  status: string;
  run_reason?: string | null;
  completed_at?: string | null;
}

interface Props {
  workspaceId: string;
  sessions: Session[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (sessionId: string) => void;
  onRetry: () => void;
  style: React.CSSProperties;
}

const draft = (
  message: string,
  executor_config: ExecutorConfig,
): DraftFollowUpData => ({ message, executor_config, session_command: null });

function buildSessionProcessesWsUrl(sessionId: string): string {
  const path = `/vk-api/execution-processes/stream/session/ws?${new URLSearchParams({ session_id: sessionId })}`;
  if (typeof window === 'undefined') return path;
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function applyProcessPatch(
  current: Record<string, ExecutionProcess>,
  patch: Array<{ op?: string; path?: string; value?: unknown }>,
): Record<string, ExecutionProcess> {
  let next = current;
  for (const op of patch) {
    if (op.path === '/execution_processes' && op.value) {
      next = op.value as Record<string, ExecutionProcess>;
      continue;
    }
    const processId = op.path?.match(/^\/execution_processes\/([^/]+)$/)?.[1];
    if (!processId) continue;
    if (op.op === 'remove') {
      const { [processId]: _removed, ...rest } = next;
      next = rest;
    } else if (op.value) {
      next = { ...next, [processId]: op.value as ExecutionProcess };
    }
  }
  return next;
}

export function AgentPaneFooter(props: Props) {
  const session = props.sessions.find(
    ({ id }) => id === props.selectedSessionId,
  );
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<ExecutorConfig & { executor: Executor }>(
    { executor: 'CODEX', permission_policy: null },
  );
  const [queue, setQueue] = useState<QueueStatus>({ status: 'empty' });
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<Record<string, ExecutionProcess>>(
    {},
  );
  const [processesLoading, setProcessesLoading] = useState(false);
  const [processesError, setProcessesError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const id = props.selectedSessionId;
    if (!id) {
      setMessage('');
      setQueue({ status: 'empty' });
      setProcesses({});
      return;
    }
    let cancelled = false;
    setConfig(normalizeExecutorConfig(undefined, session));
    setError(null);
    const key = agentDraftStorageKey(props.workspaceId, id);
    const local = parseAgentDraft(localStorage.getItem(key));
    const localValid = local !== null;
    setMessage(local?.message ?? '');
    if (local?.executorConfig) {
      setConfig(normalizeExecutorConfig(local.executorConfig, session));
    }
    void Promise.all([
      vkClient.getFollowUpDraft(id),
      vkClient.getQueueStatus(id),
    ]).then(
      ([saved, status]) => {
        if (cancelled) return;
        setQueue(status);
        if (!localValid && saved) {
          setMessage(saved.message);
          setConfig(normalizeExecutorConfig(saved.executor_config, session));
        }
      },
      () => {
        if (!cancelled) setError('Could not load composer state');
      },
    );
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [props.selectedSessionId, props.workspaceId, session?.executor]);

  useEffect(() => {
    const id = props.selectedSessionId;
    if (!id || typeof WebSocket === 'undefined') {
      setProcesses({});
      setProcessesLoading(false);
      setProcessesError(null);
      return;
    }
    let cancelled = false;
    const socket = new WebSocket(buildSessionProcessesWsUrl(id));
    setProcesses({});
    setProcessesLoading(true);
    setProcessesError(null);
    socket.onmessage = (event) => {
      if (cancelled) return;
      try {
        const value = JSON.parse(String(event.data)) as {
          JsonPatch?: Array<{ op?: string; path?: string; value?: unknown }>;
          Ready?: boolean;
        };
        if (value.JsonPatch) {
          setProcesses((current) =>
            applyProcessPatch(current, value.JsonPatch!),
          );
        }
        if (value.JsonPatch || value.Ready !== undefined) {
          setProcessesLoading(false);
        }
      } catch {
        setProcessesError('Could not read execution state');
        setProcessesLoading(false);
      }
    };
    socket.onerror = () => {
      if (!cancelled) {
        setProcessesError('Could not load execution state');
        setProcessesLoading(false);
      }
    };
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [props.selectedSessionId]);

  const executionState: ExecutionState = useMemo(() => {
    if (!props.selectedSessionId) return 'idle';
    if (processesError) return 'error';
    if (processesLoading) return 'loading';
    return Object.values(processes).some(
      (process) =>
        process.session_id === props.selectedSessionId &&
        isCodingAgentProcessRunning(process),
    )
      ? 'running'
      : 'idle';
  }, [processes, processesError, processesLoading, props.selectedSessionId]);

  useEffect(() => {
    const id = props.selectedSessionId;
    if (!id) return;
    if (executionState !== 'running' && queue.status !== 'queued') return;
    let cancelled = false;
    const interval = setInterval(() => {
      void vkClient.getQueueStatus(id).then(
        (status) => {
          if (!cancelled) setQueue(status);
        },
        () => {
          if (!cancelled) setError('Could not refresh queue state');
        },
      );
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [executionState, props.selectedSessionId, queue.status]);

  const persist = useCallback(
    (nextMessage: string, nextConfig: ExecutorConfig & { executor: Executor }) => {
      const id = props.selectedSessionId;
      if (!id) return;
      const value = draft(nextMessage, nextConfig);
      localStorage.setItem(
        agentDraftStorageKey(props.workspaceId, id),
        serializeAgentDraft(nextMessage, nextConfig),
      );
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () =>
          void vkClient
            .saveFollowUpDraft(id, value)
            .catch(() => setError('Draft is safe locally; server sync failed')),
        500,
      );
    },
    [props.selectedSessionId, props.workspaceId],
  );

  const clearDraft = useCallback(() => {
    const id = props.selectedSessionId;
    if (!id) return;
    if (timer.current) clearTimeout(timer.current);
    localStorage.removeItem(agentDraftStorageKey(props.workspaceId, id));
    setMessage('');
    void vkClient.deleteFollowUpDraft(id).catch(() => undefined);
  }, [props.selectedSessionId, props.workspaceId]);

  const locked = queue.status === 'queued';
  const disabled =
    !props.selectedSessionId || props.loading || Boolean(props.error);
  const hasMessage = Boolean(message.trim());
  const sending = busy !== 'idle';
  const canSend =
    !disabled && !locked && !sending && executionState === 'idle' && hasMessage;
  const canQueue =
    !disabled &&
    !locked &&
    !sending &&
    executionState === 'running' &&
    hasMessage;
  const canCancelQueue = !disabled && locked && !sending;
  const canStop =
    !disabled &&
    !sending &&
    (executionState === 'running' || queue.status === 'queued');
  const readOnly = locked || sending || executionState === 'loading';
  const statusText =
    error ??
    processesError ??
    (busy === 'sending'
      ? 'Sending…'
      : busy === 'queueing'
        ? 'Queueing…'
        : busy === 'cancelling'
          ? 'Cancelling queued follow-up…'
          : busy === 'stopping'
            ? 'Stopping…'
            : queue.status === 'queued'
              ? 'Follow-up queued; editor locked until cancelled or consumed'
              : executionState === 'running'
                ? 'Agent running; queue or stop'
                : executionState === 'loading'
                  ? 'Loading execution state…'
                  : 'Ctrl/Cmd+Enter to send');

  const changeMessage = useCallback(
    (value?: string) => {
      if (locked) return;
      const next = value ?? '';
      setMessage(next);
      persist(next, config);
    },
    [config, locked, persist],
  );
  const changeConfig = useCallback(
    (
      patch: Partial<Omit<ExecutorConfig, 'executor'>> & {
        executor?: Executor;
      },
    ) => {
      if (locked) return;
      const next = { ...config, ...patch };
      setConfig(next);
      persist(message, next);
    },
    [config, locked, message, persist],
  );

  const refreshQueue = useCallback(async () => {
    const id = props.selectedSessionId;
    if (!id) return;
    setQueue(await vkClient.getQueueStatus(id));
  }, [props.selectedSessionId]);

  const act = useCallback(
    async (kind: 'send' | 'queue' | 'cancel' | 'stop') => {
      const id = props.selectedSessionId;
      const prompt = message.trim();
      const allowed =
        kind === 'send'
          ? canSend
          : kind === 'queue'
            ? canQueue
            : kind === 'cancel'
              ? canCancelQueue
              : canStop;
      if (!id || !allowed) {
        return;
      }
      setBusy(
        kind === 'send'
          ? 'sending'
          : kind === 'queue'
            ? 'queueing'
            : kind === 'cancel'
              ? 'cancelling'
              : 'stopping',
      );
      setError(null);
      try {
        if (kind === 'send') {
          await vkClient.sendFollowUp(id, draft(prompt, config));
          clearDraft();
          await refreshQueue();
        } else if (kind === 'queue') {
          setQueue(await vkClient.queueFollowUp(id, draft(prompt, config)));
          clearDraft();
        } else if (kind === 'cancel') {
          const queuedDraft = draftFromQueuedMessage(queue);
          setQueue(await vkClient.cancelQueuedFollowUp(id));
          if (queuedDraft) {
            const restoredConfig = normalizeExecutorConfig(
              queuedDraft.executor_config,
              session,
            );
            setMessage(queuedDraft.message);
            setConfig(restoredConfig);
            persist(queuedDraft.message, restoredConfig);
          }
        } else {
          await vkClient.stopSessionExecution(id);
          await refreshQueue();
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Could not ${kind}`);
      } finally {
        setBusy('idle');
      }
    },
    [
      canCancelQueue,
      canQueue,
      canSend,
      canStop,
      clearDraft,
      config,
      message,
      persist,
      props.selectedSessionId,
      queue,
      refreshQueue,
      sending,
      session,
    ],
  );

  submitRef.current = () => {
    if (canQueue) {
      void act('queue');
    } else if (canSend) {
      void act('send');
    }
  };
  const mount: OnMount = useCallback(
    (editor, monaco) =>
      editor.addAction({
        id: 'agent-composer.send',
        label: 'Send follow-up',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => submitRef.current(),
      }),
    [],
  );
  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderLineHighlight: 'none',
      scrollbar: { horizontal: 'hidden', verticalScrollbarSize: 6 },
      padding: { top: 8, bottom: 8 },
      fontSize: 13,
      automaticLayout: true,
      ariaLabel: 'Follow-up message',
      readOnly,
    }),
    [readOnly],
  );
  const configDisabled = disabled || locked || sending;

  return (
    <footer
      className="absolute bottom-0 z-30 flex flex-col overflow-hidden border-t border-neutral-800 bg-neutral-950 text-xs text-neutral-400"
      style={{ ...props.style, height: AGENT_PANE_FOOTER_HEIGHT_PX }}
      data-testid="agent-pane-footer"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800 px-3">
        {props.error ? (
          <>
            <span className="min-w-32 flex-1 truncate text-red-400">
              {props.error}
            </span>
            <button type="button" onClick={props.onRetry}>
              Retry
            </button>
          </>
        ) : (
          <select
            aria-label="Agent session"
            className="min-w-32 max-w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
            disabled={props.loading || props.sessions.length === 0}
            value={props.selectedSessionId ?? ''}
            onChange={(event) => props.onSelect(event.target.value)}
          >
            {props.loading && <option value="">Loading sessions…</option>}
            {!props.loading && props.sessions.length === 0 && (
              <option value="">No sessions</option>
            )}
            {props.sessions.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index === 0 ? 'Latest · ' : ''}
                {item.name || item.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Executor"
          value={config.executor}
          disabled={configDisabled}
          onChange={(event) =>
            changeConfig({ executor: event.target.value as Executor })
          }
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        >
          {SUPPORTED_EXECUTORS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <input
          aria-label="Variant"
          placeholder="Variant"
          value={config.variant ?? ''}
          disabled={configDisabled}
          onChange={(event) =>
            changeConfig({ variant: event.target.value || null })
          }
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <input
          aria-label="Model"
          placeholder="Model"
          value={config.model_id ?? ''}
          disabled={configDisabled}
          onChange={(event) =>
            changeConfig({ model_id: event.target.value || null })
          }
          className="min-w-32 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <input
          aria-label="Reasoning"
          placeholder="Reasoning"
          value={config.reasoning_id ?? ''}
          disabled={configDisabled}
          onChange={(event) =>
            changeConfig({ reasoning_id: event.target.value || null })
          }
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <select
          aria-label="Permission policy"
          value={config.permission_policy ?? ''}
          disabled={configDisabled}
          onChange={(event) =>
            changeConfig({
              permission_policy: normalizePermissionPolicy(event.target.value),
            })
          }
          className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        >
          {PERMISSION_POLICY_VALUES.map((item) => (
            <option key={item} value={item}>
              {item || 'Inherited'}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          language="markdown"
          theme="vs-dark"
          value={message}
          onChange={changeMessage}
          onMount={mount}
          options={options}
        />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-t border-neutral-800 px-3">
        <span
          className="min-w-24 flex-1 truncate"
          role={error || processesError ? 'alert' : 'status'}
        >
          {statusText}
        </span>
        {queue.status === 'queued' ? (
          <button
            type="button"
            disabled={!canCancelQueue}
            onClick={() => void act('cancel')}
          >
            Cancel queue
          </button>
        ) : (
          executionState === 'running' && (
            <button
              type="button"
              disabled={!canQueue}
              onClick={() => void act('queue')}
            >
              Queue
            </button>
          )
        )}
        {(executionState === 'running' || queue.status === 'queued') && (
          <button
            type="button"
            disabled={!canStop}
            onClick={() => void act('stop')}
          >
            Stop
          </button>
        )}
        {executionState !== 'running' && queue.status !== 'queued' && (
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void act('send')}
            className="rounded bg-neutral-100 px-3 py-1 font-medium text-neutral-950 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </footer>
  );
}
