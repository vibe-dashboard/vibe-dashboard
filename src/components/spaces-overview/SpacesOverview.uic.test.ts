import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import {
  UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET,
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

function renderUICLayout(xml?: string, overrides: Partial<React.ComponentProps<typeof SpacesOverviewView>> = {}) {
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
    ...overrides,
    presentation: (props) => createElement(SpacesOverviewUICLayoutProofPresentation, { ...props, ...(xml ? { xml } : {}) }),
  }));
}

function runningDevServersRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="running-dev-servers"'), html.indexOf('data-myne-slot="recently-visited-craft"'));
}

function recentlyVisitedRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recently-visited-craft"'), html.indexOf('data-myne-slot="recently-created-craft"'));
}

function runningWorkspace(overrides: Partial<DashboardWorkspace> = {}): DashboardWorkspace {
  const base = dashboardWorkspaces.find((workspace) => workspace.has_running_dev_server) ?? dashboardWorkspaces[0]!;
  return { ...base, id: "uic-running", name: "UIC running", branch: "vk/uic-running", has_running_dev_server: true, ...overrides };
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

  it("lets UIC own read-only running dev servers ready rendering without mutation controls", () => {
    const html = renderUICLayout();
    const region = runningDevServersRegion(html);

    expect(html).toContain("data-uic-owned-region=\"running-dev-servers\"");
    expect(region).toContain("Read-only UIC resource");
    expect(region).toContain("Auth bug fix");
    expect(region).not.toContain("Stop server");
    expect(region).not.toContain("Go to craft");
  });

  it("lets UIC own loading and empty states for running dev servers", () => {
    expect(renderUICLayout(undefined, { loading: true, workspaces: [] })).toContain("Loading running development servers");
    expect(renderUICLayout(undefined, { workspaces: [] })).toContain("No running development servers");
  });

  it("caps UIC running-dev-server rows and repo labels deterministically", () => {
    const workspaces = Array.from({ length: UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows + 2 }, (_, index) =>
      runningWorkspace({
        id: `uic-running-${index}`,
        name: `UIC running ${index}`,
        repos: Array.from({ length: UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow + 2 }, (_repo, repoIndex) => ({
          id: `repo-${index}-${repoIndex}`,
          name: `repo-${repoIndex}`,
          display_name: `Repo ${repoIndex}`,
          target_branch: "main",
        })),
      }),
    );
    const region = runningDevServersRegion(renderUICLayout(undefined, { workspaces }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain(`UIC running ${UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`UIC running ${UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRows}`);
    expect(region).toContain(`Repo ${UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow - 1}`);
    expect(region).not.toContain(`Repo ${UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelsPerRow}`);
  });

  it("diagnoses duplicate row IDs and renders the first matching row only", () => {
    const workspaces = [
      runningWorkspace({ id: "dupe", name: "First duplicate" }),
      runningWorkspace({ id: "dupe", name: "Second duplicate" }),
    ];
    const region = runningDevServersRegion(renderUICLayout(undefined, { workspaces }));

    expect(region).toContain("uic/resource/duplicate-row-id");
    expect(region).toContain("First duplicate");
    expect(region).not.toContain("Second duplicate");
  });

  it("caps long running-dev-server labels before rendering", () => {
    const longName = `Name-${"n".repeat(UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxLabelLength + 20)}`;
    const longBranch = `branch-${"b".repeat(UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxBranchLength + 20)}`;
    const longRepo = `Repo-${"r".repeat(UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelLength + 20)}`;
    const region = runningDevServersRegion(renderUICLayout(undefined, {
      workspaces: [runningWorkspace({
        name: longName,
        branch: longBranch,
        repos: [{ id: "repo-long", name: "repo-long", display_name: longRepo, target_branch: "main" }],
      })],
    }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longName);
    expect(region).not.toContain(longBranch);
    expect(region).not.toContain(longRepo);
    expect(region).toContain(longName.slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxLabelLength));
    expect(region).toContain(longBranch.slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxBranchLength));
    expect(region).toContain(longRepo.slice(0, UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET.maxRepoLabelLength));
  });

  it("uses finite UIC empty/ready/list semantics for recently visited craft without mutation controls", () => {
    const readyRegion = recentlyVisitedRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).not.toContain("<button");
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");

    const emptyWorkspace = { ...storybookWorkspace, tabGroups: storybookWorkspace.tabGroups.map((tabGroup) => ({ ...tabGroup, lastVisitedAt: undefined })) };
    const emptyRegion = recentlyVisitedRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }));
    expect(emptyRegion).toContain("No recently visited craft");
  });
});
