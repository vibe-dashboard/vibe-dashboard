import { describe, expect, it } from "vitest";
import {
  defaultSkinEditorManifest,
  compactDiagnosticsSkinEditorManifest,
  selectedSkinEditorComposition,
  skinEditorCompositionRegistry,
  skinEditorSlots,
  projectSkinEditorSlotProps,
  resolveSkinEditorComposition,
  skinEditorSlotContracts,
} from "./SkinEditorDialog.composition";

describe("Skin Editor composition contract", () => {
  it("resolves a separately registered layout and component view pack", () => {
    expect(selectedSkinEditorComposition.layout).toBe(
      skinEditorCompositionRegistry.layouts["myne.appearance.layout.dialog"],
    );
    expect(Object.keys(defaultSkinEditorManifest.slots).sort()).toEqual(
      [...skinEditorSlots].sort(),
    );
    expect(selectedSkinEditorComposition.components.library).toBe(
      skinEditorCompositionRegistry.components[
        "myne.appearance.library.default"
      ].component,
    );
    expect(defaultSkinEditorManifest.viewPackId).toBe(
      "myne.appearance.view-pack.default",
    );
    expect(JSON.stringify(defaultSkinEditorManifest)).not.toContain("skinId");
  });

  it("supports a compatible regional override without changing skin data", () => {
    const resolved = resolveSkinEditorComposition(
      compactDiagnosticsSkinEditorManifest,
    );
    expect(resolved.components.diagnostics).toBe(
      skinEditorCompositionRegistry.components[
        "myne.appearance.diagnostics.compact"
      ].component,
    );
    expect(resolved.viewPackId).toBe(
      "myne.appearance.view-pack.compact-diagnostics",
    );
    expect(JSON.stringify(compactDiagnosticsSkinEditorManifest)).not.toContain(
      "skinId",
    );
  });

  it("projects each real region without leaking surface-wide state or actions", () => {
    expect(Object.values(skinEditorSlotContracts).map(({ version }) => version)).toEqual([1, 2, 2, 1, 2, 1]);
    const surface = {
      model: { skinOptions: [], selectedSkinIsBuiltIn: true, isSaving: false, isDirty: false, isCandidateReady: true },
      actions: { selectSkin: () => undefined, close: () => undefined },
    } as never;
    const projected = projectSkinEditorSlotProps("library", surface);
    expect(Object.keys(projected.model).sort()).toEqual([
      "isCandidateReady",
      "isDirty",
      "isSaving",
      "selectedSkinIsBuiltIn",
      "skinOptions",
    ]);
    expect(Object.keys(projected.actions).sort()).toEqual([
      "applySelectedSkin",
      "forkSelectedSkin",
      "revertToDefaultSkin",
      "selectSkin",
    ]);
    expect("close" in projected.actions).toBe(false);
    expect("previewState" in projected.model).toBe(false);
  });

  it("rejects extra slots and same-version cross-region substitutions", () => {
    expect(() => resolveSkinEditorComposition({
      ...defaultSkinEditorManifest,
      slots: {
        ...defaultSkinEditorManifest.slots,
        unknown: { slot: "unknown", component: "myne.appearance.header.default", contractVersion: 1 },
      },
    } as never)).toThrow(/unknown slot unknown/);
    expect(() => resolveSkinEditorComposition(defaultSkinEditorManifest, {
      library: "myne.appearance.header.default",
    } as never)).toThrow(/registered for header.*not library/);
  });
});
