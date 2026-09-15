import { createElement, type ComponentType } from "react";
import {
  createCompositionRegistry,
  resolveComposition,
  type CompositionManifest,
} from "../../myne/composition";
import type { SkinEditorDialogViewProps } from "./SkinEditorDialog.contracts";
import { projectSkinEditorSlotProps, skinEditorSlotContracts, skinEditorSlots, type SkinEditorSlot, type SkinEditorSlotProps } from "./SkinEditorDialog.slots";
import {
  DefaultSkinEditorDiagnostics,
  DefaultSkinEditorHeader,
  DefaultSkinEditorImportExport,
  DefaultSkinEditorLibrary,
  DefaultSkinEditorPreview,
  DefaultSkinEditorTokenEditor,
  CompactSkinEditorDiagnostics,
  SkinEditorDialogView,
} from "./SkinEditorDialog.view";

export { projectSkinEditorSlotProps, skinEditorSlotContracts, skinEditorSlots } from "./SkinEditorDialog.slots";
export type SkinEditorLayoutId = "myne.appearance.layout.dialog";
export type SkinEditorComponentId =
  | "myne.appearance.header.default"
  | "myne.appearance.library.default"
  | "myne.appearance.token-editor.default"
  | "myne.appearance.preview.default"
  | "myne.appearance.import-export.default"
  | "myne.appearance.diagnostics.default"
  | "myne.appearance.diagnostics.compact";
export type SkinEditorOverrides = Partial<{
  header: "myne.appearance.header.default";
  library: "myne.appearance.library.default";
  tokenEditor: "myne.appearance.token-editor.default";
  preview: "myne.appearance.preview.default";
  importExport: "myne.appearance.import-export.default";
  diagnostics: "myne.appearance.diagnostics.default" | "myne.appearance.diagnostics.compact";
}>;
export interface SkinEditorLayoutProps extends SkinEditorDialogViewProps {
  readonly components: Readonly<Record<SkinEditorSlot, ComponentType<SkinEditorDialogViewProps>>>;
  readonly viewPackId?: string;
}
export type SkinEditorCompositionManifest = CompositionManifest<
  SkinEditorSlot,
  SkinEditorLayoutId,
  SkinEditorComponentId
>;

export function SkinEditorDialogLayout({
  components,
  model,
  actions,
  viewPackId,
}: SkinEditorLayoutProps) {
  return <SkinEditorDialogView model={model} actions={actions} components={components} viewPackId={viewPackId} />;
}

const registered = <S extends SkinEditorSlot>(slot: S, renderer: ComponentType<SkinEditorSlotProps<S>>) => ({
  slot,
  contractVersion: skinEditorSlotContracts[slot].version,
  component: (props: SkinEditorDialogViewProps) =>
    createElement(renderer, projectSkinEditorSlotProps(slot, props)),
});

export const skinEditorCompositionRegistry = createCompositionRegistry({
  surface: "skin-editor",
  version: 1,
  requiredSlots: skinEditorSlots,
  layouts: { "myne.appearance.layout.dialog": SkinEditorDialogLayout },
  components: {
    "myne.appearance.header.default": registered("header", DefaultSkinEditorHeader),
    "myne.appearance.library.default": registered("library", DefaultSkinEditorLibrary),
    "myne.appearance.token-editor.default": registered("tokenEditor", DefaultSkinEditorTokenEditor),
    "myne.appearance.preview.default": registered("preview", DefaultSkinEditorPreview),
    "myne.appearance.import-export.default": registered("importExport", DefaultSkinEditorImportExport),
    "myne.appearance.diagnostics.default": registered("diagnostics", DefaultSkinEditorDiagnostics),
    "myne.appearance.diagnostics.compact": registered("diagnostics", CompactSkinEditorDiagnostics),
  },
});

export const defaultSkinEditorManifest: SkinEditorCompositionManifest = {
  surface: "skin-editor",
  version: 1,
  layout: "myne.appearance.layout.dialog",
  viewPackId: "myne.appearance.view-pack.default",
  slots: {
    header: { slot: "header", component: "myne.appearance.header.default", contractVersion: 1 },
    library: { slot: "library", component: "myne.appearance.library.default", contractVersion: 1 },
    tokenEditor: { slot: "tokenEditor", component: "myne.appearance.token-editor.default", contractVersion: 1 },
    preview: { slot: "preview", component: "myne.appearance.preview.default", contractVersion: 1 },
    importExport: { slot: "importExport", component: "myne.appearance.import-export.default", contractVersion: 1 },
    diagnostics: { slot: "diagnostics", component: "myne.appearance.diagnostics.default", contractVersion: 1 },
  },
};

export const compactDiagnosticsSkinEditorManifest: SkinEditorCompositionManifest = {
  ...defaultSkinEditorManifest,
  viewPackId: "myne.appearance.view-pack.compact-diagnostics",
  slots: {
    ...defaultSkinEditorManifest.slots,
    diagnostics: { slot: "diagnostics", component: "myne.appearance.diagnostics.compact", contractVersion: 1 },
  },
};

export const selectedSkinEditorComposition = resolveComposition(
  skinEditorCompositionRegistry,
  defaultSkinEditorManifest,
);

export function resolveSkinEditorComposition(
  manifest: SkinEditorCompositionManifest,
  overrides: SkinEditorOverrides = {},
) {
  return resolveComposition(skinEditorCompositionRegistry, manifest, overrides);
}
