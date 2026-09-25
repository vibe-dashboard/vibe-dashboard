import { useCallback, useEffect, useMemo, useState } from "react";
import { createAppHooksV1, type AppHooksV1 } from "../app-hooks/AppHooks";
import { productionAppearanceHost } from "../app-hooks/AppHooks.host";
import { ProtectedAppearanceBoundary } from "../theme/skins/ProtectedAppearanceBoundary.view";
import { installProtectedAppearanceRecovery } from "../theme/skins/scopedCss";
import { SkinEditorContainer } from "../theme/skins/SkinEditorDialog";
import { canonicalizeAppearanceSnapshot, parseAppearanceSnapshot } from "../theme/skins/appearanceSnapshot";
import { compileAppearanceSnapshotCandidate } from "../theme/skins/appearanceCandidate";
import { defaultSpacesOverviewManifest, denseSpacesOverviewManifest } from "./spaces-overview/SpacesOverview.composition";
import { compactDiagnosticsSkinEditorManifest, defaultSkinEditorManifest } from "../theme/skins/SkinEditorDialog.composition";
import styles from "./AppearanceSettings.module.css";

interface Revision { revisionId: string; summary: string; committedAt: string; source: string; targetRevisionId?: string; snapshot?: string }
interface History { head?: Revision; revisions: Revision[] }

export interface AppearanceSettingsProps {
  readonly appHooks: AppHooksV1;
  readonly fetcher?: typeof fetch;
  readonly onHistoryChanged?: () => void | Promise<void>;
}

export function AppearanceSettings({ appHooks, fetcher = fetch, onHistoryChanged = productionAppearanceHost.reload }: AppearanceSettingsProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState<string | null>(null);
  const appearance = appHooks.modules.get("myne.appearance");
  const appearanceResult = appearance.useSkinEditor();
  const load = useCallback(async () => {
    try {
      const response = await fetcher("/dashboard/api/appearance", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`History unavailable (HTTP ${response.status})`);
      setHistory(await response.json() as History); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "History unavailable"); }
  }, [fetcher]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => installProtectedAppearanceRecovery(document), []);
  const confirmedHooks = useMemo(() => createAppHooksV1([
    appHooks.modules.get("myne.spaces"),
    Object.freeze({ ...appearance, saveAppearance: async (args: Parameters<typeof appearance.saveAppearance>[0]) => {
      if (!window.confirm("Apply this appearance globally? This creates an undoable revision.")) return { ok: false, diagnostics: [{ severity: "warning" as const, code: "confirmation-cancelled", message: "Appearance was not changed." }] };
      return appearance.saveAppearance(args);
    } }),
  ]), [appHooks, appearance]);
  const mutate = async (type: "undo" | "redo" | "restore", targetRevisionId?: string) => {
    const head = history?.head;
    if (!head || !window.confirm(`${type[0]!.toUpperCase()}${type.slice(1)} appearance by creating a new revision?`)) return;
    const response = await fetcher("/dashboard/api/appearance/commands", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, expectedCurrentRevisionId: head.revisionId, ...(targetRevisionId ? { targetRevisionId } : {}), summary: `${type} from Appearance settings` }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { diagnostic?: { message?: string } };
      setError(body.diagnostic?.message ?? `${type} failed (HTTP ${response.status})`); return;
    }
    await onHistoryChanged(); await load();
  };
  const selectViewPack = async (surface: "spaces-overview" | "skin-editor", viewPackId: string) => {
    const head = history?.head;
    if (!head?.snapshot || !window.confirm(`Apply ${viewPackId} to ${surface}? This creates an undoable revision.`)) return;
    const parsed = parseAppearanceSnapshot(head.snapshot);
    if (!parsed.ok || !parsed.value) { setError("The active snapshot cannot be edited safely."); return; }
    const manifest = surface === "spaces-overview"
      ? (viewPackId === denseSpacesOverviewManifest.viewPackId ? denseSpacesOverviewManifest : defaultSpacesOverviewManifest)
      : (viewPackId === compactDiagnosticsSkinEditorManifest.viewPackId ? compactDiagnosticsSkinEditorManifest : defaultSkinEditorManifest);
    const next = { ...parsed.value, surfaces: parsed.value.surfaces.map((entry) => entry.surface === surface ? {
      surface, manifestVersion: 1 as const, layoutId: manifest.layout, viewPackId: manifest.viewPackId,
      slots: Object.values(manifest.slots).map((slot) => ({ id: slot.slot, componentId: slot.component, contractVersion: slot.contractVersion })),
    } : entry), provenance: { source: "user-export" as const, createdAt: new Date().toISOString(), generator: "vibe-kanban-appearance-settings" } };
    const candidate = await compileAppearanceSnapshotCandidate(next);
    if (!candidate.ok) { setError(candidate.diagnostics.map((item) => item.code).join(", ") || "Candidate compilation failed."); return; }
    const response = await fetcher("/dashboard/api/appearance/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "apply", expectedCurrentRevisionId: head.revisionId, snapshot: canonicalizeAppearanceSnapshot(next), candidate: { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null }, summary: `Select ${viewPackId}` }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { diagnostic?: { message?: string } }; setError(body.diagnostic?.message ?? `View pack save failed (HTTP ${response.status})`); return; }
    await onHistoryChanged(); await load();
  };
  const value = appearanceResult.available ? appearanceResult.value : undefined;
  const redoTarget = history?.head?.source === "undo" ? history.head.targetRevisionId : undefined;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><h1 className={styles.title}>Appearance</h1><p className={styles.summary}>Preview safely, then save an immutable global revision.</p></div>
      </header>
      <ProtectedAppearanceBoundary status={error || value?.error ? "error" : value?.safeMode ? "warning" : "neutral"}>
        <div className={styles.controls}>
          <button className={styles.button} type="button" onClick={() => setEditorOpen(true)}>Open Skin Editor</button>
          <button className={styles.button} type="button" disabled={!history?.head || history.revisions.length < 2} onClick={() => void mutate("undo")}>Undo latest</button>
          <button className={styles.button} type="button" disabled={!redoTarget} onClick={() => void mutate("redo", redoTarget)}>Redo</button>
          <button className={styles.button} type="button" onClick={() => void load()}>Refresh history</button>
          <label>Spaces layout <select value={value?.viewPacks?.["spaces-overview"] ?? defaultSpacesOverviewManifest.viewPackId} onChange={(event) => void selectViewPack("spaces-overview", event.target.value)}>
            <option value={defaultSpacesOverviewManifest.viewPackId}>Default</option><option value={denseSpacesOverviewManifest.viewPackId}>Dense workspace list</option>
          </select></label>
          <label>Editor layout <select value={value?.viewPacks?.["skin-editor"] ?? defaultSkinEditorManifest.viewPackId} onChange={(event) => void selectViewPack("skin-editor", event.target.value)}>
            <option value={defaultSkinEditorManifest.viewPackId}>Default</option><option value={compactDiagnosticsSkinEditorManifest.viewPackId}>Compact diagnostics</option>
          </select></label>
        </div>
        {value?.loading && <p>Loading persisted appearance…</p>}
        {value?.safeMode && <p className={styles.error}>Safe mode is active. The last-known-good appearance remains active.</p>}
        {(error || value?.error) && <p className={styles.error} role="alert">{error ?? value?.error}</p>}
      </ProtectedAppearanceBoundary>
      <section aria-labelledby="appearance-history-heading">
        <h2 id="appearance-history-heading">Revision history</h2>
        {history?.head && <p>Saved revision {history.head.revisionId}</p>}
        {value?.density && <p>Resolved density: {value.density}</p>}
        <ol className={styles.history}>{history?.revisions.slice().reverse().map((revision) => (
          <li className={styles.revision} key={revision.revisionId}>
            <strong>{revision.summary || revision.source}</strong>
            <span className={styles.revisionMeta}>{revision.source} · {revision.committedAt} · {revision.revisionId}</span>
            {revision.revisionId !== history.head?.revisionId && <button className={styles.button} type="button" onClick={() => void mutate("restore", revision.revisionId)}>Restore this revision</button>}
          </li>
        ))}</ol>
      </section>
      {value?.artifact ? <div data-myne-package-scope={value.artifact.scope}><style data-myne-compiled-artifact={value.artifact.digest}>{value.artifact.cssText}</style><SkinEditorContainer appHooks={confirmedHooks} onClose={() => setEditorOpen(false)} open={editorOpen} viewPackId={value?.viewPacks?.["skin-editor"]} /></div>
        : <SkinEditorContainer appHooks={confirmedHooks} onClose={() => setEditorOpen(false)} open={editorOpen} viewPackId={value?.viewPacks?.["skin-editor"]} />}
    </main>
  );
}
