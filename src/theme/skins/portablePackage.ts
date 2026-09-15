import { parseAppearanceSnapshot, type MyneAppearanceSnapshotV1 } from "./appearanceSnapshot";
import type { MyneSkinDiagnostic } from "./types";

export interface PortableAppearancePackageInput {
  readonly snapshotJson: string;
  readonly assets: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

export interface VerifiedPortableAppearancePackageV1 {
  readonly version: 1;
  readonly snapshot: MyneAppearanceSnapshotV1;
  readonly canonicalSnapshot: string;
  readonly assetPaths: readonly string[];
  readAsset(path: string): Uint8Array | undefined;
}

export type PortableAppearancePackageResult =
  | { readonly ok: true; readonly package: VerifiedPortableAppearancePackageV1; readonly diagnostics: readonly MyneSkinDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly MyneSkinDiagnostic[] };

export interface AppearanceSnapshotChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export type AppearanceSnapshotDiffResult =
  | { readonly ok: true; readonly changes: readonly AppearanceSnapshotChange[] }
  | { readonly ok: false; readonly diagnostics: readonly MyneSkinDiagnostic[] };

function error(code: string, message: string, path?: string): MyneSkinDiagnostic {
  return { severity: "error", code, message, ...(path ? { path } : {}) };
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((entry) => deepFreezeJson(entry));
    Object.freeze(value);
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function calculateIntegrity(bytes: Uint8Array, integrity: string): Promise<string | undefined> {
  const separator = integrity.indexOf("-");
  const algorithmName = integrity.slice(0, separator);
  const algorithm = algorithmName === "sha256" ? "SHA-256" : algorithmName === "sha384" ? "SHA-384" : algorithmName === "sha512" ? "SHA-512" : undefined;
  if (!algorithm) return undefined;
  const digest = await crypto.subtle.digest(algorithm, Uint8Array.from(bytes).buffer);
  return `${algorithmName}-${bytesToBase64(new Uint8Array(digest))}`;
}

function equalBytes(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyPortableAppearancePackage(input: PortableAppearancePackageInput): Promise<PortableAppearancePackageResult> {
  const snapshotResult = parseAppearanceSnapshot(input.snapshotJson);
  if (!snapshotResult.ok || !snapshotResult.value) return { ok: false, diagnostics: snapshotResult.diagnostics };
  const diagnostics: MyneSkinDiagnostic[] = [];
  const supplied = new Map<string, Uint8Array>();
  input.assets.forEach((asset, index) => {
    if (supplied.has(asset.path)) diagnostics.push(error("duplicate-package-asset", `Asset \"${asset.path}\" is supplied more than once.`, `assets.${index}.path`));
    supplied.set(asset.path, new Uint8Array(asset.bytes));
  });
  const expected = new Map(snapshotResult.value.assets.map((asset) => [asset.path, asset]));
  for (const path of supplied.keys()) if (!expected.has(path)) diagnostics.push(error("unexpected-asset", `Asset \"${path}\" is not declared by the canonical snapshot.`, path));
  for (const descriptor of snapshotResult.value.assets) {
    const bytes = supplied.get(descriptor.path);
    if (!bytes) {
      diagnostics.push(error("missing-asset", `Declared asset \"${descriptor.path}\" is missing.`, descriptor.path));
      continue;
    }
    if (bytes.byteLength !== descriptor.byteLength) {
      diagnostics.push(error("asset-length-mismatch", `Asset \"${descriptor.path}\" byte length does not match its descriptor.`, descriptor.path));
      continue;
    }
    const actual = await calculateIntegrity(bytes, descriptor.integrity);
    if (!actual || !equalBytes(actual, descriptor.integrity)) diagnostics.push(error("asset-integrity-mismatch", `Asset \"${descriptor.path}\" failed integrity verification.`, descriptor.path));
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const stored = new Map([...supplied].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  const packageValue: VerifiedPortableAppearancePackageV1 = Object.freeze({
    version: 1 as const,
    snapshot: deepFreezeJson(snapshotResult.value),
    canonicalSnapshot: input.snapshotJson,
    assetPaths: Object.freeze([...stored.keys()].sort()),
    readAsset(path: string) { const bytes = stored.get(path); return bytes ? new Uint8Array(bytes) : undefined; },
  });
  return { ok: true, package: packageValue, diagnostics: Object.freeze([]) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectChanges(before: unknown, after: unknown, path: string, changes: AppearanceSnapshotChange[]): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    before.forEach((value, index) => collectChanges(value, after[index], `${path}.${index}`, changes));
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    keys.forEach((key) => collectChanges(before[key], after[key], path ? `${path}.${key}` : key, changes));
    return;
  }
  changes.push(Object.freeze({ path, before: deepFreezeJson(before), after: deepFreezeJson(after) }));
}

export function diffAppearanceSnapshots(beforeJson: string, afterJson: string): AppearanceSnapshotDiffResult {
  const before = parseAppearanceSnapshot(beforeJson);
  if (!before.ok || !before.value) return { ok: false, diagnostics: before.diagnostics };
  const after = parseAppearanceSnapshot(afterJson);
  if (!after.ok || !after.value) return { ok: false, diagnostics: after.diagnostics };
  const changes: AppearanceSnapshotChange[] = [];
  collectChanges(before.value, after.value, "", changes);
  return { ok: true, changes: Object.freeze(changes) };
}

export function restoreAppearanceSnapshot(currentJson: string, targetJson: string): AppearanceSnapshotDiffResult & { readonly canonicalSnapshot?: string } {
  const diff = diffAppearanceSnapshots(currentJson, targetJson);
  if (!diff.ok) return diff;
  return { ...diff, canonicalSnapshot: targetJson };
}
