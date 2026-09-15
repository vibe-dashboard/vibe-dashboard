import { describe, expect, it } from "vitest";
import { defaultSpacesOverviewManifest } from "../../components/spaces-overview/SpacesOverview.composition";
import { defaultSkinEditorManifest } from "./SkinEditorDialog.composition";
import { defaultDarkSkin } from "./builtin";
import {
  canonicalizeAppearanceSnapshot,
  parseAppearanceSnapshot,
  validateAppearanceSnapshot,
  type MyneAppearanceSnapshotV1,
} from "./appearanceSnapshot";

function snapshot(): MyneAppearanceSnapshotV1 {
  return {
    format: "myne.appearance.snapshot",
    snapshotVersion: 1,
    capabilities: [
      { id: "myne.skin", version: 1 },
      { id: "myne.composition", version: 1 },
    ],
    skin: {
      version: 1,
      activeGlobalSkinId: defaultDarkSkin.id,
      userSkins: [],
    },
    surfaces: [
      {
        surface: "spaces-overview",
        manifestVersion: 1,
        layoutId: defaultSpacesOverviewManifest.layout,
        viewPackId: defaultSpacesOverviewManifest.viewPackId,
        slots: Object.values(defaultSpacesOverviewManifest.slots).map((slot) => ({
          id: slot.slot,
          componentId: slot.component,
          contractVersion: slot.contractVersion,
        })),
      },
      {
        surface: "skin-editor",
        manifestVersion: 1,
        layoutId: defaultSkinEditorManifest.layout,
        viewPackId: defaultSkinEditorManifest.viewPackId,
        slots: Object.values(defaultSkinEditorManifest.slots).map((slot) => ({
          id: slot.slot,
          componentId: slot.component,
          contractVersion: slot.contractVersion,
        })),
      },
    ],
    assets: [
      {
        path: "assets/preview.webp",
        mediaType: "image/webp",
        byteLength: 12,
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    ],
    provenance: {
      source: "user-export",
      createdAt: "2026-09-15T12:30:00Z",
      generator: "vibe-kanban-vscode-web",
    },
  };
}

describe("portable appearance snapshots", () => {
  it("serializes equivalent values to identical canonical bytes", () => {
    const first = snapshot();
    const reordered = {
      provenance: { generator: "vibe-kanban-vscode-web", createdAt: "2026-09-15T12:30:00Z", source: "user-export" },
      assets: first.assets,
      surfaces: first.surfaces,
      skin: first.skin,
      capabilities: [...first.capabilities].reverse(),
      snapshotVersion: 1,
      format: "myne.appearance.snapshot",
    };

    expect(canonicalizeAppearanceSnapshot(first)).toBe(
      canonicalizeAppearanceSnapshot(reordered),
    );
    expect(parseAppearanceSnapshot(canonicalizeAppearanceSnapshot(first))).toEqual({
      ok: true,
      value: validateAppearanceSnapshot(first).value,
      diagnostics: [],
    });
  });

  it.each([
    [{ ...snapshot(), snapshotVersion: 2 }, "unsupported-snapshot-version"],
    [{ ...snapshot(), capabilities: [{ id: "myne.skin", version: 2 }] }, "unsupported-capability-version"],
    [{ ...snapshot(), script: "alert(1)" }, "unknown-property"],
    [{ ...snapshot(), skin: { ...snapshot().skin, userSkins: [{ ...defaultDarkSkin, id: "user.test", script: "alert(1)" }] } }, "non-canonical-skin"],
    [{ ...snapshot(), assets: [{ ...snapshot().assets[0], integrity: "sha1-deadbeef" }] }, "invalid-asset-integrity"],
    [{ ...snapshot(), assets: [{ ...snapshot().assets[0], path: "../escape.webp" }] }, "invalid-asset-path"],
    [{ ...snapshot(), surfaces: [...snapshot().surfaces, snapshot().surfaces[0]] }, "duplicate-surface"],
    [{ ...snapshot(), surfaces: snapshot().surfaces.slice(1) }, "missing-surface"],
    [{ ...snapshot(), provenance: { ...snapshot().provenance, generator: "bad\ud800" } }, "invalid-unicode"],
  ])("rejects malformed or incompatible packages (%s)", (candidate, code) => {
    const result = validateAppearanceSnapshot(candidate);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code })]),
    );
  });

  it("rejects non-canonical JSON input and reports parse failures without throwing", () => {
    const pretty = JSON.stringify(snapshot(), null, 2);
    expect(parseAppearanceSnapshot(pretty)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "non-canonical-json" })],
    });
    expect(parseAppearanceSnapshot("{" )).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "invalid-json" })],
    });
  });
});
