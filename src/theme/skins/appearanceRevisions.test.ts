import { describe, expect, it } from "vitest";
import { defaultSpacesOverviewManifest } from "../../components/spaces-overview/SpacesOverview.composition";
import { defaultSkinEditorManifest } from "./SkinEditorDialog.composition";
import { defaultDarkSkin } from "./builtin";
import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import { AppearanceRevisionService, MemoryAppearanceRevisionStore } from "./appearanceRevisions";

function snapshot(activeGlobalSkinId = defaultDarkSkin.id): string {
  const mapSurface = (manifest: typeof defaultSpacesOverviewManifest | typeof defaultSkinEditorManifest) => ({ surface: manifest.surface, manifestVersion: 1 as const, layoutId: manifest.layout, viewPackId: manifest.viewPackId, slots: Object.values(manifest.slots).map((slot) => ({ id: slot.slot, componentId: slot.component, contractVersion: slot.contractVersion })) });
  const value: MyneAppearanceSnapshotV1 = {
    format: "myne.appearance.snapshot", snapshotVersion: 1,
    capabilities: [{ id: "myne.skin", version: 1 }, { id: "myne.composition", version: 1 }],
    skin: { version: 1, activeGlobalSkinId, userSkins: [] },
    surfaces: [mapSurface(defaultSpacesOverviewManifest), mapSurface(defaultSkinEditorManifest)], assets: [],
    provenance: { source: "app-backup", createdAt: "2026-09-15T00:00:00Z", generator: "revision-tests" },
  };
  return canonicalizeAppearanceSnapshot(value);
}

describe("appearance revision command service", () => {
  it("appends immutable canonical metadata through one source-neutral command", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot(), clock: () => "2026-09-15T01:00:00Z" });
    const genesis = service.inspect().head!;
    const result = await service.apply({ expectedCurrentRevisionId: genesis.revisionId, snapshot: snapshot("myne-light-studio"), actor: { id: "user-1", kind: "user" }, source: "user", summary: "Use light studio" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toMatchObject({ parentRevisionId: genesis.revisionId, actor: { id: "user-1", kind: "user" }, source: "user", summary: "Use light studio", committedAt: "2026-09-15T01:00:00Z" });
    expect(Object.isFrozen(result.revision)).toBe(true);
    expect(service.inspect().revisions).toHaveLength(2);
  });

  it("serializes concurrent clients and returns an actionable stale conflict", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    const otherClient = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    const head = service.inspect().head!.revisionId;
    const [first, second] = await Promise.all([
      service.apply({ expectedCurrentRevisionId: head, snapshot: snapshot("myne-light-studio"), actor: { id: "a", kind: "user" }, source: "user", summary: "first" }),
      otherClient.apply({ expectedCurrentRevisionId: head, snapshot: snapshot("myne-high-contrast-terminal"), actor: { id: "b", kind: "agent" }, source: "agent", summary: "second" }),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const conflict = first.ok ? second : first;
    expect(conflict).toMatchObject({ ok: false, diagnostic: { code: "stale-revision", expectedRevisionId: head, currentRevisionId: expect.any(String) } });
    const restarted = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    expect(restarted.inspect().revisions).toHaveLength(2);
  });

  it("leaves head/history unchanged on persistence failure and remains undoable", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    const genesis = service.inspect().head!.revisionId;
    store.failNextWrite();
    const failed = await service.apply({ expectedCurrentRevisionId: genesis, snapshot: snapshot("myne-light-studio"), actor: { id: "u", kind: "user" }, source: "user", summary: "fail" });
    expect(failed).toMatchObject({ ok: false, diagnostic: { code: "persistence-failed" } });
    expect(service.inspect()).toMatchObject({ head: { revisionId: genesis }, revisions: [{ revisionId: genesis }] });
    const applied = await service.apply({ expectedCurrentRevisionId: genesis, snapshot: snapshot("myne-light-studio"), actor: { id: "u", kind: "user" }, source: "user", summary: "apply" });
    if (!applied.ok) throw new Error("apply failed");
    const undone = await service.undo({ expectedCurrentRevisionId: applied.revision.revisionId, actor: { id: "u", kind: "user" }, summary: "undo" });
    expect(undone).toMatchObject({ ok: true, revision: { source: "undo", targetRevisionId: applied.revision.revisionId, snapshot: snapshot() } });
  });

  it("implements restore, revert, and redo as compensating revisions", async () => {
    const service = await AppearanceRevisionService.open({ store: new MemoryAppearanceRevisionStore(), genesisSnapshot: snapshot() });
    const genesis = service.inspect().head!;
    const applied = await service.apply({ expectedCurrentRevisionId: genesis.revisionId, snapshot: snapshot("myne-light-studio"), actor: { id: "cli", kind: "cli" }, source: "cli", summary: "apply" });
    if (!applied.ok) throw new Error("fixture");
    const reverted = await service.revert({ expectedCurrentRevisionId: applied.revision.revisionId, targetRevisionId: applied.revision.revisionId, actor: { id: "cli", kind: "cli" }, summary: "revert" });
    if (!reverted.ok) throw new Error("fixture");
    const redone = await service.redo({ expectedCurrentRevisionId: reverted.revision.revisionId, targetRevisionId: applied.revision.revisionId, actor: { id: "cli", kind: "cli" }, summary: "redo" });
    if (!redone.ok) throw new Error("fixture");
    const restored = await service.restore({ expectedCurrentRevisionId: redone.revision.revisionId, targetRevisionId: genesis.revisionId, actor: { id: "cli", kind: "cli" }, summary: "restore" });
    expect(service.inspect().revisions.map((revision) => revision.source)).toEqual(["genesis", "cli", "revert", "redo", "restore"]);
    expect(restored).toMatchObject({ ok: true, revision: { snapshot: genesis.snapshot } });
  });

  it("uses authorization for every source and recovers consistently after restart/corruption", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot(), authorize: ({ actor }) => actor.id !== "denied" });
    const head = service.inspect().head!.revisionId;
    expect(await service.apply({ expectedCurrentRevisionId: head, snapshot: snapshot("myne-light-studio"), actor: { id: "denied", kind: "marketplace" }, source: "marketplace", summary: "no" })).toMatchObject({ ok: false, diagnostic: { code: "unauthorized" } });
    const restarted = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    expect(restarted.inspect().head?.revisionId).toBe(head);
    store.corrupt();
    await expect(AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() })).rejects.toThrow("corrupt-appearance-history");
  });

  it("records a checkpoint without changing observable retained history", async () => {
    const service = await AppearanceRevisionService.open({ store: new MemoryAppearanceRevisionStore(), genesisSnapshot: snapshot() });
    let head = service.inspect().head!.revisionId;
    for (const id of ["myne-light-studio", "myne-high-contrast-terminal", "myne-default-dark"]) {
      const result = await service.apply({ expectedCurrentRevisionId: head, snapshot: snapshot(id), actor: { id: "u", kind: "user" }, source: "user", summary: id });
      if (!result.ok) throw new Error("fixture"); head = result.revision.revisionId;
    }
    const before = service.inspect().revisions;
    await service.compact({ retainRecent: 2 });
    expect(service.inspect().revisions).toEqual(before);
    expect(service.inspect().checkpoint).toMatchObject({ throughRevisionId: before[1]!.revisionId, retainedRevisionCount: 4 });
  });
});
