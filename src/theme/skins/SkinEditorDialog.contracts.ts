import type {
  MyneSkinDiagnostic,
  MyneSkinManifestV1,
  MyneSkinState,
} from "./types";

export interface SkinEditorSaveResult {
  diagnostics?: MyneSkinDiagnostic[];
  ok: boolean;
}

export interface SkinEditorCandidateResult extends SkinEditorSaveResult {
  sourceDigest?: string;
  artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string };
}

export interface SkinEditorCandidateHandle {
  readonly sourceDigest: string;
  readonly artifactDigest: string | null;
  readonly artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string };
}

export interface SkinEditorActions {
  compileSkinState?: (args: { state: MyneSkinState }) => Promise<SkinEditorCandidateResult>;
  saveSkinState: (args: { state: MyneSkinState; source?: "user" | "import"; candidate: SkinEditorCandidateHandle }) => Promise<SkinEditorSaveResult>;
}

export interface SkinEditorColorField {
  key: string;
  label: string;
  swatchValue: string;
  value: string;
}

export interface SkinEditorSkinOption {
  id: string;
  isActive: boolean;
  isBuiltIn: boolean;
  isSelected: boolean;
  name: string;
}

export interface SkinEditorViewModel {
  activeGlobalSkinId: string;
  colorFields: SkinEditorColorField[];
  diagnostics: MyneSkinDiagnostic[];
  draftSkin: MyneSkinManifestV1 | null;
  exportText: string;
  importText: string;
  isDirty: boolean;
  isEditingCustomSkin: boolean;
  isSaving: boolean;
  isCandidateReady: boolean;
  previewArtifact?: { readonly scope: string; readonly cssText: string; readonly digest: string };
  previewState: MyneSkinState;
  rawCssStatus: "compiler-protected";
  selectedSkin: MyneSkinManifestV1;
  selectedSkinIsBuiltIn: boolean;
  skinOptions: SkinEditorSkinOption[];
  statusMessage: string | null;
}

export interface SkinEditorViewActions {
  applySelectedSkin: () => void;
  close: () => void;
  exportSelectedSkin: () => void;
  forkSelectedSkin: () => void;
  importPackage: () => void;
  revertToDefaultSkin: () => void;
  saveDraftSkin: () => void;
  selectSkin: (skinId: string) => void;
  updateColorToken: (key: string, value: string) => void;
  updateDraftAuthor: (value: string) => void;
  updateDraftDescription: (value: string) => void;
  updateDraftName: (value: string) => void;
  updateImportText: (value: string) => void;
}

export interface SkinEditorDialogViewProps {
  actions: SkinEditorViewActions;
  model: SkinEditorViewModel;
  viewPackId?: string;
}
