import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  CircleDashedIcon,
  CircleIcon,
  ListChecksIcon,
} from '@phosphor-icons/react';
import type { Session } from 'shared/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@vibe/ui/components/Popover';
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

export function WorkspaceBeadsTaskList({
  workspaceId,
  sessions,
  selectedSessionId,
  onRequestHousekeeping,
}: {
  workspaceId: string | undefined;
  sessions: Session[];
  selectedSessionId?: string;
  onRequestHousekeeping: (
    sessionId: string,
    message: string
  ) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['workspaceBeadsTasks', workspaceId] as const;
  const { data, error, refetch } = useQuery({
    queryKey,
    enabled: !!workspaceId,
    staleTime: TASK_POLL_INTERVAL_MS,
    refetchInterval: TASK_POLL_INTERVAL_MS,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/dashboard/api/workspaces/${encodeURIComponent(workspaceId!)}/beads/tasks`,
        { credentials: 'same-origin', signal }
      );
      if (!response.ok)
        throw new Error(
          response.statusText || `Request failed with status ${response.status}`
        );
      return (await response.json()) as WorkspaceTasksResult;
    },
  });
  const [selectedHousekeepingSessionId, setSelectedHousekeepingSessionId] =
    useState('');
  const [isSendingHousekeeping, setIsSendingHousekeeping] = useState(false);

  useEffect(() => {
    setSelectedHousekeepingSessionId(
      selectedSessionId || sessions[0]?.id || ''
    );
  }, [selectedSessionId, sessions]);

  const total = data
    ? data.counts.open + data.counts.inProgress + data.counts.done
    : 0;
  const allCompleted = total > 0 && data?.counts.done === total;
  const hasNonOpenBeads =
    data &&
    Object.values(data.groups).some((tasks) =>
      tasks.some((task) => task.status !== 'open')
    );
  const tooltip = data
    ? `${data.counts.inProgress} in progress, ${data.counts.open} open, ${data.counts.done} done`
    : 'Workspace tasks';

  const handleHousekeeping = async () => {
    if (!selectedHousekeepingSessionId) return;
    setIsSendingHousekeeping(true);
    try {
      const sent = await onRequestHousekeeping(
        selectedHousekeepingSessionId,
        HOUSEKEEPING_MESSAGE
      );
      if (sent) void queryClient.invalidateQueries({ queryKey });
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
              className="flex items-center gap-1 text-default-500 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-focus"
              aria-label="Workspace tasks"
            >
              <div className="relative">
                <ListChecksIcon className="size-icon-base" />
                {allCompleted || hasNonOpenBeads ? (
                  <span
                    role="img"
                    aria-label={
                      allCompleted ? 'All beads completed' : 'Beads activity'
                    }
                    className={`absolute -top-0.5 -right-0.5 size-2 rounded-full ${allCompleted ? 'bg-success' : 'bg-primary'}`}
                  />
                ) : null}
              </div>
            </button>
          </PopoverTrigger>
        </span>
      </Tooltip>
      <PopoverContent
        align="end"
        side="top"
        className="flex w-[25rem] max-w-[calc(100vw-2rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-base overflow-hidden">
          <div className="flex shrink-0 items-start justify-between gap-base">
            <div>
              <h4 className="text-sm font-medium text-foreground">
                Workspace tasks
              </h4>
              <p className="text-xs text-default-500">
                {data ? (
                  <>
                    <span>{data.counts.inProgress} in progress</span>
                    <span aria-hidden> · </span>
                    <span>{data.counts.open} open</span>
                    <span aria-hidden> · </span>
                    <span>{data.counts.done} done</span>
                  </>
                ) : (
                  'Loading bd tasks…'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={!workspaceId}
              className="text-xs text-default-500 hover:text-foreground underline-offset-2 hover:underline"
            >
              Refresh
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded border border-danger/30 bg-danger/10 px-base py-2 text-xs text-danger"
            >
              {error.message}
            </p>
          ) : null}

          {data && !data.initialized ? (
            <p className="rounded border border-divider/30 bg-content2/40 px-base py-2 text-xs text-default-500">
              Workspace beads are not initialized yet at <code>{data.dir}</code>
              .
            </p>
          ) : null}

          {data?.initialized ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
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

          <div className="shrink-0 border-t border-divider/30 pt-base">
            <label
              className="mb-1 block text-xs font-medium text-default-500"
              htmlFor="workspace-beads-housekeeping-session"
            >
              Housekeeping session
            </label>
            <div className="flex gap-base">
              <select
                id="workspace-beads-housekeeping-session"
                className="min-w-0 flex-1 rounded border border-divider/30 bg-background px-2 py-1 text-sm text-foreground"
                value={selectedHousekeepingSessionId}
                onChange={(event) =>
                  setSelectedHousekeepingSessionId(event.target.value)
                }
              >
                {sessions.length === 0 ? (
                  <option value="">No sessions yet</option>
                ) : (
                  sessions.map((session, index) => (
                    <option key={session.id} value={session.id}>
                      {session.name ||
                        (session.id === selectedSessionId
                          ? 'Current session'
                          : index === 0
                            ? 'Latest session'
                            : new Date(session.created_at).toLocaleString())}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={handleHousekeeping}
                disabled={
                  !selectedHousekeepingSessionId || isSendingHousekeeping
                }
                className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingHousekeeping ? 'Requesting…' : 'Request housekeeping'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-default-500">
              Sends: “{HOUSEKEEPING_MESSAGE}”
            </p>
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
    <details
      className="group border-t border-divider/30 py-2 first:border-t-0 first:pt-0"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-base text-sm font-medium text-foreground">
        <span className="flex items-center gap-2">
          {bucketIcon(bucket)}
          {title}
        </span>
        <span className="rounded-full bg-content2 px-2 py-0.5 text-xs text-default-500">
          {tasks.length}
        </span>
      </summary>
      {tasks.length === 0 ? (
        <p className="py-2 pl-6 text-xs text-default-500">
          No tasks in this group.
        </p>
      ) : (
        <ul className="space-y-1 py-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded border border-divider/70 bg-content2/20 px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-base">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-mono text-xs text-default-500">
                      {task.id}
                    </span>
                    <span aria-hidden> · </span>
                    {task.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-default-500">
                    <span>{task.status}</span>
                    {task.priority !== undefined ? (
                      <span>priority {task.priority}</span>
                    ) : null}
                    {task.assignee || task.owner ? (
                      <span>{task.assignee || task.owner}</span>
                    ) : null}
                    {task.forms.hasForms ? (
                      <span>
                        {task.forms.pendingResponseCount} pending forms
                      </span>
                    ) : null}
                  </p>
                </div>
                {task.forms.hasForms ? (
                  <a
                    className="shrink-0 text-xs text-primary hover:underline"
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
  if (bucket === 'done')
    return <CheckIcon className="size-icon-sm text-success" />;
  if (bucket === 'inProgress')
    return <CircleDashedIcon className="size-icon-sm text-primary" />;
  return <CircleIcon className="size-icon-sm text-default-500" />;
}
