import { validateSkinManifest } from "./schema";
import { BUILT_IN_MYNE_SKINS } from "./builtin";
import type {
  MyneSkinDiagnostic,
  MyneSkinStateV1,
  MyneSkinValidationResult,
} from "./types";

export const MYNE_APPEARANCE_SNAPSHOT_FORMAT = "myne.appearance.snapshot";
export const MYNE_APPEARANCE_SNAPSHOT_VERSION = 1;

const CAPABILITY_VERSIONS = {
  "myne.composition": 1,
  "myne.skin": 1,
} as const;
const REQUIRED_SURFACES = new Set(["skin-editor", "spaces-overview"]);

export interface MyneAppearanceCapabilityV1 {
  id: keyof typeof CAPABILITY_VERSIONS;
  version: 1;
}

export interface MyneAppearanceSurfaceSnapshotV1 {
  surface: string;
  manifestVersion: 1;
  layoutId: string;
  viewPackId?: string;
  slots: Array<{
    id: string;
    componentId: string;
    contractVersion: number;
  }>;
}

export interface MyneAppearanceAssetV1 {
  path: string;
  mediaType: string;
  byteLength: number;
  integrity: `sha256-${string}` | `sha384-${string}` | `sha512-${string}`;
}

export interface MyneAppearanceSnapshotV1 {
  format: typeof MYNE_APPEARANCE_SNAPSHOT_FORMAT;
  snapshotVersion: 1;
  capabilities: MyneAppearanceCapabilityV1[];
  skin: MyneSkinStateV1;
  surfaces: MyneAppearanceSurfaceSnapshotV1[];
  assets: MyneAppearanceAssetV1[];
  provenance: {
    source: "user-export" | "app-backup" | "agent-proposal";
    createdAt: string;
    generator: string;
  };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const SLOT_ID_PATTERN = /^[a-z][a-zA-Z0-9]{1,63}$/;
const ASSET_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?![a-z][a-z0-9+.-]*:)[a-zA-Z0-9._/-]+$/;
const MEDIA_TYPE_PATTERN = /^(?:image\/(?:png|jpeg|webp|gif|svg\+xml)|font\/(?:woff|woff2))$/;
const INTEGRITY_PATTERN = /^sha(?:256-[A-Za-z0-9+/]{43}=|384-[A-Za-z0-9+/]{64}|512-[A-Za-z0-9+/]{86}==)$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function diagnostic(code: string, message: string, path?: string): MyneSkinDiagnostic {
  return { severity: "error", code, message, ...(path ? { path } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: MyneSkinDiagnostic[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(diagnostic("unknown-property", `Unknown property \"${key}\" is not executable or portable appearance data.`, path ? `${path}.${key}` : key));
    }
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts JSON values only.");
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function inspectJsonValue(
  value: unknown,
  diagnostics: MyneSkinDiagnostic[],
  path = "$",
  ancestors = new WeakSet<object>(),
): void {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) diagnostics.push(diagnostic("invalid-unicode", "Canonical JSON strings cannot contain lone Unicode surrogates.", path));
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) diagnostics.push(diagnostic("invalid-json-value", "Canonical JSON numbers must be finite.", path));
    return;
  }
  if (typeof value !== "object") {
    diagnostics.push(diagnostic("invalid-json-value", "Appearance snapshots contain JSON values only.", path));
    return;
  }
  if (ancestors.has(value)) {
    diagnostics.push(diagnostic("invalid-json-value", "Appearance snapshots cannot contain cyclic values.", path));
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => inspectJsonValue(entry, diagnostics, `${path}.${index}`, ancestors));
  else Object.entries(value).forEach(([key, entry]) => inspectJsonValue(entry, diagnostics, `${path}.${key}`, ancestors));
  ancestors.delete(value);
}

function normalizeSnapshot(value: unknown): MyneSkinValidationResult<MyneAppearanceSnapshotV1> {
  const diagnostics: MyneSkinDiagnostic[] = [];
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [diagnostic("invalid-snapshot", "Appearance snapshot must be a JSON object.")] };
  }
  inspectJsonValue(value, diagnostics);
  rejectUnknownKeys(value, ["format", "snapshotVersion", "capabilities", "skin", "surfaces", "assets", "provenance"], "", diagnostics);
  if (value.format !== MYNE_APPEARANCE_SNAPSHOT_FORMAT) diagnostics.push(diagnostic("invalid-snapshot-format", `format must be ${MYNE_APPEARANCE_SNAPSHOT_FORMAT}.`, "format"));
  if (value.snapshotVersion !== MYNE_APPEARANCE_SNAPSHOT_VERSION) diagnostics.push(diagnostic("unsupported-snapshot-version", "snapshotVersion is not supported by this consumer.", "snapshotVersion"));

  const capabilities: MyneAppearanceCapabilityV1[] = [];
  const seenCapabilities = new Set<string>();
  if (!Array.isArray(value.capabilities)) {
    diagnostics.push(diagnostic("invalid-capabilities", "capabilities must be an array.", "capabilities"));
  } else {
    value.capabilities.forEach((entry, index) => {
      if (!isRecord(entry)) {
        diagnostics.push(diagnostic("invalid-capability", "Capability must be an object.", `capabilities.${index}`));
        return;
      }
      rejectUnknownKeys(entry, ["id", "version"], `capabilities.${index}`, diagnostics);
      const id = typeof entry.id === "string" ? entry.id : "";
      if (!(id in CAPABILITY_VERSIONS)) {
        diagnostics.push(diagnostic("unknown-capability", `Capability \"${id}\" is not supported.`, `capabilities.${index}.id`));
        return;
      }
      if (seenCapabilities.has(id)) diagnostics.push(diagnostic("duplicate-capability", `Capability \"${id}\" is duplicated.`, `capabilities.${index}.id`));
      seenCapabilities.add(id);
      if (entry.version !== CAPABILITY_VERSIONS[id as keyof typeof CAPABILITY_VERSIONS]) {
        diagnostics.push(diagnostic("unsupported-capability-version", `Capability \"${id}\" version is not supported.`, `capabilities.${index}.version`));
        return;
      }
      capabilities.push({ id: id as keyof typeof CAPABILITY_VERSIONS, version: 1 });
    });
  }
  for (const id of Object.keys(CAPABILITY_VERSIONS)) {
    if (!seenCapabilities.has(id)) diagnostics.push(diagnostic("missing-capability", `Required capability \"${id}\" is missing.`, "capabilities"));
  }

  let skin: MyneSkinStateV1 | undefined;
  if (!isRecord(value.skin)) {
    diagnostics.push(diagnostic("invalid-skin-state", "skin must be a complete skin state object.", "skin"));
  } else {
    rejectUnknownKeys(value.skin, ["version", "userSkins", "activeGlobalSkinId"], "skin", diagnostics);
    if (value.skin.version !== 1 || !Array.isArray(value.skin.userSkins) || typeof value.skin.activeGlobalSkinId !== "string") {
      diagnostics.push(diagnostic("invalid-skin-state", "skin must use version 1 with userSkins and activeGlobalSkinId.", "skin"));
    } else {
      const validated = value.skin.userSkins.map(validateSkinManifest);
      validated.forEach((result, index) => diagnostics.push(...result.diagnostics.map((item) => ({ ...item, path: `skin.userSkins.${index}${item.path ? `.${item.path}` : ""}` }))));
      if (validated.every((result) => result.ok && result.value)) {
        const userSkins = validated.map((result) => result.value!).sort((a, b) => a.id.localeCompare(b.id));
        value.skin.userSkins.forEach((rawSkin, index) => {
          const normalizedSkin = validated[index]?.value;
          try {
            if (normalizedSkin && canonicalJson(rawSkin) !== canonicalJson(normalizedSkin)) diagnostics.push(diagnostic("non-canonical-skin", "Skin entries must use the exact normalized v1 shape without unknown fields.", `skin.userSkins.${index}`));
          } catch {
            diagnostics.push(diagnostic("non-canonical-skin", "Skin entries must contain canonical JSON values only.", `skin.userSkins.${index}`));
          }
        });
        if (new Set(userSkins.map((item) => item.id)).size !== userSkins.length) diagnostics.push(diagnostic("duplicate-skin-id", "userSkins contains duplicate ids.", "skin.userSkins"));
        const availableSkinIds = new Set([...BUILT_IN_MYNE_SKINS.map((item) => item.id), ...userSkins.map((item) => item.id)]);
        if (!availableSkinIds.has(value.skin.activeGlobalSkinId)) diagnostics.push(diagnostic("unknown-active-skin", "activeGlobalSkinId must reference a bundled or included skin.", "skin.activeGlobalSkinId"));
        skin = { version: 1, activeGlobalSkinId: value.skin.activeGlobalSkinId, userSkins };
      }
    }
  }

  const surfaces: MyneAppearanceSurfaceSnapshotV1[] = [];
  const seenSurfaces = new Set<string>();
  if (!Array.isArray(value.surfaces)) diagnostics.push(diagnostic("invalid-surfaces", "surfaces must be an array.", "surfaces"));
  else value.surfaces.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostics.push(diagnostic("invalid-surface", "Surface must be an object.", `surfaces.${index}`));
      return;
    }
    rejectUnknownKeys(entry, ["surface", "manifestVersion", "layoutId", "viewPackId", "slots"], `surfaces.${index}`, diagnostics);
    const surface = typeof entry.surface === "string" ? entry.surface : "";
    if (!ID_PATTERN.test(surface)) diagnostics.push(diagnostic("invalid-surface-id", "surface must be a stable id.", `surfaces.${index}.surface`));
    if (seenSurfaces.has(surface)) diagnostics.push(diagnostic("duplicate-surface", `Surface \"${surface}\" is duplicated.`, `surfaces.${index}.surface`));
    seenSurfaces.add(surface);
    if (entry.manifestVersion !== 1) diagnostics.push(diagnostic("unsupported-manifest-version", "Surface manifestVersion must be 1.", `surfaces.${index}.manifestVersion`));
    if (typeof entry.layoutId !== "string" || !ID_PATTERN.test(entry.layoutId)) diagnostics.push(diagnostic("invalid-layout-id", "layoutId must be a stable id.", `surfaces.${index}.layoutId`));
    if (entry.viewPackId !== undefined && (typeof entry.viewPackId !== "string" || !ID_PATTERN.test(entry.viewPackId))) diagnostics.push(diagnostic("invalid-view-pack-id", "viewPackId must be a stable id.", `surfaces.${index}.viewPackId`));
    const slots: MyneAppearanceSurfaceSnapshotV1["slots"] = [];
    const seenSlots = new Set<string>();
    if (!Array.isArray(entry.slots)) diagnostics.push(diagnostic("invalid-slots", "slots must be an array.", `surfaces.${index}.slots`));
    else entry.slots.forEach((slot, slotIndex) => {
      if (!isRecord(slot)) {
        diagnostics.push(diagnostic("invalid-slot", "Slot must be an object.", `surfaces.${index}.slots.${slotIndex}`));
        return;
      }
      rejectUnknownKeys(slot, ["id", "componentId", "contractVersion"], `surfaces.${index}.slots.${slotIndex}`, diagnostics);
      const id = typeof slot.id === "string" ? slot.id : "";
      if (!SLOT_ID_PATTERN.test(id) || typeof slot.componentId !== "string" || !ID_PATTERN.test(slot.componentId) || !Number.isSafeInteger(slot.contractVersion) || Number(slot.contractVersion) < 1) diagnostics.push(diagnostic("invalid-slot", "Slot requires stable id/componentId and a positive integer contractVersion.", `surfaces.${index}.slots.${slotIndex}`));
      if (seenSlots.has(id)) diagnostics.push(diagnostic("duplicate-slot", `Slot \"${id}\" is duplicated.`, `surfaces.${index}.slots.${slotIndex}.id`));
      seenSlots.add(id);
      slots.push({ id, componentId: String(slot.componentId), contractVersion: Number(slot.contractVersion) });
    });
    surfaces.push({ surface, manifestVersion: 1, layoutId: String(entry.layoutId), ...(typeof entry.viewPackId === "string" ? { viewPackId: entry.viewPackId } : {}), slots: slots.sort((a, b) => a.id.localeCompare(b.id)) });
  });
  for (const surface of REQUIRED_SURFACES) {
    if (!seenSurfaces.has(surface)) diagnostics.push(diagnostic("missing-surface", `Required surface \"${surface}\" is missing.`, "surfaces"));
  }
  for (const surface of seenSurfaces) {
    if (!REQUIRED_SURFACES.has(surface)) diagnostics.push(diagnostic("unknown-surface", `Surface \"${surface}\" is not supported by snapshot v1.`, "surfaces"));
  }

  const assets: MyneAppearanceAssetV1[] = [];
  const seenAssetPaths = new Set<string>();
  if (!Array.isArray(value.assets)) diagnostics.push(diagnostic("invalid-assets", "assets must be an array.", "assets"));
  else value.assets.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostics.push(diagnostic("invalid-asset", "Asset must be an object.", `assets.${index}`));
      return;
    }
    rejectUnknownKeys(entry, ["path", "mediaType", "byteLength", "integrity"], `assets.${index}`, diagnostics);
    const path = typeof entry.path === "string" ? entry.path : "";
    if (!ASSET_PATH_PATTERN.test(path)) diagnostics.push(diagnostic("invalid-asset-path", "Asset path must be relative and traversal-free.", `assets.${index}.path`));
    if (seenAssetPaths.has(path)) diagnostics.push(diagnostic("duplicate-asset-path", `Asset path \"${path}\" is duplicated.`, `assets.${index}.path`));
    seenAssetPaths.add(path);
    if (typeof entry.mediaType !== "string" || !MEDIA_TYPE_PATTERN.test(entry.mediaType)) diagnostics.push(diagnostic("invalid-asset-media-type", "Asset mediaType is not allowlisted.", `assets.${index}.mediaType`));
    if (!Number.isSafeInteger(entry.byteLength) || Number(entry.byteLength) < 0) diagnostics.push(diagnostic("invalid-asset-byte-length", "Asset byteLength must be a non-negative safe integer.", `assets.${index}.byteLength`));
    if (typeof entry.integrity !== "string" || !INTEGRITY_PATTERN.test(entry.integrity)) diagnostics.push(diagnostic("invalid-asset-integrity", "Asset integrity must be an SRI sha256, sha384, or sha512 digest.", `assets.${index}.integrity`));
    assets.push({ path, mediaType: String(entry.mediaType), byteLength: Number(entry.byteLength), integrity: String(entry.integrity) as MyneAppearanceAssetV1["integrity"] });
  });

  let provenance: MyneAppearanceSnapshotV1["provenance"] | undefined;
  if (!isRecord(value.provenance)) diagnostics.push(diagnostic("invalid-provenance", "provenance must be an object.", "provenance"));
  else {
    rejectUnknownKeys(value.provenance, ["source", "createdAt", "generator"], "provenance", diagnostics);
    const source = value.provenance.source;
    const createdAt = value.provenance.createdAt;
    const generator = value.provenance.generator;
    if (!(source === "user-export" || source === "app-backup" || source === "agent-proposal")) diagnostics.push(diagnostic("invalid-provenance-source", "provenance.source is unsupported.", "provenance.source"));
    if (typeof createdAt !== "string" || !RFC3339_UTC_PATTERN.test(createdAt) || Number.isNaN(Date.parse(createdAt))) diagnostics.push(diagnostic("invalid-provenance-time", "provenance.createdAt must be an RFC 3339 UTC timestamp.", "provenance.createdAt"));
    if (typeof generator !== "string" || !generator.trim()) diagnostics.push(diagnostic("invalid-provenance-generator", "provenance.generator is required.", "provenance.generator"));
    if (typeof source === "string" && typeof createdAt === "string" && typeof generator === "string") provenance = { source: source as MyneAppearanceSnapshotV1["provenance"]["source"], createdAt, generator };
  }

  if (diagnostics.length || !skin || !provenance) return { ok: false, diagnostics };
  return {
    ok: true,
    diagnostics: [],
    value: {
      format: MYNE_APPEARANCE_SNAPSHOT_FORMAT,
      snapshotVersion: 1,
      capabilities: capabilities.sort((a, b) => a.id.localeCompare(b.id)),
      skin,
      surfaces: surfaces.sort((a, b) => a.surface.localeCompare(b.surface)),
      assets: assets.sort((a, b) => a.path.localeCompare(b.path)),
      provenance,
    },
  };
}

export function validateAppearanceSnapshot(value: unknown): MyneSkinValidationResult<MyneAppearanceSnapshotV1> {
  return normalizeSnapshot(value);
}

export function canonicalizeAppearanceSnapshot(value: unknown): string {
  const result = normalizeSnapshot(value);
  if (!result.ok || !result.value) {
    throw new TypeError(`Invalid appearance snapshot: ${result.diagnostics.map((item) => item.code).join(", ")}`);
  }
  return canonicalJson(result.value);
}

export function parseAppearanceSnapshot(source: string): MyneSkinValidationResult<MyneAppearanceSnapshotV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, diagnostics: [diagnostic("invalid-json", "Appearance snapshot is not valid JSON.")] };
  }
  const result = normalizeSnapshot(parsed);
  if (!result.ok || !result.value) return result;
  if (canonicalJson(result.value) !== source) {
    return { ok: false, diagnostics: [diagnostic("non-canonical-json", "Appearance snapshot must use canonical JSON ordering and representation.")] };
  }
  return result;
}
