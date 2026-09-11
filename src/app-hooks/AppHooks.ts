import type { Repo } from "../lib/vk-client";
import type { DashboardWorkspace } from "../components/spaces-overview/SpacesOverview.contracts";
import type { SkinEditorActions } from "../theme/skins/SkinEditorDialog.contracts";
import type { VDSkinState } from "../theme/skins";

export type CapabilityAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface SpacesOverviewHookValue {
  readonly workspaces: DashboardWorkspace[];
  readonly repos: Repo[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: (isRefresh?: boolean) => Promise<void>;
}

export interface SpacesCapabilityV1 {
  readonly id: "myne.spaces";
  readonly version: 1;
  readonly availability: CapabilityAvailability;
  readonly useSpacesOverview: () => SpacesOverviewHookValue;
  readonly stopWorkspaceExecution: (workspaceId: string) => Promise<void>;
}

export interface SkinEditorHookValue {
  readonly skinState?: VDSkinState;
  readonly actions: SkinEditorActions;
}

export interface AppearanceCapabilityV1 {
  readonly id: "myne.appearance";
  readonly version: 1;
  readonly availability: CapabilityAvailability;
  readonly useSkinEditor: () => SkinEditorHookValue;
}

export interface AppHooksV1 {
  readonly contractVersion: 1;
  readonly capabilities: {
    readonly spaces: SpacesCapabilityV1;
    readonly appearance: AppearanceCapabilityV1;
  };
}

type CapabilityRequirement = {
  readonly key: keyof AppHooksV1["capabilities"];
  readonly id: string;
  readonly version: number;
  readonly required: boolean;
};

export const APP_HOOKS_V1_REQUIREMENTS = {
  skinEditor: [{ key: "appearance", id: "myne.appearance", version: 1, required: true }],
  spacesOverview: [{ key: "spaces", id: "myne.spaces", version: 1, required: true }],
} as const satisfies Record<string, readonly CapabilityRequirement[]>;

const EMPTY_SPACES_VALUE: SpacesOverviewHookValue = Object.freeze({
  workspaces: [], repos: [], loading: false,
  error: "Spaces capability is unavailable.",
  refetch: async () => undefined,
});
const EMPTY_APPEARANCE_VALUE: SkinEditorHookValue = Object.freeze({
  actions: { saveSkinState: async () => ({ ok: false }) },
});

export const unavailableSpacesHooksV1: SpacesCapabilityV1 = Object.freeze({
  id: "myne.spaces", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide spaces." }),
  useSpacesOverview: () => EMPTY_SPACES_VALUE,
  stopWorkspaceExecution: async () => { throw new Error("myne.spaces is unavailable"); },
});

export const unavailableAppearanceHooksV1: AppearanceCapabilityV1 = Object.freeze({
  id: "myne.appearance", version: 1,
  availability: Object.freeze({ available: false, reason: "Host does not provide appearance editing." }),
  useSkinEditor: () => EMPTY_APPEARANCE_VALUE,
});

export function assertAppHooksV1Compatible(
  appHooks: AppHooksV1,
  requirements: readonly CapabilityRequirement[],
): void {
  if (appHooks.contractVersion !== 1) throw new Error(`AppHooksV1 requires contract version 1; received ${appHooks.contractVersion}`);
  for (const requirement of requirements) {
    const capability = appHooks.capabilities[requirement.key];
    if (capability.id !== requirement.id) throw new Error(`Required capability ${requirement.id} is missing`);
    if (capability.version !== requirement.version) throw new Error(`${requirement.id} requires version ${requirement.version}; received ${capability.version}`);
    if (requirement.required && !capability.availability.available) throw new Error(`${requirement.id} is unavailable: ${capability.availability.reason}`);
  }
}

export function createFakeAppHooksV1(options: {
  spacesValue?: Partial<SpacesOverviewHookValue>;
  skinEditorValue?: SkinEditorHookValue;
  stopWorkspaceExecution?: (workspaceId: string) => Promise<void>;
} = {}): AppHooksV1 {
  const spacesValue: SpacesOverviewHookValue = {
    workspaces: [], repos: [], loading: false, error: null,
    refetch: async () => undefined,
    ...options.spacesValue,
  };
  const skinEditorValue = options.skinEditorValue ?? EMPTY_APPEARANCE_VALUE;
  return Object.freeze({
    contractVersion: 1,
    capabilities: Object.freeze({
      spaces: Object.freeze({
        id: "myne.spaces", version: 1, availability: Object.freeze({ available: true }),
        useSpacesOverview: () => spacesValue,
        stopWorkspaceExecution: async (workspaceId: string) => {
          if (!workspaceId.trim()) throw new Error("workspaceId must be non-empty");
          await options.stopWorkspaceExecution?.(workspaceId);
        },
      }),
      appearance: Object.freeze({
        id: "myne.appearance", version: 1, availability: Object.freeze({ available: true }),
        useSkinEditor: () => skinEditorValue,
      }),
    }),
  });
}
