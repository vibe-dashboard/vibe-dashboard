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
export type HeroUICSSVariableName = `--heroui-${string}`;
type ThemeCSSVariableName = MyneCSSVariableName | HeroUICSSVariableName;
export type MyneStyleVariables = CSSProperties &
  Partial<Record<ThemeCSSVariableName, string | number>>;

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
  name: ThemeCSSVariableName,
  value: number | string | undefined,
): void {
  if (value == null || value === "") return;
  style[name] = value;
}

function hexToHeroUIHsl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return undefined;
  const intValue = Number.parseInt(match[1] ?? "", 16);
  const red = ((intValue >> 16) & 255) / 255;
  const green = ((intValue >> 8) & 255) / 255;
  const blue = (intValue & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    delta === 0
      ? 0
      : max === red
        ? 60 * (((green - blue) / delta) % 6)
        : max === green
          ? 60 * ((blue - red) / delta + 2)
          : 60 * ((red - green) / delta + 4);
  const normalizedHue = hue < 0 ? hue + 360 : hue;
  const round = (number: number) =>
    Number.isInteger(number)
      ? String(number)
      : number.toFixed(2).replace(/\.?0+$/, "");
  return `${round(normalizedHue)} ${round(saturation * 100)}% ${round(lightness * 100)}%`;
}

function projectHeroUIBridge(
  style: MyneStyleVariables,
  colors: MyneSkinPrimitiveTokens["colors"],
  skin: MyneSkinManifestV1,
): void {
  const appShell = skin.surfaces["app-shell"];
  const modal = skin.surfaces.modal;
  const button = skin.components.button;
  setVariable(
    style,
    "--heroui-background",
    hexToHeroUIHsl(appShell?.background ?? colors.background),
  );
  setVariable(
    style,
    "--heroui-foreground",
    hexToHeroUIHsl(appShell?.foreground ?? colors.foreground),
  );
  setVariable(
    style,
    "--heroui-content1",
    hexToHeroUIHsl(modal?.background ?? colors.panel),
  );
  setVariable(style, "--heroui-content2", hexToHeroUIHsl(colors.panel));
  setVariable(
    style,
    "--heroui-default",
    hexToHeroUIHsl(button?.background ?? colors.border),
  );
  setVariable(
    style,
    "--heroui-default-foreground",
    hexToHeroUIHsl(button?.foreground ?? colors.foreground),
  );
  setVariable(style, "--heroui-primary", hexToHeroUIHsl(colors.accent));
  setVariable(
    style,
    "--heroui-primary-foreground",
    hexToHeroUIHsl(colors.background),
  );
  setVariable(style, "--heroui-danger", hexToHeroUIHsl(colors.danger));
  setVariable(style, "--heroui-success", hexToHeroUIHsl(colors.success));
  setVariable(style, "--heroui-warning", hexToHeroUIHsl(colors.warning));
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
  projectHeroUIBridge(style, colors, skin);

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
