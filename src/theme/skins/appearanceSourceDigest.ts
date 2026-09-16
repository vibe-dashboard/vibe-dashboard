import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";

export async function sourceDigestForAppearanceSnapshot(snapshot: MyneAppearanceSnapshotV1): Promise<`sha256-${string}`> {
  const canonical = canonicalizeAppearanceSnapshot({
    ...snapshot,
    provenance: { source: "user-export", createdAt: "1970-01-01T00:00:00.000Z", generator: "candidate-source-binding" },
  });
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  const binary = String.fromCharCode(...bytes);
  return `sha256-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`;
}
