import { defaultSpacesOverviewManifest } from "../../components/spaces-overview/SpacesOverview.composition";
import { defaultSkinEditorManifest } from "./SkinEditorDialog.composition";
import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import { defaultDarkSkin } from "./builtin";
import { DEFAULT_GLOBAL_UIC_PREFERENCES } from "./uicPreferences";

export function createDefaultAppearanceSnapshot(createdAt = "1970-01-01T00:00:00.000Z"): string {
  const toSurface = (manifest: typeof defaultSpacesOverviewManifest | typeof defaultSkinEditorManifest) => ({
    surface: manifest.surface,
    manifestVersion: 1 as const,
    layoutId: manifest.layout,
    viewPackId: manifest.viewPackId,
    slots: Object.values(manifest.slots).map((slot) => ({
      id: slot.slot,
      componentId: slot.component,
      contractVersion: slot.contractVersion,
    })),
  });
  const snapshot: MyneAppearanceSnapshotV1 = {
    format: "myne.appearance.snapshot",
    snapshotVersion: 1,
    capabilities: [{ id: "myne.skin", version: 1 }, { id: "myne.composition", version: 1 }],
    preferences: DEFAULT_GLOBAL_UIC_PREFERENCES,
    skin: { version: 1, activeGlobalSkinId: defaultDarkSkin.id, userSkins: [] },
    surfaces: [toSurface(defaultSpacesOverviewManifest), toSurface(defaultSkinEditorManifest)],
    assets: [],
    provenance: { source: "app-backup", createdAt, generator: "vibe-kanban" },
  };
  return canonicalizeAppearanceSnapshot(snapshot);
}
