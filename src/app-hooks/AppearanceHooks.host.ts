import { useEffect, useSyncExternalStore } from "react";
import { canonicalizeAppearanceSnapshot, parseAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "../theme/skins/appearanceSnapshot";
import { compileAppearanceSnapshotCandidate, compilerTokensFromRuntime, verifyAppearanceCandidateBinding } from "../theme/skins/appearanceCandidate";
import { migrateSkinState } from "../theme/skins/schema";
import { BUILT_IN_MYNE_SKINS } from "../theme/skins/builtin";
import { compileScopedAppearance, type CompiledAppearanceArtifactV1 } from "../theme/skins/scopedCss";
import { getSkinRuntimeState } from "../theme/skins/runtime";
import type { AppearanceModuleV1, AppearanceSnapshotV1, AppearanceStateV1, ModuleHookResult, ReadonlyJsonValue } from "./AppHooks";

interface HistoryEnvelope { head?: { revisionId?: unknown; snapshot?: unknown } }
export interface AppearanceProjection {
  readonly activeGlobalSkinId: string;
  readonly density: string;
  readonly surfaceViewPacks: Readonly<Record<string, string>>;
  readonly safeMode: boolean;
}
export interface ProductionAppearanceHost {
  readonly module: AppearanceModuleV1;
  reload(): Promise<void>;
  getProjection(): AppearanceProjection | undefined;
}

function diagnostic(code: string, message: string) {
  return { severity: "error" as const, code, message };
}

export function createProductionAppearanceModule(options: {
  fetcher?: typeof fetch;
  endpoint?: string;
} = {}): ProductionAppearanceHost {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = options.endpoint ?? "/dashboard/api/appearance";
  let state: AppearanceStateV1 = Object.freeze({ loading: true, error: null, safeMode: false });
  let canonical: string | undefined;
  let parsed: MyneAppearanceSnapshotV1 | undefined;
  let artifact: CompiledAppearanceArtifactV1 | undefined;
  let loadPromise: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = (next: AppearanceStateV1) => { state = Object.freeze(next); listeners.forEach((listener) => listener()); };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  const load = async () => {
    const previous = state.snapshot;
    try {
      const response = await fetcher(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`appearance history returned HTTP ${response.status}`);
      const envelope = await response.json() as HistoryEnvelope;
      if (typeof envelope.head?.revisionId !== "string" || typeof envelope.head.snapshot !== "string") throw new Error("appearance history response is malformed");
      const result = parseAppearanceSnapshot(envelope.head.snapshot);
      if (!result.ok || !result.value) throw new Error(`persisted appearance is invalid: ${result.diagnostics.map((item) => item.code).join(", ")}`);
      const compiled = await compileActiveCss(result.value.skin);
      if (!compiled.ok) throw new Error(`persisted appearance CSS is invalid: ${compiled.diagnostics.map((item) => item.code).join(", ")}`);
      canonical = envelope.head.snapshot;
      parsed = result.value;
      artifact = compiled.artifact;
      const activeSkin = result.value.skin.userSkins.find((skin) => skin.id === result.value!.skin.activeGlobalSkinId)
        ?? BUILT_IN_MYNE_SKINS.find((skin) => skin.id === result.value!.skin.activeGlobalSkinId);
      emit({ loading: false, error: null, safeMode: false, headRevisionId: envelope.head.revisionId,
        density: activeSkin?.tokens.density.scale ?? "comfortable",
        viewPacks: Object.freeze(Object.fromEntries(result.value.surfaces.map((surface) => [surface.surface, surface.viewPackId ?? ""]))),
        ...(artifact ? { artifact: { scope: artifact.scope, cssText: artifact.cssText, digest: artifact.metadata.artifactDigest } } : {}),
        snapshot: { schemaVersion: 1, value: result.value.skin as unknown as ReadonlyJsonValue } });
    } catch (cause) {
      emit({ ...state, loading: false, safeMode: true, error: cause instanceof Error ? cause.message : "appearance startup failed", ...(previous ? { snapshot: previous } : {}) });
    }
  };
  const reload = () => loadPromise = load().finally(() => { loadPromise = undefined; });
  const ensureLoaded = () => loadPromise ??= load().finally(() => { loadPromise = undefined; });
  const useSkinEditor = (): ModuleHookResult<AppearanceStateV1> => {
    const value = useSyncExternalStore(subscribe, () => state, () => state);
    useEffect(() => { void ensureLoaded(); }, []);
    return { available: true, value };
  };
  const module: AppearanceModuleV1 = Object.freeze({
    id: "myne.appearance", version: 1, availability: Object.freeze({ available: true }), useSkinEditor,
    compileAppearanceCandidate: async ({ snapshot }: { readonly snapshot: AppearanceSnapshotV1 }) => {
      try {
        if (!parsed) return { ok: false, diagnostics: [diagnostic("appearance-not-ready", "Appearance history is not ready.")] };
        const skin = migrateSkinState(snapshot.value);
        const next: MyneAppearanceSnapshotV1 = { ...parsed, skin, provenance: { source: "user-export", createdAt: new Date().toISOString(), generator: "vibe-kanban-skin-editor" } };
        const candidate = await compileAppearanceSnapshotCandidate(next);
        return candidate.ok ? { ok: true, sourceDigest: candidate.sourceDigest, ...(candidate.artifact ? { artifact: candidate.artifact } : {}) } : { ok: false, diagnostics: candidate.diagnostics.map((item) => ({ ...item })) };
      } catch (cause) {
        return { ok: false, diagnostics: [diagnostic("invalid-appearance", cause instanceof Error ? cause.message : "Appearance is invalid.")] };
      }
    },
    saveAppearance: async ({ snapshot, source = "user", candidate }: { readonly snapshot: AppearanceSnapshotV1; readonly source?: "user" | "import"; readonly candidate?: { readonly sourceDigest: string; readonly artifactDigest: string | null } }) => {
      if (!canonical || !parsed || !state.headRevisionId) return { ok: false, diagnostics: [diagnostic("appearance-not-ready", "Appearance history is not ready.")] };
      try {
        const skin = migrateSkinState(snapshot.value);
        const next: MyneAppearanceSnapshotV1 = { ...parsed, skin, provenance: { source: "user-export", createdAt: new Date().toISOString(), generator: "vibe-kanban-skin-editor" } };
        const binding = candidate
          ? { sourceDigest: candidate.sourceDigest as `sha256-${string}`, artifactDigest: candidate.artifactDigest as `sha256-${string}` | null }
          : await defaultCandidateBinding(next);
        const verified = await verifyAppearanceCandidateBinding(next, binding);
        if (!verified.ok) return { ok: false, diagnostics: [diagnostic(verified.code, verified.message)] };
        const nextCanonical = canonicalizeAppearanceSnapshot(next);
        const response = await fetcher(`${endpoint}/commands`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-VK-Appearance-CSRF": "1" },
          body: JSON.stringify({
            type: "apply",
            ...(source === "import" ? { operation: "import" } : {}),
            expectedCurrentRevisionId: state.headRevisionId,
            snapshot: nextCanonical,
            candidate: { sourceDigest: verified.candidate.sourceDigest, artifactDigest: verified.candidate.artifact?.digest ?? null },
            summary: `Activate ${skin.activeGlobalSkinId}`,
          }),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { diagnostic?: { code?: string; message?: string } };
          return { ok: false, diagnostics: [diagnostic(failure.diagnostic?.code ?? "appearance-save-failed", failure.diagnostic?.message ?? `Appearance save failed with HTTP ${response.status}.`)] };
        }
        await reload();
        return state.safeMode ? { ok: false, diagnostics: [diagnostic("appearance-reload-failed", state.error ?? "Saved appearance could not be reloaded.")] } : { ok: true };
      } catch (cause) {
        return { ok: false, diagnostics: [diagnostic("invalid-appearance", cause instanceof Error ? cause.message : "Appearance is invalid.")] };
      }
    },
  });
  return Object.freeze({
    module,
    reload,
    getProjection: () => parsed ? Object.freeze({
      activeGlobalSkinId: parsed.skin.activeGlobalSkinId,
      density: (parsed.skin.userSkins.find((skin) => skin.id === parsed!.skin.activeGlobalSkinId)
        ?? BUILT_IN_MYNE_SKINS.find((skin) => skin.id === parsed!.skin.activeGlobalSkinId))?.tokens.density.scale ?? "comfortable",
      surfaceViewPacks: Object.freeze(Object.fromEntries(parsed.surfaces.map((surface) => [surface.surface, surface.viewPackId ?? ""]))),
      safeMode: Boolean(state.safeMode),
    }) : undefined,
  });
}

async function compileActiveCss(skinState: MyneAppearanceSnapshotV1["skin"]): Promise<{ ok: true; artifact?: CompiledAppearanceArtifactV1 } | { ok: false; diagnostics: readonly { severity: "error" | "warning"; code: string; message: string; path?: string }[] }> {
  const skin = skinState.userSkins.find((candidate) => candidate.id === skinState.activeGlobalSkinId)
    ?? BUILT_IN_MYNE_SKINS.find((candidate) => candidate.id === skinState.activeGlobalSkinId);
  if (!skin || skin.rawCss.length === 0) return { ok: true };
  const runtime = getSkinRuntimeState({ state: skinState });
  const tokens = compilerTokensFromRuntime(runtime.style as Readonly<Record<string, unknown>>);
  const result = await compileScopedAppearance({ packageId: skin.id, cssBlocks: skin.rawCss, tokens });
  return result.ok ? { ok: true, artifact: result.artifact } : { ok: false, diagnostics: result.diagnostics };
}

async function defaultCandidateBinding(snapshot: MyneAppearanceSnapshotV1) {
  const candidate = await compileAppearanceSnapshotCandidate(snapshot);
  if (!candidate.ok) throw new Error(candidate.diagnostics.map((item) => item.code).join(", ") || "candidate compilation failed");
  return { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null };
}
