import { BUILT_IN_MYNE_SKINS, DEFAULT_MYNE_SKIN_ID } from "./builtin";
import {
  createDefaultSkinState,
  migrateSkinState,
  setGlobalSkin,
  validateSkinManifest,
} from "./schema";
import type {
  MyneSkinDiagnostic,
  MyneSkinImportExportPackage,
  MyneSkinManifestV1,
  MyneSkinState,
  MyneSkinValidationResult,
} from "./types";

export const EDITABLE_COLOR_TOKEN_KEYS = [
  "background",
  "foreground",
  "panel",
  "muted",
  "accent",
  "border",
  "danger",
  "success",
  "warning",
] as const;

export type EditableColorTokenKey = (typeof EDITABLE_COLOR_TOKEN_KEYS)[number];

const BUILT_IN_SKIN_IDS = new Set(BUILT_IN_MYNE_SKINS.map((skin) => skin.id));
const COLOR_SWATCH_FALLBACK = "#000000";
const HEX_COLOR_SWATCH_PATTERN =
  /^#(?<short>[0-9a-f]{3})$|^#(?<long>[0-9a-f]{6})(?:[0-9a-f]{2})?$/i;

function diagnostic(
  code: string,
  message: string,
  path?: string,
  severity: MyneSkinDiagnostic["severity"] = "error",
): MyneSkinDiagnostic {
  return { severity, code, message, path };
}

function ok<T>(
  value: T,
  diagnostics: MyneSkinDiagnostic[] = [],
): MyneSkinValidationResult<T> {
  return { ok: true, value, diagnostics };
}

function fail<T>(diagnostics: MyneSkinDiagnostic[]): MyneSkinValidationResult<T> {
  return { ok: false, diagnostics };
}

function deepCloneSkin(skin: MyneSkinManifestV1): MyneSkinManifestV1 {
  return JSON.parse(JSON.stringify(skin)) as MyneSkinManifestV1;
}

export function createUserSkinId(
  name: string,
  existingIds: Iterable<string> = [],
): string {
  const existing = new Set(existingIds);
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 44) || "custom-skin";
  let id = `vd-user-${slug}`;
  let suffix = 2;

  while (existing.has(id) || BUILT_IN_SKIN_IDS.has(id)) {
    id = `vd-user-${slug}-${suffix}`;
    suffix += 1;
  }

  return id;
}

export function normalizeSkinEditorColorSwatchValue(
  value: unknown,
  fallback = COLOR_SWATCH_FALLBACK,
): string {
  const fallbackValue = normalizeSkinEditorColorSwatchValueWithoutFallback(
    fallback,
  );
  const normalizedFallback = fallbackValue ?? COLOR_SWATCH_FALLBACK;

  if (typeof value !== "string") return normalizedFallback;

  return normalizeSkinEditorColorSwatchValueWithoutFallback(value) ??
    normalizedFallback;
}

function normalizeSkinEditorColorSwatchValueWithoutFallback(
  value: string,
): string | null {
  const candidate = value.trim();
  const match = HEX_COLOR_SWATCH_PATTERN.exec(candidate);
  if (!match?.groups) return null;

  if (match.groups.short) {
    return `#${match.groups.short
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`.toLowerCase();
  }

  if (match.groups.long) {
    return `#${match.groups.long}`.toLowerCase();
  }

  return null;
}

export function createEditableSkinFromBase({
  baseSkin,
  name,
  existingIds = [],
}: {
  baseSkin: MyneSkinManifestV1;
  name?: string;
  existingIds?: Iterable<string>;
}): MyneSkinManifestV1 {
  const skin = deepCloneSkin(baseSkin);
  const nextName = name?.trim() || `${baseSkin.name} Custom`;

  return {
    ...skin,
    id: createUserSkinId(nextName, existingIds),
    name: nextName,
    author: skin.author || "VD skin editor",
    rawCss: [],
  };
}

export function validateSkinEditorDraft(
  draftSkin: unknown,
): MyneSkinValidationResult<MyneSkinManifestV1> {
  const result = validateSkinManifest(draftSkin);
  if (!result.ok || !result.value) return result;
  if (BUILT_IN_SKIN_IDS.has(result.value.id)) {
    return fail([
      ...result.diagnostics,
      diagnostic(
        "reserved-skin-id",
        `Skin id "${result.value.id}" is reserved for a built-in skin.`,
        "id",
      ),
    ]);
  }

  return result;
}

export function createSkinEditorPreviewState(
  currentState: unknown,
  draftSkin: MyneSkinManifestV1,
): MyneSkinState {
  const state = migrateSkinState(currentState || createDefaultSkinState());
  const userSkins = [
    ...state.userSkins.filter((skin) => skin.id !== draftSkin.id),
    draftSkin,
  ];

  return {
    version: 1,
    userSkins,
    activeGlobalSkinId: draftSkin.id,
  };
}

export function upsertUserSkinAndSetGlobal({
  state,
  skin,
}: {
  state: unknown;
  skin: unknown;
}): MyneSkinValidationResult<MyneSkinState> {
  const draft = validateSkinEditorDraft(skin);
  if (!draft.ok || !draft.value) return fail(draft.diagnostics);

  const current = migrateSkinState(state || createDefaultSkinState());
  const nextState: MyneSkinState = {
    version: 1,
    userSkins: [
      ...current.userSkins.filter((entry) => entry.id !== draft.value!.id),
      draft.value,
    ],
    activeGlobalSkinId: draft.value.id,
  };

  return ok(nextState, draft.diagnostics);
}

export function buildSingleSkinExportPackage(
  skin: MyneSkinManifestV1,
): MyneSkinImportExportPackage {
  return {
    packageVersion: 1,
    skins: [skin],
    activeGlobalSkinId: skin.id,
  };
}

export function mergeImportedSkinState(
  currentState: unknown,
  importedState: MyneSkinState,
): MyneSkinState {
  const current = migrateSkinState(currentState || createDefaultSkinState());
  const importedIds = new Set(importedState.userSkins.map((skin) => skin.id));
  const userSkins = [
    ...current.userSkins.filter((skin) => !importedIds.has(skin.id)),
    ...importedState.userSkins,
  ];
  const validIds = new Set([
    ...BUILT_IN_MYNE_SKINS.map((skin) => skin.id),
    ...userSkins.map((skin) => skin.id),
  ]);

  return {
    version: 1,
    userSkins,
    activeGlobalSkinId: validIds.has(importedState.activeGlobalSkinId)
      ? importedState.activeGlobalSkinId
      : current.activeGlobalSkinId,
  };
}

export function setActiveGlobalSkinFromEditor({
  state,
  skinId,
}: {
  state: unknown;
  skinId: string;
}): MyneSkinValidationResult<MyneSkinState> {
  return setGlobalSkin({ state, skinId });
}
