import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";
import { formatRelativeTime, Pagination } from "./workspaceList.view";

export function DenseWorkspaceListSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"workspaceList">) {
  const {
    loading,
    error,
    selectedRepoId,
    sortedWorkspaces,
    pagedWorkspaces,
    workspacePage,
    workspaceTotalPages,
    stoppingDevServerIds,
    workspaceTabGroupMap,
    canOpenWorkspaceInSpace,
  } = model;

  return (
    <div
      className="mb-10 rounded-xl border "
      data-myne-slot="workspace-list"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-sm font-semibold uppercase tracking-[0.16em] myne-text myne-text--primary"
          >
            VK Workspaces
          </h2>
          {!loading && sortedWorkspaces.length > 0 && (
            <p className="mt-1 text-xs myne-text myne-text--muted">
              {sortedWorkspaces.length} workspace
              {sortedWorkspaces.length !== 1 ? "s" : ""}
              {selectedRepoId ? " in this repository" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={`myne-button rounded-full border px-3 py-1 text-xs font-medium ${
              selectedRepoId === null
                ? "myne-button--accent"
                : "myne-button--quiet"
            }`}
            onClick={() => actions.selectRepo(null)}
          >
            All
          </button>
          {model.effectiveRepos.map((repo) => (
            <button
              key={repo.id}
              className={`myne-button rounded-full border px-3 py-1 text-xs font-medium ${
                selectedRepoId === repo.id
                  ? "myne-button--accent"
                  : "myne-button--quiet"
              }`}
              onClick={() => actions.selectRepo(repo.id)}
            >
              {repo.display_name || repo.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
          <div className="myne-state myne-state--loading myne-text myne-text--muted px-4 py-8 text-center text-sm">
          Loading workspaces…
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center myne-state myne-state--error">
          <p className="text-sm myne-text myne-text--secondary">
            {error}
          </p>
          <p className="mt-1 text-xs myne-text myne-text--muted">
            VK backend may not be running
          </p>
        </div>
      ) : sortedWorkspaces.length === 0 ? (
          <div className="myne-state myne-state--empty myne-text myne-text--muted px-4 py-8 text-center text-sm">
          {selectedRepoId
            ? "No workspaces for this repository"
            : "No active workspaces"}
        </div>
      ) : (
        <>
          <div className="divide-y divide-zinc-800">
            {pagedWorkspaces.map((workspace) => {
              const nav = workspaceTabGroupMap.get(workspace.id);
              const isStopping = stoppingDevServerIds.has(workspace.id);
              const canStop = workspace.has_running_dev_server || isStopping;
              return (
                <div
                  key={workspace.id}
                  className="grid gap-3 px-4 py-2.5 text-xs sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center myne-row"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {workspace.has_unseen_turns && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full " />
                      )}
                      {workspace.pinned && (
                        <span className="shrink-0 myne-status myne-status--warning">
                          *
                        </span>
                      )}
                      <span className="truncate font-medium myne-text myne-text--primary">
                        {workspace.name}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono myne-text myne-text--muted">
                      {workspace.branch}
                    </div>
                  </div>

                  <div
                    className="flex min-w-0 flex-wrap items-center gap-2 myne-text myne-text--muted"
                  >
                    {workspace.repos.slice(0, 2).map((repo) => (
                      <span
                        key={repo.id}
                        className="rounded px-1.5 py-0.5 myne-badge"
                      >
                        {repo.display_name || repo.name}
                      </span>
                    ))}
                    {workspace.files_changed != null && (
                      <span>{workspace.files_changed} files</span>
                    )}
                    {workspace.lines_added != null &&
                      workspace.lines_added > 0 && (
                        <span
                          className="font-mono myne-status myne-status--success"
                        >
                          +{workspace.lines_added}
                        </span>
                      )}
                    {workspace.lines_removed != null &&
                      workspace.lines_removed > 0 && (
                        <span
                          className="font-mono myne-status myne-status--danger"
                        >
                          -{workspace.lines_removed}
                        </span>
                      )}
                    <span>
                      {formatRelativeTime(
                        workspace.latest_process_completed_at ||
                          workspace.updated_at,
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {canStop && (
                        <button
                          className="myne-button myne-button--danger rounded border px-2 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isStopping}
                        onClick={() => actions.stopDevServer(workspace.id)}
                      >
                        {isStopping ? "Stopping…" : "Stop"}
                      </button>
                    )}
                    {nav ? (
                      <button
                        className="rounded border px-2 py-1 font-medium myne-button myne-button--accent"
                        title={`Go to "${nav.label}"`}
                        onClick={() =>
                          actions.navigateToTabGroup(
                            nav.spaceId,
                            nav.tabGroupId,
                          )
                        }
                      >
                        Craft
                      </button>
                    ) : canOpenWorkspaceInSpace ? (
                        <button
                          className="myne-button myne-button--quiet rounded border px-2 py-1 font-medium"
                          aria-label={`Open ${workspace.name}`}
                        onClick={() =>
                          actions.openSpacePickerForWorkspace(workspace)
                        }
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 pb-3">
            <Pagination
              page={workspacePage}
              totalPages={workspaceTotalPages}
              onPageChange={actions.setWorkspacePage}
            />
          </div>
        </>
      )}
    </div>
  );
}
