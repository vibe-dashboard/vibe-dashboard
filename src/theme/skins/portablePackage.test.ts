import { describe, expect, it } from "vitest";
import { defaultSpacesOverviewManifest } from "../../components/spaces-overview/SpacesOverview.composition";
import { defaultSkinEditorManifest } from "./SkinEditorDialog.composition";
import { defaultDarkSkin } from "./builtin";
import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import { diffAppearanceSnapshots, restoreAppearanceSnapshot, verifyPortableAppearancePackage } from "./portablePackage";
import { DEFAULT_GLOBAL_UIC_PREFERENCES } from "./uicPreferences";

async function integrity(bytes: Uint8Array, algorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256") {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, Uint8Array.from(bytes).buffer));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `${algorithm.toLowerCase().replace("-", "")}-${btoa(binary)}`;
}

function surface(manifest: typeof defaultSpacesOverviewManifest | typeof defaultSkinEditorManifest) {
  return {
    surface: manifest.surface,
    manifestVersion: 1 as const,
    layoutId: manifest.layout,
    viewPackId: manifest.viewPackId,
    slots: Object.values(manifest.slots).map((slot) => ({ id: slot.slot, componentId: slot.component, contractVersion: slot.contractVersion })),
  };
}

async function fixture(algorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256") {
  const bytes = new TextEncoder().encode("verified image bytes");
  const snapshot: MyneAppearanceSnapshotV1 = {
    format: "myne.appearance.snapshot", snapshotVersion: 1,
    capabilities: [{ id: "myne.skin", version: 1 }, { id: "myne.composition", version: 1 }],
    preferences: DEFAULT_GLOBAL_UIC_PREFERENCES,
    skin: { version: 1, activeGlobalSkinId: defaultDarkSkin.id, userSkins: [] },
    surfaces: [surface(defaultSpacesOverviewManifest), surface(defaultSkinEditorManifest)],
    assets: [{ path: "assets/preview.webp", mediaType: "image/webp", byteLength: bytes.byteLength, integrity: await integrity(bytes, algorithm) as `sha256-${string}` }],
    provenance: { source: "user-export", createdAt: "2026-09-15T12:30:00Z", generator: "tests" },
  };
  return { bytes, snapshot, snapshotJson: canonicalizeAppearanceSnapshot(snapshot) };
}

describe("portable appearance packages", () => {
  it.each(["SHA-256", "SHA-384", "SHA-512"] as const)("verifies %s asset bytes and returns defensive copies", async (algorithm) => {
    const input = await fixture(algorithm);
    const result = await verifyPortableAppearancePackage({ snapshotJson: input.snapshotJson, assets: [{ path: "assets/preview.webp", bytes: input.bytes }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.canonicalSnapshot).toBe(input.snapshotJson);
    const first = result.package.readAsset("assets/preview.webp")!;
    first[0] = 0;
    expect(result.package.readAsset("assets/preview.webp")).toEqual(input.bytes);
    expect(Object.isFrozen(result.package)).toBe(true);
  });

  it.each([
    ["missing", "missing-asset"],
    ["unexpected", "unexpected-asset"],
    ["length", "asset-length-mismatch"],
    ["digest", "asset-integrity-mismatch"],
  ])("rejects the complete package for %s assets", async (mutation, code) => {
    const input = await fixture();
    const bytes = mutation === "length" ? new Uint8Array([...input.bytes, 0]) : mutation === "digest" ? new Uint8Array(input.bytes.map((value, index) => index ? value : value ^ 1)) : input.bytes;
    const assets = mutation === "missing" ? [] : [{ path: mutation === "unexpected" ? "assets/other.webp" : "assets/preview.webp", bytes }];
    const result = await verifyPortableAppearancePackage({ snapshotJson: input.snapshotJson, assets });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect("package" in result).toBe(false);
  });

  it("produces stable semantic diffs and restores only validated canonical targets", async () => {
    const input = await fixture();
    const changed = canonicalizeAppearanceSnapshot({ ...input.snapshot, provenance: { ...input.snapshot.provenance, source: "app-backup" }, skin: { ...input.snapshot.skin, activeGlobalSkinId: "myne-light-studio" } });
    const diff = diffAppearanceSnapshots(input.snapshotJson, changed);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.changes.map((change) => change.path)).toEqual(["provenance.source", "skin.activeGlobalSkinId"]);
    expect(diffAppearanceSnapshots(changed, input.snapshotJson)).toMatchObject({ ok: true, changes: expect.any(Array) });
    expect(restoreAppearanceSnapshot(input.snapshotJson, changed)).toMatchObject({ ok: true, canonicalSnapshot: changed, changes: diff.changes });
    expect(restoreAppearanceSnapshot(input.snapshotJson, JSON.stringify(input.snapshot))).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "non-canonical-json" })] });
  });
});
