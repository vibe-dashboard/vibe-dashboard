import type {
  SpacesOverviewComponentProps,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
} from "./SpacesOverview.contracts";

export const spacesOverviewSlots = ["pageHeader", "recentSessions", "starredCraft", "runningDevServers", "recentlyVisitedCraft", "recentlyCreatedCraft", "workspaceList", "spaces", "spacePicker"] as const;
export type SpacesOverviewSlot = (typeof spacesOverviewSlots)[number];

export const spacesOverviewSlotContracts = {
  pageHeader: { version: 1, model: [], actions: [] },
  recentSessions: { version: 1, model: ["workspace", "savedSessions", "currentSessionId", "sortedSessions", "expandedSessionId", "editingSessionId", "sessionNameDraft"], actions: ["resumeSession", "renameSession", "deleteSession", "startNewSession", "toggleExpandedSession", "startRenameSession", "setSessionNameDraft", "submitRenameSession", "cancelRenameSession", "navigateToTabGroup"] },
  starredCraft: { version: 1, model: ["starredTabGroups", "tabGroupDisplayLabelById"], actions: ["navigateToTabGroup"] },
  runningDevServers: { version: 1, model: ["workspaces", "loading", "stoppingDevServerIds", "workspaceTabGroupMap", "canOpenWorkspaceInSpace"], actions: ["stopDevServer", "navigateToTabGroup", "openSpacePickerForWorkspace"] },
  recentlyVisitedCraft: { version: 1, model: ["recentlyVisited", "tabGroupDisplayLabelById"], actions: ["setRecentlyVisitedPage", "navigateToTabGroup"] },
  recentlyCreatedCraft: { version: 1, model: ["recentlyCreated", "tabGroupDisplayLabelById"], actions: ["setRecentlyCreatedPage", "navigateToTabGroup"] },
  workspaceList: { version: 1, model: ["effectiveRepos", "loading", "error", "selectedRepoId", "sortedWorkspaces", "pagedWorkspaces", "workspacePage", "workspaceTotalPages", "stoppingDevServerIds", "workspaceTabGroupMap", "canOpenWorkspaceInSpace"], actions: ["selectRepo", "setWorkspacePage", "stopDevServer", "navigateToTabGroup", "openSpacePickerForWorkspace"] },
  spaces: { version: 1, model: ["hasSpaces", "spacesWithTabGroups", "tabGroupDisplayLabelById"], actions: ["navigateToTabGroup"] },
  spacePicker: { version: 1, model: ["workspace", "spacePickerTarget", "pendingOpenCraftRequest", "openCraftRetryRequest", "openCraftActionError", "canOpenWorkspaceInSpace"], actions: ["runOpenCraftRequest", "closeSpacePicker", "retryOpenCraftRequest"] },
} as const satisfies Record<SpacesOverviewSlot, { version: number; model: readonly (keyof SpacesOverviewViewModel)[]; actions: readonly (keyof SpacesOverviewViewActions)[] }>;

type Contract<S extends SpacesOverviewSlot> = (typeof spacesOverviewSlotContracts)[S];
export type SpacesOverviewSlotProps<S extends SpacesOverviewSlot> = {
  model: Pick<SpacesOverviewViewModel, Contract<S>["model"][number]>;
  actions: Pick<SpacesOverviewViewActions, Contract<S>["actions"][number]>;
};

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>;
}

export function projectSpacesOverviewSlotProps<S extends SpacesOverviewSlot>(slot: S, props: SpacesOverviewComponentProps): SpacesOverviewSlotProps<S> {
  const contract = spacesOverviewSlotContracts[slot];
  return { model: pick(props.model, contract.model), actions: pick(props.actions, contract.actions) } as SpacesOverviewSlotProps<S>;
}
