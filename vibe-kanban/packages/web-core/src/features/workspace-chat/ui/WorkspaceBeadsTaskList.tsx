import { useCallback, useEffect, useState } from 'react';
import {
  CheckIcon,
  CircleDashedIcon,
  CircleIcon,
  ListChecksIcon,
  SpinnerIcon,
} from '@phosphor-icons/react';
import type { Session } from 'shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@vibe/ui/components/Popover';
import { Tooltip } from '@vibe/ui/components/Tooltip';

const HOUSEKEEPING_MESSAGE = "Please do housekeeping on this workspace's beads";
const TASK_POLL_INTERVAL_MS = 20_000;

type TaskBucket = 'open' | 'inProgress' | 'done';

type WorkspaceTask = {
  id: string;
  title: string;
  status: string;
  statusBucket: TaskBucket;
  priority?: number;
  assignee?: string;
  owner?: string;
  labels: string[];
  forms: {
    hasForms: boolean;
    hasPendingAnswer: boolean;
    pendingResponseCount: number;
    formIds: string[];
    pendingFormIds: string[];
  };
};

type WorkspaceTasksResult = {
  workspaceId: string;
  dir: string;
  initialized: boolean;
  counts: Record<TaskBucket, number>;
  groups: Record<TaskBucket, WorkspaceTask[]>;
  updateStrategy: { intervalMs: number };
  error?: string;
};

type LoadState =
  | { status: 'loading'; data?: WorkspaceTasksResult; error?: undefined }
  | { status: 'ready'; data: WorkspaceTasksResult; error?: undefined }
  | { status: 'error'; data?: WorkspaceTasksResult; error: string };

export function WorkspaceBeadsTaskList({
  workspaceId,
  sessions,
  selectedSessionId,
  onRequestHousekeeping,
}: {
  workspaceId: string | undefined;
  sessions: Session[];
  selectedSessionId?: string;
  onRequestHousekeeping: (sessionId: string, message: string) => Promise<boolean>;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selectedHousekeepingSessionId, setSelectedHousekeepingSessionId] = useState('');
  const [isSendingHousekeeping, setIsSendingHousekeeping] = useState(false);

  useEffect(() => {
    setSelectedHousekeepingSessionId(selectedSessionId || sessions[0]?.id || '');
  }, [selectedSessionId, sessions]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!workspaceId) return;
    setState((current) => ({ status: 'loading', data: current.data }));
    try {
      const response = await fetch(`/dashboard/api/workspaces/${encodeURIComponent(workspaceId)}/beads/tasks`, {
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) throw new Error(response.statusText || `Request failed with status ${response.status}`);
      const data = await response.json() as WorkspaceTasksResult;
      setState({ status: 'ready', data });
    } catch (error) {
      if (signal?.aborted) return;
      setState((current) => ({
        status: 'error',
        data: current.data,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const controller = new AbortController();
    void load(controller.signal);

    const poll = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void load();
    };
    const interval = window.setInterval(poll, TASK_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load, workspaceId]);

  const data = state.data;
  const total = data
    ? data.counts.open + data.counts.inProgress + data.counts.done
    : 0;
  const tooltip = data
    ? `${data.counts.inProgress} in progress, ${data.counts.open} open, ${data.counts.done} done`
    : 'Workspace tasks';

  const handleHousekeeping = async () => {
    if (!selectedHousekeepingSessionId) return;
    setIsSendingHousekeeping(true);
    try {
      const sent = await onRequestHousekeeping(selectedHousekeepingSessionId, HOUSEKEEPING_MESSAGE);
      if (sent) void load();
    } finally {
      setIsSendingHousekeeping(false);
    }
  };

  return (
    <Popover>
      <Tooltip content={tooltip} side="bottom">
        <span className="inline-flex">
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-low hover:text-normal transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              aria-label="Workspace tasks"
            >
              <div className="relative">
                <ListChecksIcon className="size-icon-base" />
                {state.status === 'loading' ? (
                  <SpinnerIcon className="absolute -top-1 -right-1 size-3 animate-spin text-blue-500" />
                ) : total > 0 ? (
                  <span className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-blue-500 px-0.5 text-[8px] leading-none text-white">
                    {total > 9 ? '9+' : total}
                  </span>
                ) : null}
              </div>
            </button>
          </PopoverTrigger>
        </span>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[25rem] max-w-[calc(100vw-2rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-hidden"
      >
        <div className="flex min-h-0 flex-col gap-base">
          <div className="flex items-start justify-between gap-base">
            <div>
              <h4 className="text-sm font-medium text-normal">Workspace tasks</h4>
              <p className="text-xs text-low">
                {data ? (
                  <>
                    <span>{data.counts.inProgress} in progress</span>
                    <span aria-hidden> · </span>
                    <span>{data.counts.open} open</span>
                    <span aria-hidden> · </span>
                    <span>{data.counts.done} done</span>
                  </>
                ) : 'Loading bd tasks…'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs text-low hover:text-normal underline-offset-2 hover:underline"
            >
              Refresh
            </button>
          </div>

          {state.status === 'error' ? (
            <p role="alert" className="rounded border border-error/30 bg-error/10 px-base py-2 text-xs text-error">
              {state.error}
            </p>
          ) : null}

          {data && !data.initialized ? (
            <p className="rounded border border-secondary bg-secondary/40 px-base py-2 text-xs text-low">
              Workspace beads are not initialized yet at <code>{data.dir}</code>.
            </p>
          ) : null}

          {data?.initialized ? (
            <div className="min-h-0 overflow-y-auto pr-1">
              <TaskSection
                workspaceId={data.workspaceId}
                title="In progress"
                bucket="inProgress"
                tasks={data.groups.inProgress}
                defaultOpen
              />
              <TaskSection
                workspaceId={data.workspaceId}
                title="Open"
                bucket="open"
                tasks={data.groups.open}
                defaultOpen
              />
              <TaskSection
                workspaceId={data.workspaceId}
                title="Done / closed"
                bucket="done"
                tasks={data.groups.done}
              />
            </div>
          ) : null}

          <div className="border-t border-secondary pt-base">
            <label className="mb-1 block text-xs font-medium text-low" htmlFor="workspace-beads-housekeeping-session">
              Housekeeping session
            </label>
            <div className="flex gap-base">
              <select
                id="workspace-beads-housekeeping-session"
                className="min-w-0 flex-1 rounded border border-secondary bg-primary px-2 py-1 text-sm text-normal"
                value={selectedHousekeepingSessionId}
                onChange={(event) => setSelectedHousekeepingSessionId(event.target.value)}
              >
                {sessions.length === 0 ? (
                  <option value="">No sessions yet</option>
                ) : sessions.map((session, index) => (
                  <option key={session.id} value={session.id}>
                    {session.name || (session.id === selectedSessionId ? 'Current session' : index === 0 ? 'Latest session' : new Date(session.created_at).toLocaleString())}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleHousekeeping}
                disabled={!selectedHousekeepingSessionId || isSendingHousekeeping}
                className="rounded bg-brand px-3 py-1 text-sm text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingHousekeeping ? 'Requesting…' : 'Request housekeeping'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-low">Sends: “{HOUSEKEEPING_MESSAGE}”</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TaskSection({
  workspaceId,
  title,
  bucket,
  tasks,
  defaultOpen = false,
}: {
  workspaceId: string;
  title: string;
  bucket: TaskBucket;
  tasks: WorkspaceTask[];
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-t border-secondary py-2 first:border-t-0 first:pt-0" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-base text-sm font-medium text-normal">
        <span className="flex items-center gap-2">
          {bucketIcon(bucket)}
          {title}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-low">{tasks.length}</span>
      </summary>
      {tasks.length === 0 ? (
        <p className="py-2 pl-6 text-xs text-low">No tasks in this group.</p>
      ) : (
        <ul className="space-y-1 py-2">
          {tasks.map((task) => (
            <li key={task.id} className="rounded border border-secondary/70 bg-secondary/20 px-2 py-1.5">
              <div className="flex items-start justify-between gap-base">
                <div className="min-w-0">
                  <p className="truncate text-sm text-normal">
                    <span className="font-mono text-xs text-low">{task.id}</span>
                    <span aria-hidden> · </span>
                    {task.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-low">
                    <span>{task.status}</span>
                    {task.priority !== undefined ? <span>priority {task.priority}</span> : null}
                    {task.assignee || task.owner ? <span>{task.assignee || task.owner}</span> : null}
                    {task.forms.hasForms ? <span>{task.forms.pendingResponseCount} pending forms</span> : null}
                  </p>
                </div>
                {task.forms.hasForms ? (
                  <a
                    className="shrink-0 text-xs text-brand hover:underline"
                    href={`/dashboard/forms?workspace=${encodeURIComponent(workspaceId)}&bead=${encodeURIComponent(task.id)}`}
                  >
                    Forms
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function bucketIcon(bucket: TaskBucket) {
  if (bucket === 'done') return <CheckIcon className="size-icon-sm text-success" />;
  if (bucket === 'inProgress') return <CircleDashedIcon className="size-icon-sm text-blue-500" />;
  return <CircleIcon className="size-icon-sm text-low" />;
}
