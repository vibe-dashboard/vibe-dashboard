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
  SUPPORTED_EXECUTORS,
  agentDraftStorageKey,
  normalizeExecutorConfig,
  parseAgentDraft,
  serializeAgentDraft,
} from '../lib/agentComposerState';

export const AGENT_PANE_FOOTER_HEIGHT_PX = 196;
const draft = (
  message: string,
  executor_config: ExecutorConfig,
): DraftFollowUpData => ({ message, executor_config, session_command: null });

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

export function AgentPaneFooter(props: Props) {
  const session = props.sessions.find(
    ({ id }) => id === props.selectedSessionId,
  );
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<ExecutorConfig>({ executor: 'CODEX' });
  const [queue, setQueue] = useState<QueueStatus>({ status: 'empty' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const id = props.selectedSessionId;
    if (!id) {
      setMessage('');
      setQueue({ status: 'empty' });
      return;
    }
    let cancelled = false;
    setConfig(normalizeExecutorConfig(undefined, session));
    setError(null);
    const key = agentDraftStorageKey(props.workspaceId, id);
    const local = parseAgentDraft(localStorage.getItem(key));
    const localValid = local !== null;
    setMessage(local?.message ?? '');
    if (local?.executorConfig)
      setConfig(normalizeExecutorConfig(local.executorConfig, session));
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

  const persist = useCallback(
    (nextMessage: string, nextConfig: ExecutorConfig) => {
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
  const changeMessage = useCallback(
    (value?: string) => {
      const next = value ?? '';
      setMessage(next);
      persist(next, config);
    },
    [config, persist],
  );
  const changeConfig = useCallback(
    (patch: Partial<ExecutorConfig>) => {
      const next = { ...config, ...patch };
      setConfig(next);
      persist(message, next);
    },
    [config, message, persist],
  );
  const clearDraft = useCallback(() => {
    const id = props.selectedSessionId;
    if (!id) return;
    if (timer.current) clearTimeout(timer.current);
    localStorage.removeItem(agentDraftStorageKey(props.workspaceId, id));
    setMessage('');
    void vkClient.deleteFollowUpDraft(id).catch(() => undefined);
  }, [props.selectedSessionId, props.workspaceId]);

  const act = useCallback(
    async (kind: 'send' | 'queue' | 'cancel' | 'stop') => {
      const id = props.selectedSessionId;
      const prompt = message.trim();
      if (!id || busy || ((kind === 'send' || kind === 'queue') && !prompt))
        return;
      setBusy(true);
      setError(null);
      try {
        if (kind === 'send') {
          await vkClient.sendFollowUp(id, draft(prompt, config));
          clearDraft();
        } else if (kind === 'queue') {
          setQueue(await vkClient.queueFollowUp(id, draft(prompt, config)));
          clearDraft();
        } else if (kind === 'cancel') {
          const queued =
            queue.status === 'queued' ? queue.message.data.message : '';
          setQueue(await vkClient.cancelQueuedFollowUp(id));
          if (queued) changeMessage(queued);
        } else await vkClient.stopSessionExecution(id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Could not ${kind}`);
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      changeMessage,
      clearDraft,
      config,
      message,
      props.selectedSessionId,
      queue,
    ],
  );
  submitRef.current = () => void act('send');
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
    }),
    [],
  );
  const disabled =
    !props.selectedSessionId || props.loading || Boolean(props.error);
  const canSubmit = !disabled && !busy && Boolean(message.trim());

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
          disabled={disabled}
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
          onChange={(event) =>
            changeConfig({ variant: event.target.value || null })
          }
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <input
          aria-label="Model"
          placeholder="Model"
          value={config.model_id ?? ''}
          onChange={(event) =>
            changeConfig({ model_id: event.target.value || null })
          }
          className="min-w-32 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <input
          aria-label="Reasoning"
          placeholder="Reasoning"
          value={config.reasoning_id ?? ''}
          onChange={(event) =>
            changeConfig({ reasoning_id: event.target.value || null })
          }
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
        <input
          aria-label="Permission policy"
          placeholder="Permissions"
          value={config.permission_policy ?? ''}
          onChange={(event) =>
            changeConfig({ permission_policy: event.target.value || null })
          }
          className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
        />
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
          role={error ? 'alert' : 'status'}
        >
          {error ??
            (queue.status === 'queued'
              ? 'Follow-up queued'
              : 'Ctrl/Cmd+Enter to send')}
        </span>
        {queue.status === 'queued' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('cancel')}
          >
            Cancel queue
          </button>
        ) : (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void act('queue')}
          >
            Queue
          </button>
        )}
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void act('stop')}
        >
          Stop
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void act('send')}
          className="rounded bg-neutral-100 px-3 py-1 font-medium text-neutral-950 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </footer>
  );
}
