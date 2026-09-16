import { canonicalizeAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import { BUILT_IN_MYNE_SKINS } from "./builtin";
import { getSkinRuntimeState } from "./runtime";
import { compileScopedAppearance, type CompiledAppearanceArtifactV1 } from "./scopedCss";

export interface AppearanceCandidateBindingV1 {
  readonly sourceDigest: `sha256-${string}`;
  readonly artifactDigest: `sha256-${string}` | null;
}

export interface AppearanceCandidateArtifactDTO {
  readonly scope: string;
  readonly cssText: string;
  readonly digest: `sha256-${string}`;
}

export type AppearanceCandidateCompileResult =
  | { readonly ok: true; readonly sourceDigest: `sha256-${string}`; readonly artifact?: AppearanceCandidateArtifactDTO; readonly artifactObject?: CompiledAppearanceArtifactV1 }
  | { readonly ok: false; readonly diagnostics: readonly { readonly severity: "error" | "warning"; readonly code: string; readonly message: string; readonly path?: string }[] };

export async function sourceDigestForAppearanceSnapshot(snapshot: MyneAppearanceSnapshotV1): Promise<`sha256-${string}`> {
  return sha256Base64Url(canonicalizeAppearanceSnapshot({
    ...snapshot,
    provenance: { source: "user-export", createdAt: "1970-01-01T00:00:00.000Z", generator: "candidate-source-binding" },
  }));
}

export async function compileAppearanceSnapshotCandidate(snapshot: MyneAppearanceSnapshotV1): Promise<AppearanceCandidateCompileResult> {
  const sourceDigest = await sourceDigestForAppearanceSnapshot(snapshot);
  const skin = snapshot.skin.userSkins.find((candidate) => candidate.id === snapshot.skin.activeGlobalSkinId)
    ?? BUILT_IN_MYNE_SKINS.find((candidate) => candidate.id === snapshot.skin.activeGlobalSkinId);
  if (!skin || skin.rawCss.length === 0) return { ok: true, sourceDigest };
  const runtime = getSkinRuntimeState({ state: snapshot.skin });
  const tokens = compilerTokensFromRuntime(runtime.style as Readonly<Record<string, unknown>>);
  const result = await compileScopedAppearance({ packageId: skin.id, cssBlocks: skin.rawCss, tokens });
  if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
  return {
    ok: true,
    sourceDigest,
    artifactObject: result.artifact,
    artifact: {
      scope: result.artifact.scope,
      cssText: result.artifact.cssText,
      digest: result.artifact.metadata.artifactDigest,
    },
  };
}

export function compilerTokensFromRuntime(style: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(Object.entries(style).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string"
    && /^--myne-(?:color|font|text|density|space|radius|control|row|surface|component|slot)-[a-z0-9-]+$/.test(entry[0])
    && !entry[0].startsWith("--myne-protected-")
    && !/url\s*\(|javascript:|expression\s*\(|\s\/\s/i.test(entry[1]),
  ));
}

export async function verifyAppearanceCandidateBinding(
  snapshot: MyneAppearanceSnapshotV1,
  binding: AppearanceCandidateBindingV1,
): Promise<{ readonly ok: true; readonly candidate: Extract<AppearanceCandidateCompileResult, { ok: true }> } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const candidate = await compileAppearanceSnapshotCandidate(snapshot);
  if (!candidate.ok) return { ok: false, code: "candidate-compile-failed", message: candidate.diagnostics.map((item) => item.code).join(", ") || "Candidate CSS did not compile." };
  if (candidate.sourceDigest !== binding.sourceDigest || (candidate.artifact?.digest ?? null) !== binding.artifactDigest) {
    return { ok: false, code: "candidate-digest-mismatch", message: "The appearance candidate no longer matches the submitted activation artifact." };
  }
  return { ok: true, candidate };
}

async function sha256Base64Url(value: string): Promise<`sha256-${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return `sha256-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "")}`;
}
