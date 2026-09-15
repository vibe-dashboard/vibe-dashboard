import { describe, expect, it } from "vitest";
import {
  defaultSpacesOverviewManifest,
  denseSpacesOverviewManifest,
  resolveSpacesOverviewComposition,
  spacesOverviewCompositionRegistry,
  spacesOverviewSlots,
  projectSpacesOverviewSlotProps,
} from "./SpacesOverview.composition";

describe("SpacesOverview composition contract", () => {
  it("registers every required slot and resolves the default view pack", () => {
    const resolved = resolveSpacesOverviewComposition(defaultSpacesOverviewManifest);
    expect(Object.keys(defaultSpacesOverviewManifest.slots).sort()).toEqual(
      [...spacesOverviewSlots].sort(),
    );
    expect(resolved.layout).toBe(
      spacesOverviewCompositionRegistry.layouts["myne.spaces.layout.default"],
    );
    expect(resolved.viewPackId).toBe("myne.spaces.view-pack.default");
  });

  it("projects only the independently versioned model and actions for a slot", () => {
    const surface = {
      model: {
        sortedWorkspaces: [],
        loading: false,
        workspace: { secret: "not-public-to-header" },
      },
      actions: {
        selectRepo: () => undefined,
        deleteSession: () => undefined,
      },
    } as never;

    const projected = projectSpacesOverviewSlotProps("workspaceList", surface);
    expect(Object.keys(projected.model).sort()).toEqual([
      "canOpenWorkspaceInSpace",
      "effectiveRepos",
      "error",
      "loading",
      "pagedWorkspaces",
      "selectedRepoId",
      "sortedWorkspaces",
      "stoppingDevServerIds",
      "workspacePage",
      "workspaceTabGroupMap",
      "workspaceTotalPages",
    ]);
    expect(Object.keys(projected.actions).sort()).toEqual([
      "navigateToTabGroup",
      "openSpacePickerForWorkspace",
      "selectRepo",
      "setWorkspacePage",
      "stopDevServer",
    ]);
    expect("workspace" in projected.model).toBe(false);
    expect("deleteSession" in projected.actions).toBe(false);
    expect("appHooks" in projected).toBe(false);
  });

  it("keeps view packs independent from skins and swaps only compatible slots", () => {
    const resolved = resolveSpacesOverviewComposition(denseSpacesOverviewManifest);
    expect(resolved.viewPackId).toBe(
      "myne.spaces.view-pack.dense-workspace-list",
    );
    expect(resolved.ui.WorkspaceListSection).toBe(
      spacesOverviewCompositionRegistry.components[
        "myne.spaces.workspace-list.dense"
      ].component,
    );
    expect(JSON.stringify(denseSpacesOverviewManifest)).not.toContain("skin");
  });

  it("rejects incomplete manifests and same-version cross-slot overrides", () => {
    const { pageHeader: _missing, ...incomplete } = defaultSpacesOverviewManifest.slots;
    expect(() => resolveSpacesOverviewComposition({
      ...defaultSpacesOverviewManifest,
      slots: incomplete,
    } as never)).toThrow(/missing required slot pageHeader/);
    expect(() => resolveSpacesOverviewComposition(defaultSpacesOverviewManifest, {
      pageHeader: "myne.spaces.workspace-list.default",
    } as never)).toThrow(/registered for workspaceList.*not pageHeader/);
  });
});
