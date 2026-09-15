import type { MyneAppearanceSurfaceSnapshotV1 } from "./appearanceSnapshot";
import type { MyneSkinDiagnostic } from "./types";

interface SurfaceContract {
  readonly layoutIds: ReadonlySet<string>;
  readonly viewPackIds: ReadonlySet<string>;
  readonly slots: Readonly<Record<string, ReadonlySet<string>>>;
}

const MYNE_APPEARANCE_SURFACE_CONTRACTS: Readonly<Record<string, SurfaceContract>> = Object.freeze({
  "spaces-overview": {
    layoutIds: new Set(["myne.spaces.layout.default"]),
    viewPackIds: new Set(["myne.spaces.view-pack.default", "myne.spaces.view-pack.dense-workspace-list"]),
    slots: Object.freeze({
      pageHeader: new Set(["myne.spaces.page-header.default"]), recentSessions: new Set(["myne.spaces.recent-sessions.default"]),
      starredCraft: new Set(["myne.spaces.starred-craft.default"]), runningDevServers: new Set(["myne.spaces.running-dev-servers.default"]),
      recentlyVisitedCraft: new Set(["myne.spaces.recently-visited.default"]), recentlyCreatedCraft: new Set(["myne.spaces.recently-created.default"]),
      workspaceList: new Set(["myne.spaces.workspace-list.default", "myne.spaces.workspace-list.dense"]), spaces: new Set(["myne.spaces.spaces.default"]),
      spacePicker: new Set(["myne.spaces.space-picker.default"]),
    }),
  },
  "skin-editor": {
    layoutIds: new Set(["myne.appearance.layout.dialog"]),
    viewPackIds: new Set(["myne.appearance.view-pack.default", "myne.appearance.view-pack.compact-diagnostics"]),
    slots: Object.freeze({
      header: new Set(["myne.appearance.header.default"]), library: new Set(["myne.appearance.library.default"]),
      tokenEditor: new Set(["myne.appearance.token-editor.default"]), preview: new Set(["myne.appearance.preview.default"]),
      importExport: new Set(["myne.appearance.import-export.default"]), diagnostics: new Set(["myne.appearance.diagnostics.default", "myne.appearance.diagnostics.compact"]),
    }),
  },
});

export function validateAppearanceSurfaceCompatibility(surface: MyneAppearanceSurfaceSnapshotV1): MyneSkinDiagnostic[] {
  const diagnostics: MyneSkinDiagnostic[] = [];
  const contract = MYNE_APPEARANCE_SURFACE_CONTRACTS[surface.surface];
  const fail = (code: string, message: string, path: string) => diagnostics.push({ severity: "error", code, message, path });
  if (!contract) return [{ severity: "error", code: "unknown-surface", message: `Surface \"${surface.surface}\" is not registered.`, path: "surface" }];
  if (!contract.layoutIds.has(surface.layoutId)) fail("unknown-layout", `Layout \"${surface.layoutId}\" is not registered for ${surface.surface}.`, "layoutId");
  if (surface.viewPackId && !contract.viewPackIds.has(surface.viewPackId)) fail("unknown-view-pack", `View pack \"${surface.viewPackId}\" is not registered for ${surface.surface}.`, "viewPackId");
  const supplied = new Map(surface.slots.map((slot) => [slot.id, slot]));
  for (const [slotId, componentIds] of Object.entries(contract.slots)) {
    const slot = supplied.get(slotId);
    if (!slot) fail("missing-slot", `Required slot \"${slotId}\" is missing from ${surface.surface}.`, "slots");
    else if (!componentIds.has(slot.componentId)) fail("incompatible-component", `Component \"${slot.componentId}\" is not registered for ${surface.surface}.${slotId}.`, `slots.${slotId}.componentId`);
    else if (slot.contractVersion !== 1) fail("unsupported-slot-contract", `Slot \"${slotId}\" contract version is unsupported.`, `slots.${slotId}.contractVersion`);
  }
  for (const slot of surface.slots) if (!(slot.id in contract.slots)) fail("unknown-slot", `Slot \"${slot.id}\" is not registered for ${surface.surface}.`, `slots.${slot.id}`);
  return diagnostics;
}
