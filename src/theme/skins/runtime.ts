import type { CSSProperties } from "react";
import { BUILT_IN_MYNE_SKINS, defaultDarkSkin } from "./builtin";
import { migrateSkinState } from "./schema";
import type {
  MyneSkinDiagnostic,
  MyneSkinManifestV1,
  MyneSkinPrimitiveTokens,
  MyneSkinResolution,
  MyneSkinState,
  MyneSkinStyleRecipe,
} from "./types";

export type MyneCSSVariableName = `--myne-${string}`;
export type MyneStyleVariables = CSSProperties &
  Partial<Record<MyneCSSVariableName, string | number>>;

export interface MyneSkinRuntimeOptions {
  state?: unknown;
  fallbackSkin?: MyneSkinManifestV1;
}

export interface MyneSkinRuntimeState extends MyneSkinResolution {
  densityScale: NonNullable<MyneSkinPrimitiveTokens["density"]["scale"]>;
  style: MyneStyleVariables;
  rawCss: "";
  rawCssStatus: "deferred";
}

const RECIPE_KEYS = [
  "background",
  "foreground",
  "muted",
  "accent",
  "border",
  "radius",
  "shadow",
  "padding",
  "gap",
  "variant",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequestedSkinId(value: unknown, migrated: MyneSkinState): string {
  if (isRecord(value) && typeof value.activeGlobalSkinId === "string") {
    return value.activeGlobalSkinId.trim() || migrated.activeGlobalSkinId;
  }
  return migrated.activeGlobalSkinId;
}

function missingSkinDiagnostic(requestedSkinId: string): MyneSkinDiagnostic {
  return {
    severity: "warning",
    code: "missing-global-skin",
    message: `Global skin "${requestedSkinId}" is missing; falling back to the built-in default.`,
    path: "activeGlobalSkinId",
  };
}

function setVariable(
  style: MyneStyleVariables,
  name: MyneCSSVariableName,
  value: number | string | undefined,
): void {
  if (value == null || value === "") return;
  style[name] = value;
}

function projectTokenMap(
  style: MyneStyleVariables,
  prefix: MyneCSSVariableName,
  values: Record<string, string> | undefined,
): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    setVariable(style, `${prefix}-${key}` as MyneCSSVariableName, value);
  }
}

function projectRecipe(
  style: MyneStyleVariables,
  prefix: MyneCSSVariableName,
  recipe: MyneSkinStyleRecipe | undefined,
): void {
  if (!recipe) return;
  for (const key of RECIPE_KEYS) {
    setVariable(style, `${prefix}-${key}` as MyneCSSVariableName, recipe[key]);
  }
}

function projectRecipes(
  style: MyneStyleVariables,
  prefix: "component" | "slot" | "surface",
  recipes: Partial<Record<string, MyneSkinStyleRecipe>>,
): void {
  for (const [id, recipe] of Object.entries(recipes)) {
    projectRecipe(style, `--myne-${prefix}-${id}` as MyneCSSVariableName, recipe);
  }
}

function buildSkinStyleVariables(skin: MyneSkinManifestV1): MyneStyleVariables {
  const style: MyneStyleVariables = {};
  const colors = {
    ...defaultDarkSkin.tokens.colors,
    ...skin.tokens.colors,
  };
  const typography = {
    ...defaultDarkSkin.tokens.typography,
    ...skin.tokens.typography,
  };
  const density = {
    ...defaultDarkSkin.tokens.density,
    ...skin.tokens.density,
  };

  setVariable(style, "--myne-color-background", colors.background);
  setVariable(style, "--myne-color-foreground", colors.foreground);
  setVariable(style, "--myne-color-panel", colors.panel);
  setVariable(style, "--myne-color-muted", colors.muted);
  setVariable(style, "--myne-color-accent", colors.accent);
  setVariable(style, "--myne-color-border", colors.border);
  setVariable(style, "--myne-color-danger", colors.danger);
  setVariable(style, "--myne-color-success", colors.success);
  setVariable(style, "--myne-color-warning", colors.warning);

  setVariable(style, "--myne-font-family", typography.fontFamily);
  setVariable(style, "--myne-mono-font-family", typography.monoFontFamily);
  setVariable(style, "--myne-font-size-base", typography.baseSize);
  setVariable(style, "--myne-font-weight-heading", typography.headingWeight);
  setVariable(style, "--myne-font-weight-body", typography.bodyWeight);
  setVariable(style, "--myne-letter-spacing", typography.letterSpacing);

  setVariable(style, "--myne-density-scale", density.scale);
  setVariable(style, "--myne-space-unit", density.spaceUnit);
  setVariable(style, "--myne-control-height", density.controlHeight);
  setVariable(style, "--myne-row-height", density.rowHeight);

  projectTokenMap(style, "--myne-spacing", skin.tokens.spacing);
  projectTokenMap(style, "--myne-radius", skin.tokens.radii);
  projectTokenMap(style, "--myne-shadow", skin.tokens.shadows);
  projectRecipes(style, "surface", skin.surfaces);
  projectRecipes(style, "component", skin.components);
  projectRecipes(style, "slot", skin.slots);

  return style;
}

export function getSkinRuntimeState({
  state,
  fallbackSkin = defaultDarkSkin,
}: MyneSkinRuntimeOptions = {}): MyneSkinRuntimeState {
  const migrated = migrateSkinState(state);
  const requestedSkinId = readRequestedSkinId(state, migrated);
  const availableSkins = new Map([
    ...BUILT_IN_MYNE_SKINS.map((skin) => [skin.id, skin] as const),
    ...migrated.userSkins.map((skin) => [skin.id, skin] as const),
  ]);
  const skin = availableSkins.get(requestedSkinId);
  const resolution: MyneSkinResolution = skin
    ? {
        skin,
        requestedSkinId,
        source: "global",
        diagnostics: [],
      }
    : {
        skin: fallbackSkin,
        requestedSkinId,
        source: "default",
        diagnostics: [missingSkinDiagnostic(requestedSkinId)],
      };

  const densityScale =
    resolution.skin.tokens.density.scale ??
    defaultDarkSkin.tokens.density.scale ??
    "comfortable";

  return {
    ...resolution,
    densityScale,
    style: buildSkinStyleVariables(resolution.skin),
    rawCss: "",
    rawCssStatus: "deferred",
  };
}
