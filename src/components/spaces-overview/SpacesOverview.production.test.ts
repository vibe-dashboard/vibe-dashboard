// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import { DefaultSpacesOverviewLayout, defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";
import {
  SPACES_OVERVIEW_UIC_DISABLE_ENV,
  UIC_SPACES_OVERVIEW_ALTERNATE_LAYOUT_ID,
  UIC_SPACES_OVERVIEW_DEFAULT_LAYOUT_ID,
  createSpacesOverviewProductionView,
  isSpacesOverviewUICDisabled,
  spacesOverviewUICFallbackDiagnostics,
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

function renderProductionSpacesOverview(
  overrides: Partial<React.ComponentProps<typeof SpacesOverviewView>> = {},
) {
  return render(createElement(SpacesOverviewView, {
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
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("SpacesOverview production UIC fallback", () => {
  it("treats 1, true, yes, and on as disable values and unset/0/false as enabled", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isSpacesOverviewUICDisabled({ [SPACES_OVERVIEW_UIC_DISABLE_ENV]: value })).toBe(true);
    }

    for (const value of [undefined, "", "0", "false", "FALSE", "off"]) {
      expect(isSpacesOverviewUICDisabled({ [SPACES_OVERVIEW_UIC_DISABLE_ENV]: value })).toBe(false);
    }
    expect(isSpacesOverviewUICDisabled({ VD_SPACES_OVERVIEW_UIC: "0" })).toBe(false);
  });

  it("catches a child slot render failure with the client error boundary and shows React fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function ThrowingWorkspaceListSection(_props: SpacesOverviewSlotProps<"workspaceList">): never {
      throw new Error("workspace slot exploded");
    }
    const presentation = createSpacesOverviewProductionView({
      env: {},
      startupDiagnostics: [],
      uicPresentation: (props) => createElement(DefaultSpacesOverviewLayout, {
        ...props,
        ui: {
          ...defaultSpacesOverviewUI,
          WorkspaceListSection: ThrowingWorkspaceListSection,
        },
        viewPackId: "uic.spaces.layout-shell.proof",
      }),
    });

    const { container } = renderProductionSpacesOverview({ presentation });

    expect(screen.getByText(/SpacesOverview UIC fallback active/)).toBeTruthy();
    expect(container.innerHTML).toContain('data-myne-view-pack="myne.spaces.view-pack.default"');
    expect(container.innerHTML).toContain(`data-uic-fallback-diagnostic="${spacesOverviewUICFallbackDiagnostics.renderException}"`);
  });

  it("defaults to the built-in default UIC layout and switches to the alternate layout for this mount", () => {
    const { container } = renderProductionSpacesOverview();

    const selector = screen.getByLabelText("SpacesOverview UIC layout") as HTMLSelectElement;
    expect(selector.value).toBe(UIC_SPACES_OVERVIEW_DEFAULT_LAYOUT_ID);
    expect(container.innerHTML).toContain(`data-myne-view-pack="${UIC_SPACES_OVERVIEW_DEFAULT_LAYOUT_ID}"`);

    const defaultRecentIndex = container.innerHTML.indexOf('data-uic-owned-region="recent-sessions"');
    const defaultWorkspaceIndex = container.innerHTML.indexOf('data-uic-owned-region="workspace-list"');
    expect(defaultRecentIndex).toBeGreaterThan(-1);
    expect(defaultWorkspaceIndex).toBeGreaterThan(defaultRecentIndex);

    fireEvent.change(selector, { target: { value: UIC_SPACES_OVERVIEW_ALTERNATE_LAYOUT_ID } });

    expect(selector.value).toBe(UIC_SPACES_OVERVIEW_ALTERNATE_LAYOUT_ID);
    expect(container.innerHTML).toContain(`data-myne-view-pack="${UIC_SPACES_OVERVIEW_ALTERNATE_LAYOUT_ID}"`);
    const alternateWorkspaceIndex = container.innerHTML.indexOf('data-uic-owned-region="workspace-list"');
    const alternateRecentIndex = container.innerHTML.indexOf('data-uic-owned-region="recent-sessions"');
    expect(alternateWorkspaceIndex).toBeGreaterThan(-1);
    expect(alternateRecentIndex).toBeGreaterThan(alternateWorkspaceIndex);
  });

  it("falls back to the default UIC layout when the selected built-in layout id is invalid", () => {
    const presentation = createSpacesOverviewProductionView({
      env: {},
      initialLayoutId: "uic.spaces.layout.missing",
    });

    const { container } = renderProductionSpacesOverview({ presentation });

    expect(screen.getByLabelText("SpacesOverview UIC layout")).toHaveProperty("value", UIC_SPACES_OVERVIEW_DEFAULT_LAYOUT_ID);
    expect(container.innerHTML).toContain(`data-myne-view-pack="${UIC_SPACES_OVERVIEW_DEFAULT_LAYOUT_ID}"`);
    expect(container.innerHTML).not.toContain("SpacesOverview UIC fallback active");
  });
});
