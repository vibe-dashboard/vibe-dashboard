import React from "react";
import { Link, useSearchParams } from "react-router";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useModule } from "../hooks/useModule";
import { getStoredLastDashboardUrl } from "../lib/voyageUrl";
import { getBuiltInWorkspaceMetadata } from "../modules/plugins/vibe-dashboard/craft-surfaces";
import { ReactCraftSurfaceHost } from "../modules/plugins/vibe-dashboard/react-craft-surfaces";

type PaneSide = "left" | "right";

export function AgentSplitViewPage() {
  const workspace = useModule("workspace").states.workspace.useState();
  const [params, setParams] = useSearchParams();
  const crafts = workspace.tabGroups.flatMap((craft) => {
    const metadata = getBuiltInWorkspaceMetadata(craft);
    return metadata
      ? [{
          id: craft.id,
          label: craft.label || metadata.workspaceId,
          workspaceId: metadata.workspaceId,
        }]
      : [];
  });
  const left = crafts.find((craft) => craft.id === params.get("left"));
  const right = crafts.find((craft) => craft.id === params.get("right"));
  const duplicateWorkspace = Boolean(
    left && right && left.workspaceId === right.workspaceId,
  );
  const requestedSize = Number(params.get("size") ?? 50);
  const leftSize = Number.isFinite(requestedSize)
    ? Math.min(80, Math.max(20, requestedSize))
    : 50;
  const backPath = getStoredLastDashboardUrl() || "/";

  const renderPane = (side: PaneSide) => {
    const selected = side === "left" ? left : right;
    const other = side === "left" ? right : left;
    const label = side === "left" ? "Left workspace" : "Right workspace";
    const unavailable = Boolean(params.get(side) && !selected);
    const canRender = selected && !(side === "right" && duplicateWorkspace);

    return (
      <section
        aria-label={`${side === "left" ? "Left" : "Right"} Agent pane`}
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex items-center gap-2 border-b border-divider bg-content1 p-3">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-default-500">{label}</span>
            <select
              aria-label={label}
              value={selected?.id ?? ""}
              className="w-full rounded border border-divider bg-background p-2 text-foreground"
              onChange={(event) => {
                const id = event.target.value;
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    if (id) next.set(side, id);
                    else next.delete(side);
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              <option value="">Choose a workspace…</option>
              {crafts.map((craft) => (
                <option
                  key={craft.id}
                  value={craft.id}
                  disabled={craft.workspaceId === other?.workspaceId}
                >
                  {craft.label} ({craft.workspaceId.slice(0, 8)})
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className="relative min-h-0 flex-1">
          {canRender ? (
            <ReactCraftSurfaceHost
              key={selected.id}
              target={{
                kind: "react",
                pluginId: "vd.built-in",
                surfaceKey: "agent-chat",
                props: {
                  workspaceId: selected.workspaceId,
                  surfaceId: `${selected.id}:split-view:${side}`,
                },
              }}
            />
          ) : (
            <div
              className="flex h-full items-center justify-center p-6 text-center text-default-500"
              role="status"
            >
              {unavailable
                ? "This craft is no longer available. Choose another workspace."
                : duplicateWorkspace && side === "right"
                  ? "Choose a different workspace for each pane."
                  : "Choose a workspace above to open its Agent."}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-divider px-4 py-3">
        <h1 className="text-lg font-semibold">Workspace split view</h1>
        <Link
          to={backPath}
          className="rounded border border-divider px-3 py-2 text-sm hover:bg-content2"
        >
          Back to dashboard
        </Link>
      </header>
      {crafts.length === 0 && (
        <p role="status" className="p-4 text-default-500">
          Open workspace crafts from the dashboard to use split view.
        </p>
      )}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(layout) => {
          const size = Math.round(layout.left ?? leftSize);
          if (!Number.isFinite(size) || size === Math.round(leftSize)) return;
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set("size", String(size));
              return next;
            },
            { replace: true },
          );
        }}
      >
        <Panel id="left" defaultSize={`${leftSize}%`} minSize="20%">
          {renderPane("left")}
        </Panel>
        <Separator
          aria-label="Resize workspace panes"
          className="w-1 shrink-0 cursor-col-resize bg-content2 hover:bg-primary"
        />
        <Panel id="right" defaultSize={`${100 - leftSize}%`} minSize="20%">
          {renderPane("right")}
        </Panel>
      </Group>
    </main>
  );
}
