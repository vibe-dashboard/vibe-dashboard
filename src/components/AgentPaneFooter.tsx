import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {
  vkClient,
  type DraftFollowUpData,
  type Executor,
  type ExecutorConfig,
  type ModelInfo,
  type ModelSelectorConfig,
  type QueueStatus,
  type Session,
} from '../lib/vk-client';
import {
  PERMISSION_POLICY_VALUES,
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
  onSessionCreated: (session: Session) => void;
  onRetry: () => void;
  style: React.CSSProperties;
}

const draft = (
  message: string,
  executor_config: ExecutorConfig,
): DraftFollowUpData => ({ message, executor_config, session_command: null });

const CHAT_MAX_WIDTH_CLASS = 'mx-auto w-full max-w-[48rem]';
const RESERVED_PROFILE_KEYS = new Set(['recently_used_models']);

function buildSessionProcessesWsUrl(sessionId: string): string {
  const path = `/vk-api/execution-processes/stream/session/ws?${new URLSearchParams({ session_id: sessionId })}`;
  if (typeof window === 'undefined') return path;
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function buildModelSelectorWsUrl(
  executor: Executor,
  workspaceId: string,
  sessionId: string | null,
): string {
  const params = new URLSearchParams({
    executor,
    workspace_id: workspaceId,
  });
  if (sessionId) params.set('session_id', sessionId);
  const path = `/vk-api/agents/discovered-options/ws?${params}`;
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

function applyPlainJsonPatch<T>(
  current: T,
  patch: Array<{ op?: string; path?: string; value?: unknown }>,
): T {
  let next: unknown = current;
  for (const op of patch) {
    if (op.op === 'remove') continue;
    if (!op.path || op.path === '') {
      next = op.value;
      continue;
    }
    const parts = op.path.split('/').slice(1).map((part) =>
      part.replace(/~1/g, '/').replace(/~0/g, '~'),
    );
    if (parts.length === 0) continue;
    const clone = Array.isArray(next) ? [...next] : { ...(next as object) };
    let target: Record<string, unknown> = clone as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) {
      const child = target[part];
      const copy = Array.isArray(child) ? [...child] : { ...(child as object) };
      target[part] = copy;
      target = copy as Record<string, unknown>;
    }
    target[parts[parts.length - 1]!] = op.value;
    next = clone;
  }
  return next as T;
}

function prettyCase(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function permissionLabel(value: string): string {
  if (value === '') return 'Inherited';
  if (value === 'SUPERVISED') return 'Ask first';
  return prettyCase(value);
}

function optionLabel(value: string | null | undefined): string {
  return value ? prettyCase(value) : 'Default';
}

function getVariantOptions(
  profiles: Partial<Record<Executor, Record<string, unknown>>> | null,
  executor: Executor,
  selectedVariant: string | null | undefined,
): string[] {
  const keys = Object.keys(profiles?.[executor] ?? {}).filter(
    (key) => !RESERVED_PROFILE_KEYS.has(key),
  );
  const withSelected = selectedVariant && !keys.includes(selectedVariant)
    ? [selectedVariant, ...keys]
    : keys;
  return withSelected.sort((left, right) => {
    if (left === 'DEFAULT') return -1;
    if (right === 'DEFAULT') return 1;
    return left.localeCompare(right);
  });
}

function parseModelId(
  value: string | null | undefined,
  hasProviders: boolean,
): { providerId: string | null; modelId: string | null } {
  if (!value) return { providerId: null, modelId: null };
  if (!hasProviders) return { providerId: null, modelId: value };
  const index = value.indexOf('/');
  return index === -1
    ? { providerId: null, modelId: value }
    : { providerId: value.slice(0, index), modelId: value.slice(index + 1) };
}

function modelOptionValue(model: ModelInfo, hasProviders: boolean): string {
  return hasProviders && model.provider_id
    ? `${model.provider_id}/${model.id}`
    : model.id;
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
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [profiles, setProfiles] = useState<Partial<
    Record<Executor, Record<string, unknown>>
  > | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelSelectorConfig | null>(
    null,
  );
  const [modelConfigLoading, setModelConfigLoading] = useState(false);
  const [processes, setProcesses] = useState<Record<string, ExecutionProcess>>(
    {},
  );
  const [processesLoading, setProcessesLoading] = useState(false);
  const [processesError, setProcessesError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const id = props.selectedSessionId;
    setNewSessionMode(false);
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
    let cancelled = false;
    void vkClient.getInfo().then(
      (info) => {
        if (!cancelled) setProfiles(info.executors ?? null);
      },
      () => {
        if (!cancelled) setProfiles(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
    const executor = config.executor;
    if (!props.workspaceId || typeof WebSocket === 'undefined') {
      setModelConfig(null);
      setModelConfigLoading(false);
      return;
    }
    let cancelled = false;
    const socket = new WebSocket(
      buildModelSelectorWsUrl(
        executor,
        props.workspaceId,
        newSessionMode ? null : props.selectedSessionId,
      ),
    );
    setModelConfig(null);
    setModelConfigLoading(true);
    socket.onmessage = (event) => {
      if (cancelled) return;
      try {
        const value = JSON.parse(String(event.data)) as {
          JsonPatch?: Array<{ op?: string; path?: string; value?: unknown }>;
          Ready?: boolean;
          Finished?: boolean;
          finished?: boolean;
        };
        if (value.JsonPatch) {
          setModelConfig((current) =>
            applyPlainJsonPatch<{
              options?: { model_selector?: ModelSelectorConfig };
            }>(
              {
                options: current
                  ? { model_selector: current }
                  : undefined,
              },
              value.JsonPatch!,
            ).options?.model_selector ?? null,
          );
        }
        if (
          value.Ready !== undefined ||
          value.Finished !== undefined ||
          value.finished !== undefined
        ) {
          setModelConfigLoading(false);
        }
      } catch {
        setModelConfigLoading(false);
      }
    };
    socket.onerror = () => {
      if (!cancelled) setModelConfigLoading(false);
    };
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [
    config.executor,
    newSessionMode,
    props.selectedSessionId,
    props.workspaceId,
  ]);

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
  const hasTarget = newSessionMode || Boolean(props.selectedSessionId);
  const disabled = !hasTarget || props.loading || Boolean(props.error);
  const hasMessage = Boolean(message.trim());
  const sending = busy !== 'idle';
  const canSend =
    !disabled &&
    !locked &&
    !sending &&
    (newSessionMode || executionState === 'idle') &&
    hasMessage;
  const canQueue =
    !disabled &&
    !newSessionMode &&
    !locked &&
    !sending &&
    executionState === 'running' &&
    hasMessage;
  const canCancelQueue = !disabled && locked && !sending;
  const canStop =
    !disabled &&
    !newSessionMode &&
    !sending &&
    (executionState === 'running' || queue.status === 'queued');
  const readOnly =
    locked || sending || (!newSessionMode && executionState === 'loading');
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
              : newSessionMode
                ? 'New session · Ctrl/Cmd+Enter to start'
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
      if (!newSessionMode) persist(next, config);
    },
    [config, locked, newSessionMode, persist],
  );
  const changeConfig = useCallback(
    (
      patch: Partial<Omit<ExecutorConfig, 'executor'>>,
    ) => {
      if (locked) return;
      const next = { ...config, ...patch };
      setConfig(next);
      if (!newSessionMode) persist(message, next);
    },
    [config, locked, message, newSessionMode, persist],
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
      if (!allowed || (!id && kind !== 'send')) {
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
          if (newSessionMode) {
            const created = await vkClient.createSession(
              props.workspaceId,
              config.executor,
            );
            props.onSessionCreated(created);
            props.onSelect(created.id);
            await vkClient.sendFollowUp(created.id, draft(prompt, config));
            setNewSessionMode(false);
            setMessage('');
          } else {
            await vkClient.sendFollowUp(id!, draft(prompt, config));
            clearDraft();
            await refreshQueue();
          }
        } else if (kind === 'queue') {
          setQueue(await vkClient.queueFollowUp(id!, draft(prompt, config)));
          clearDraft();
        } else if (kind === 'cancel') {
          const queuedDraft = draftFromQueuedMessage(queue);
          setQueue(await vkClient.cancelQueuedFollowUp(id!));
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
          await vkClient.stopSessionExecution(id!);
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
      newSessionMode,
      persist,
      props.onSelect,
      props.onSessionCreated,
      props.selectedSessionId,
      props.workspaceId,
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
  const variantOptions = getVariantOptions(
    profiles,
    config.executor,
    config.variant,
  );
  const hasProviders = (modelConfig?.providers.length ?? 0) > 0;
  const modelOptions = modelConfig?.models ?? [];
  const selectedModel = (() => {
    const parsed = parseModelId(config.model_id, hasProviders);
    if (!parsed.modelId) return null;
    return modelOptions.find((model) => {
      if (model.id !== parsed.modelId) return false;
      return !parsed.providerId || model.provider_id === parsed.providerId;
    }) ?? null;
  })();
  const providerNames = new Map(
    modelConfig?.providers.map((provider) => [provider.id, provider.name]) ??
      [],
  );
  const selectedModelMissing =
    config.model_id &&
    !modelOptions.some(
      (model) => modelOptionValue(model, hasProviders) === config.model_id,
    );

  return (
    <footer
      className="absolute bottom-0 z-30 flex flex-col overflow-hidden border-t border-neutral-800 bg-neutral-950 text-xs text-neutral-400"
      style={{ ...props.style, height: AGENT_PANE_FOOTER_HEIGHT_PX }}
      data-testid="agent-pane-footer"
    >
      <div className="shrink-0 border-b border-neutral-800 px-3">
        <div className={`${CHAT_MAX_WIDTH_CLASS} flex h-10 items-center gap-2 overflow-x-auto`}>
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
              value={
                newSessionMode ? '__new__' : (props.selectedSessionId ?? '')
              }
              onChange={(event) => {
                if (event.target.value === '__new__') {
                  setNewSessionMode(true);
                  setMessage('');
                  setQueue({ status: 'empty' });
                  return;
                }
                setNewSessionMode(false);
                props.onSelect(event.target.value);
              }}
            >
              {newSessionMode && <option value="__new__">New session</option>}
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
          <button
            type="button"
            className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-900"
            disabled={props.loading}
            onClick={() => {
              setNewSessionMode(true);
              setMessage('');
              setQueue({ status: 'empty' });
            }}
          >
            New session
          </button>
          <select
            aria-label="Variant"
            value={config.variant ?? ''}
            disabled={configDisabled}
            onChange={(event) =>
              changeConfig({ variant: event.target.value || null })
            }
            className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
          >
            <option value="">Default</option>
            {variantOptions.map((item) => (
              <option key={item} value={item === 'DEFAULT' ? '' : item}>
                {optionLabel(item)}
              </option>
            ))}
          </select>
          <select
            aria-label="Model"
            value={config.model_id ?? ''}
            disabled={configDisabled || modelConfigLoading}
            onChange={(event) =>
              changeConfig({
                model_id: event.target.value || null,
                reasoning_id: null,
              })
            }
            className="min-w-36 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
          >
            <option value="">
              {modelConfigLoading ? 'Loading models…' : 'Default model'}
            </option>
            {selectedModelMissing && (
              <option value={config.model_id ?? ''}>
                {config.model_id}
              </option>
            )}
            {modelOptions.map((model) => {
              const value = modelOptionValue(model, hasProviders);
              const provider = model.provider_id
                ? providerNames.get(model.provider_id)
                : null;
              return (
                <option key={value} value={value}>
                  {provider ? `${model.name} · ${provider}` : model.name}
                </option>
              );
            })}
          </select>
          <select
            aria-label="Reasoning"
            value={config.reasoning_id ?? ''}
            disabled={configDisabled || !selectedModel}
            onChange={(event) =>
              changeConfig({ reasoning_id: event.target.value || null })
            }
            className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
          >
            <option value="">Default reasoning</option>
            {selectedModel?.reasoning_options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            {config.reasoning_id &&
              !selectedModel?.reasoning_options.some(
                (item) => item.id === config.reasoning_id,
              ) && (
                <option value={config.reasoning_id}>
                  {optionLabel(config.reasoning_id)}
                </option>
              )}
          </select>
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
                {permissionLabel(item)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3">
        <div className={`${CHAT_MAX_WIDTH_CLASS} h-full`}>
          <Editor
            language="markdown"
            theme="vs-dark"
            value={message}
            onChange={changeMessage}
            onMount={mount}
            options={options}
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-neutral-800 px-3">
        <div
          className={`${CHAT_MAX_WIDTH_CLASS} flex h-10 items-center gap-2 overflow-x-auto`}
        >
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
      </div>
    </footer>
  );
}
