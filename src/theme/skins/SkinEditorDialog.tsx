import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_MYNE_SKINS,
  DEFAULT_MYNE_SKIN_ID,
} from "./builtin";
import {
  EDITABLE_COLOR_TOKEN_KEYS,
  createEditableSkinFromBase,
  createSkinEditorPreviewState,
  mergeImportedSkinState,
  normalizeSkinEditorColorSwatchValue,
  upsertUserSkinAndSetGlobal,
  validateSkinEditorDraft,
  type EditableColorTokenKey,
} from "./editor";
import {
  createDefaultSkinState,
  importSkinPackage,
  migrateSkinState,
  setGlobalSkin,
} from "./schema";
import type {
  MyneSkinDiagnostic,
  MyneSkinManifestV1,
  MyneSkinState,
} from "./types";
import type {
  SkinEditorActions,
  SkinEditorColorField,
  SkinEditorViewModel,
} from "./SkinEditorDialog.contracts";
import { compactDiagnosticsSkinEditorManifest, defaultSkinEditorManifest, resolveSkinEditorComposition } from "./SkinEditorDialog.composition";

import {
  APP_HOOKS_V1_REQUIREMENTS,
  assertAppHooksV1Compatible,
  type AppearanceSnapshotV1,
  type AppHooksV1,
  type ReadonlyJsonValue,
} from "../../app-hooks/AppHooks";

export interface SkinEditorDialogProps {
  actions: SkinEditorActions;
  onClose: () => void;
  open: boolean;
  skinState?: MyneSkinState;
  viewPackId?: string;
}

const COLOR_LABELS: Record<EditableColorTokenKey, string> = {
  accent: "Accent",
  background: "Background",
  border: "Border",
  danger: "Danger",
  foreground: "Foreground",
  muted: "Muted",
  panel: "Panel",
  success: "Success",
  warning: "Warning",
};

const BUILT_IN_IDS = new Set(BUILT_IN_MYNE_SKINS.map((skin) => skin.id));

function cloneSkin(skin: MyneSkinManifestV1): MyneSkinManifestV1 {
  return JSON.parse(JSON.stringify(skin)) as MyneSkinManifestV1;
}

function formatPackageJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stableStateKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStateKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStateKey(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
): MyneSkinDiagnostic {
  return { severity: "error", code, message, path };
}

function getSavedSkinState(skinState: MyneSkinState | undefined): MyneSkinState {
  return skinState ?? createDefaultSkinState();
}

function toAppearanceSnapshot(state: MyneSkinState): AppearanceSnapshotV1 {
  return { schemaVersion: 1, value: state as unknown as ReadonlyJsonValue };
}

export interface SkinEditorContainerProps {
  appHooks: AppHooksV1;
  onClose: () => void;
  open: boolean;
  viewPackId?: string;
}

export function SkinEditorContainer({
  appHooks,
  onClose,
  open,
  viewPackId,
}: SkinEditorContainerProps) {
  assertAppHooksV1Compatible(appHooks, APP_HOOKS_V1_REQUIREMENTS.skinEditor);
  return (
    <SkinEditorContainerContent
      appHooks={appHooks}
      onClose={onClose}
      open={open}
      viewPackId={viewPackId}
    />
  );
}

function SkinEditorContainerContent({
  appHooks,
  onClose,
  open,
  viewPackId,
}: SkinEditorContainerProps) {
  const appearanceModule = appHooks.modules.get("myne.appearance");
  const appearanceResult = appearanceModule.useSkinEditor();
  const snapshot = appearanceResult.available
    ? appearanceResult.value.snapshot
    : undefined;
  const skinState = useMemo(
    () => snapshot ? migrateSkinState(snapshot.value) : undefined,
    [snapshot],
  );
  if (!appearanceResult.available) {
    throw new Error(`myne.appearance hook is unavailable: ${appearanceResult.reason}`);
  }
  return (
    <SkinEditorDialog
      actions={{
        compileSkinState: async ({ state }) => {
          const result = await appearanceModule.compileAppearanceCandidate({
            snapshot: toAppearanceSnapshot(state),
          });
          return {
            ok: result.ok,
            sourceDigest: result.sourceDigest,
            artifact: result.artifact,
            diagnostics: result.diagnostics?.map((item) => ({ ...item })),
          };
        },
        saveSkinState: async ({ state, source, candidate }) => {
          const result = await appearanceModule.saveAppearance({
            snapshot: toAppearanceSnapshot(state),
            source,
            candidate,
          });
          return {
            ok: result.ok,
            diagnostics: result.diagnostics?.map((item) => ({ ...item })),
          };
        },
      }}
      onClose={onClose}
      open={open}
      skinState={skinState}
      viewPackId={viewPackId}
    />
  );
}

export function SkinEditorDialog({
  actions,
  onClose,
  open,
  skinState,
  viewPackId,
}: SkinEditorDialogProps) {
  const composition = useMemo(() => resolveSkinEditorComposition(
    viewPackId === compactDiagnosticsSkinEditorManifest.viewPackId ? compactDiagnosticsSkinEditorManifest : defaultSkinEditorManifest,
  ), [viewPackId]);
  const SelectedLayout = composition.layout;
  const savedState = getSavedSkinState(skinState);
  const [selectedSkinId, setSelectedSkinId] = useState(savedState.activeGlobalSkinId);
  const [draftSkin, setDraftSkin] = useState<MyneSkinManifestV1 | null>(null);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<MyneSkinDiagnostic[]>([]);
  const [candidate, setCandidate] = useState<{ readonly stateKey: string; readonly sourceDigest: string; readonly artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string } } | undefined>();
  const [pendingProposal, setPendingProposal] = useState<{ readonly kind: "import" | "default-revert"; readonly state: MyneSkinState } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const operationGenerationRef = useRef(0);
  const nextSaveRequestRef = useRef(0);
  const activeSaveRef = useRef<{ generation: number; request: number } | null>(null);
  const externalStateKey = useMemo(
    () => JSON.stringify(skinState ?? null),
    [skinState],
  );

  useEffect(() => {
    operationGenerationRef.current += 1;
    activeSaveRef.current = null;
    setSelectedSkinId(savedState.activeGlobalSkinId);
    setDraftSkin(null);
    setImportText("");
    setExportText("");
    setStatusMessage(null);
    setDiagnostics([]);
    setCandidate(undefined);
    setPendingProposal(null);
    setIsSaving(false);
  }, [externalStateKey]);

  const availableSkins = useMemo(
    () => [...BUILT_IN_MYNE_SKINS, ...savedState.userSkins],
    [savedState.userSkins],
  );
  const selectedSkin =
    draftSkin ??
    availableSkins.find((skin) => skin.id === selectedSkinId) ??
    availableSkins.find((skin) => skin.id === savedState.activeGlobalSkinId) ??
    BUILT_IN_MYNE_SKINS[0]!;
  const selectedSkinIsBuiltIn = BUILT_IN_IDS.has(selectedSkin.id);
  const draftValidation = draftSkin ? validateSkinEditorDraft(draftSkin) : null;
  const previewState = pendingProposal?.state ?? (
    draftSkin && draftValidation?.ok
      ? createSkinEditorPreviewState(savedState, draftSkin)
      : {
          ...savedState,
          activeGlobalSkinId: selectedSkin.id,
        });

  const previewStateKey = useMemo(() => stableStateKey(previewState), [previewState]);
  useEffect(() => {
    let cancelled = false;
    const generation = operationGenerationRef.current;
    setCandidate(undefined);
    if (!actions.compileSkinState) {
      setCandidate(undefined);
      return;
    }
    void actions.compileSkinState({ state: previewState }).then((result) => {
      if (cancelled || generation !== operationGenerationRef.current) return;
      if (result.ok && result.sourceDigest) {
        setCandidate({ stateKey: previewStateKey, sourceDigest: result.sourceDigest, artifact: result.artifact });
        return;
      }
      setCandidate(undefined);
      setDiagnostics(result.diagnostics ?? []);
    }).catch((error) => {
      if (cancelled || generation !== operationGenerationRef.current) return;
      setCandidate(undefined);
      setDiagnostics([diagnostic("candidate-preview-failed", getErrorMessage(error), "compileSkinState")]);
    });
    return () => { cancelled = true; };
  }, [actions, previewStateKey]);

  const colorSource = draftSkin ?? selectedSkin;
  const colorFields: SkinEditorColorField[] = EDITABLE_COLOR_TOKEN_KEYS.map(
    (key) => ({
      key,
      label: COLOR_LABELS[key],
      swatchValue: normalizeSkinEditorColorSwatchValue(
        colorSource.tokens.colors[key],
      ),
      value: colorSource.tokens.colors[key] ?? "",
    }),
  );

  const model: SkinEditorViewModel = {
    activeGlobalSkinId: savedState.activeGlobalSkinId,
    colorFields,
    diagnostics: draftValidation && !draftValidation.ok
      ? [...diagnostics, ...draftValidation.diagnostics]
      : diagnostics,
    draftSkin,
    exportText,
    importText,
    isDirty: Boolean(draftSkin),
    isEditingCustomSkin: Boolean(draftSkin),
    isSaving,
    isCandidateReady: !actions.compileSkinState || candidate?.stateKey === previewStateKey,
    previewArtifact: candidate?.stateKey === previewStateKey ? candidate.artifact : undefined,
    previewState,
    rawCssStatus: "compiler-protected",
    selectedSkin,
    selectedSkinIsBuiltIn,
    skinOptions: availableSkins.map((skin) => ({
      id: skin.id,
      isActive: skin.id === savedState.activeGlobalSkinId,
      isBuiltIn: BUILT_IN_IDS.has(skin.id),
      isSelected: skin.id === selectedSkin.id,
      name: skin.name,
    })),
    statusMessage,
  };

  if (!open) return null;

  return (
    <SelectedLayout
      components={composition.components}
      viewPackId={composition.viewPackId}
      actions={{
        applySelectedSkin: () => {
          void saveStateFromResult(
            setGlobalSkin({
              state: savedState,
              skinId: selectedSkin.id,
            }).value,
            `Applied ${selectedSkin.name}.`,
          );
        },
        close: onClose,
        exportSelectedSkin: () => {
          setExportText(
            formatPackageJson({
              packageVersion: 1,
              skins: [selectedSkin],
              activeGlobalSkinId: selectedSkin.id,
            }),
          );
          setImportText("");
          setStatusMessage(`Exported ${selectedSkin.name}.`);
          setDiagnostics([]);
        },
        forkSelectedSkin: () => {
          setPendingProposal(null);
          const editable = selectedSkinIsBuiltIn
            ? createEditableSkinFromBase({
                baseSkin: selectedSkin,
                existingIds: [
                  ...BUILT_IN_MYNE_SKINS.map((skin) => skin.id),
                  ...savedState.userSkins.map((skin) => skin.id),
                ],
              })
            : cloneSkin(selectedSkin);
          setDraftSkin(editable);
          setSelectedSkinId(editable.id);
          setStatusMessage(
            selectedSkinIsBuiltIn
              ? `Created editable copy of ${selectedSkin.name}.`
              : `Editing ${selectedSkin.name}.`,
          );
          setDiagnostics([]);
        },
        importPackage: () => {
          if (pendingProposal?.kind === "import") {
            void saveStateFromResult(pendingProposal.state, "Imported skin package.", () => setPendingProposal(null), "import");
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(importText);
          } catch {
            setDiagnostics([
              diagnostic("invalid-json", "Skin package JSON could not be parsed."),
            ]);
            setStatusMessage(null);
            return;
          }

          const imported = importSkinPackage(parsed);
          if (!imported.ok || !imported.value) {
            setDiagnostics(imported.diagnostics);
            setStatusMessage(null);
            return;
          }

          const merged = mergeImportedSkinState(savedState, imported.value);
          setPendingProposal({ kind: "import", state: merged });
          setStatusMessage("Review the imported appearance preview, then confirm Import package.");
          setDiagnostics([]);
        },
        revertToDefaultSkin: () => {
          if (pendingProposal?.kind === "default-revert") {
            void saveStateFromResult(pendingProposal.state, "Reverted to default skin.", () => setPendingProposal(null));
            return;
          }
          const proposed = setGlobalSkin({ state: savedState, skinId: DEFAULT_MYNE_SKIN_ID }).value;
          if (!proposed) return;
          setPendingProposal({ kind: "default-revert", state: proposed });
          setStatusMessage("Review the default appearance preview, then confirm Revert to default.");
          setDiagnostics([]);
        },
        saveDraftSkin: () => {
          if (!draftSkin) return;
          const saved = upsertUserSkinAndSetGlobal({
            state: savedState,
            skin: draftSkin,
          });
          if (!saved.ok || !saved.value) {
            setDiagnostics(saved.diagnostics);
            setStatusMessage(null);
            return;
          }
          void saveStateFromResult(saved.value, `Saved ${draftSkin.name}.`, () => {
            setDraftSkin(null);
            setSelectedSkinId(draftSkin.id);
          });
        },
        selectSkin: (skinId) => {
          setPendingProposal(null);
          setSelectedSkinId(skinId);
          setDraftSkin(null);
          setDiagnostics([]);
          setStatusMessage(null);
        },
        updateColorToken: (key, value) => {
          updateDraft((skin) => {
            skin.tokens.colors = {
              ...skin.tokens.colors,
              [key]: value,
            };
          });
        },
        updateDraftAuthor: (value) => {
          updateDraft((skin) => {
            skin.author = value;
          });
        },
        updateDraftDescription: (value) => {
          updateDraft((skin) => {
            skin.description = value;
          });
        },
        updateDraftName: (value) => {
          updateDraft((skin) => {
            skin.name = value;
          });
        },
        updateImportText: (value) => {
          setPendingProposal(null);
          setImportText(value);
          setExportText("");
          setDiagnostics([]);
          setStatusMessage(null);
        },
      }}
      model={model}
    />
  );

  function updateDraft(mutator: (skin: MyneSkinManifestV1) => void) {
    setPendingProposal(null);
    setDraftSkin((current) => {
      if (!current) return current;
      const next = cloneSkin(current);
      mutator(next);
      return next;
    });
  }

  async function saveStateFromResult(
    nextState: MyneSkinState | undefined,
    successMessage: string,
    afterSave?: () => void,
    source: "user" | "import" = "user",
  ) {
    if (!nextState) {
      setDiagnostics([
        diagnostic("invalid-skin-state", "Skin state could not be updated."),
      ]);
      return;
    }

    // Saves are serialized per mounted editor. A host snapshot replacement
    // invalidates the active token and permits a save against the new snapshot.
    if (activeSaveRef.current) return;
    const operation = {
      generation: operationGenerationRef.current,
      request: ++nextSaveRequestRef.current,
    };
    activeSaveRef.current = operation;
    const isCurrentOperation = () =>
      activeSaveRef.current?.generation === operation.generation
      && activeSaveRef.current.request === operation.request
      && operationGenerationRef.current === operation.generation;

    setIsSaving(true);
    try {
      const nextStateKey = stableStateKey(nextState);
      const retainedCandidate = candidate?.stateKey === nextStateKey ? candidate : !actions.compileSkinState ? {
        stateKey: nextStateKey,
        sourceDigest: "legacy-trusted-renderer",
      } : undefined;
      if (!retainedCandidate) {
        if (isCurrentOperation()) {
          setDiagnostics([diagnostic("candidate-not-ready", "Wait for the current preview to finish rendering before confirming.")]);
          setStatusMessage(null);
        }
        return;
      }
      const result = await actions.saveSkinState({
        state: nextState,
        source,
        candidate: {
          sourceDigest: retainedCandidate.sourceDigest,
          artifactDigest: retainedCandidate.artifact?.digest ?? null,
          artifact: retainedCandidate.artifact,
        },
      });
      if (!isCurrentOperation()) return;
      setDiagnostics(result.diagnostics ?? []);
      if (result.ok) {
        afterSave?.();
        setStatusMessage(successMessage);
      } else {
        setStatusMessage(null);
      }
    } catch (error) {
      if (!isCurrentOperation()) return;
      setDiagnostics([
        diagnostic(
          "save-failed",
          `Skin state could not be saved. ${getErrorMessage(error)}`,
          "saveSkinState",
        ),
      ]);
      setStatusMessage(null);
    } finally {
      if (isCurrentOperation()) {
        activeSaveRef.current = null;
        setIsSaving(false);
      }
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Try again.";
}
