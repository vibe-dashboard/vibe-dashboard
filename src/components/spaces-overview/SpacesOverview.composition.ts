import type { ComponentType } from "react";
import { createCompositionRegistry, resolveComposition, type CompositionManifest } from "../../myne/composition";
import type { SpacesOverviewComponentProps, SpacesOverviewUIPack, SpacesOverviewViewActions, SpacesOverviewViewModel } from "./SpacesOverview.contracts";
import { DefaultPageHeader, DefaultRecentSessionsSection, DefaultRecentlyCreatedCraftSection, DefaultRecentlyVisitedCraftSection, DefaultRunningDevServersSection, DefaultSpacePickerModal, DefaultSpacesOverviewLayout, DefaultSpacesSection, DefaultStarredCraftSection, DefaultWorkspaceListSection } from "./DefaultSpacesOverview.view";
import { DenseWorkspaceListSection } from "./DenseWorkspaceListSection.view";

export const spacesOverviewSlots = ["pageHeader", "recentSessions", "starredCraft", "runningDevServers", "recentlyVisitedCraft", "recentlyCreatedCraft", "workspaceList", "spaces", "spacePicker"] as const;
export type SpacesOverviewSlot = (typeof spacesOverviewSlots)[number];
export type SpacesOverviewLayoutId = "myne.spaces.layout.default";
export type SpacesOverviewComponentId = "myne.spaces.page-header.default" | "myne.spaces.recent-sessions.default" | "myne.spaces.starred-craft.default" | "myne.spaces.running-dev-servers.default" | "myne.spaces.recently-visited.default" | "myne.spaces.recently-created.default" | "myne.spaces.workspace-list.default" | "myne.spaces.workspace-list.dense" | "myne.spaces.spaces.default" | "myne.spaces.space-picker.default";
export interface SpacesOverviewLayoutProps { readonly model: SpacesOverviewViewModel; readonly actions: SpacesOverviewViewActions; readonly ui: SpacesOverviewUIPack; readonly viewPackId?: string; }
export type SpacesOverviewCompositionManifest = CompositionManifest<SpacesOverviewSlot, SpacesOverviewLayoutId, SpacesOverviewComponentId>;

const registered = (component: ComponentType<SpacesOverviewComponentProps>) => ({ contractVersion: 1, component });
export const spacesOverviewCompositionRegistry = createCompositionRegistry({
  surface: "spaces-overview", version: 1,
  layouts: { "myne.spaces.layout.default": DefaultSpacesOverviewLayout },
  components: {
    "myne.spaces.page-header.default": registered(DefaultPageHeader),
    "myne.spaces.recent-sessions.default": registered(DefaultRecentSessionsSection),
    "myne.spaces.starred-craft.default": registered(DefaultStarredCraftSection),
    "myne.spaces.running-dev-servers.default": registered(DefaultRunningDevServersSection),
    "myne.spaces.recently-visited.default": registered(DefaultRecentlyVisitedCraftSection),
    "myne.spaces.recently-created.default": registered(DefaultRecentlyCreatedCraftSection),
    "myne.spaces.workspace-list.default": registered(DefaultWorkspaceListSection),
    "myne.spaces.workspace-list.dense": registered(DenseWorkspaceListSection),
    "myne.spaces.spaces.default": registered(DefaultSpacesSection),
    "myne.spaces.space-picker.default": registered(DefaultSpacePickerModal),
  },
});

export const defaultSpacesOverviewManifest: SpacesOverviewCompositionManifest = {
  surface: "spaces-overview", version: 1, layout: "myne.spaces.layout.default", viewPackId: "myne.spaces.view-pack.default",
  slots: {
    pageHeader: { component: "myne.spaces.page-header.default", contractVersion: 1 }, recentSessions: { component: "myne.spaces.recent-sessions.default", contractVersion: 1 },
    starredCraft: { component: "myne.spaces.starred-craft.default", contractVersion: 1 }, runningDevServers: { component: "myne.spaces.running-dev-servers.default", contractVersion: 1 },
    recentlyVisitedCraft: { component: "myne.spaces.recently-visited.default", contractVersion: 1 }, recentlyCreatedCraft: { component: "myne.spaces.recently-created.default", contractVersion: 1 },
    workspaceList: { component: "myne.spaces.workspace-list.default", contractVersion: 1 }, spaces: { component: "myne.spaces.spaces.default", contractVersion: 1 },
    spacePicker: { component: "myne.spaces.space-picker.default", contractVersion: 1 },
  },
};
export const denseSpacesOverviewManifest: SpacesOverviewCompositionManifest = { ...defaultSpacesOverviewManifest, viewPackId: "myne.spaces.view-pack.dense-workspace-list", slots: { ...defaultSpacesOverviewManifest.slots, workspaceList: { component: "myne.spaces.workspace-list.dense", contractVersion: 1 } } };

export function resolveSpacesOverviewComposition(manifest: SpacesOverviewCompositionManifest, overrides: Partial<Record<SpacesOverviewSlot, SpacesOverviewComponentId>> = {}) {
  const resolved = resolveComposition(spacesOverviewCompositionRegistry, manifest, overrides);
  const components = resolved.components;
  const ui: SpacesOverviewUIPack = { PageHeader: components.pageHeader, RecentSessionsSection: components.recentSessions, StarredCraftSection: components.starredCraft, RunningDevServersSection: components.runningDevServers, RecentlyVisitedCraftSection: components.recentlyVisitedCraft, RecentlyCreatedCraftSection: components.recentlyCreatedCraft, WorkspaceListSection: components.workspaceList, SpacesSection: components.spaces, SpacePickerModal: components.spacePicker };
  return { ...resolved, ui };
}
