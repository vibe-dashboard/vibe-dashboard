import { describe, expect, it } from "vitest";
import {
  defaultSkinEditorManifest,
  selectedSkinEditorComposition,
  skinEditorCompositionRegistry,
} from "./SkinEditorDialog.composition";

describe("Skin Editor composition contract", () => {
  it("resolves a separately registered layout and component view pack", () => {
    expect(selectedSkinEditorComposition.layout).toBe(
      skinEditorCompositionRegistry.layouts["myne.appearance.layout.dialog"],
    );
    expect(selectedSkinEditorComposition.components.editor).toBe(
      skinEditorCompositionRegistry.components[
        "myne.appearance.editor.default"
      ].component,
    );
    expect(defaultSkinEditorManifest.viewPackId).toBe(
      "myne.appearance.view-pack.default",
    );
    expect(JSON.stringify(defaultSkinEditorManifest)).not.toContain("skinId");
  });
});
