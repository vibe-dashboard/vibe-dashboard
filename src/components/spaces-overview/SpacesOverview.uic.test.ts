import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import {
  UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET,
  UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET,
  UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET,
  UIC_STARRED_CRAFT_RESOURCE_BUDGET,
  SpacesOverviewUICLayoutProofPresentation,
  SpacesOverviewUICPageHeaderProof,
  projectUICRecentlyCreatedCraftResource,
  projectUICRecentlyVisitedCraftResource,
  projectUICStarredCraftResource,
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

function starredCraftRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="starred-craft"'), html.indexOf('data-uic-owned-region="running-dev-servers"'));
}

function recentlyVisitedRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recently-visited-craft"'), html.indexOf('data-myne-slot="recently-created-craft"'));
}

function recentlyCreatedRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recently-created-craft"'), html.indexOf('data-myne-slot="workspace-list"'));
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
    expect(readyRegion).toContain("3 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).not.toContain("<button");
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");

    const emptyWorkspace = { ...storybookWorkspace, tabGroups: storybookWorkspace.tabGroups.map((tabGroup) => ({ ...tabGroup, lastVisitedAt: undefined })) };
    const emptyRegion = recentlyVisitedRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }));
    expect(emptyRegion).toContain("No recently visited craft");
  });

  it("caps UIC recently visited craft rows deterministically before rendering", () => {
    const tabGroups = Array.from({ length: UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxRows + 2 }, (_, index) => ({
      ...storybookWorkspace.tabGroups[1]!,
      id: `tg-uic-${index}`,
      label: `Visited craft ${index}`,
      lastVisitedAt: `2026-06-27T13:${String(59 - index).padStart(2, "0")}:00.000Z`,
    }));
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, tabGroupIds: tabGroups.map((tabGroup) => tabGroup.id) }],
      tabGroups,
    };
    const region = recentlyVisitedRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain(`Visited craft ${UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`Visited craft ${UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxRows}`);
  });

  it("diagnoses duplicate recently visited craft IDs and renders the first matching row only", () => {
    const resource = projectUICRecentlyVisitedCraftResource({
      tabGroupDisplayLabelById: new Map([["dupe", "First duplicate"]]),
      recentlyVisited: {
        page: 0,
        totalPages: 1,
        items: [
          { space: { ...storybookWorkspace.spaces[1]!, name: "First space" }, tg: { ...storybookWorkspace.tabGroups[1]!, id: "dupe", label: "First fallback" } },
          { space: { ...storybookWorkspace.spaces[2]!, name: "Second space" }, tg: { ...storybookWorkspace.tabGroups[2]!, id: "dupe", label: "Second duplicate" } },
        ],
      },
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: ["uic/resource/duplicate-row-id"] });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.items).toHaveLength(1);
    expect(resource.items[0]?.label).toBe("First duplicate");
    expect(resource.items[0]?.meta).toContain("First space");
  });

  it("caps long recently visited craft labels and metadata before rendering", () => {
    const longLabel = `Craft-${"c".repeat(UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxLabelLength + 20)}`;
    const longSpace = `Space-${"s".repeat(UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength + 20)}`;
    const tabGroup = {
      ...storybookWorkspace.tabGroups[1]!,
      id: "tg-long",
      label: longLabel,
      lastVisitedAt: "2026-06-27T13:00:00.000Z",
    };
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, name: longSpace, tabGroupIds: [tabGroup.id] }],
      tabGroups: [tabGroup],
    };
    const region = recentlyVisitedRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longLabel);
    expect(region).not.toContain(longSpace);
    expect(region).toContain(longLabel.slice(0, UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxLabelLength));
    expect(region).toContain(longSpace.slice(0, UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength));
  });

  it("uses finite UIC empty/ready/list semantics for recently created craft without mutation controls", () => {
    const readyRegion = recentlyCreatedRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("3 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).not.toContain("<button");
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");

    const emptyWorkspace = { ...storybookWorkspace, tabGroups: storybookWorkspace.tabGroups.map((tabGroup) => ({ ...tabGroup, createdAt: undefined })) };
    const emptyRegion = recentlyCreatedRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }));
    expect(emptyRegion).toContain("No recently created craft");
  });

  it("caps UIC recently created craft rows deterministically before rendering", () => {
    const tabGroups = Array.from({ length: UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxRows + 2 }, (_, index) => ({
      ...storybookWorkspace.tabGroups[1]!,
      id: `tg-created-uic-${index}`,
      label: `Created craft ${index}`,
      createdAt: `2026-06-27T13:${String(59 - index).padStart(2, "0")}:00.000Z`,
    }));
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, tabGroupIds: tabGroups.map((tabGroup) => tabGroup.id) }],
      tabGroups,
    };
    const region = recentlyCreatedRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain(`Created craft ${UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`Created craft ${UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxRows}`);
  });

  it("diagnoses duplicate recently created craft IDs and renders the first matching row only", () => {
    const resource = projectUICRecentlyCreatedCraftResource({
      tabGroupDisplayLabelById: new Map([["created-dupe", "First created duplicate"]]),
      recentlyCreated: {
        page: 0,
        totalPages: 1,
        items: [
          { space: { ...storybookWorkspace.spaces[1]!, name: "First created space" }, tg: { ...storybookWorkspace.tabGroups[1]!, id: "created-dupe", label: "First fallback" } },
          { space: { ...storybookWorkspace.spaces[2]!, name: "Second created space" }, tg: { ...storybookWorkspace.tabGroups[2]!, id: "created-dupe", label: "Second duplicate" } },
        ],
      },
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: ["uic/resource/duplicate-row-id"] });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.items).toHaveLength(1);
    expect(resource.items[0]?.label).toBe("First created duplicate");
    expect(resource.items[0]?.meta).toContain("First created space");
  });

  it("caps long recently created craft labels and metadata before rendering", () => {
    const longLabel = `Created-${"c".repeat(UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxLabelLength + 20)}`;
    const longSpace = `CreatedSpace-${"s".repeat(UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength + 20)}`;
    const tabGroup = {
      ...storybookWorkspace.tabGroups[1]!,
      id: "tg-created-long",
      label: longLabel,
      createdAt: "2026-06-27T13:00:00.000Z",
    };
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, name: longSpace, tabGroupIds: [tabGroup.id] }],
      tabGroups: [tabGroup],
    };
    const region = recentlyCreatedRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longLabel);
    expect(region).not.toContain(longSpace);
    expect(region).toContain(longLabel.slice(0, UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxLabelLength));
    expect(region).toContain(longSpace.slice(0, UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength));
  });

  it("uses finite UIC empty/ready/list semantics for starred craft without navigation controls", () => {
    const readyRegion = starredCraftRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("1 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).not.toContain("<button");

    const emptyWorkspace = { ...storybookWorkspace, tabGroups: storybookWorkspace.tabGroups.map((tabGroup) => ({ ...tabGroup, starred: false })) };
    const emptyRegion = starredCraftRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }));
    expect(emptyRegion).toContain("No starred craft");
  });

  it("caps UIC starred craft rows deterministically before rendering", () => {
    const tabGroups = Array.from({ length: UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxRows + 2 }, (_, index) => ({
      ...storybookWorkspace.tabGroups[1]!,
      id: `tg-starred-uic-${index}`,
      label: `Starred craft ${index}`,
      starred: true,
    }));
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, tabGroupIds: tabGroups.map((tabGroup) => tabGroup.id) }],
      tabGroups,
    };
    const region = starredCraftRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain(`Starred craft ${UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`Starred craft ${UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxRows}`);
  });

  it("diagnoses duplicate starred craft IDs and renders the first matching row only", () => {
    const resource = projectUICStarredCraftResource({
      tabGroupDisplayLabelById: new Map([["starred-dupe", "First starred duplicate"]]),
      starredTabGroups: [
        { space: { ...storybookWorkspace.spaces[1]!, name: "First starred space" }, tg: { ...storybookWorkspace.tabGroups[1]!, id: "starred-dupe", label: "First fallback" } },
        { space: { ...storybookWorkspace.spaces[2]!, name: "Second starred space" }, tg: { ...storybookWorkspace.tabGroups[2]!, id: "starred-dupe", label: "Second duplicate" } },
      ],
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: ["uic/resource/duplicate-row-id"] });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.items).toHaveLength(1);
    expect(resource.items[0]?.label).toBe("First starred duplicate");
    expect(resource.items[0]?.meta).toContain("First starred space");
  });

  it("caps long starred craft labels and metadata before rendering", () => {
    const longLabel = `Starred-${"c".repeat(UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxLabelLength + 20)}`;
    const longSpace = `StarredSpace-${"s".repeat(UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength + 20)}`;
    const tabGroup = {
      ...storybookWorkspace.tabGroups[1]!,
      id: "tg-starred-long",
      label: longLabel,
      starred: true,
    };
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, name: longSpace, tabGroupIds: [tabGroup.id] }],
      tabGroups: [tabGroup],
    };
    const region = starredCraftRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longLabel);
    expect(region).not.toContain(longSpace);
    expect(region).toContain(longLabel.slice(0, UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxLabelLength));
    expect(region).toContain(longSpace.slice(0, UIC_STARRED_CRAFT_RESOURCE_BUDGET.maxSpaceLabelLength));
  });
});
