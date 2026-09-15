import type {
  DashboardWorkspace,
  SpacesOverviewRepo,
} from "./SpacesOverview.contracts";
import {
  MyneAction,
  MyneBadge,
  MyneText,
} from "../../theme/skins";

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function StatusBadge({
  status,
  hasPendingApproval,
}: {
  status: DashboardWorkspace["latest_process_status"];
  hasPendingApproval: boolean;
}) {
  if (hasPendingApproval) {
    return (
      <MyneBadge
        className="px-2 py-0.5 rounded-full text-xs font-medium border "
        status="warning"
      >
        Waiting
      </MyneBadge>
    );
  }

  switch (status) {
    case "running":
      return (
        <MyneBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1"
          status="success"
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" />
          Running
        </MyneBadge>
      );
    case "completed":
      return (
        <MyneBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium border "
          status="accent"
        >
          Done
        </MyneBadge>
      );
    case "failed":
    case "killed":
      return (
        <MyneBadge
          className="px-2 py-0.5 rounded-full text-xs font-medium border "
          status="danger"
        >
          {status === "failed" ? "Failed" : "Killed"}
        </MyneBadge>
      );
    default:
      return null;
  }
}

export function PRBadge({
  status,
}: {
  status: "open" | "merged" | "closed" | "unknown";
}) {
  const styles = {
    open: "",
    merged: "",
    closed: "",
    unknown: "",
  };
  const tones = {
    open: "success",
    merged: "accent",
    closed: "danger",
    unknown: "secondary",
  } as const;

  return (
    <MyneBadge
      className={`px-1.5 py-0.5 rounded text-xs border ${styles[status]}`}
      status={tones[status]}
    >
      PR {status}
    </MyneBadge>
  );
}

export function RepoFilterBar({
  repos,
  selectedRepoId,
  onSelectRepo,
}: {
  repos: SpacesOverviewRepo[];
  selectedRepoId: string | null;
  onSelectRepo: (repoId: string | null) => void;
}) {
  const active =
    "px-3 py-1 rounded-full text-xs font-medium border ";
  const inactive =
    "px-3 py-1 rounded-full text-xs font-medium border border-transparent transition-colors";

  return (
    <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
      <MyneAction
        className={selectedRepoId === null ? active : inactive}
        tone={selectedRepoId === null ? "accent" : "quiet"}
        onClick={() => onSelectRepo(null)}
        type="button"
      >
        All
      </MyneAction>
      {repos.map((repo) => (
        <MyneAction
          key={repo.id}
          className={selectedRepoId === repo.id ? active : inactive}
          tone={selectedRepoId === repo.id ? "accent" : "quiet"}
          onClick={() => onSelectRepo(repo.id)}
          type="button"
        >
          {repo.display_name || repo.name}
        </MyneAction>
      ))}
    </div>
  );
}

export function WorkspaceRow({
  workspace: ws,
  tabGroupNav,
  onOpenInNewTabGroup,
  isStoppingDevServer,
  onStopDevServer,
}: {
  workspace: DashboardWorkspace;
  tabGroupNav?: {
    spaceId: string;
    tabGroupId: string;
    label: string;
    onNavigate: () => void;
  };
  onOpenInNewTabGroup?: () => void;
  isStoppingDevServer?: boolean;
  onStopDevServer?: () => void;
}) {
  const activityTime = ws.latest_process_completed_at || ws.updated_at;
  const hasDiffStats =
    ws.files_changed != null ||
    ws.lines_added != null ||
    ws.lines_removed != null;
  const showsDevServerControls =
    ws.has_running_dev_server || isStoppingDevServer;

  return (
    <div
      className="flex flex-col gap-3 px-4 py-3 rounded-lg border transition-colors sm:flex-row sm:items-start myne-row"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* Unseen dot */}
        <div className="w-2 shrink-0 pt-2">
          {ws.has_unseen_turns && (
            <span className="block w-2 h-2 rounded-full " />
          )}
        </div>

        {/* Name + metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {ws.pinned && (
              <MyneText className="text-xs" status="warning">
                *
              </MyneText>
            )}
            <MyneText
              className="min-w-0 text-sm font-medium break-words"
            >
              {ws.name}
            </MyneText>
          </div>
          <div
            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs myne-text myne-text--muted"
          >
            <span className="font-mono break-all">{ws.branch}</span>
            {ws.repos.map((r) => (
              <MyneBadge
                key={r.id}
                className="rounded px-1.5 py-0.5"
              >
                {r.display_name || r.name}
              </MyneBadge>
            ))}
            {hasDiffStats && (
              <>
                {ws.files_changed != null && (
                  <span>{ws.files_changed} file{ws.files_changed !== 1 ? "s" : ""}</span>
                )}
                {ws.lines_added != null && ws.lines_added > 0 && (
                  <MyneText className="font-mono" status="success">
                    +{ws.lines_added}
                  </MyneText>
                )}
                {ws.lines_removed != null && ws.lines_removed > 0 && (
                  <MyneText className="font-mono" status="danger">
                    -{ws.lines_removed}
                  </MyneText>
                )}
              </>
            )}
            {showsDevServerControls && (
              <MyneBadge
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium"
                status="accent"
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" />
                Dev server
              </MyneBadge>
            )}
            {ws.pr_status && ws.pr_status !== "unknown" && (
              <PRBadge status={ws.pr_status} />
            )}
            {(ws.latest_process_status || ws.has_pending_approval) && (
              <StatusBadge
                status={ws.latest_process_status}
                hasPendingApproval={ws.has_pending_approval}
              />
            )}
            <span>{formatRelativeTime(activityTime)}</span>
          </div>
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-wrap justify-start gap-2 pl-5 sm:w-auto sm:justify-end sm:pl-0">
        {showsDevServerControls && onStopDevServer && (
          <MyneAction
            onClick={onStopDevServer}
            disabled={isStoppingDevServer}
            className="px-2 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            tone="danger"
            type="button"
          >
            {isStoppingDevServer ? "Stopping..." : "Stop server"}
          </MyneAction>
        )}

        {tabGroupNav ? (
          <MyneAction
            onClick={tabGroupNav.onNavigate}
            title={`Go to "${tabGroupNav.label}"`}
            className="px-2 py-1 rounded text-xs font-medium border transition-colors"
            tone="accent"
            type="button"
          >
            Go to craft
          </MyneAction>
        ) : onOpenInNewTabGroup ? (
          <MyneAction
            onClick={onOpenInNewTabGroup}
            aria-label={`Open ${ws.name}`}
            className="px-2 py-1 rounded text-xs font-medium border transition-colors"
            tone="quiet"
            type="button"
          >
            Open
          </MyneAction>
        ) : null}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-4">
      <MyneText className="text-xs" tone="muted">
        Page {page + 1} of {totalPages}
      </MyneText>
      <div className="flex gap-2">
        <MyneAction
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed "
          tone="quiet"
          type="button"
        >
          Previous
        </MyneAction>
        <MyneAction
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed "
          tone="quiet"
          type="button"
        >
          Next
        </MyneAction>
      </div>
    </div>
  );
}
