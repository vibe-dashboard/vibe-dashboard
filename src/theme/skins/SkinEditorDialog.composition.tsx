import type { ComponentType } from "react";
import {
  createCompositionRegistry,
  resolveComposition,
  type CompositionManifest,
} from "../../myne/composition";
import type { SkinEditorDialogViewProps } from "./SkinEditorDialog.contracts";
import { SkinEditorDialogView } from "./SkinEditorDialog.view";

export type SkinEditorSlot = "editor";
export type SkinEditorLayoutId = "myne.appearance.layout.dialog";
export type SkinEditorComponentId = "myne.appearance.editor.default";
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
  const Editor = components.editor;
  return <Editor model={model} actions={actions} viewPackId={viewPackId} />;
}

export const skinEditorCompositionRegistry = createCompositionRegistry({
  surface: "skin-editor",
  version: 1,
  layouts: { "myne.appearance.layout.dialog": SkinEditorDialogLayout },
  components: {
    "myne.appearance.editor.default": {
      contractVersion: 1,
      component: SkinEditorDialogView,
    },
  },
});

export const defaultSkinEditorManifest: SkinEditorCompositionManifest = {
  surface: "skin-editor",
  version: 1,
  layout: "myne.appearance.layout.dialog",
  viewPackId: "myne.appearance.view-pack.default",
  slots: {
    editor: {
      component: "myne.appearance.editor.default",
      contractVersion: 1,
    },
  },
};

export const selectedSkinEditorComposition = resolveComposition(
  skinEditorCompositionRegistry,
  defaultSkinEditorManifest,
);
