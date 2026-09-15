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

export interface AppearanceStateV1 {
  readonly snapshot?: AppearanceSnapshotV1;
}

export interface SpacesModuleV1 {
  readonly id: "myne.spaces";
  readonly version: number;
  readonly availability: CapabilityAvailability;
  readonly useSpacesOverview: () => SpacesStateV1;
  readonly stopWorkspaceExecution: (workspaceId: string) => Promise<void>;
}

export interface AppearanceModuleV1 {
  readonly id: "myne.appearance";
  readonly version: number;
  readonly availability: CapabilityAvailability;
  readonly useSkinEditor: () => AppearanceStateV1;
  readonly saveAppearance: (args: { readonly snapshot: AppearanceSnapshotV1 }) => Promise<AppearanceSaveResultDTO>;
}

export interface AppHooksModuleMapV1 {
  readonly "myne.spaces": SpacesModuleV1;
  readonly "myne.appearance": AppearanceModuleV1;
}

export type AppHooksModuleId = keyof AppHooksModuleMapV1;
export type AppHooksModuleV1 = AppHooksModuleMapV1[AppHooksModuleId];

export interface AppHooksModuleRegistryV1 {
  get<K extends AppHooksModuleId>(id: K): AppHooksModuleMapV1[K];
  has(id: AppHooksModuleId): boolean;
  ids(): readonly AppHooksModuleId[];
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

const EMPTY_SPACES_VALUE: SpacesStateV1 = Object.freeze({
  workspaces: Object.freeze([]), repos: Object.freeze([]), loading: false,
  error: "Spaces capability is unavailable.", refetch: async () => undefined,
});
const EMPTY_APPEARANCE_VALUE: AppearanceStateV1 = Object.freeze({});

export const unavailableSpacesHooksV1: SpacesModuleV1 = Object.freeze({
  id: "myne.spaces", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide spaces." }),
  useSpacesOverview: () => EMPTY_SPACES_VALUE,
  stopWorkspaceExecution: async () => { throw new Error("myne.spaces is unavailable"); },
});

export const unavailableAppearanceHooksV1: AppearanceModuleV1 = Object.freeze({
  id: "myne.appearance", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide appearance editing." }),
  useSkinEditor: () => EMPTY_APPEARANCE_VALUE,
  saveAppearance: async () => ({ ok: false }),
});

export function createAppHooksV1(modules: readonly AppHooksModuleV1[]): AppHooksV1 {
  const moduleMap = new Map<AppHooksModuleId, AppHooksModuleV1>();
  for (const module of modules) {
    if (moduleMap.has(module.id)) throw new Error(`Duplicate AppHooksV1 module ${module.id}`);
    Object.freeze(module.availability);
    moduleMap.set(module.id, Object.freeze(module));
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
  for (const requirement of requirements) {
    if (!appHooks.modules.has(requirement.id)) {
      if (requirement.required) throw new Error(`Required AppHooksV1 module ${requirement.id} is missing`);
      continue;
    }
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
  stopWorkspaceExecution?: (workspaceId: string) => Promise<void>;
  saveAppearance?: AppearanceModuleV1["saveAppearance"];
} = {}): FakeAppHooksV1Host {
  const spacesStore = createExternalStore<SpacesStateV1>({
    workspaces: [], repos: [], loading: false, error: null,
    refetch: async () => undefined, ...options.spacesValue,
  });
  const appearanceStore = createExternalStore<AppearanceStateV1>({ snapshot: options.appearanceSnapshot });
  const useSpacesOverview = () => useSyncExternalStore(spacesStore.subscribe, spacesStore.getSnapshot, spacesStore.getSnapshot);
  const useSkinEditor = () => useSyncExternalStore(appearanceStore.subscribe, appearanceStore.getSnapshot, appearanceStore.getSnapshot);
  const spaces: SpacesModuleV1 = Object.freeze({
    id: "myne.spaces", version: 1, availability: Object.freeze({ available: true }), useSpacesOverview,
    stopWorkspaceExecution: async (workspaceId: string) => {
      if (!workspaceId.trim()) throw new Error("workspaceId must be non-empty");
      await options.stopWorkspaceExecution?.(workspaceId);
    },
  });
  const appearance: AppearanceModuleV1 = Object.freeze({
    id: "myne.appearance", version: 1, availability: Object.freeze({ available: true }), useSkinEditor,
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
