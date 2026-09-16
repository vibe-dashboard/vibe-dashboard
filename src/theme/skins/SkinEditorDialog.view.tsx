import type { ComponentType } from "react";
import { SkinRoot } from "./SkinRoot";
import { MyneAction, MyneBadge, MyneCard, MyneHeading, MyneRow, MyneText } from "./primitives.view";
import type { SkinEditorDialogViewProps } from "./SkinEditorDialog.contracts";
import type { SkinEditorSlot, SkinEditorSlotProps } from "./SkinEditorDialog.slots";
import styles from "./SkinEditorDialog.module.css";

export type SkinEditorRegionComponents = Readonly<Record<SkinEditorSlot, ComponentType<SkinEditorDialogViewProps>>>;

export function DefaultSkinEditorHeader({ actions }: SkinEditorSlotProps<"header">) {
  return (
    <header
      className="flex items-start justify-between gap-4"
      data-myne-slot="skin-editor-header"
    >
      <div>
        <MyneHeading className="text-2xl font-bold" level={1}>
          Skin Editor
        </MyneHeading>
        <MyneText as="p" className="mt-1 max-w-3xl text-sm" tone="muted">
          Customize the global app skin with safe tokens, preview changes,
          and import/export skin packages without raw CSS injection.
        </MyneText>
      </div>
      <MyneAction
        aria-label="Close skin editor"
        className="border px-3 py-1 text-sm"
        onClick={actions.close}
        tone="quiet"
      >
        Close
      </MyneAction>
    </header>
  );
}

export function DefaultSkinEditorLibrary({ model, actions }: SkinEditorSlotProps<"library">) {
  return (
    <MyneCard
      className="flex min-h-0 flex-col border p-4"
      data-myne-slot="skin-editor-library"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <MyneHeading className="text-base font-semibold" level={2}>
          Library
        </MyneHeading>
        <MyneBadge className="border px-2 py-0.5 text-xs" status="accent">
          Global
        </MyneBadge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {model.skinOptions.map((skin) => (
          <MyneRow
            as="button"
            aria-pressed={skin.isSelected}
            className="rounded-lg border px-3 py-2 text-left"
            key={skin.id}
            onClick={() => actions.selectSkin(skin.id)}
          >
            <span className="flex items-center justify-between gap-2">
              <MyneText className="font-medium">{skin.name}</MyneText>
              {skin.isActive && (
                <MyneBadge className="border px-2 py-0.5 text-xs" status="success">
                  Active
                </MyneBadge>
              )}
            </span>
            <MyneText as="span" className="mt-1 block text-xs" tone="muted">
              {skin.isBuiltIn ? "Built-in" : "Custom"}
            </MyneText>
          </MyneRow>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <MyneAction
          className="border px-3 py-2 text-sm"
          onClick={actions.forkSelectedSkin}
          tone="accent"
        >
          {model.selectedSkinIsBuiltIn
            ? "Create editable copy"
            : "Edit custom skin"}
        </MyneAction>
        <MyneAction
          className="border px-3 py-2 text-sm"
          disabled={model.isSaving || model.isDirty}
          onClick={actions.applySelectedSkin}
        >
          Apply selected
        </MyneAction>
        <MyneAction
          className="border px-3 py-2 text-sm"
          disabled={model.isSaving}
          onClick={actions.revertToDefaultSkin}
          tone="quiet"
        >
          Revert to default
        </MyneAction>
      </div>
    </MyneCard>
  );
}

export function DefaultSkinEditorTokenEditor({ model, actions }: SkinEditorSlotProps<"tokenEditor">) {
  return (
    <MyneCard
      className="flex min-h-0 flex-col border p-4"
      data-myne-slot="skin-editor-editor"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <MyneHeading className="text-base font-semibold" level={2}>
            Token editor
          </MyneHeading>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            {model.isEditingCustomSkin
              ? "Editing a custom skin draft."
              : "Create an editable copy before changing built-in skins."}
          </MyneText>
        </div>
        {model.isDirty && (
          <MyneBadge className="border px-2 py-0.5 text-xs" status="warning">
            Unsaved
          </MyneBadge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <MyneText className="text-xs font-medium" tone="secondary">
            Name
          </MyneText>
          <input
            className={`${styles.field} px-3 py-2 text-sm`}
            disabled={!model.draftSkin}
            onChange={(event) => actions.updateDraftName(event.target.value)}
            value={model.draftSkin?.name ?? model.selectedSkin.name}
          />
        </label>
        <label className="flex flex-col gap-1">
          <MyneText className="text-xs font-medium" tone="secondary">
            Author
          </MyneText>
          <input
            className={`${styles.field} px-3 py-2 text-sm`}
            disabled={!model.draftSkin}
            onChange={(event) => actions.updateDraftAuthor(event.target.value)}
            value={model.draftSkin?.author ?? model.selectedSkin.author ?? ""}
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <MyneText className="text-xs font-medium" tone="secondary">
          Description
        </MyneText>
        <textarea
          className={`${styles.field} min-h-20 px-3 py-2 text-sm`}
          disabled={!model.draftSkin}
          onChange={(event) =>
            actions.updateDraftDescription(event.target.value)
          }
          value={
            model.draftSkin?.description ??
            model.selectedSkin.description ??
            ""
          }
        />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {model.colorFields.map((field) => (
          <label className="flex flex-col gap-1" key={field.key}>
            <MyneText className="text-xs font-medium" tone="secondary">
              {field.label}
            </MyneText>
            <span className="flex gap-2">
              <input
                aria-label={`${field.label} swatch`}
                className={`${styles.swatch} h-10 w-10 shrink-0 rounded-lg border`}
                disabled={!model.draftSkin}
                onChange={(event) =>
                  actions.updateColorToken(field.key, event.target.value)
                }
                type="color"
                value={field.swatchValue}
              />
              <input
                aria-label={`${field.label} color`}
                className={`${styles.field} min-w-0 flex-1 px-3 py-2 font-mono text-sm`}
                disabled={!model.draftSkin}
                onChange={(event) =>
                  actions.updateColorToken(field.key, event.target.value)
                }
                value={field.value}
              />
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <MyneAction
          className="border px-4 py-2 text-sm font-medium"
          disabled={!model.draftSkin || model.isSaving}
          onClick={actions.saveDraftSkin}
          tone="accent"
        >
          Save and apply
        </MyneAction>
        <MyneAction
          className="border px-4 py-2 text-sm"
          onClick={actions.exportSelectedSkin}
        >
          Export selected
        </MyneAction>
      </div>
    </MyneCard>
  );
}

export function DefaultSkinEditorPreview({ model }: SkinEditorSlotProps<"preview">) {
  return (
    <MyneCard
      className="border p-4"
      data-myne-slot="skin-editor-preview"
    >
      <MyneHeading className="text-base font-semibold" level={2}>
        Preview
      </MyneHeading>
      <div className="mt-3 rounded-xl border p-4 myne-card">
        <MyneText as="p" className="text-sm font-medium">
          {model.draftSkin?.name ?? model.selectedSkin.name}
        </MyneText>
        <MyneText as="p" className="mt-1 text-xs" tone="muted">
          Active preview uses the same global SkinRoot runtime as the
          migrated SpacesOverview surface.
        </MyneText>
        <div className="mt-3 flex gap-2">
          <MyneBadge className="border px-2 py-0.5 text-xs" status="success">
            Success
          </MyneBadge>
          <MyneBadge className="border px-2 py-0.5 text-xs" status="warning">
            Warning
          </MyneBadge>
          <MyneBadge className="border px-2 py-0.5 text-xs" status="danger">
            Danger
          </MyneBadge>
        </div>
      </div>
    </MyneCard>
  );
}

export function DefaultSkinEditorImportExport({ model, actions }: SkinEditorSlotProps<"importExport">) {
  return (
    <MyneCard
      className="flex min-h-0 flex-1 flex-col border p-4"
      data-myne-slot="skin-editor-import-export"
    >
      <MyneHeading className="text-base font-semibold" level={2}>
        Import / export
      </MyneHeading>
      <textarea
        aria-label="Skin package JSON"
        className={`${styles.field} mt-3 min-h-32 flex-1 px-3 py-2 font-mono text-xs`}
        onChange={(event) => actions.updateImportText(event.target.value)}
        placeholder="Paste a skin package JSON object"
        value={model.importText || model.exportText}
      />
      <div className="mt-3 flex gap-2">
        <MyneAction
          className="border px-3 py-2 text-sm"
          disabled={model.isSaving}
          onClick={actions.importPackage}
          tone="accent"
        >
          Import package
        </MyneAction>
      </div>
    </MyneCard>
  );
}

export function DefaultSkinEditorDiagnostics({ model }: SkinEditorSlotProps<"diagnostics">) {
  return (
    <MyneCard
      className="border p-4"
      data-myne-slot="skin-editor-diagnostics"
    >
      <div className="flex items-center justify-between gap-2">
        <MyneHeading className="text-base font-semibold" level={2}>
          Diagnostics
        </MyneHeading>
        <MyneBadge
          className="border px-2 py-0.5 text-xs"
          status={model.diagnostics.length ? "danger" : "success"}
        >
          {model.diagnostics.length ? "Needs attention" : "Valid"}
        </MyneBadge>
      </div>
      <MyneText as="p" className="mt-2 text-xs" tone="muted">
        Raw CSS is {model.rawCssStatus}; activation occurs only after the
        host scoped compiler accepts the complete candidate.
      </MyneText>
      {model.statusMessage && (
        <MyneText as="p" className="mt-2 text-xs" status="accent">
          {model.statusMessage}
        </MyneText>
      )}
      {model.diagnostics.length > 0 && (
        <ul className="mt-3 space-y-2">
          {model.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>
              <MyneText as="span" className="text-xs" status="danger">
                {diagnostic.path ? `${diagnostic.path}: ` : ""}
                {diagnostic.message}
              </MyneText>
            </li>
          ))}
        </ul>
      )}
    </MyneCard>
  );
}

export function CompactSkinEditorDiagnostics({ model }: SkinEditorSlotProps<"diagnostics">) {
  const hasDiagnostics = model.diagnostics.length > 0;
  return (
    <MyneCard className="border p-3" data-myne-slot="skin-editor-diagnostics">
      <div className="flex items-center justify-between gap-2">
        <MyneHeading className="text-sm font-semibold" level={2}>Diagnostics</MyneHeading>
        <MyneBadge className="border px-2 py-0.5 text-xs" status={hasDiagnostics ? "danger" : "success"}>
          {hasDiagnostics ? `${model.diagnostics.length} issue${model.diagnostics.length === 1 ? "" : "s"}` : "Valid"}
        </MyneBadge>
      </div>
      {model.statusMessage && <MyneText as="p" className="mt-2 text-xs" status="accent">{model.statusMessage}</MyneText>}
    </MyneCard>
  );
}

export interface SkinEditorLayoutViewProps extends SkinEditorDialogViewProps {
  components: SkinEditorRegionComponents;
}

export function SkinEditorDialogView({ actions, components, model, viewPackId = "myne.appearance.view-pack.default" }: SkinEditorLayoutViewProps) {
  const Header = components.header;
  const Library = components.library;
  const TokenEditor = components.tokenEditor;
  const Preview = components.preview;
  const ImportExport = components.importExport;
  const Diagnostics = components.diagnostics;
  const surfaceProps = { model, actions };
  return (
    <SkinRoot className={styles.root} state={model.previewState} artifact={model.previewArtifact}>
      <section aria-label="Skin editor" className={`${styles.surface} flex h-full min-h-[42rem] flex-col gap-4 p-6`} data-myne-surface="skin-editor" data-myne-view-pack={viewPackId}>
        <Header {...surfaceProps} />
        <div className="grid flex-1 grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)_minmax(16rem,24rem)] gap-4">
          <Library {...surfaceProps} />
          <TokenEditor {...surfaceProps} />
          <div className="flex min-h-0 flex-col gap-4">
            <Preview {...surfaceProps} />
            <ImportExport {...surfaceProps} />
            <Diagnostics {...surfaceProps} />
          </div>
        </div>
      </section>
    </SkinRoot>
  );
}
