export const explicitLintExemptPaths: readonly string[];
export const publicMyneClasses: readonly string[];
export const runtimeMyneTokens: readonly (readonly [token: string, marker: string])[];

export interface MigratedSurfaceInventory {
  readonly id: string;
  readonly openLintTargets: readonly string[];
  readonly composition: string;
  readonly compositionMarkers: readonly string[];
  readonly views: readonly string[];
  readonly styles: readonly string[];
  readonly identities: readonly (readonly [file: string, marker: string])[];
  readonly slots: readonly (readonly [file: string, slot: string])[];
  readonly evidence: readonly (readonly [file: string, markers: readonly string[]])[];
}

export const migratedSurfaces: readonly MigratedSurfaceInventory[];
export const migratedRuntimeFiles: readonly string[];
