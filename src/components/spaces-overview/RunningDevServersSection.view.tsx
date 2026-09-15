import type { DashboardWorkspace } from "./SpacesOverview.contracts";
import { sortDashboardWorkspaces } from "./SpacesOverview.model";
import { WorkspaceRow } from "./workspaceList.view";

export function RunningDevServersSection({
  workspaces,
  loading,
  onStop,
  stoppingIds,
  workspaceTabGroupMap,
  onNavigateToTabGroup,
  onRequestOpenWorkspace,
}: {
  workspaces: DashboardWorkspace[];
  loading: boolean;
  onStop?: (workspaceId: string) => void | Promise<void>;
  stoppingIds: Set<string>;
  workspaceTabGroupMap: Map<
    string,
    { spaceId: string; tabGroupId: string; label: string }
  >;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  onRequestOpenWorkspace?: (workspace: DashboardWorkspace) => void;
}) {
  const devServerWorkspaces = sortDashboardWorkspaces(
    workspaces.filter(
      (ws) => ws.has_running_dev_server || stoppingIds.has(ws.id),
    ),
  );

  if (loading || devServerWorkspaces.length === 0) return null;

  return (
    <div
      className="mb-8 rounded-xl border p-4"
      data-myne-slot="running-dev-servers"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" />
          <h2 className="text-lg font-semibold myne-text myne-text--primary">
            Running Dev Servers
          </h2>
        </div>
        <span className="text-xs myne-text myne-text--muted">
          {devServerWorkspaces.length} workspace
          {devServerWorkspaces.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1">
        {devServerWorkspaces.map((ws) => {
          const nav = workspaceTabGroupMap.get(ws.id);
          const tabGroupNav = nav
            ? {
                ...nav,
                onNavigate: () =>
                  onNavigateToTabGroup(nav.spaceId, nav.tabGroupId),
              }
            : null;
          return (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              isStoppingDevServer={stoppingIds.has(ws.id)}
              onStopDevServer={
                onStop
                  ? () => {
                      void onStop(ws.id);
                    }
                  : undefined
              }
              {...(tabGroupNav ? { tabGroupNav } : {})}
              {...(!tabGroupNav && onRequestOpenWorkspace
                ? {
                    onOpenInNewTabGroup: () => onRequestOpenWorkspace(ws),
                  }
                : {})}
            />
          );
        })}
      </div>
    </div>
  );
}
