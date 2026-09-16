import { useSyncExternalStore } from "react";

export type CapabilityAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface SpacesRepoDTO {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
}

export interface SpacesWorkspaceRepoDTO extends SpacesRepoDTO {
  readonly targetBranch: string;
}

export interface SpacesWorkspaceDTO {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly taskId: string;
  readonly containerRef: string | null;
  readonly filesChanged: number | null;
  readonly linesAdded: number | null;
  readonly linesRemoved: number | null;
  readonly latestProcessStatus: "running" | "completed" | "failed" | "killed" | null;
  readonly latestProcessCompletedAt: string | null;
  readonly hasPendingApproval: boolean;
  readonly hasRunningDevServer: boolean;
  readonly hasUnseenTurns: boolean;
  readonly pullRequestStatus: "open" | "merged" | "closed" | "unknown" | null;
  readonly repos: readonly SpacesWorkspaceRepoDTO[];
}

export interface SpacesStateV1 {
  readonly workspaces: readonly SpacesWorkspaceDTO[];
  readonly repos: readonly SpacesRepoDTO[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: (isRefresh?: boolean) => Promise<void>;
}

export type ModuleHookResult<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false; readonly reason: string };

export type ReadonlyJsonValue =
  | null | boolean | number | string
  | readonly ReadonlyJsonValue[]
  | { readonly [key: string]: ReadonlyJsonValue };

export interface AppearanceSnapshotV1 {
  readonly schemaVersion: 1;
  readonly value: ReadonlyJsonValue;
}

export interface AppearanceDiagnosticDTO {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface AppearanceSaveResultDTO {
  readonly ok: boolean;
  readonly diagnostics?: readonly AppearanceDiagnosticDTO[];
}

export interface AppearanceCandidateDTO {
  readonly ok: boolean;
  readonly sourceDigest?: string;
  readonly artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string };
  readonly diagnostics?: readonly AppearanceDiagnosticDTO[];
}

export interface AppearanceStateV1 {
  readonly snapshot?: AppearanceSnapshotV1;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly safeMode?: boolean;
  readonly headRevisionId?: string;
  readonly viewPacks?: Readonly<Record<string, string>>;
  readonly artifact?: { readonly scope: string; readonly cssText: string; readonly digest: string };
  readonly density?: string;
}

export interface SpacesModuleV1 {
  readonly id: "myne.spaces";
  readonly version: number;
  readonly availability: CapabilityAvailability;
  readonly useSpacesOverview: () => ModuleHookResult<SpacesStateV1>;
  readonly stopWorkspaceExecution: (workspaceId: string) => Promise<void>;
}

export interface AppearanceModuleV1 {
  readonly id: "myne.appearance";
  readonly version: number;
  readonly availability: CapabilityAvailability;
  readonly useSkinEditor: () => ModuleHookResult<AppearanceStateV1>;
  readonly compileAppearanceCandidate: (args: { readonly snapshot: AppearanceSnapshotV1 }) => Promise<AppearanceCandidateDTO>;
  readonly saveAppearance: (args: { readonly snapshot: AppearanceSnapshotV1; readonly source?: "user" | "import"; readonly candidate?: { readonly sourceDigest: string; readonly artifactDigest: string | null } }) => Promise<AppearanceSaveResultDTO>;
}

export interface AppHooksModuleMapV1 {
  readonly "myne.spaces": SpacesModuleV1;
  readonly "myne.appearance": AppearanceModuleV1;
}

export type AppHooksModuleId = keyof AppHooksModuleMapV1;
export type AppHooksModuleV1 = AppHooksModuleMapV1[AppHooksModuleId];

export interface AppHooksModuleRegistryV1 {
  get<K extends AppHooksModuleId>(id: K): AppHooksModuleMapV1[K];
  has(id: string): boolean;
  ids(): readonly string[];
}

export interface AppHooksV1 {
  readonly contractVersion: 1;
  readonly modules: AppHooksModuleRegistryV1;
}

export interface AppHooksCapabilityRequirement {
  readonly id: AppHooksModuleId;
  readonly version: number;
  readonly required: boolean;
}

export const APP_HOOKS_V1_REQUIREMENTS = {
  skinEditor: [{ id: "myne.appearance", version: 1, required: true }],
  spacesOverview: [{ id: "myne.spaces", version: 1, required: true }],
} as const satisfies Record<string, readonly AppHooksCapabilityRequirement[]>;

const UNAVAILABLE_SPACES_RESULT: ModuleHookResult<SpacesStateV1> = Object.freeze({
  available: false,
  reason: "Host does not provide spaces.",
});
const UNAVAILABLE_APPEARANCE_RESULT: ModuleHookResult<AppearanceStateV1> = Object.freeze({
  available: false,
  reason: "Host does not provide appearance editing.",
});

export const unavailableSpacesHooksV1: SpacesModuleV1 = Object.freeze({
  id: "myne.spaces", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide spaces." }),
  useSpacesOverview: () => UNAVAILABLE_SPACES_RESULT,
  stopWorkspaceExecution: async () => { throw new Error("myne.spaces is unavailable"); },
});

export const unavailableAppearanceHooksV1: AppearanceModuleV1 = Object.freeze({
  id: "myne.appearance", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide appearance editing." }),
  useSkinEditor: () => UNAVAILABLE_APPEARANCE_RESULT,
  compileAppearanceCandidate: async () => ({ ok: false, diagnostics: [{ severity: "error" as const, code: "appearance-unavailable", message: "Host does not provide appearance editing." }] }),
  saveAppearance: async () => ({ ok: false }),
});

const PUBLISHED_MODULE_DEFAULTS: AppHooksModuleMapV1 = Object.freeze({
  "myne.spaces": unavailableSpacesHooksV1,
  "myne.appearance": unavailableAppearanceHooksV1,
});
const PUBLISHED_MODULE_IDS = Object.freeze(Object.keys(PUBLISHED_MODULE_DEFAULTS) as AppHooksModuleId[]);

export function createAppHooksV1(modules: readonly AppHooksModuleV1[]): AppHooksV1 {
  const suppliedModules = new Map<AppHooksModuleId, AppHooksModuleV1>();
  for (const module of modules) {
    if (suppliedModules.has(module.id)) throw new Error(`Duplicate AppHooksV1 module ${module.id}`);
    Object.freeze(module.availability);
    suppliedModules.set(module.id, Object.freeze(module));
  }
  const moduleMap = new Map<AppHooksModuleId, AppHooksModuleV1>();
  for (const id of PUBLISHED_MODULE_IDS) {
    moduleMap.set(id, suppliedModules.get(id) ?? PUBLISHED_MODULE_DEFAULTS[id]);
  }
  const registry: AppHooksModuleRegistryV1 = Object.freeze({
    get<K extends AppHooksModuleId>(id: K): AppHooksModuleMapV1[K] {
      const module = moduleMap.get(id);
      if (!module) throw new Error(`AppHooksV1 module ${id} is missing`);
      return module as AppHooksModuleMapV1[K];
    },
    has: (id: AppHooksModuleId) => moduleMap.has(id),
    ids: () => Object.freeze([...moduleMap.keys()]),
  });
  return Object.freeze({ contractVersion: 1, modules: registry });
}

export function assertAppHooksV1Compatible(
  appHooks: AppHooksV1,
  requirements: readonly AppHooksCapabilityRequirement[],
): void {
  if (appHooks.contractVersion !== 1) throw new Error(`AppHooksV1 requires contract version 1; received ${appHooks.contractVersion}`);
  const listedIds = appHooks.modules.ids();
  for (const id of PUBLISHED_MODULE_IDS) {
    if (!appHooks.modules.has(id)) throw new Error(`Malformed AppHooksV1 envelope: published module ${id} is missing`);
    if (!listedIds.includes(id)) throw new Error(`Malformed AppHooksV1 envelope: published module ${id} is missing from discovery`);
    if (appHooks.modules.get(id).id !== id) throw new Error(`Malformed AppHooksV1 envelope: registry key ${id} resolves to a different module`);
  }
  if (new Set(listedIds).size !== listedIds.length) {
    throw new Error("Malformed AppHooksV1 envelope: discovery module IDs are duplicated");
  }
  for (const requirement of requirements) {
    const module = appHooks.modules.get(requirement.id);
    if (module.version !== requirement.version) throw new Error(`${requirement.id} requires version ${requirement.version}; received ${module.version}`);
    if (requirement.required && !module.availability.available) throw new Error(`${requirement.id} is unavailable: ${module.availability.reason}`);
  }
}

type Listener = () => void;
function createExternalStore<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<Listener>();
  return Object.freeze({
    getSnapshot: () => value,
    set(next: T) { value = next; for (const listener of listeners) listener(); },
    subscribe(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}

export interface FakeAppHooksV1Host {
  readonly appHooks: AppHooksV1;
  getAppearanceSnapshot(): AppearanceSnapshotV1 | undefined;
  getSpacesValue(): SpacesStateV1;
  setAppearanceSnapshot(snapshot: AppearanceSnapshotV1 | undefined): void;
  setSpacesValue(value: Partial<SpacesStateV1>): void;
}

export function createFakeAppHooksV1Host(options: {
  spacesValue?: Partial<SpacesStateV1>;
  appearanceSnapshot?: AppearanceSnapshotV1;
  appearanceState?: AppearanceStateV1;
  stopWorkspaceExecution?: (workspaceId: string) => Promise<void>;
  compileAppearanceCandidate?: AppearanceModuleV1["compileAppearanceCandidate"];
  saveAppearance?: AppearanceModuleV1["saveAppearance"];
} = {}): FakeAppHooksV1Host {
  const spacesStore = createExternalStore<SpacesStateV1>({
    workspaces: [], repos: [], loading: false, error: null,
    refetch: async () => undefined, ...options.spacesValue,
  });
  const appearanceStore = createExternalStore<AppearanceStateV1>(options.appearanceState ?? { snapshot: options.appearanceSnapshot });
  const useSpacesOverview = (): ModuleHookResult<SpacesStateV1> => ({
    available: true,
    value: useSyncExternalStore(spacesStore.subscribe, spacesStore.getSnapshot, spacesStore.getSnapshot),
  });
  const useSkinEditor = (): ModuleHookResult<AppearanceStateV1> => ({
    available: true,
    value: useSyncExternalStore(appearanceStore.subscribe, appearanceStore.getSnapshot, appearanceStore.getSnapshot),
  });
  const spaces: SpacesModuleV1 = Object.freeze({
    id: "myne.spaces", version: 1, availability: Object.freeze({ available: true }), useSpacesOverview,
    stopWorkspaceExecution: async (workspaceId: string) => {
      if (!workspaceId.trim()) throw new Error("workspaceId must be non-empty");
      await options.stopWorkspaceExecution?.(workspaceId);
    },
  });
  const appearance: AppearanceModuleV1 = Object.freeze({
    id: "myne.appearance", version: 1, availability: Object.freeze({ available: true }), useSkinEditor,
    compileAppearanceCandidate: options.compileAppearanceCandidate ?? (async () => ({ ok: true })),
    saveAppearance: options.saveAppearance ?? (async () => ({ ok: true })),
  });
  const appHooks = createAppHooksV1([spaces, appearance]);
  return Object.freeze({
    appHooks,
    getAppearanceSnapshot: () => appearanceStore.getSnapshot().snapshot,
    getSpacesValue: spacesStore.getSnapshot,
    setAppearanceSnapshot: (snapshot: AppearanceSnapshotV1 | undefined) => appearanceStore.set({ snapshot }),
    setSpacesValue: (value: Partial<SpacesStateV1>) => spacesStore.set({ ...spacesStore.getSnapshot(), ...value }),
  });
}

export function createFakeAppHooksV1(options: Parameters<typeof createFakeAppHooksV1Host>[0] = {}): AppHooksV1 {
  return createFakeAppHooksV1Host(options).appHooks;
}
