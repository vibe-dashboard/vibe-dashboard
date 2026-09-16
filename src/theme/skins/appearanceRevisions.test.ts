import { describe, expect, it } from "vitest";
import { defaultSpacesOverviewManifest } from "../../components/spaces-overview/SpacesOverview.composition";
import { defaultSkinEditorManifest } from "./SkinEditorDialog.composition";
import { defaultDarkSkin } from "./builtin";
import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import { AppearanceRevisionService, MemoryAppearanceRevisionStore, type AppearanceRevisionState, type AppearanceRevisionStore } from "./appearanceRevisions";
import { compileAppearanceSnapshotCandidate } from "./appearanceCandidate";

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

function customCssSnapshot(css: string): string {
  const value = JSON.parse(snapshot()) as MyneAppearanceSnapshotV1;
  value.skin = { version: 1, activeGlobalSkinId: "myne-user-legacy", userSkins: [{ ...defaultDarkSkin, id: "myne-user-legacy", name: "Legacy", rawCss: [{ id: "legacy.css", css }] }] };
  return canonicalizeAppearanceSnapshot(value);
}

async function legacyGenesis(snapshotValue: string) {
  const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const snapshotDigest = await hash(snapshotValue);
  const fields = { integrityVersion: 1, sequence: 0, parentRevisionId: null, targetRevisionId: null, snapshotDigest, actor: { id: "system", kind: "system" }, source: "genesis", committedAt: "2026-09-15T00:00:00Z", summary: "Initial appearance" };
  const revisionId = `myne-rev-v1-${await hash(JSON.stringify(fields))}`;
  return { version: 1, headRevisionId: revisionId, revisions: [{ revisionId, snapshot: snapshotValue, actor: fields.actor, source: fields.source, committedAt: fields.committedAt, summary: fields.summary, integrityVersion: 1, sequence: 0, snapshotDigest }] };
}

const compileActivation = async (value: MyneAppearanceSnapshotV1) => {
  const candidate = await compileAppearanceSnapshotCandidate(value);
  return candidate.ok ? { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null, compilerVersion: 1 as const, policyVersion: 1 as const } : undefined;
};

describe("appearance revision command service", () => {
  it("migrates valid legacy custom CSS with verified activation metadata and survives restart", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const legacy = await legacyGenesis(customCssSnapshot(".myne-card{color:#fff}"));
    await store.compareAndSwap(undefined, legacy as unknown as AppearanceRevisionState);
    const migrated = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot(), compileActivation });
    expect(migrated.inspect().head?.activation).toMatchObject({ artifactDigest: expect.stringMatching(/^sha256-/), compilerVersion: 1, policyVersion: 1 });
    const restarted = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot(), compileActivation });
    expect(restarted.inspect().head?.revisionId).toBe(migrated.inspect().head?.revisionId);
  });

  it("rejects invalid legacy custom CSS rather than inventing activation metadata", async () => {
    const legacy = await legacyGenesis(customCssSnapshot("body{background:url(javascript:alert(1))}"));
    const store: AppearanceRevisionStore = { load: async () => legacy, compareAndSwap: async () => "saved" };
    await expect(AppearanceRevisionService.open({ store, genesisSnapshot: snapshot(), compileActivation })).rejects.toThrow("corrupt-appearance-history");
  });
  it("rejects legacy custom CSS when a compiler adapter returns metadata for different source", async () => {
    const legacy = await legacyGenesis(customCssSnapshot(".myne-card{color:#fff}"));
    const store: AppearanceRevisionStore = { load: async () => legacy, compareAndSwap: async () => "saved" };
    await expect(AppearanceRevisionService.open({
      store,
      genesisSnapshot: snapshot(),
      compileActivation: async () => ({ sourceDigest: "sha256-wrong-source", artifactDigest: "sha256-wrong-artifact", compilerVersion: 1, policyVersion: 1 }),
    })).rejects.toThrow("corrupt-appearance-history");
  });
  it("rejects field-by-field immutable-chain corruption", async () => {
    const source = new MemoryAppearanceRevisionStore(); const service = await AppearanceRevisionService.open({ store: source, genesisSnapshot: snapshot(), clock: () => "2026-09-15T01:00:00Z" });
    const first = service.inspect().head!; await service.apply({ expectedCurrentRevisionId: first.revisionId, snapshot: snapshot("myne-light-studio"), actor: { id: "u", kind: "user" }, source: "user", summary: "changed" });
    const valid = await source.load() as AppearanceRevisionState;
    const mutations: Array<(state: any) => void> = [
      (s) => { s.revisions[1].snapshot = snapshot("myne-high-contrast-terminal"); }, (s) => { s.revisions[1].snapshotDigest = "0".repeat(64); },
      (s) => { s.revisions[1].actor.id = "forged"; }, (s) => { s.revisions[1].actor.kind = "forged"; }, (s) => { s.revisions[1].source = "forged"; },
      (s) => { s.revisions[1].committedAt = "2026-09-15T02:00:00Z"; }, (s) => { s.revisions[1].summary = "forged"; }, (s) => { s.revisions[1].parentRevisionId = "forged"; },
      (s) => { s.revisions[1].targetRevisionId = first.revisionId; }, (s) => { s.revisions[1].sequence = 7; }, (s) => { s.revisions[1].integrityVersion = 2; },
      (s) => { s.revisions[1].streamId = "forged"; }, (s) => { s.revisions[1].ownerId = "forged"; },
      (s) => { s.revisions[1].activation.sourceDigest = "sha256-forged"; }, (s) => { s.revisions[1].activation.artifactDigest = "sha256-forged"; },
      (s) => { s.revisions[1].activation.compilerVersion = 2; }, (s) => { s.revisions[1].activation.policyVersion = 2; },
      (s) => { s.streamId = "forged"; }, (s) => { s.ownerId = "forged"; }, (s) => { s.retention.mode = "delete"; },
      (s) => { s.revisions.reverse(); }, (s) => { s.headRevisionId = first.revisionId; }, (s) => { s.revisions[1].extra = true; },
    ];
    for (const mutate of mutations) { const corrupted = JSON.parse(JSON.stringify(valid)); mutate(corrupted); const store: AppearanceRevisionStore = { load: async () => corrupted, compareAndSwap: async () => "saved" }; await expect(AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() })).rejects.toThrow("corrupt-appearance-history"); }
  });
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
  it.each([
    ["default undo", "undo", undefined, "myne-light-studio"],
    ["targeted undo", "undo", "first", "myne-default-dark"],
    ["restore", "restore", "first", "myne-light-studio"],
    ["revert", "revert", "first", "myne-default-dark"],
    ["redo", "redo", "first", "myne-light-studio"],
  ] as const)("refreshes before resolving delayed %s", async (_label, operation, target, expectedSkin) => {
    const store = new MemoryAppearanceRevisionStore();
    const writer = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    const delayed = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    const genesis = writer.inspect().head!;
    const first = await writer.apply({ expectedCurrentRevisionId: genesis.revisionId, snapshot: snapshot("myne-light-studio"), actor: { id: "writer", kind: "user" }, source: "user", summary: "first" });
    if (!first.ok) throw new Error("first fixture write failed");
    const second = await writer.apply({ expectedCurrentRevisionId: first.revision.revisionId, snapshot: snapshot("myne-high-contrast-terminal"), actor: { id: "writer", kind: "user" }, source: "user", summary: "second" });
    if (!second.ok) throw new Error("second fixture write failed");
    const command = { expectedCurrentRevisionId: second.revision.revisionId, actor: { id: "delayed", kind: "user" } as const, summary: operation, ...(target ? { targetRevisionId: first.revision.revisionId } : {}) };
    const result = operation === "undo" ? await delayed.undo(command) : await delayed[operation](command as typeof command & { targetRevisionId: string });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.revision.snapshot).skin.activeGlobalSkinId).toBe(expectedSkin);
    expect((await writer.inspectFresh()).head?.revisionId).toBe(result.revision.revisionId);
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
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: snapshot() });
    let head = service.inspect().head!.revisionId;
    for (const id of ["myne-light-studio", "myne-high-contrast-terminal", "myne-default-dark"]) {
      const result = await service.apply({ expectedCurrentRevisionId: head, snapshot: snapshot(id), actor: { id: "u", kind: "user" }, source: "user", summary: id });
      if (!result.ok) throw new Error("fixture"); head = result.revision.revisionId;
    }
    const before = service.inspect().revisions;
    await service.checkpoint({ retainRecent: 2 });
    expect(service.inspect().revisions).toEqual(before);
    expect(service.inspect()).toMatchObject({ retention: { mode: "retain-all", undoWindow: null, assetGc: "disabled" } });
    expect(service.inspect().checkpoint).toMatchObject({ throughRevisionId: before[1]!.revisionId, boundarySnapshot: before[1]!.snapshot, boundarySnapshotDigest: before[1]!.snapshotDigest, retainedRevisionCount: 4, retainedRoots: expect.arrayContaining(before.map((revision) => revision.revisionId)) });
    const valid = await store.load() as AppearanceRevisionState;
    for (const mutate of [
      (state: any) => { state.checkpoint.throughRevisionId = "missing"; },
      (state: any) => { state.checkpoint.retainedRevisionCount = 3; },
      (state: any) => { state.checkpoint.createdAt = "invalid"; },
      (state: any) => { state.checkpoint.boundarySnapshot = "forged"; },
      (state: any) => { state.checkpoint.boundarySnapshotDigest = "forged"; },
      (state: any) => { state.checkpoint.rangeStartedAt = "invalid"; },
      (state: any) => { state.checkpoint.rangeEndedAt = "invalid"; },
      (state: any) => { state.checkpoint.auditSummary.user = 99; },
      (state: any) => { state.checkpoint.retainedRoots = []; },
      (state: any) => { state.checkpoint.digest = "forged"; },
    ]) {
      const corrupted = JSON.parse(JSON.stringify(valid)); mutate(corrupted);
      await expect(AppearanceRevisionService.open({ store: { load: async () => corrupted, compareAndSwap: async () => "saved" }, genesisSnapshot: snapshot() })).rejects.toThrow("corrupt-appearance-history");
    }
  });
});
