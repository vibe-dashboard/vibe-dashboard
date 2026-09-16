import type {
  SkinEditorDialogViewProps,
  SkinEditorViewActions,
  SkinEditorViewModel,
} from "./SkinEditorDialog.contracts";

export const skinEditorSlots = ["header", "library", "tokenEditor", "preview", "importExport", "diagnostics"] as const;
export type SkinEditorSlot = (typeof skinEditorSlots)[number];

export const skinEditorSlotContracts = {
  header: { version: 1, model: [], actions: ["close"] },
  library: { version: 2, model: ["skinOptions", "selectedSkinIsBuiltIn", "isSaving", "isDirty", "isCandidateReady"], actions: ["selectSkin", "forkSelectedSkin", "applySelectedSkin", "revertToDefaultSkin"] },
  tokenEditor: { version: 2, model: ["isEditingCustomSkin", "isDirty", "draftSkin", "selectedSkin", "colorFields", "isSaving", "isCandidateReady"], actions: ["updateDraftName", "updateDraftAuthor", "updateDraftDescription", "updateColorToken", "saveDraftSkin", "exportSelectedSkin"] },
  preview: { version: 1, model: ["draftSkin", "selectedSkin"], actions: [] },
  importExport: { version: 2, model: ["importText", "exportText", "isSaving", "isCandidateReady"], actions: ["updateImportText", "importPackage"] },
  diagnostics: { version: 1, model: ["diagnostics", "rawCssStatus", "statusMessage"], actions: [] },
} as const satisfies Record<SkinEditorSlot, { version: number; model: readonly (keyof SkinEditorViewModel)[]; actions: readonly (keyof SkinEditorViewActions)[] }>;

type Contract<S extends SkinEditorSlot> = (typeof skinEditorSlotContracts)[S];
export type SkinEditorSlotProps<S extends SkinEditorSlot> = {
  model: Pick<SkinEditorViewModel, Contract<S>["model"][number]>;
  actions: Pick<SkinEditorViewActions, Contract<S>["actions"][number]>;
};

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>;
}

export function projectSkinEditorSlotProps<S extends SkinEditorSlot>(slot: S, props: SkinEditorDialogViewProps): SkinEditorSlotProps<S> {
  const contract = skinEditorSlotContracts[slot];
  return { model: pick(props.model, contract.model), actions: pick(props.actions, contract.actions) } as SkinEditorSlotProps<S>;
}
