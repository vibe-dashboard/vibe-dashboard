import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type Session = {
  id: string;
  workspace_id: string;
  executor?: string | null;
  created_at: string;
  updated_at: string;
  name?: string | null;
};

type ExecutionProcessStatus = 'running' | 'completed' | 'failed' | 'killed';

type ExecutionProcess = {
  id: string;
  session_id: string;
  status: ExecutionProcessStatus;
  created_at?: string | null;
  updated_at?: string | null;
  run_reason?: string | null;
  dropped?: boolean | null;
};

type NormalizedEntry = {
  timestamp: string | null;
  entry_type: {
    type: string;
    tool_name?: string;
    status?: string;
  };
  content: string;
};

type PatchEntry =
  | { type: 'NORMALIZED_ENTRY'; content: NormalizedEntry }
  | { type: 'STDOUT'; content: string }
  | { type: 'STDERR'; content: string }
  | { type: string; content?: unknown };

type ConversationPreviewMessage = {
  role: 'user' | 'assistant';
  content: string;
  execution_process_id: string;
  created_at: string;
};

type JsonPatchOperation = {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string | null;
};

type SessionProcessState = {
  execution_processes: Record<string, ExecutionProcess>;
};

type EntriesState = {
  entries: PatchEntry[];
};

export type InlineVkAgentChatTheme = {
  className?: string;
  style?: CSSProperties;
};

export type InlineVkAgentChatProps = {
  workspaceId: string;
  surfaceId: string;
  title?: string;
  theme?: InlineVkAgentChatTheme;
};

const EMPTY_PROCESS_STATE: SessionProcessState = { execution_processes: {} };
const EMPTY_ENTRIES_STATE: EntriesState = { entries: [] };

function apiUrl(path: string): string {
  return path;
}

function wsUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

async function readApi<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }

  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.success) {
    throw new Error(body.message || `${path} returned an unsuccessful response`);
  }
  return body.data;
}

async function postApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }

  const json = (await response.json()) as ApiEnvelope<T>;
  if (!json.success) {
    throw new Error(json.message || `${path} returned an unsuccessful response`);
  }
  return json.data;
}

function cloneContainer<T extends object>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePathSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function applyJsonPatches<T extends object>(current: T, patches: JsonPatchOperation[]): T {
  const next = cloneContainer(current);

  for (const patch of patches) {
    const segments = patch.path
      .split('/')
      .slice(1)
      .map(decodePathSegment);
    if (!segments.length) continue;

    let parent: unknown = next;
    for (const segment of segments.slice(0, -1)) {
      if (parent == null) break;
      parent = Array.isArray(parent)
        ? parent[Number(segment)]
        : (parent as Record<string, unknown>)[segment];
    }
    if (parent == null) continue;

    const leaf = segments[segments.length - 1]!;
    if (Array.isArray(parent)) {
      const index = leaf === '-' ? parent.length : Number(leaf);
      if (!Number.isInteger(index)) continue;
      if (patch.op === 'remove') {
        parent.splice(index, 1);
      } else if (patch.op === 'add') {
        parent.splice(index, 0, patch.value);
      } else {
        parent[index] = patch.value;
      }
      continue;
    }

    const record = parent as Record<string, unknown>;
    if (patch.op === 'remove') {
      delete record[leaf];
    } else {
      record[leaf] = patch.value;
    }
  }

  return next;
}

function openPatchSocket<T extends object>(params: {
  path: string;
  initial: T;
  onData: (data: T) => void;
  onConnected?: (connected: boolean) => void;
  onFinished?: () => void;
  onError?: (error: Error) => void;
}): () => void {
  const socket = new WebSocket(wsUrl(params.path));
  let current = cloneContainer(params.initial);
  let closed = false;

  socket.addEventListener('open', () => {
    params.onConnected?.(true);
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as
        | { JsonPatch?: JsonPatchOperation[] }
        | { Ready?: true }
        | { finished?: boolean };

      if ('JsonPatch' in message && message.JsonPatch) {
        current = applyJsonPatches(current, message.JsonPatch);
        params.onData(current);
      }
      if ('finished' in message) {
        params.onFinished?.();
        socket.close();
      }
    } catch (error) {
      params.onError?.(
        error instanceof Error ? error : new Error('Invalid websocket message'),
      );
    }
  });
  socket.addEventListener('close', () => {
    if (!closed) params.onConnected?.(false);
  });
  socket.addEventListener('error', () => {
    params.onError?.(new Error(`Websocket failed: ${params.path}`));
  });

  return () => {
    closed = true;
    params.onConnected?.(false);
    socket.close();
  };
}

function sessionStorageKey(surfaceId: string): string {
  return `vk-inline-chat:selected-session:${surfaceId}`;
}

function useWorkspaceSessions(workspaceId: string, surfaceId: string) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSessions = await readApi<Session[]>(
        `/api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      setSessions(nextSessions);
      setSelectedSessionId((current) => {
        const stored =
          typeof window === 'undefined'
            ? null
            : window.localStorage.getItem(sessionStorageKey(surfaceId));
        const preferred = current || stored || undefined;
        if (preferred && nextSessions.some((session) => session.id === preferred)) {
          return preferred;
        }
        return nextSessions[0]?.id;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load sessions');
    } finally {
      setLoading(false);
    }
  }, [surfaceId, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectSession = useCallback(
    (sessionId: string) => {
      setSelectedSessionId(sessionId);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(sessionStorageKey(surfaceId), sessionId);
      }
    },
    [surfaceId],
  );

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  return {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    refresh,
    loading,
    error,
  };
}

function useSessionProcesses(sessionId: string | undefined) {
  const [processes, setProcesses] = useState<ExecutionProcess[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setProcesses([]);
      setConnected(false);
      return;
    }

    setProcesses([]);
    setError(null);
    return openPatchSocket<SessionProcessState>({
      path: `/api/execution-processes/stream/session/ws?session_id=${encodeURIComponent(
        sessionId,
      )}&show_soft_deleted=true`,
      initial: EMPTY_PROCESS_STATE,
      onConnected: setConnected,
      onData: (data) => {
        const next = Object.values(data.execution_processes)
          .filter((process) => !process.dropped && process.session_id === sessionId)
          .sort(compareByCreatedAt);
        setProcesses(next);
      },
      onError: (nextError) => setError(nextError.message),
    });
  }, [sessionId]);

  return { processes, connected, error };
}

function useConversationPreview(sessionId: string | undefined) {
  const [messages, setMessages] = useState<ConversationPreviewMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    if (!sessionId) return;

    (async () => {
      try {
        const params = new URLSearchParams({ limit: '80' });
        const preview = await readApi<{ messages: ConversationPreviewMessage[] }>(
          `/api/sessions/${encodeURIComponent(
            sessionId,
          )}/conversation-preview?${params.toString()}`,
        );
        if (!cancelled) setMessages(preview.messages);
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return messages;
}

function useProcessEntries(processes: ExecutionProcess[]) {
  const [entriesByProcess, setEntriesByProcess] = useState<Record<string, PatchEntry[]>>({});
  const processKey = processes.map((process) => `${process.id}:${process.status}`).join('|');

  useEffect(() => {
    setEntriesByProcess({});
    // ken: one log websocket per visible process; add a shared stream registry when duplicate visible sessions > 4 measured.
    const cleanups = processes.map((process) =>
      openPatchSocket<EntriesState>({
        path: `/api/execution-processes/${encodeURIComponent(
          process.id,
        )}/normalized-logs/ws`,
        initial: EMPTY_ENTRIES_STATE,
        onData: (data) => {
          setEntriesByProcess((current) => ({
            ...current,
            [process.id]: data.entries,
          }));
        },
        onFinished: () => undefined,
        onError: () => undefined,
      }),
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [processKey]);

  return entriesByProcess;
}

function compareByCreatedAt(left: ExecutionProcess, right: ExecutionProcess): number {
  return (
    new Date(left.created_at || left.updated_at || 0).getTime() -
    new Date(right.created_at || right.updated_at || 0).getTime()
  );
}

function entryRole(entry: NormalizedEntry): 'user' | 'assistant' | 'event' {
  if (entry.entry_type.type === 'user_message') return 'user';
  if (entry.entry_type.type === 'assistant_message') return 'assistant';
  return 'event';
}

function entryLabel(entry: NormalizedEntry): string {
  if (entry.entry_type.type === 'tool_use') {
    return entry.entry_type.tool_name
      ? `Tool: ${entry.entry_type.tool_name}`
      : 'Tool use';
  }
  return entry.entry_type.type.replace(/_/g, ' ');
}

function isNormalizedPatchEntry(
  entry: PatchEntry,
): entry is { type: 'NORMALIZED_ENTRY'; content: NormalizedEntry } {
  return (
    entry.type === 'NORMALIZED_ENTRY' &&
    typeof entry.content === 'object' &&
    entry.content !== null &&
    'entry_type' in entry.content &&
    'content' in entry.content
  );
}

function isTextPatchEntry(
  entry: PatchEntry,
): entry is { type: 'STDOUT' | 'STDERR'; content: string } {
  return (
    (entry.type === 'STDOUT' || entry.type === 'STDERR') &&
    typeof entry.content === 'string'
  );
}

function flattenEntries(
  processes: ExecutionProcess[],
  entriesByProcess: Record<string, PatchEntry[]>,
) {
  return processes.flatMap((process) =>
    (entriesByProcess[process.id] || []).map((entry, index) => ({
      key: `${process.id}:${index}`,
      process,
      entry,
    })),
  );
}

function statusTone(status: ExecutionProcessStatus | undefined): string {
  if (status === 'running') return 'var(--vk-chat-accent, #8ab4f8)';
  if (status === 'failed' || status === 'killed') return 'var(--vk-chat-danger, #f87171)';
  return 'var(--vk-chat-muted, #9ca3af)';
}

export function InlineVkAgentChat({
  workspaceId,
  surfaceId,
  title = 'Agent',
  theme,
}: InlineVkAgentChatProps) {
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    refresh,
    loading: sessionsLoading,
    error: sessionsError,
  } = useWorkspaceSessions(workspaceId, surfaceId);
  const { processes, connected, error: processError } =
    useSessionProcesses(selectedSessionId);
  const previewMessages = useConversationPreview(selectedSessionId);
  const entriesByProcess = useProcessEntries(processes);
  const rows = flattenEntries(processes, entriesByProcess);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const latestProcess = processes.at(-1);
  const hasRows = rows.length > 0;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [rows.length, previewMessages.length]);

  const sendFollowUp = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || !selectedSession || sending) return;

    setSending(true);
    setSendError(null);
    try {
      await postApi<ExecutionProcess>(
        `/api/sessions/${encodeURIComponent(selectedSession.id)}/follow-up`,
        {
          prompt,
          executor_config: {
            executor: selectedSession.executor || 'CODEX',
          },
          retry_process_id: null,
          force_when_dirty: null,
          perform_git_reset: null,
        },
      );
      setDraft('');
      await refresh();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not send follow-up');
    } finally {
      setSending(false);
    }
  }, [draft, refresh, selectedSession, sending]);

  const rootStyle: CSSProperties = {
    '--vk-chat-bg': '#0a0a0a',
    '--vk-chat-panel': '#111113',
    '--vk-chat-panel-strong': '#18181b',
    '--vk-chat-border': '#27272a',
    '--vk-chat-text': '#f4f4f5',
    '--vk-chat-muted': '#a1a1aa',
    '--vk-chat-accent': '#8ab4f8',
    '--vk-chat-danger': '#f87171',
    ...theme?.style,
  } as CSSProperties;

  return (
    <section
      className={theme?.className}
      data-testid="inline-vk-agent-chat"
      style={{
        ...rootStyle,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--vk-chat-bg)',
        color: 'var(--vk-chat-text)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 48,
          padding: '8px 12px',
          borderBottom: '1px solid var(--vk-chat-border)',
          background: 'var(--vk-chat-panel)',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>{title}</div>
          <div style={{ color: 'var(--vk-chat-muted)', fontSize: 12 }}>
            {selectedSessionId
              ? `${connected ? 'Streaming' : 'Connecting'} · ${selectedSessionId.slice(0, 8)}`
              : 'No session selected'}
          </div>
        </div>
        {sessions.length > 1 ? (
          <select
            aria-label="Agent session"
            value={selectedSessionId || ''}
            onChange={(event) => selectSession(event.currentTarget.value)}
            style={{
              maxWidth: 220,
              border: '1px solid var(--vk-chat-border)',
              borderRadius: 8,
              background: 'var(--vk-chat-panel-strong)',
              color: 'var(--vk-chat-text)',
              padding: '6px 8px',
              fontSize: 12,
            }}
          >
            {sessions.map((session, index) => (
              <option key={session.id} value={session.id}>
                {session.name || `Session ${index + 1}`} · {session.id.slice(0, 8)}
              </option>
            ))}
          </select>
        ) : null}
        <span
          aria-label={latestProcess?.status || 'idle'}
          title={latestProcess?.status || 'idle'}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: statusTone(latestProcess?.status),
            flex: '0 0 auto',
          }}
        />
      </header>

      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 16,
        }}
      >
        {sessionsLoading ? (
          <CenteredState>Loading agent chat…</CenteredState>
        ) : sessionsError ? (
          <CenteredState tone="danger">{sessionsError}</CenteredState>
        ) : !selectedSessionId ? (
          <CenteredState>No agent sessions exist for this workspace yet.</CenteredState>
        ) : hasRows ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map(({ key, entry }) => (
              <EntryBubble key={key} entry={entry} />
            ))}
          </div>
        ) : previewMessages.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {previewMessages.map((message, index) => (
              <MessageBubble
                key={`${message.execution_process_id}:${index}`}
                role={message.role}
                content={message.content}
              />
            ))}
          </div>
        ) : (
          <CenteredState>Waiting for conversation entries…</CenteredState>
        )}
      </div>

      {(processError || sendError) && (
        <div
          role="alert"
          style={{
            margin: '0 12px 8px',
            border: '1px solid color-mix(in srgb, var(--vk-chat-danger), transparent 55%)',
            borderRadius: 10,
            color: 'var(--vk-chat-danger)',
            padding: '8px 10px',
            fontSize: 12,
            background: 'color-mix(in srgb, var(--vk-chat-danger), transparent 92%)',
          }}
        >
          {sendError || processError}
        </div>
      )}

      <footer
        style={{
          borderTop: '1px solid var(--vk-chat-border)',
          background: 'var(--vk-chat-panel)',
          padding: 12,
        }}
      >
        <label
          htmlFor={`vk-follow-up-${surfaceId}`}
          style={{
            display: 'block',
            color: 'var(--vk-chat-muted)',
            fontSize: 12,
            marginBottom: 6,
          }}
        >
          Follow up
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            id={`vk-follow-up-${surfaceId}`}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void sendFollowUp();
              }
            }}
            disabled={!selectedSession || sending}
            placeholder={
              selectedSession
                ? 'Ask the agent to continue…'
                : 'Select a session before sending a follow-up'
            }
            rows={3}
            style={{
              flex: 1,
              resize: 'vertical',
              minHeight: 72,
              maxHeight: 180,
              border: '1px solid var(--vk-chat-border)',
              borderRadius: 12,
              background: 'var(--vk-chat-panel-strong)',
              color: 'var(--vk-chat-text)',
              padding: 10,
              outline: 'none',
              font: 'inherit',
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={() => void sendFollowUp()}
            disabled={!draft.trim() || !selectedSession || sending}
            style={{
              minHeight: 40,
              border: '1px solid var(--vk-chat-border)',
              borderRadius: 10,
              padding: '0 14px',
              background:
                !draft.trim() || !selectedSession || sending
                  ? 'var(--vk-chat-panel-strong)'
                  : 'var(--vk-chat-accent)',
              color:
                !draft.trim() || !selectedSession || sending
                  ? 'var(--vk-chat-muted)'
                  : '#06111f',
              fontWeight: 700,
              cursor:
                !draft.trim() || !selectedSession || sending ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </footer>
    </section>
  );
}

function CenteredState({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        color:
          tone === 'danger'
            ? 'var(--vk-chat-danger)'
            : 'var(--vk-chat-muted)',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

function EntryBubble({ entry }: { entry: PatchEntry }) {
  if (isNormalizedPatchEntry(entry)) {
    const role = entryRole(entry.content);
    if (role === 'event') {
      return (
        <div
          style={{
            justifySelf: 'center',
            maxWidth: 'min(760px, 100%)',
            color: 'var(--vk-chat-muted)',
            fontSize: 12,
            border: '1px solid var(--vk-chat-border)',
            borderRadius: 999,
            padding: '4px 10px',
            background: 'var(--vk-chat-panel)',
          }}
        >
          {entryLabel(entry.content)}
          {entry.content.content ? ` · ${entry.content.content}` : ''}
        </div>
      );
    }
    return <MessageBubble role={role} content={entry.content.content} />;
  }

  if (isTextPatchEntry(entry)) {
    return <MessageBubble role="event" content={entry.content} />;
  }

  return null;
}

function MessageBubble({
  role,
  content,
}: {
  role: 'user' | 'assistant' | 'event';
  content: string;
}) {
  const isUser = role === 'user';
  return (
    <article
      style={{
        justifySelf: isUser ? 'end' : 'start',
        width: 'fit-content',
        maxWidth: 'min(760px, 92%)',
        border: '1px solid var(--vk-chat-border)',
        borderRadius: 16,
        padding: '10px 12px',
        background: isUser ? 'var(--vk-chat-panel-strong)' : 'var(--vk-chat-panel)',
        color: 'var(--vk-chat-text)',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          color: 'var(--vk-chat-muted)',
          fontSize: 11,
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {role === 'assistant' ? 'Agent' : role === 'user' ? 'You' : 'Event'}
      </div>
      {content || '…'}
    </article>
  );
}
