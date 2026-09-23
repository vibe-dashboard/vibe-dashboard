import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import {
  UIC_RECENTLY_CREATED_CRAFT_RESOURCE_BUDGET,
  UIC_RECENT_SESSIONS_RESOURCE_BUDGET,
  UIC_RECENTLY_VISITED_CRAFT_RESOURCE_BUDGET,
  UIC_RUNNING_DEV_SERVERS_RESOURCE_BUDGET,
  UIC_STARRED_CRAFT_RESOURCE_BUDGET,
  UIC_SPACES_RESOURCE_BUDGET,
  UIC_SPACES_OVERVIEW_ACTIONS,
  UIC_WORKSPACE_LIST_RESOURCE_BUDGET,
  SpacesOverviewUICLayoutProofPresentation,
  SpacesOverviewUICPageHeaderProof,
  resolveUICActionLifecycle,
  invokeUICSpacePickerAction,
  invokeUICWorkspaceListAction,
  invokeUICSpacesOverviewAction,
  projectUICRecentSessionsResource,
  projectUICRecentlyCreatedCraftActions,
  projectUICRecentlyCreatedCraftResource,
  projectUICRecentlyVisitedCraftActions,
  projectUICRecentlyVisitedCraftResource,
  projectUICStarredCraftActions,
  projectUICSpacesCraftActions,
  projectUICSpacesResource,
  projectUICStarredCraftResource,
  projectUICSpacePickerActions,
  projectUICWorkspaceListActions,
  projectUICWorkspaceListResource,
  spacesOverviewUICLayoutXml,
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

function renderUICPresentationWithModel(
  modelOverrides: Partial<React.ComponentProps<typeof SpacesOverviewUICLayoutProofPresentation>["model"]>,
  actionOverrides: Partial<React.ComponentProps<typeof SpacesOverviewUICLayoutProofPresentation>["actions"]> = {},
  xml = spacesOverviewUICLayoutXml,
) {
  const tabGroupDisplayLabelById = new Map(storybookWorkspace.tabGroups.map((tabGroup) => [tabGroup.id, tabGroup.label]));
  const model: React.ComponentProps<typeof SpacesOverviewUICLayoutProofPresentation>["model"] = {
    workspace: storybookWorkspace,
    savedSessions: storybookSavedSessions,
    currentSessionId: storybookSavedSessions[0]?.id,
    workspaces: dashboardWorkspaces,
    effectiveRepos: storybookRepos,
    loading: false,
    error: null,
    selectedRepoId: null,
    sortedWorkspaces: dashboardWorkspaces,
    pagedWorkspaces: dashboardWorkspaces,
    workspacePage: 0,
    workspaceTotalPages: 1,
    stoppingDevServerIds: new Set<string>(),
    tabGroupDisplayLabelById,
    workspaceTabGroupMap: new Map(),
    hasSpaces: true,
    sortedSessions: storybookSavedSessions,
    expandedSessionId: null,
    editingSessionId: null,
    sessionNameDraft: "",
    starredTabGroups: [],
    recentlyVisited: { items: [], page: 0, totalPages: 1 },
    recentlyCreated: { items: [], page: 0, totalPages: 1 },
    spacesWithTabGroups: [],
    spacePickerTarget: null,
    pendingOpenCraftRequest: null,
    openCraftRetryRequest: null,
    openCraftActionError: null,
    isOpenCraftPending: false,
    canOpenWorkspaceInSpace: true,
    ...modelOverrides,
  };
  const actions: React.ComponentProps<typeof SpacesOverviewUICLayoutProofPresentation>["actions"] = {
    resumeSession: () => undefined,
    renameSession: () => undefined,
    deleteSession: () => undefined,
    startNewSession: () => undefined,
    navigateToTabGroup: () => undefined,
    selectRepo: () => undefined,
    setWorkspacePage: () => undefined,
    stopDevServer: () => undefined,
    openSpacePickerForWorkspace: () => undefined,
    runOpenCraftRequest: () => undefined,
    closeSpacePicker: () => undefined,
    retryOpenCraftRequest: () => undefined,
    toggleExpandedSession: () => undefined,
    startRenameSession: () => undefined,
    setSessionNameDraft: () => undefined,
    submitRenameSession: () => undefined,
    cancelRenameSession: () => undefined,
    setRecentlyVisitedPage: () => undefined,
    setRecentlyCreatedPage: () => undefined,
    ...actionOverrides,
  };
  return renderToStaticMarkup(createElement(SpacesOverviewUICLayoutProofPresentation, { model, actions, xml }));
}

function runningDevServersRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="running-dev-servers"'), html.indexOf('data-myne-slot="recently-visited-craft"'));
}

function starredCraftRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="starred-craft"'), html.indexOf('data-uic-owned-region="running-dev-servers"'));
}

function recentSessionsRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recent-sessions"'), html.indexOf('data-uic-owned-region="starred-craft"'));
}

function recentlyVisitedRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recently-visited-craft"'), html.indexOf('data-myne-slot="recently-created-craft"'));
}

function recentlyCreatedRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="recently-created-craft"'), html.indexOf('data-myne-slot="workspace-list"'));
}

function workspaceListRegion(html: string) {
  return html.slice(html.indexOf('data-uic-owned-region="workspace-list"'), html.indexOf('data-uic-owned-region="spaces-list"'));
}

function spacesRegion(html: string) {
  const start = html.indexOf('data-uic-owned-region="spaces-list"');
  return html.slice(start, html.indexOf("</main>", start));
}

function spacePickerRegion(html: string) {
  const start = html.indexOf('data-uic-owned-region="space-picker"');
  return start === -1 ? "" : html.slice(start, html.indexOf("</main>", start));
}

function runningWorkspace(overrides: Partial<DashboardWorkspace> = {}): DashboardWorkspace {
  const base = dashboardWorkspaces.find((workspace) => workspace.has_running_dev_server) ?? dashboardWorkspaces[0]!;
  return { ...base, id: "uic-running", name: "UIC running", branch: "vk/uic-running", has_running_dev_server: true, ...overrides };
}

function workspaceActionModel(overrides: Partial<Parameters<typeof projectUICWorkspaceListActions>[0]> = {}): Parameters<typeof projectUICWorkspaceListActions>[0] {
  return {
    sortedWorkspaces: [dashboardWorkspaces[0]!],
    effectiveRepos: storybookRepos,
    selectedRepoId: null,
    workspacePage: 0,
    workspaceTotalPages: 1,
    canOpenWorkspaceInSpace: true,
    ...overrides,
  };
}

function workspaceActionCallbacks(overrides: Partial<Parameters<typeof invokeUICWorkspaceListAction>[0]> = {}): Parameters<typeof invokeUICWorkspaceListAction>[0] {
  return {
    openSpacePickerForWorkspace: vi.fn(),
    selectRepo: vi.fn(),
    setWorkspacePage: vi.fn(),
    ...overrides,
  };
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

  it("uses finite UIC empty/ready/list semantics and navigation action for recently visited craft", () => {
    const readyRegion = recentlyVisitedRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("3 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).toContain("Open craft");
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");
    expect(readyRegion).not.toContain("Delete");
    expect(readyRegion).not.toContain("Stop server");

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

  it("uses finite UIC empty/ready/list semantics and navigation action for recently created craft", () => {
    const readyRegion = recentlyCreatedRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("3 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).toContain("Open craft");
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");
    expect(readyRegion).not.toContain("Delete");
    expect(readyRegion).not.toContain("Stop server");

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

  it("uses a typed UIC navigation action for starred craft without mutation controls", () => {
    const readyRegion = starredCraftRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC list");
    expect(readyRegion).toContain("1 craft");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).toContain("Open craft");
    expect(readyRegion).not.toContain("Delete");
    expect(readyRegion).not.toContain("Stop server");

    const emptyWorkspace = { ...storybookWorkspace, tabGroups: storybookWorkspace.tabGroups.map((tabGroup) => ({ ...tabGroup, starred: false })) };
    const emptyRegion = starredCraftRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }));
    expect(emptyRegion).toContain("No starred craft");
  });

  it("does not expose or dispatch the starred craft action when XML omits the binding", () => {
    const xml = spacesOverviewUICLayoutXml.replace(' uic:on-activate="spaces.navigateToCraft"', "");
    const region = starredCraftRegion(renderUICLayout(xml));

    expect(region).toContain("Read-only UIC list");
    expect(region).not.toContain("Open craft");
    expect(projectUICStarredCraftActions({
      starredTabGroups: [{ space: storybookWorkspace.spaces[1]!, tg: storybookWorkspace.tabGroups[1]! }],
      tabGroupDisplayLabelById: new Map(),
    }, false)).toEqual([]);
  });

  it("does not expose sibling craft-list actions when XML omits their bindings", () => {
    const withoutVisited = spacesOverviewUICLayoutXml.replace('  <uic:recentlyVisitedCraft uic:on-activate="spaces.navigateToCraft" />', "  <uic:recentlyVisitedCraft />");
    expect(recentlyVisitedRegion(renderUICLayout(withoutVisited))).not.toContain("Open craft");
    expect(projectUICRecentlyVisitedCraftActions({
      recentlyVisited: { page: 0, totalPages: 1, items: [{ space: storybookWorkspace.spaces[1]!, tg: storybookWorkspace.tabGroups[1]! }] },
      tabGroupDisplayLabelById: new Map(),
    }, false)).toEqual([]);

    const withoutCreated = spacesOverviewUICLayoutXml.replace('  <uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" />', "  <uic:recentlyCreatedCraft />");
    expect(recentlyCreatedRegion(renderUICLayout(withoutCreated))).not.toContain("Open craft");
    expect(projectUICRecentlyCreatedCraftActions({
      recentlyCreated: { page: 0, totalPages: 1, items: [{ space: storybookWorkspace.spaces[1]!, tg: storybookWorkspace.tabGroups[1]! }] },
      tabGroupDisplayLabelById: new Map(),
    }, false)).toEqual([]);

    const withoutSpaces = spacesOverviewUICLayoutXml.replace('  <uic:spaces uic:on-activate="spaces.navigateToCraft" />', "  <uic:spaces />");
    expect(spacesRegion(renderUICLayout(withoutSpaces))).not.toContain("Open craft");
    expect(projectUICSpacesCraftActions({
      hasSpaces: true,
      tabGroupDisplayLabelById: new Map(),
      spacesWithTabGroups: [{ space: storybookWorkspace.spaces[1]!, tabGroups: [storybookWorkspace.tabGroups[1]!] }],
    }, false)).toEqual([]);
  });

  it("falls back instead of exposing the starred craft action when XML action validation fails", () => {
    const html = renderUICLayout(spacesOverviewUICLayoutXml.replace("spaces.navigateToCraft", "spaces.deleteCraft"));

    expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
    expect(html).toContain("uic/xml/unknown-action");
  });

  it("falls back instead of exposing sibling craft-list actions when XML action validation fails", () => {
    const html = renderUICLayout(spacesOverviewUICLayoutXml.replace('<uic:recentlyVisitedCraft uic:on-activate="spaces.navigateToCraft" />', '<uic:recentlyVisitedCraft uic:on-activate="https://example.test/action" />'));

    expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
    expect(html).toContain("uic/xml/unknown-action");
  });

  it("falls back without UIC action UI or dispatch for invalid recently-created and spaces action bindings", () => {
    const cases = [
      {
        valid: '<uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" />',
        invalid: '<uic:recentlyCreatedCraft uic:on-activate="https://example.test/action" />',
        region: 'data-uic-owned-region="recently-created-craft"',
      },
      {
        valid: '<uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" />',
        invalid: '<uic:recentlyCreatedCraft uic:on-activate="spaces.deleteCraft" />',
        region: 'data-uic-owned-region="recently-created-craft"',
      },
      {
        valid: '<uic:spaces uic:on-activate="spaces.navigateToCraft" />',
        invalid: '<uic:spaces uic:on-activate="https://example.test/action" />',
        region: 'data-uic-owned-region="spaces-list"',
      },
      {
        valid: '<uic:spaces uic:on-activate="spaces.navigateToCraft" />',
        invalid: '<uic:spaces uic:on-activate="spaces.deleteCraft" />',
        region: 'data-uic-owned-region="spaces-list"',
      },
    ] as const;

    for (const item of cases) {
      const navigateToTabGroup = vi.fn();
      const html = renderUICLayout(spacesOverviewUICLayoutXml.replace(item.valid, item.invalid), {
        onNavigateToTabGroup: navigateToTabGroup,
      });

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain(item.region);
      expect(navigateToTabGroup).not.toHaveBeenCalled();
    }
  });

  it("projects only serializable allowed UIC action descriptors for starred craft", () => {
    const descriptors = projectUICStarredCraftActions({
      starredTabGroups: [{ space: storybookWorkspace.spaces[1]!, tg: storybookWorkspace.tabGroups[1]! }],
      tabGroupDisplayLabelById: new Map(),
    });

    expect(descriptors).toEqual([
      {
        event: "activate",
        id: "spaces.navigateToCraft",
        args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: storybookWorkspace.tabGroups[1]!.id },
        status: "available",
      },
    ]);
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|navigateToTabGroup/u);
    expect(UIC_SPACES_OVERVIEW_ACTIONS["spaces.navigateToCraft"].args).toEqual({ spaceId: "string", tabGroupId: "string" });
  });

  it("validates shared serializable lifecycle metadata before mutating UIC actions use it", () => {
    const descriptor = {
      event: "activate",
      id: "spaces.openWorkspace",
      args: { workspaceId: dashboardWorkspaces[0]!.id },
      status: "available",
    } as const;
    const lifecycle = {
      confirmation: {
        required: true,
        title: "Stop development server?",
        message: "Confirm before invoking a mutating host action.",
        confirmLabel: "Stop server",
        tone: "destructive",
      },
      pending: { key: `workspace:${dashboardWorkspaces[0]!.id}:stop-dev-server`, label: "Stopping development server" },
      result: { state: "idle" },
      diagnostics: ["uic/action/mutation-proof"],
      authorization: { state: "allowed" },
    } as const;

    expect(resolveUICActionLifecycle(descriptor, lifecycle, { authorized: true, confirmed: false })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/confirmation-required" } });
    expect(resolveUICActionLifecycle(descriptor, lifecycle, { authorized: true, confirmed: true })).toEqual({ ok: true, descriptor: { ...descriptor, lifecycle } });
    expect(JSON.stringify(lifecycle)).not.toMatch(/function|=>|appHooks|QueryClient|Promise|https?:|stopDevServer|deleteSession|renameSession/u);
  });

  it("gates lifecycle descriptors on authorization, pending identity, and result envelope shape", () => {
    const descriptor = { event: "activate", id: "spaces.openWorkspace", args: { workspaceId: dashboardWorkspaces[0]!.id }, status: "available" } as const;
    const lifecycle = {
      confirmation: { required: false },
      pending: { key: "workspace:one:proof", label: "Proof pending" },
      result: { state: "completed" },
      diagnostics: [],
      authorization: { state: "allowed" },
    } as const;

    expect(resolveUICActionLifecycle(descriptor, lifecycle, { authorized: false })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unauthorized" } });
    expect(resolveUICActionLifecycle(descriptor, lifecycle, { authorized: true, pendingKeys: new Set(["workspace:one:proof"]) })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/pending" } });
    expect(resolveUICActionLifecycle(descriptor, { ...lifecycle, result: { state: "failed", diagnostic: { code: "uic/proof/error", message: "Proof failed", recoverable: true } } }, { authorized: true })).toMatchObject({ ok: true });
    expect(resolveUICActionLifecycle(descriptor, { ...lifecycle, result: { state: "failed" } }, { authorized: true })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-lifecycle" } });
    expect(resolveUICActionLifecycle(descriptor, { ...lifecycle, pending: { key: "https://example.test/action", label: "Bad" } }, { authorized: true })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-lifecycle" } });
    expect(resolveUICActionLifecycle({ ...descriptor, status: "unavailable" }, lifecycle, { authorized: true })).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
  });

  it("projects only serializable allowed UIC action descriptors for sibling craft lists", () => {
    const expected = {
      event: "activate",
      id: "spaces.navigateToCraft",
      args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: storybookWorkspace.tabGroups[1]!.id },
      status: "available",
    };
    const item = { space: storybookWorkspace.spaces[1]!, tg: storybookWorkspace.tabGroups[1]! };
    const descriptors = [
      ...projectUICRecentlyVisitedCraftActions({ recentlyVisited: { page: 0, totalPages: 1, items: [item] }, tabGroupDisplayLabelById: new Map() }),
      ...projectUICRecentlyCreatedCraftActions({ recentlyCreated: { page: 0, totalPages: 1, items: [item] }, tabGroupDisplayLabelById: new Map() }),
      ...projectUICSpacesCraftActions({ hasSpaces: true, tabGroupDisplayLabelById: new Map(), spacesWithTabGroups: [{ space: item.space, tabGroups: [item.tg] }] }),
    ];

    expect(descriptors).toEqual([expected, expected, expected]);
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|navigateToTabGroup|delete|stop/u);
  });

  it("keeps sibling craft-list action targets aligned with the bounded rendered rows", () => {
    const duplicateItems = [
      { space: storybookWorkspace.spaces[1]!, tg: { ...storybookWorkspace.tabGroups[1]!, id: "dupe-action" } },
      { space: storybookWorkspace.spaces[2]!, tg: { ...storybookWorkspace.tabGroups[2]!, id: "dupe-action" } },
    ];

    expect(projectUICRecentlyVisitedCraftActions({ recentlyVisited: { page: 0, totalPages: 1, items: duplicateItems }, tabGroupDisplayLabelById: new Map() })).toEqual([
      expect.objectContaining({ args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: "dupe-action" } }),
    ]);
    expect(projectUICRecentlyCreatedCraftActions({ recentlyCreated: { page: 0, totalPages: 1, items: duplicateItems }, tabGroupDisplayLabelById: new Map() })).toEqual([
      expect.objectContaining({ args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: "dupe-action" } }),
    ]);
    expect(projectUICSpacesCraftActions({
      hasSpaces: true,
      tabGroupDisplayLabelById: new Map(),
      spacesWithTabGroups: [
        { space: storybookWorkspace.spaces[1]!, tabGroups: [duplicateItems[0]!.tg] },
        { space: storybookWorkspace.spaces[2]!, tabGroups: [duplicateItems[1]!.tg] },
      ],
    })).toEqual([
      expect.objectContaining({ args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: "dupe-action" } }),
    ]);
  });

  it("rejects invalid, unavailable, or arbitrary UIC action invocations before trusted host dispatch", () => {
    const navigateToTabGroup = vi.fn();
    const allowedTargets = new Set([`${storybookWorkspace.spaces[1]!.id}:${storybookWorkspace.tabGroups[1]!.id}`]);

    expect(invokeUICSpacesOverviewAction(
      { navigateToTabGroup },
      { id: "spaces.navigateToCraft", args: { spaceId: storybookWorkspace.spaces[1]!.id, tabGroupId: storybookWorkspace.tabGroups[1]!.id }, status: "available", event: "activate" },
      allowedTargets,
    )).toEqual({ ok: true, result: { state: "completed" } });
    expect(navigateToTabGroup).toHaveBeenCalledWith(storybookWorkspace.spaces[1]!.id, storybookWorkspace.tabGroups[1]!.id);

    expect(invokeUICSpacesOverviewAction({ navigateToTabGroup }, { id: "spaces.deleteCraft", args: {}, status: "available", event: "activate" }, allowedTargets)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unknown" } });
    expect(invokeUICSpacesOverviewAction({ navigateToTabGroup }, { id: "spaces.navigateToCraft", args: { spaceId: 1, tabGroupId: "tg" }, status: "available", event: "activate" }, allowedTargets)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(invokeUICSpacesOverviewAction({ navigateToTabGroup }, { id: "spaces.navigateToCraft", args: { spaceId: "missing", tabGroupId: "tg" }, status: "available", event: "activate" }, allowedTargets)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
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

  it("uses finite UIC grouped-list semantics and navigation action for spaces", () => {
    const readyRegion = spacesRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC grouped list");
    expect(readyRegion).toContain("2 spaces");
    expect(readyRegion).toContain("Product");
    expect(readyRegion).toContain("Auth bug fix");
    expect(readyRegion).toContain("Open craft");
    expect(readyRegion).not.toContain("Delete");
    expect(readyRegion).not.toContain("Stop server");

    const emptyWorkspace = { ...storybookWorkspace, spaces: storybookWorkspace.spaces.filter((space) => space.isSystem) };
    expect(spacesRegion(renderUICLayout(undefined, { workspace: emptyWorkspace }))).toContain("No spaces");
  });

  it("caps UIC spaces and nested craft deterministically before rendering", () => {
    const tabGroups = Array.from({ length: UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace + 2 }, (_, index) => ({
      ...storybookWorkspace.tabGroups[1]!,
      id: `tg-space-uic-${index}`,
      label: `Space craft ${index}`,
    }));
    const spaces = Array.from({ length: UIC_SPACES_RESOURCE_BUDGET.maxSpaces + 2 }, (_, index) => ({
      ...storybookWorkspace.spaces[1]!,
      id: `space-uic-${index}`,
      name: `Space ${index}`,
      tabGroupIds: tabGroups.map((tabGroup) => tabGroup.id),
    }));
    const region = spacesRegion(renderUICLayout(undefined, { workspace: { ...storybookWorkspace, spaces, tabGroups } }));

    expect(region).toContain("uic/resource/spaces-truncated");
    expect(region).toContain("uic/resource/craft-truncated");
    expect(region).toContain(`Space ${UIC_SPACES_RESOURCE_BUDGET.maxSpaces - 1}`);
    expect(region).not.toContain(`Space ${UIC_SPACES_RESOURCE_BUDGET.maxSpaces}`);
    expect(region).toContain(`Space craft ${UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace - 1}`);
    expect(region).not.toContain(`Space craft ${UIC_SPACES_RESOURCE_BUDGET.maxCraftPerSpace}`);
  });

  it("diagnoses duplicate UIC space and craft IDs while keeping first matches", () => {
    const resource = projectUICSpacesResource({
      hasSpaces: true,
      tabGroupDisplayLabelById: new Map([["craft-dupe", "First craft duplicate"]]),
      spacesWithTabGroups: [
        {
          space: { ...storybookWorkspace.spaces[1]!, id: "space-dupe", name: "First space", tabGroupIds: ["craft-dupe"] },
          tabGroups: [
            { ...storybookWorkspace.tabGroups[1]!, id: "craft-dupe", label: "First fallback" },
            { ...storybookWorkspace.tabGroups[2]!, id: "craft-dupe", label: "Second craft duplicate" },
          ],
        },
        { space: { ...storybookWorkspace.spaces[2]!, id: "space-dupe", name: "Second space" }, tabGroups: [] },
      ],
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: expect.arrayContaining(["uic/resource/duplicate-craft-id", "uic/resource/duplicate-space-id"]) });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.groups).toHaveLength(1);
    expect(resource.groups[0]?.label).toBe("First space");
    expect(resource.groups[0]?.items).toHaveLength(1);
    expect(resource.groups[0]?.items[0]?.label).toBe("First craft duplicate");
  });

  it("caps long UIC space and craft labels before rendering", () => {
    const longSpace = `Space-${"s".repeat(UIC_SPACES_RESOURCE_BUDGET.maxSpaceLabelLength + 20)}`;
    const longCraft = `Craft-${"c".repeat(UIC_SPACES_RESOURCE_BUDGET.maxCraftLabelLength + 20)}`;
    const tabGroup = { ...storybookWorkspace.tabGroups[1]!, id: "tg-space-long", label: longCraft };
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, name: longSpace, tabGroupIds: [tabGroup.id] }],
      tabGroups: [tabGroup],
    };
    const region = spacesRegion(renderUICLayout(undefined, { workspace }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longSpace);
    expect(region).not.toContain(longCraft);
    expect(region).toContain(longSpace.slice(0, UIC_SPACES_RESOURCE_BUDGET.maxSpaceLabelLength));
    expect(region).toContain(longCraft.slice(0, UIC_SPACES_RESOURCE_BUDGET.maxCraftLabelLength));
  });

  it("uses finite UIC states and typed open/filter actions for workspace list without mutation controls", () => {
    const readyRegion = workspaceListRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC workspace list");
    expect(readyRegion).toContain("VK Workspaces");
    expect(readyRegion).toContain(dashboardWorkspaces[0]!.name);
    expect(readyRegion).toContain("Open workspace");
    expect(readyRegion).toContain("All</");
    expect(readyRegion).toContain(storybookRepos[0]!.display_name);
    expect(readyRegion).not.toContain("Previous");
    expect(readyRegion).not.toContain("Next");
    expect(readyRegion).not.toContain("Stop server");
    expect(readyRegion).not.toContain("Go to craft");
    expect(readyRegion).not.toContain(">Open<");

    expect(workspaceListRegion(renderUICLayout(undefined, { loading: true, workspaces: [] }))).toContain("Loading workspaces");
    expect(workspaceListRegion(renderUICLayout(undefined, { workspaces: [] }))).toContain("No active workspaces");
    expect(workspaceListRegion(renderUICLayout(undefined, { error: "VK backend unavailable", workspaces: [] }))).toContain("VK backend unavailable");
  });

  it("does not expose or dispatch the workspace open action when XML omits the binding", () => {
    const xml = spacesOverviewUICLayoutXml.replace(' uic:on-activate="spaces.openWorkspace"', "");
    const region = workspaceListRegion(renderUICLayout(xml));

    expect(region).toContain("Read-only UIC workspace list");
    expect(region).not.toContain("Open workspace");
    expect(region).toContain("All</");
    expect(projectUICWorkspaceListActions(workspaceActionModel(), { open: false, filter: true, page: true }).some((action) => action.id === "spaces.openWorkspace")).toBe(false);
  });

  it("does not expose workspace open descriptors when the trusted open capability is unavailable", () => {
    const region = workspaceListRegion(renderUICLayout(undefined, { onOpenWorkspaceInSpace: undefined }));

    expect(region).toContain("Read-only UIC workspace list");
    expect(region).not.toContain("Open workspace");
    expect(projectUICWorkspaceListActions(workspaceActionModel({ canOpenWorkspaceInSpace: false })).some((action) => action.id === "spaces.openWorkspace")).toBe(false);
  });

  it("falls back without workspace action UI or dispatch when workspace action validation fails", () => {
    for (const invalid of ["https://example.test/action", "spaces.deleteWorkspace"]) {
      const onOpenWorkspaceInSpace = vi.fn();
      const html = renderUICLayout(spacesOverviewUICLayoutXml.replace(
        'uic:on-activate="spaces.openWorkspace"',
        `uic:on-activate="${invalid}"`,
      ), { onOpenWorkspaceInSpace });

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain('data-uic-owned-region="workspace-list"');
      expect(onOpenWorkspaceInSpace).not.toHaveBeenCalled();
    }
  });

  it("projects serializable workspace open descriptors and blocks invalid workspace targets before dispatch", () => {
    const descriptors = projectUICWorkspaceListActions(workspaceActionModel(), { open: true, filter: false, page: false });
    const openSpacePickerForWorkspace = vi.fn();
    const actions = workspaceActionCallbacks({ openSpacePickerForWorkspace });
    const allowedWorkspaces = new Map([[dashboardWorkspaces[0]!.id, dashboardWorkspaces[0]!]]);

    expect(descriptors).toEqual([
      {
        event: "activate",
        id: "spaces.openWorkspace",
        args: { workspaceId: dashboardWorkspaces[0]!.id },
        status: "available",
      },
    ]);
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|openSpacePickerForWorkspace|stop|delete/u);
    expect(invokeUICWorkspaceListAction(actions, descriptors[0]!, allowedWorkspaces)).toEqual({ ok: true, result: { state: "completed" } });
    expect(openSpacePickerForWorkspace).toHaveBeenCalledWith(dashboardWorkspaces[0]);

    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.openWorkspace", event: "activate", status: "available", args: { workspaceId: "missing" } }, allowedWorkspaces)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.openWorkspace", event: "activate", status: "available", args: { workspaceId: 1 } }, allowedWorkspaces)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.deleteWorkspace", event: "activate", status: "available", args: { workspaceId: dashboardWorkspaces[0]!.id } }, allowedWorkspaces)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unknown" } });
  });

  it("binds workspace repo filters and pagination only from validated XML actions", () => {
    const selectedRepo = storybookRepos[0]!;
    const pagedHtml = renderUICPresentationWithModel({ workspacePage: 1, workspaceTotalPages: 3, selectedRepoId: selectedRepo.id });
    const region = workspaceListRegion(pagedHtml);
    const descriptors = projectUICWorkspaceListActions(workspaceActionModel({ workspacePage: 1, workspaceTotalPages: 3 }), { open: false, filter: true, page: true });

    expect(region).toContain("All</");
    expect(region).toContain(selectedRepo.display_name);
    expect(region).toContain("Previous");
    expect(region).toContain("Next");
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|stop|delete|session/u);

    const selectRepo = vi.fn();
    const setWorkspacePage = vi.fn();
    const actions = workspaceActionCallbacks({ selectRepo, setWorkspacePage });
    const allowedFilters = new Set(["__all__", selectedRepo.id]);
    const allowedPages = new Map<"previous" | "next", number>([["previous", 0], ["next", 2]]);

    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.filterWorkspaces", event: "filter", status: "available", args: { repoId: selectedRepo.id } }, new Map(), allowedFilters, allowedPages)).toEqual({ ok: true, result: { state: "completed" } });
    expect(selectRepo).toHaveBeenCalledWith(selectedRepo.id);
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.filterWorkspaces", event: "filter", status: "available", args: { repoId: "__all__" } }, new Map(), allowedFilters, allowedPages)).toEqual({ ok: true, result: { state: "completed" } });
    expect(selectRepo).toHaveBeenCalledWith(null);
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.pageWorkspaces", event: "page", status: "available", args: { direction: "previous", page: 0 } }, new Map(), allowedFilters, allowedPages)).toEqual({ ok: true, result: { state: "completed" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.pageWorkspaces", event: "page", status: "available", args: { direction: "next", page: 2 } }, new Map(), allowedFilters, allowedPages)).toEqual({ ok: true, result: { state: "completed" } });
    expect(setWorkspacePage).toHaveBeenCalledWith(0);
    expect(setWorkspacePage).toHaveBeenCalledWith(2);
  });

  it("omits workspace filter and pagination controls when XML omits those bindings", () => {
    const withoutFilter = workspaceListRegion(renderUICLayout(spacesOverviewUICLayoutXml.replace(' uic:on-filter="spaces.filterWorkspaces"', "")));
    const withoutPage = workspaceListRegion(renderUICPresentationWithModel(
      { workspacePage: 1, workspaceTotalPages: 3 },
      {},
      spacesOverviewUICLayoutXml.replace(' uic:on-page="spaces.pageWorkspaces"', ""),
    ));

    expect(withoutFilter).not.toContain("All</");
    expect(withoutFilter).not.toContain("myne-button rounded border px-3 py-1");
    expect(withoutPage).not.toContain("Previous");
    expect(withoutPage).not.toContain("Next");
    expect(projectUICWorkspaceListActions(workspaceActionModel(), { open: true, filter: false, page: false }).some((action) => action.id === "spaces.filterWorkspaces" || action.id === "spaces.pageWorkspaces")).toBe(false);
  });

  it("falls back without workspace filter/page dispatch when those action bindings are invalid", () => {
    for (const [attr, invalid, dispatcher] of [
      ["uic:on-filter", "https://example.test/action", "selectRepo"],
      ["uic:on-filter", "spaces.deleteWorkspace", "selectRepo"],
      ["uic:on-page", "https://example.test/action", "setWorkspacePage"],
      ["uic:on-page", "spaces.deleteWorkspace", "setWorkspacePage"],
    ] as const) {
      const selectRepo = vi.fn();
      const setWorkspacePage = vi.fn();
      const html = renderUICPresentationWithModel(
        {},
        { selectRepo, setWorkspacePage },
        spacesOverviewUICLayoutXml.replace(new RegExp(`${attr}="[^"]+"`, "u"), `${attr}="${invalid}"`),
      );

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain('data-uic-owned-region="workspace-list"');
      expect(dispatcher === "selectRepo" ? selectRepo : setWorkspacePage).not.toHaveBeenCalled();
    }
  });

  it("blocks unavailable workspace filter/page targets before dispatch", () => {
    const selectRepo = vi.fn();
    const setWorkspacePage = vi.fn();
    const actions = workspaceActionCallbacks({ selectRepo, setWorkspacePage });
    const allowedFilters = new Set(["__all__", storybookRepos[0]!.id]);
    const allowedPages = new Map<"previous" | "next", number>([["next", 1]]);

    expect(projectUICWorkspaceListActions(workspaceActionModel({ effectiveRepos: [] }), { open: false, filter: true, page: false })).toEqual([]);
    expect(projectUICWorkspaceListActions(workspaceActionModel({ workspaceTotalPages: 1 }), { open: false, filter: false, page: true })).toEqual([]);
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.filterWorkspaces", event: "filter", status: "available", args: { repoId: "missing" } }, new Map(), allowedFilters, allowedPages)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.filterWorkspaces", event: "filter", status: "available", args: { repoId: 1 } }, new Map(), allowedFilters, allowedPages)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.pageWorkspaces", event: "page", status: "available", args: { direction: "previous", page: 0 } }, new Map(), allowedFilters, allowedPages)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
    expect(invokeUICWorkspaceListAction(actions, { id: "spaces.pageWorkspaces", event: "page", status: "available", args: { direction: "sideways", page: 1 } }, new Map(), allowedFilters, allowedPages)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(selectRepo).not.toHaveBeenCalled();
    expect(setWorkspacePage).not.toHaveBeenCalled();
  });

  it("renders UIC space-picker close action only from validated XML binding", () => {
    const html = renderUICLayout(undefined, { initialSpacePickerTargetId: dashboardWorkspaces[0]!.id });
    const region = spacePickerRegion(html);

    expect(region).toContain("UIC space picker");
    expect(region).toContain(dashboardWorkspaces[0]!.name);
    expect(region).toContain("Close picker");
    expect(region).not.toContain("Retry open");
    expect(region).not.toContain("Stop server");
    expect(region).not.toContain("Delete");

    const withoutClose = renderUICLayout(
      spacesOverviewUICLayoutXml.replace(' uic:on-close="spaces.dismissPicker"', ""),
      { initialSpacePickerTargetId: dashboardWorkspaces[0]!.id },
    );
    expect(spacePickerRegion(withoutClose)).not.toContain("Close picker");
  });

  it("falls back without UIC space-picker action UI or dispatch when picker action validation fails", () => {
    for (const invalid of ["https://example.test/action", "spaces.deleteWorkspace"]) {
      const onOpenWorkspaceInSpace = vi.fn();
      const html = renderUICLayout(spacesOverviewUICLayoutXml.replace(
        '<uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />',
        `<uic:spacePicker uic:on-close="${invalid}" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />`,
      ), { initialSpacePickerTargetId: dashboardWorkspaces[0]!.id, onOpenWorkspaceInSpace });

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain('data-uic-owned-region="space-picker"');
      expect(onOpenWorkspaceInSpace).not.toHaveBeenCalled();
    }
  });

  it("renders UIC space selection only from validated XML binding and dispatches the trusted request", () => {
    const runOpenCraftRequest = vi.fn();
    const html = renderUICPresentationWithModel(
      { spacePickerTarget: dashboardWorkspaces[0]! },
      { runOpenCraftRequest },
    );
    const region = spacePickerRegion(html);

    expect(region).toContain(storybookWorkspace.spaces[0]!.name);
    expect(region).toContain(storybookWorkspace.spaces[1]!.name);
    const descriptors = projectUICSpacePickerActions({
      workspace: storybookWorkspace,
      spacePickerTarget: dashboardWorkspaces[0]!,
      pendingOpenCraftRequest: null,
      openCraftRetryRequest: null,
      canOpenWorkspaceInSpace: true,
    });
    const select = descriptors.find((descriptor) => descriptor.id === "spaces.selectSpaceForWorkspace");
    expect(select).toMatchObject({ event: "select", args: { spaceId: storybookWorkspace.spaces[0]!.id }, status: "available" });
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|runOpenCraftRequest|delete|stop/u);
    const allowedActions = new Set(descriptors.map((descriptor) => descriptor.id));
    const allowedSpaceRequests = new Map([[storybookWorkspace.spaces[0]!.id, { workspace: dashboardWorkspaces[0]!, spaceId: storybookWorkspace.spaces[0]!.id }]]);

    expect(invokeUICSpacePickerAction({ closeSpacePicker: () => undefined, retryOpenCraftRequest: () => undefined, runOpenCraftRequest }, select!, allowedActions, allowedSpaceRequests)).toEqual({ ok: true, result: { state: "completed" } });
    expect(runOpenCraftRequest).toHaveBeenCalledWith({ workspace: dashboardWorkspaces[0], spaceId: storybookWorkspace.spaces[0]!.id });

    const withoutSelect = renderUICPresentationWithModel(
      { spacePickerTarget: dashboardWorkspaces[0]! },
      { runOpenCraftRequest },
      spacesOverviewUICLayoutXml.replace(' uic:on-select="spaces.selectSpaceForWorkspace"', ""),
    );
    expect(spacePickerRegion(withoutSelect)).not.toContain(storybookWorkspace.spaces[0]!.name);
  });

  it("falls back without UIC picker dispatch when only select binding is invalid", () => {
    for (const invalid of ["https://example.test/action", "spaces.deleteWorkspace"]) {
      const runOpenCraftRequest = vi.fn();
      const html = renderUICPresentationWithModel(
        { spacePickerTarget: dashboardWorkspaces[0]! },
        { runOpenCraftRequest },
        spacesOverviewUICLayoutXml.replace('uic:on-select="spaces.selectSpaceForWorkspace"', `uic:on-select="${invalid}"`),
      );

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain('data-uic-owned-region="space-picker"');
      expect(runOpenCraftRequest).not.toHaveBeenCalled();
    }
  });

  it("blocks invalid or unrendered UIC space selection targets before dispatch", () => {
    const runOpenCraftRequest = vi.fn();
    const actions = { closeSpacePicker: () => undefined, retryOpenCraftRequest: () => undefined, runOpenCraftRequest };
    const allowedActions = new Set(["spaces.selectSpaceForWorkspace"]);
    const allowedSpaceRequests = new Map([[storybookWorkspace.spaces[0]!.id, { workspace: dashboardWorkspaces[0]!, spaceId: storybookWorkspace.spaces[0]!.id }]]);

    expect(invokeUICSpacePickerAction(actions, { id: "spaces.selectSpaceForWorkspace", event: "select", status: "available", args: { spaceId: 1 } }, allowedActions, allowedSpaceRequests)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(invokeUICSpacePickerAction(actions, { id: "spaces.selectSpaceForWorkspace", event: "select", status: "available", args: { spaceId: "unrendered" } }, allowedActions, allowedSpaceRequests)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
    expect(runOpenCraftRequest).not.toHaveBeenCalled();
  });

  it("does not expose retry UI or dispatch in retry state when XML omits the retry binding", () => {
    const retryOpenCraftRequest = vi.fn();
    const retryRequest = { workspace: dashboardWorkspaces[0]!, spaceId: storybookWorkspace.spaces[1]!.id };
    const html = renderUICPresentationWithModel(
      {
        spacePickerTarget: dashboardWorkspaces[0]!,
        openCraftRetryRequest: retryRequest,
        openCraftActionError: "Open failed",
      },
      { retryOpenCraftRequest },
      spacesOverviewUICLayoutXml.replace(' uic:on-retry="spaces.retryOpenWorkspace"', ""),
    );
    const region = spacePickerRegion(html);

    expect(region).toContain("UIC space picker");
    expect(region).toContain("Close picker");
    expect(region).not.toContain("Retry open");
    expect(projectUICSpacePickerActions({
      workspace: storybookWorkspace,
      spacePickerTarget: dashboardWorkspaces[0]!,
      pendingOpenCraftRequest: null,
      openCraftRetryRequest: retryRequest,
      canOpenWorkspaceInSpace: true,
    }, { close: true, retry: false, select: false })).toEqual([
      { event: "close", id: "spaces.dismissPicker", args: {}, status: "available" },
    ]);
    expect(retryOpenCraftRequest).not.toHaveBeenCalled();
  });

  it("falls back without UIC picker region or dispatch when only retry binding is invalid", () => {
    for (const invalid of ["https://example.test/action", "spaces.deleteWorkspace"]) {
      const closeSpacePicker = vi.fn();
      const retryOpenCraftRequest = vi.fn();
      const retryRequest = { workspace: dashboardWorkspaces[0]!, spaceId: storybookWorkspace.spaces[1]!.id };
      const html = renderUICPresentationWithModel(
        {
          spacePickerTarget: dashboardWorkspaces[0]!,
          openCraftRetryRequest: retryRequest,
          openCraftActionError: "Open failed",
        },
        { closeSpacePicker, retryOpenCraftRequest },
        spacesOverviewUICLayoutXml.replace('uic:on-retry="spaces.retryOpenWorkspace"', `uic:on-retry="${invalid}"`),
      );

      expect(html).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
      expect(html).toContain("uic/xml/unknown-action");
      expect(html).not.toContain('data-uic-owned-region="space-picker"');
      expect(closeSpacePicker).not.toHaveBeenCalled();
      expect(retryOpenCraftRequest).not.toHaveBeenCalled();
    }
  });

  it("projects serializable space-picker close/retry descriptors and gates unavailable picker state", () => {
    const closeSpacePicker = vi.fn();
    const retryOpenCraftRequest = vi.fn();
    const runOpenCraftRequest = vi.fn();
    const retryRequest = { workspace: dashboardWorkspaces[0]!, spaceId: storybookWorkspace.spaces[1]!.id };
    const descriptors = projectUICSpacePickerActions({
      workspace: storybookWorkspace,
      spacePickerTarget: dashboardWorkspaces[0]!,
      pendingOpenCraftRequest: null,
      openCraftRetryRequest: retryRequest,
      canOpenWorkspaceInSpace: true,
    }, { close: true, retry: true, select: false });
    const allowedActions = new Set(descriptors.map((descriptor) => descriptor.id));

    expect(descriptors).toEqual([
      { event: "close", id: "spaces.dismissPicker", args: {}, status: "available" },
      { event: "retry", id: "spaces.retryOpenWorkspace", args: {}, status: "available" },
    ]);
    expect(JSON.stringify(descriptors)).not.toMatch(/function|=>|appHooks|QueryClient|https?:|closeSpacePicker|retryOpenCraftRequest|delete|stop/u);
    expect(invokeUICSpacePickerAction({ closeSpacePicker, retryOpenCraftRequest, runOpenCraftRequest }, descriptors[0]!, allowedActions)).toEqual({ ok: true, result: { state: "completed" } });
    expect(closeSpacePicker).toHaveBeenCalledOnce();
    expect(invokeUICSpacePickerAction({ closeSpacePicker, retryOpenCraftRequest, runOpenCraftRequest }, descriptors[1]!, allowedActions)).toEqual({ ok: true, result: { state: "completed" } });
    expect(retryOpenCraftRequest).toHaveBeenCalledOnce();

    expect(projectUICSpacePickerActions({ workspace: storybookWorkspace, spacePickerTarget: null, pendingOpenCraftRequest: null, openCraftRetryRequest: retryRequest, canOpenWorkspaceInSpace: true })).toEqual([]);
    expect(projectUICSpacePickerActions({ workspace: storybookWorkspace, spacePickerTarget: dashboardWorkspaces[0]!, pendingOpenCraftRequest: retryRequest, openCraftRetryRequest: retryRequest, canOpenWorkspaceInSpace: true })).toEqual([]);
    expect(invokeUICSpacePickerAction({ closeSpacePicker, retryOpenCraftRequest, runOpenCraftRequest }, { id: "spaces.retryOpenWorkspace", event: "retry", status: "available", args: { url: "https://example.test" } }, allowedActions)).toMatchObject({ ok: false, diagnostic: { code: "uic/action/invalid-args" } });
    expect(invokeUICSpacePickerAction({ closeSpacePicker, retryOpenCraftRequest, runOpenCraftRequest }, { id: "spaces.retryOpenWorkspace", event: "retry", status: "available", args: {} }, new Set())).toMatchObject({ ok: false, diagnostic: { code: "uic/action/unavailable" } });
  });

  it("caps UIC workspace rows and repo labels deterministically before rendering", () => {
    const workspaces = Array.from({ length: UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows + 2 }, (_, index) => ({
      ...runningWorkspace({
        id: `uic-workspace-${index}`,
        name: `UIC workspace ${index}`,
        branch: `vk/workspace-${index}`,
        repos: Array.from({ length: UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelsPerRow + 2 }, (_repo, repoIndex) => ({
          id: `workspace-repo-${index}-${repoIndex}`,
          name: `repo-${repoIndex}`,
          display_name: `Repo ${repoIndex}`,
          target_branch: "main",
        })),
      }),
      has_running_dev_server: false,
    }));
    const region = workspaceListRegion(renderUICLayout(undefined, { workspaces }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain("uic/resource/repo-labels-truncated");
    expect(region).toContain(`UIC workspace ${UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`UIC workspace ${UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRows}`);
    expect(region).toContain(`Repo ${UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelsPerRow - 1}`);
    expect(region).not.toContain(`Repo ${UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelsPerRow}`);
  });

  it("diagnoses duplicate UIC workspace IDs and keeps the first row", () => {
    const resource = projectUICWorkspaceListResource({
      loading: false,
      error: null,
      sortedWorkspaces: [
        { ...dashboardWorkspaces[0]!, id: "workspace-dupe", name: "First workspace duplicate" },
        { ...dashboardWorkspaces[1]!, id: "workspace-dupe", name: "Second workspace duplicate" },
      ],
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: ["uic/resource/duplicate-row-id"] });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.items).toHaveLength(1);
    expect(resource.items[0]?.label).toBe("First workspace duplicate");
  });

  it("caps long UIC workspace labels and metadata before rendering", () => {
    const longName = `Workspace-${"w".repeat(UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxNameLength + 20)}`;
    const longBranch = `branch-${"b".repeat(UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxBranchLength + 20)}`;
    const longRepo = `Repo-${"r".repeat(UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelLength + 20)}`;
    const region = workspaceListRegion(renderUICLayout(undefined, {
      workspaces: [
        {
          ...dashboardWorkspaces[0]!,
          id: "workspace-long",
          name: longName,
          branch: longBranch,
          repos: [{ id: "repo-long", name: "repo-long", display_name: longRepo, target_branch: "main" }],
        },
      ],
    }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longName);
    expect(region).not.toContain(longBranch);
    expect(region).not.toContain(longRepo);
    expect(region).toContain(longName.slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxNameLength));
    expect(region).toContain(longBranch.slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxBranchLength));
    expect(region).toContain(longRepo.slice(0, UIC_WORKSPACE_LIST_RESOURCE_BUDGET.maxRepoLabelLength));
  });

  it("uses finite UIC states for recent sessions without session or navigation controls", () => {
    const readyRegion = recentSessionsRegion(renderUICLayout());

    expect(readyRegion).toContain("Read-only UIC voyage list");
    expect(readyRegion).toContain("All Voyages");
    expect(readyRegion).toContain("Current launch");
    expect(readyRegion).toContain("Current");
    expect(readyRegion).not.toContain("<button");
    expect(readyRegion).not.toContain("New Voyage");
    expect(readyRegion).not.toContain("Rename");
    expect(readyRegion).not.toContain("Delete");
    expect(readyRegion).not.toContain("Go to craft");

    expect(recentSessionsRegion(renderUICLayout(undefined, { savedSessions: [] }))).toContain("No saved voyages");
  });

  it("caps UIC recent session rows deterministically before rendering", () => {
    const savedSessions = Array.from({ length: UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows + 2 }, (_, index) => ({
      ...storybookSavedSessions[0]!,
      id: `voyage-uic-${index}`,
      name: `UIC voyage ${index}`,
      slug: `uic-voyage-${index}`,
      updatedAt: `2026-06-27T13:${String(59 - index).padStart(2, "0")}:00.000Z`,
    }));
    const region = recentSessionsRegion(renderUICLayout(undefined, { savedSessions, currentSessionId: savedSessions[0]!.id }));

    expect(region).toContain("uic/resource/rows-truncated");
    expect(region).toContain(`UIC voyage ${UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows - 1}`);
    expect(region).not.toContain(`UIC voyage ${UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxRows}`);
  });

  it("diagnoses duplicate UIC recent session IDs and keeps the first row", () => {
    const resource = projectUICRecentSessionsResource({
      workspace: storybookWorkspace,
      currentSessionId: "session-dupe",
      expandedSessionId: null,
      editingSessionId: null,
      sortedSessions: [
        { ...storybookSavedSessions[0]!, id: "session-dupe", name: "First voyage duplicate" },
        { ...storybookSavedSessions[1]!, id: "session-dupe", name: "Second voyage duplicate" },
      ],
    });

    expect(resource).toMatchObject({ state: "ready", diagnostics: ["uic/resource/duplicate-row-id"] });
    if (resource.state !== "ready") throw new Error("Expected ready resource");
    expect(resource.items).toHaveLength(1);
    expect(resource.items[0]?.label).toBe("First voyage duplicate");
    expect(resource.items[0]?.meta).toContain("Current");
  });

  it("caps long UIC recent session names and metadata before rendering", () => {
    const longName = `Voyage-${"v".repeat(UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxNameLength + 20)}`;
    const longSpace = `Space-${"s".repeat(UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxLocationLength + 20)}`;
    const longCraft = `Craft-${"c".repeat(UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxLocationLength + 20)}`;
    const workspace = {
      ...storybookWorkspace,
      spaces: [{ ...storybookWorkspace.spaces[1]!, id: "space-long-session", name: longSpace, tabGroupIds: ["tg-long-session"] }],
      tabGroups: [{ ...storybookWorkspace.tabGroups[1]!, id: "tg-long-session", label: longCraft }],
    };
    const savedSessions = [{
      ...storybookSavedSessions[0]!,
      id: "session-long",
      name: longName,
      activeSpaceId: "space-long-session",
      activeTabGroupId: "tg-long-session",
      visitedTabGroupIds: ["tg-long-session"],
      voyageEntries: [{ id: "entry-long-session", tabGroupId: "tg-long-session", viewIds: [] }],
    }];
    const region = recentSessionsRegion(renderUICLayout(undefined, { workspace, savedSessions, currentSessionId: undefined }));

    expect(region).toContain("uic/resource/string-truncated");
    expect(region).not.toContain(longName);
    expect(region).not.toContain(longSpace);
    expect(region).not.toContain(longCraft);
    expect(region).toContain(longName.slice(0, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxNameLength));
    expect(region).toContain(longSpace.slice(0, UIC_RECENT_SESSIONS_RESOURCE_BUDGET.maxLocationLength));
  });
});
