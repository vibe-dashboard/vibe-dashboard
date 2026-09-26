import { useEffect, useSyncExternalStore } from "react";
import { canonicalizeAppearanceSnapshot, parseAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "../theme/skins/appearanceSnapshot";
import { compileAppearanceSnapshotCandidate, compilerTokensFromRuntime } from "../theme/skins/appearanceCandidate";
import { sourceDigestForAppearanceSnapshot } from "../theme/skins/appearanceSourceDigest";
import { migrateSkinState } from "../theme/skins/schema";
import { BUILT_IN_MYNE_SKINS } from "../theme/skins/builtin";
import { compileScopedAppearance, type CompiledAppearanceArtifactV1 } from "../theme/skins/scopedCss";
import { getSkinRuntimeState } from "../theme/skins/runtime";
import {
  DEFAULT_GLOBAL_UIC_PREFERENCES,
  normalizeGlobalUICPreferences,
  type GlobalUICPreferencesV1,
} from "../theme/skins/uicPreferences";
import type { AppearanceModuleV1, AppearanceSnapshotV1, AppearanceStateV1, ModuleHookResult, ReadonlyJsonValue } from "./AppHooks";

interface HistoryEnvelope { head?: { revisionId?: unknown; snapshot?: unknown; activation?: { sourceDigest?: unknown; artifactDigest?: unknown; compilerVersion?: unknown; policyVersion?: unknown } } }
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
  const readPreferences = (snapshot: MyneAppearanceSnapshotV1 | undefined): GlobalUICPreferencesV1 =>
    snapshot?.preferences ?? DEFAULT_GLOBAL_UIC_PREFERENCES;
  const preferencesForSkin = (snapshot: MyneAppearanceSnapshotV1, activeGlobalSkinId: string): GlobalUICPreferencesV1 => ({
    ...readPreferences(snapshot),
    skinId: activeGlobalSkinId,
  });
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
      if (envelope.head.activation && (envelope.head.activation.compilerVersion !== 1 || envelope.head.activation.policyVersion !== 1
        || envelope.head.activation.sourceDigest !== await sourceDigestForAppearanceSnapshot(result.value)
        || envelope.head.activation.artifactDigest !== (compiled.artifact?.metadata.artifactDigest ?? null))) throw new Error("persisted appearance activation metadata does not match its artifact");
      canonical = envelope.head.snapshot;
      parsed = result.value;
      artifact = compiled.artifact;
      const activeSkin = result.value.skin.userSkins.find((skin) => skin.id === result.value!.skin.activeGlobalSkinId)
        ?? BUILT_IN_MYNE_SKINS.find((skin) => skin.id === result.value!.skin.activeGlobalSkinId);
      emit({ loading: false, error: null, safeMode: false, headRevisionId: envelope.head.revisionId,
        density: activeSkin?.tokens.density.scale ?? "comfortable",
        preferences: readPreferences(result.value),
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
        const next: MyneAppearanceSnapshotV1 = { ...parsed, preferences: preferencesForSkin(parsed, skin.activeGlobalSkinId), skin, provenance: { source: "user-export", createdAt: new Date().toISOString(), generator: "vibe-kanban-skin-editor" } };
        const candidate = await compileAppearanceSnapshotCandidate(next);
        return candidate.ok ? { ok: true, sourceDigest: candidate.sourceDigest, ...(candidate.artifact ? { artifact: candidate.artifact } : {}) } : { ok: false, diagnostics: candidate.diagnostics.map((item) => ({ ...item })) };
      } catch (cause) {
        return { ok: false, diagnostics: [diagnostic("invalid-appearance", cause instanceof Error ? cause.message : "Appearance is invalid.")] };
      }
    },
    saveAppearance: async ({ snapshot, source = "user", candidate }: { readonly snapshot: AppearanceSnapshotV1; readonly source?: "user" | "import"; readonly candidate?: { readonly sourceDigest: string; readonly artifactDigest: string | null; readonly artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string } } }) => {
      if (!canonical || !parsed || !state.headRevisionId) return { ok: false, diagnostics: [diagnostic("appearance-not-ready", "Appearance history is not ready.")] };
      try {
        const skin = migrateSkinState(snapshot.value);
        const next: MyneAppearanceSnapshotV1 = { ...parsed, preferences: preferencesForSkin(parsed, skin.activeGlobalSkinId), skin, provenance: { source: "user-export", createdAt: new Date().toISOString(), generator: "vibe-kanban-skin-editor" } };
        if (!candidate
          || (candidate.artifactDigest === null) !== (candidate.artifact === undefined)
          || (candidate.artifact && candidate.artifact.digest !== candidate.artifactDigest)) {
          return { ok: false, diagnostics: [diagnostic("candidate-not-ready", "The exact rendered preview candidate is required for activation.")] };
        }
        const nextCanonical = canonicalizeAppearanceSnapshot(next);
        const response = await fetcher(`${endpoint}/commands`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            type: "apply",
            ...(source === "import" ? { operation: "import" } : {}),
            expectedCurrentRevisionId: state.headRevisionId,
            snapshot: nextCanonical,
            candidate: { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifactDigest },
            summary: `Activate ${skin.activeGlobalSkinId}`,
          }),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { diagnostic?: { code?: string; message?: string } };
          return { ok: false, diagnostics: [diagnostic(failure.diagnostic?.code ?? "appearance-save-failed", failure.diagnostic?.message ?? `Appearance save failed with HTTP ${response.status}.`)] };
        }
        const saved = await response.json() as { revision?: { revisionId?: unknown; activation?: { sourceDigest?: unknown; artifactDigest?: unknown } } };
        if (typeof saved.revision?.revisionId !== "string" || (saved.revision.activation && (saved.revision.activation.sourceDigest !== candidate.sourceDigest
          || saved.revision.activation.artifactDigest !== candidate.artifactDigest))) {
          return { ok: false, diagnostics: [diagnostic("appearance-activation-mismatch", "The committed activation metadata did not match the rendered candidate.")] };
        }
        canonical = nextCanonical;
        parsed = next;
        const activeSkin = skin.userSkins.find((item) => item.id === skin.activeGlobalSkinId)
          ?? BUILT_IN_MYNE_SKINS.find((item) => item.id === skin.activeGlobalSkinId);
        emit({ loading: false, error: null, safeMode: false, headRevisionId: saved.revision.revisionId,
          density: activeSkin?.tokens.density.scale ?? "comfortable",
          preferences: readPreferences(next),
          viewPacks: Object.freeze(Object.fromEntries(next.surfaces.map((surface) => [surface.surface, surface.viewPackId ?? ""]))),
          ...(candidate.artifact ? { artifact: candidate.artifact } : {}), snapshot });
        return { ok: true };
      } catch (cause) {
        return { ok: false, diagnostics: [diagnostic("invalid-appearance", cause instanceof Error ? cause.message : "Appearance is invalid.")] };
      }
    },
    saveUICPreferences: async ({ preferences }: { readonly preferences: GlobalUICPreferencesV1 }) => {
      if (!canonical || !parsed || !state.headRevisionId) return { ok: false, diagnostics: [diagnostic("appearance-not-ready", "Appearance history is not ready.")] };
      const preferenceResult = normalizeGlobalUICPreferences(preferences);
      if (!preferenceResult.ok) return { ok: false, diagnostics: preferenceResult.diagnostics };
      try {
        const next: MyneAppearanceSnapshotV1 = {
          ...parsed,
          preferences: preferenceResult.value,
          provenance: {
            source: "user-export",
            createdAt: new Date().toISOString(),
            generator: "vibe-kanban-uic-preferences",
          },
        };
        const candidate = await compileAppearanceSnapshotCandidate(next);
        if (!candidate.ok) return { ok: false, diagnostics: candidate.diagnostics.map((item) => ({ ...item })) };
        const nextCanonical = canonicalizeAppearanceSnapshot(next);
        const response = await fetcher(`${endpoint}/commands`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            type: "apply",
            expectedCurrentRevisionId: state.headRevisionId,
            snapshot: nextCanonical,
            candidate: { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null },
            summary: `Set UIC preferences ${preferenceResult.value.layoutId}`,
          }),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { diagnostic?: { code?: string; message?: string } };
          return { ok: false, diagnostics: [diagnostic(failure.diagnostic?.code ?? "appearance-save-failed", failure.diagnostic?.message ?? `UIC preference save failed with HTTP ${response.status}.`)] };
        }
        const saved = await response.json() as { revision?: { revisionId?: unknown } };
        if (typeof saved.revision?.revisionId !== "string") return { ok: false, diagnostics: [diagnostic("appearance-activation-mismatch", "The committed preference revision was malformed.")] };
        canonical = nextCanonical;
        parsed = next;
        emit({ ...state, loading: false, error: null, safeMode: false, headRevisionId: saved.revision.revisionId, preferences: preferenceResult.value });
        return { ok: true };
      } catch (cause) {
        return { ok: false, diagnostics: [diagnostic("invalid-appearance", cause instanceof Error ? cause.message : "UIC preferences are invalid.")] };
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
