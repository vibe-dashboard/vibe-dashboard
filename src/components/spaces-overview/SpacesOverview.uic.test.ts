import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import {
  SpacesOverviewUICLayoutProofPresentation,
  SpacesOverviewUICPageHeaderProof,
} from "./SpacesOverview.uic.view";
import {
  storybookRepoBranches,
  storybookRepos,
  storybookSavedSessions,
  storybookVKWorkspaces,
  storybookWorkspace,
  storybookWorkspaceSummaries,
} from "../../stories/fixtures";

const dashboardWorkspaces: DashboardWorkspace[] = storybookVKWorkspaces.map((workspace) => {
  const summary = storybookWorkspaceSummaries.find((candidate) => candidate.workspace_id === workspace.id);
  return {
    id: workspace.id,
    name: workspace.name || workspace.branch,
    branch: workspace.branch,
    pinned: workspace.pinned,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    task_id: workspace.task_id,
    container_ref: workspace.container_ref,
    files_changed: summary?.files_changed ?? null,
    lines_added: summary?.lines_added ?? null,
    lines_removed: summary?.lines_removed ?? null,
    latest_process_status: summary?.latest_process_status ?? null,
    latest_process_completed_at: summary?.latest_process_completed_at ?? null,
    has_pending_approval: summary?.has_pending_approval ?? false,
    has_running_dev_server: summary?.has_running_dev_server ?? false,
    has_unseen_turns: summary?.has_unseen_turns ?? false,
    pr_status: summary?.pr_status ?? null,
    repos: storybookRepoBranches[workspace.id] ?? [],
  };
});

function renderUICLayout(xml?: string) {
  return renderToStaticMarkup(createElement(SpacesOverviewView, {
    workspace: storybookWorkspace,
    savedSessions: storybookSavedSessions,
    currentSessionId: storybookSavedSessions[0]?.id,
    workspaces: dashboardWorkspaces,
    repos: storybookRepos,
    loading: false,
    error: null,
    stoppingDevServerIds: new Set<string>(),
    onResumeSession: () => undefined,
    onRenameSession: () => undefined,
    onDeleteSession: () => undefined,
    onStartNewSession: () => undefined,
    onNavigateToTabGroup: () => undefined,
    onStopDevServer: () => undefined,
    onOpenWorkspaceInSpace: async () => undefined,
    presentation: (props) => createElement(SpacesOverviewUICLayoutProofPresentation, { ...props, ...(xml ? { xml } : {}) }),
  }));
}

describe("SpacesOverview UIC pageHeader proof", () => {
  it("renders the dev-only pageHeader proof through existing public Myne hooks", () => {
    const html = renderToStaticMarkup(createElement(SpacesOverviewUICPageHeaderProof));

    expect(html).toContain("data-myne-slot=\"page-header\"");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Workspace activity feed");
    expect(html).toContain("UIC pageHeader proof");
  });

  it("falls back to the trusted React pageHeader when XML validation fails", () => {
    const html = renderToStaticMarkup(createElement(SpacesOverviewUICPageHeaderProof, { xml: "<uic:component ref=\"x\" />" }));

    expect(html).toContain("data-myne-slot=\"page-header\"");
    expect(html).toContain("Dashboard");
    expect(html).toContain("uic/xml/generic-component-forbidden");
  });

  it("renders the full dev-only SpacesOverview UIC layout shell through trusted React slots", () => {
    const html = renderUICLayout();

    expect(html).toContain('data-myne-view-pack="uic.spaces.layout-shell.proof"');
    for (const slot of ["page-header", "recent-sessions", "starred-craft", "running-dev-servers", "recently-visited-craft", "recently-created-craft", "workspace-list", "spaces-list"]) {
      expect(html).toContain(`data-myne-slot="${slot}"`);
    }
  });

  it("falls back to the default trusted React layout when the UIC layout shell is invalid", () => {
    const html = renderUICLayout("<uic:component ref=\"x\" />");

    expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
    expect(html).toContain("uic/xml/generic-component-forbidden");
    expect(html).toContain('data-myne-slot="workspace-list"');
  });
});
