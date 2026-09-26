import { defaultDarkSkin } from "./builtin";
import type { GlobalUICPreferencesV1 } from "../../app-hooks/AppHooks";
import type { MyneSkinDiagnostic } from "./types";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

export const DEFAULT_SPACES_OVERVIEW_UIC_LAYOUT_ID =
  "uic.spaces.layout-shell.proof";
export const DEFAULT_GLOBAL_UIC_STYLE_ID = "uic.style.default";

export type { GlobalUICPreferencesV1 } from "../../app-hooks/AppHooks";

export const DEFAULT_GLOBAL_UIC_PREFERENCES: GlobalUICPreferencesV1 =
  Object.freeze({
    skinId: defaultDarkSkin.id,
    layoutId: DEFAULT_SPACES_OVERVIEW_UIC_LAYOUT_ID,
    styleId: DEFAULT_GLOBAL_UIC_STYLE_ID,
  });

function diagnostic(
  code: string,
  message: string,
  path?: string,
): MyneSkinDiagnostic {
  return { severity: "error", code, message, ...(path ? { path } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeGlobalUICPreferences(
  value: unknown,
): { ok: true; value: GlobalUICPreferencesV1 } | {
  ok: false;
  diagnostics: readonly MyneSkinDiagnostic[];
} {
  if (value == null) return { ok: true, value: DEFAULT_GLOBAL_UIC_PREFERENCES };
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "invalid-uic-preferences",
          "UIC preferences must be an object.",
          "preferences",
        ),
      ],
    };
  }
  const diagnostics: MyneSkinDiagnostic[] = [];
  const allowed = new Set(["skinId", "layoutId", "styleId"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          "unknown-property",
          `Unknown property "${key}" is not a UIC preference.`,
          `preferences.${key}`,
        ),
      );
    }
  }
  for (const key of allowed) {
    if (typeof value[key] !== "string" || !ID_PATTERN.test(value[key])) {
      diagnostics.push(
        diagnostic(
          "invalid-uic-preference-id",
          `${key} must be a stable id.`,
          `preferences.${key}`,
        ),
      );
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      skinId: String(value.skinId),
      layoutId: String(value.layoutId),
      styleId: String(value.styleId),
    },
  };
}
