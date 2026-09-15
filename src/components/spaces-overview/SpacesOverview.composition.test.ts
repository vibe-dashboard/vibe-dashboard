import { describe, expect, it } from "vitest";
import {
  defaultSpacesOverviewManifest,
  denseSpacesOverviewManifest,
  resolveSpacesOverviewComposition,
  spacesOverviewCompositionRegistry,
  spacesOverviewSlots,
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
});
