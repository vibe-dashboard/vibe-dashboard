export const explicitLintExemptPaths = Object.freeze([
  "scripts/check-ui-customization-boundaries.test.ts",
  "scripts/openlint-myne-local.test.ts",
  "src/components/spaces-overview/SpacesOverview.skin.test.ts",
  "src/components/spaces-overview/SpacesOverview.container.test.ts",
  "src/theme/skins/SkinEditorDialog.test.ts",
  "docs/myne-architecture.md",
  "docs/myne-v1-contract.md",
]);

export const publicMyneClasses = Object.freeze([
  "myne-theme", "myne-text", "myne-text--primary", "myne-text--secondary", "myne-text--muted",
  "myne-heading", "myne-status", "myne-status--accent", "myne-status--danger", "myne-status--success", "myne-status--warning",
  "myne-card", "myne-row", "myne-dialog", "myne-section", "myne-button", "myne-button--accent", "myne-button--danger",
  "myne-button--quiet", "myne-badge", "myne-icon", "myne-icon--chevron", "myne-state", "myne-state--loading",
  "myne-state--empty", "myne-state--error", "myne-preview-frame",
]);

export const runtimeMyneTokens = Object.freeze([
  ["--myne-color-background", 'setVariable(style, "--myne-color-background"'],
  ["--myne-color-foreground", 'setVariable(style, "--myne-color-foreground"'],
  ["--myne-color-panel", 'setVariable(style, "--myne-color-panel"'],
  ["--myne-color-muted", 'setVariable(style, "--myne-color-muted"'],
  ["--myne-color-accent", 'setVariable(style, "--myne-color-accent"'],
  ["--myne-color-border", 'setVariable(style, "--myne-color-border"'],
  ["--myne-color-danger", 'setVariable(style, "--myne-color-danger"'],
  ["--myne-color-success", 'setVariable(style, "--myne-color-success"'],
  ["--myne-color-warning", 'setVariable(style, "--myne-color-warning"'],
  ["--myne-font-family", 'setVariable(style, "--myne-font-family"'],
  ["--myne-mono-font-family", 'setVariable(style, "--myne-mono-font-family"'],
  ["--myne-font-size-base", 'setVariable(style, "--myne-font-size-base"'],
  ["--myne-font-weight-heading", 'setVariable(style, "--myne-font-weight-heading"'],
  ["--myne-font-weight-body", 'setVariable(style, "--myne-font-weight-body"'],
  ["--myne-letter-spacing", 'setVariable(style, "--myne-letter-spacing"'],
  ["--myne-density-scale", 'setVariable(style, "--myne-density-scale"'],
  ["--myne-space-unit", 'setVariable(style, "--myne-space-unit"'],
  ["--myne-control-height", 'setVariable(style, "--myne-control-height"'],
  ["--myne-row-height", 'setVariable(style, "--myne-row-height"'],
  ["--myne-spacing-*", 'projectTokenMap(style, "--myne-spacing"'],
  ["--myne-radius-*", 'projectTokenMap(style, "--myne-radius"'],
  ["--myne-shadow-*", 'projectTokenMap(style, "--myne-shadow"'],
  ["--myne-surface-*", 'projectRecipes(style, "surface"'],
  ["--myne-component-*", 'projectRecipes(style, "component"'],
  ["--myne-slot-*", 'projectRecipes(style, "slot"'],
]);

export const migratedSurfaces = Object.freeze([
  {
    id: "spaces-overview",
    openLintTargets: ["src/components/spaces-overview", "src/components/SpacesOverview.stories.tsx"],
    composition: "src/components/spaces-overview/SpacesOverview.composition.ts",
    compositionMarkers: ["spacesOverviewCompositionRegistry", "defaultSpacesOverviewManifest", "denseSpacesOverviewManifest", "requiredSlots: spacesOverviewSlots"],
    views: [
      "src/components/spaces-overview/DefaultSpacesOverview.view.tsx", "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx",
      "src/components/spaces-overview/RunningDevServersSection.view.tsx", "src/components/spaces-overview/SpacePickerModal.view.tsx",
      "src/components/spaces-overview/craftSections.view.tsx", "src/components/spaces-overview/workspaceList.view.tsx",
    ],
    styles: ["src/components/spaces-overview/SpacesOverview.skin.module.css"],
    identities: [
      ["src/components/spaces-overview/DefaultSpacesOverview.view.tsx", "data-myne-surface="],
      ["src/components/spaces-overview/DefaultSpacesOverview.view.tsx", "data-myne-view-pack="],
    ],
    slots: [
      ["src/components/spaces-overview/DefaultSpacesOverview.view.tsx", "page-header"],
      ["src/components/spaces-overview/DefaultSpacesOverview.view.tsx", "workspace-list"],
      ["src/components/spaces-overview/RunningDevServersSection.view.tsx", "running-dev-servers"],
      ["src/components/spaces-overview/SpacePickerModal.view.tsx", "space-picker-modal"],
      ["src/components/spaces-overview/craftSections.view.tsx", "recent-sessions"],
      ["src/components/spaces-overview/craftSections.view.tsx", "starred-craft"],
      ["src/components/spaces-overview/craftSections.view.tsx", "recently-visited-craft"],
      ["src/components/spaces-overview/craftSections.view.tsx", "recently-created-craft"],
      ["src/components/spaces-overview/craftSections.view.tsx", "spaces-list"],
    ],
    evidence: [
      ["src/components/SpacesOverview.stories.tsx", ["createSkinLabStories", "SpacesOverviewSkinLabStory"]],
      ["src/components/spaces-overview/SpacesOverview.composition.test.ts", ["rejects incomplete manifests", "swaps only compatible slots"]],
      ["src/components/spaces-overview/SpacesOverview.skin.test.ts", ["semantic surface and slot attributes", "view pack independently"]],
    ],
  },
  {
    id: "skin-editor",
    openLintTargets: ["src/theme/skins/SkinEditorDialog.view.tsx", "src/theme/skins/SkinEditorDialog.stories.tsx"],
    composition: "src/theme/skins/SkinEditorDialog.composition.tsx",
    compositionMarkers: ["skinEditorCompositionRegistry", "defaultSkinEditorManifest", "selectedSkinEditorComposition", "requiredSlots: skinEditorSlots"],
    views: ["src/theme/skins/SkinEditorDialog.view.tsx"],
    styles: ["src/theme/skins/SkinEditorDialog.module.css"],
    identities: [
      ["src/theme/skins/SkinEditorDialog.view.tsx", 'data-myne-surface="skin-editor"'],
      ["src/theme/skins/SkinEditorDialog.view.tsx", "data-myne-view-pack="],
    ],
    slots: ["skin-editor-header", "skin-editor-library", "skin-editor-editor", "skin-editor-preview", "skin-editor-import-export", "skin-editor-diagnostics"].map((slot) => ["src/theme/skins/SkinEditorDialog.view.tsx", slot]),
    evidence: [
      ["src/theme/skins/SkinEditorDialog.stories.tsx", ["createSkinLabStories", "SkinEditorStory"]],
      ["src/theme/skins/SkinEditorDialog.composition.test.ts", ["rejects extra slots", "compatible regional override"]],
      ["src/theme/skins/SkinEditorDialog.test.ts", ["stable semantic slots", "getByRole", "aria-pressed"]],
    ],
  },
]);

export const migratedRuntimeFiles = Object.freeze([
  ...new Set([
    ...migratedSurfaces.flatMap((surface) => [...surface.views, ...surface.styles, ...surface.evidence.map(([file]) => file)]),
    "src/theme/skins/primitives.view.tsx", "src/theme/skins/SkinRoot.view.tsx", "src/theme/skins/runtime.ts", "src/theme/skins/myne.css",
  ]),
]);
