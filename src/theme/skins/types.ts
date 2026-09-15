export const MYNE_SKIN_MANIFEST_VERSION = 1;
export const MYNE_SKIN_STATE_VERSION = 1;

export type MyneSkinDiagnosticSeverity = "error" | "warning";

export type MyneSkinSurfaceId =
  | "app-shell"
  | "sidebar"
  | "voyage-bar"
  | "spaces-overview"
  | "workspace-content"
  | "modal"
  | "menu"
  | "skin-editor";

export type MyneSkinComponentId =
  | "button"
  | "input"
  | "field"
  | "dialog"
  | "card"
  | "row"
  | "badge"
  | "tab"
  | "toolbar"
  | "section"
  | "list"
  | "empty-state"
  | "loading-state"
  | "error-state";

export type MyneSkinSlotId =
  | "page-header"
  | "recent-sessions"
  | "starred-craft"
  | "running-dev-servers"
  | "recently-visited-craft"
  | "recently-created-craft"
  | "workspace-list"
  | "workspace-row"
  | "spaces-list"
  | "space-picker-modal"
  | "skin-editor-header"
  | "skin-editor-library"
  | "skin-editor-editor"
  | "skin-editor-preview"
  | "skin-editor-import-export"
  | "skin-editor-diagnostics";

export type MyneSkinAssetKind = "image" | "font" | "icon";

export interface MyneSkinDiagnostic {
  severity: MyneSkinDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface MyneSkinColorTokens {
  background?: string;
  foreground?: string;
  panel?: string;
  muted?: string;
  accent?: string;
  border?: string;
  danger?: string;
  success?: string;
  warning?: string;
}

export interface MyneSkinTypographyTokens {
  fontFamily?: string;
  monoFontFamily?: string;
  baseSize?: string;
  headingWeight?: number;
  bodyWeight?: number;
  letterSpacing?: string;
}

export interface MyneSkinDensityTokens {
  scale?: "compact" | "comfortable" | "spacious";
  spaceUnit?: string;
  controlHeight?: string;
  rowHeight?: string;
}

export interface MyneSkinPrimitiveTokens {
  colors: MyneSkinColorTokens;
  typography: MyneSkinTypographyTokens;
  density: MyneSkinDensityTokens;
  spacing?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
}

export interface MyneSkinStyleRecipe {
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  border?: string;
  radius?: string;
  shadow?: string;
  padding?: string;
  gap?: string;
  variant?: string;
}

export type MyneSkinSurfaceRecipes = Partial<
  Record<MyneSkinSurfaceId, MyneSkinStyleRecipe>
>;
export type MyneSkinComponentRecipes = Partial<
  Record<MyneSkinComponentId, MyneSkinStyleRecipe>
>;
export type MyneSkinSlotRecipes = Partial<Record<MyneSkinSlotId, MyneSkinStyleRecipe>>;

export interface MyneSkinAssetRef {
  id: string;
  kind: MyneSkinAssetKind;
  path: string;
  description?: string;
}

export interface MyneSkinRawCssBlock {
  id: string;
  css: string;
}

export interface MyneSkinManifestV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  tokens: MyneSkinPrimitiveTokens;
  surfaces: MyneSkinSurfaceRecipes;
  components: MyneSkinComponentRecipes;
  slots: MyneSkinSlotRecipes;
  assets: MyneSkinAssetRef[];
  rawCss: MyneSkinRawCssBlock[];
}

export type MyneSkinManifest = MyneSkinManifestV1;

export interface MyneSkinStateV1 {
  version: 1;
  userSkins: MyneSkinManifestV1[];
  activeGlobalSkinId: string;
}

export type MyneSkinState = MyneSkinStateV1;

export interface MyneSkinImportExportPackageV1 {
  packageVersion: 1;
  skins: MyneSkinManifestV1[];
  activeGlobalSkinId?: string;
}

export type MyneSkinImportExportPackage = MyneSkinImportExportPackageV1;

export interface MyneSkinValidationResult<T> {
  ok: boolean;
  value?: T;
  diagnostics: MyneSkinDiagnostic[];
}

export interface MyneSkinResolution {
  skin: MyneSkinManifestV1;
  requestedSkinId: string;
  source: "global" | "default";
  diagnostics: MyneSkinDiagnostic[];
}
