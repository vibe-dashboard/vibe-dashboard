import { createElement, type ComponentType } from "react";
import { createCompositionRegistry, resolveComposition, type CompositionManifest } from "../../myne/composition";
import type { SpacesOverviewComponentProps, SpacesOverviewUIPack, SpacesOverviewViewActions, SpacesOverviewViewModel } from "./SpacesOverview.contracts";
import { DefaultPageHeader, DefaultRecentSessionsSection, DefaultRecentlyCreatedCraftSection, DefaultRecentlyVisitedCraftSection, DefaultRunningDevServersSection, DefaultSpacePickerModal, DefaultSpacesOverviewLayout, DefaultSpacesSection, DefaultStarredCraftSection, DefaultWorkspaceListSection } from "./DefaultSpacesOverview.view";
import { DenseWorkspaceListSection } from "./DenseWorkspaceListSection.view";
import { projectSpacesOverviewSlotProps, spacesOverviewSlotContracts, spacesOverviewSlots, type SpacesOverviewSlot, type SpacesOverviewSlotProps } from "./SpacesOverview.slots";

export { projectSpacesOverviewSlotProps, spacesOverviewSlots } from "./SpacesOverview.slots";
export type SpacesOverviewLayoutId = "myne.spaces.layout.default";
export type SpacesOverviewComponentId = "myne.spaces.page-header.default" | "myne.spaces.recent-sessions.default" | "myne.spaces.starred-craft.default" | "myne.spaces.running-dev-servers.default" | "myne.spaces.recently-visited.default" | "myne.spaces.recently-created.default" | "myne.spaces.workspace-list.default" | "myne.spaces.workspace-list.dense" | "myne.spaces.spaces.default" | "myne.spaces.space-picker.default";
export interface SpacesOverviewLayoutProps { readonly model: SpacesOverviewViewModel; readonly actions: SpacesOverviewViewActions; readonly ui: SpacesOverviewUIPack; readonly viewPackId?: string; }
export type SpacesOverviewCompositionManifest = CompositionManifest<SpacesOverviewSlot, SpacesOverviewLayoutId, SpacesOverviewComponentId>;

const registered = <S extends SpacesOverviewSlot>(slot: S, renderer: ComponentType<SpacesOverviewSlotProps<S>>) => ({
  contractVersion: spacesOverviewSlotContracts[slot].version,
  component: (props: SpacesOverviewComponentProps) =>
    createElement(renderer, projectSpacesOverviewSlotProps(slot, props)),
});
export const spacesOverviewCompositionRegistry = createCompositionRegistry({
  surface: "spaces-overview", version: 1,
  layouts: { "myne.spaces.layout.default": DefaultSpacesOverviewLayout },
  components: {
    "myne.spaces.page-header.default": registered("pageHeader", DefaultPageHeader),
    "myne.spaces.recent-sessions.default": registered("recentSessions", DefaultRecentSessionsSection),
    "myne.spaces.starred-craft.default": registered("starredCraft", DefaultStarredCraftSection),
    "myne.spaces.running-dev-servers.default": registered("runningDevServers", DefaultRunningDevServersSection),
    "myne.spaces.recently-visited.default": registered("recentlyVisitedCraft", DefaultRecentlyVisitedCraftSection),
    "myne.spaces.recently-created.default": registered("recentlyCreatedCraft", DefaultRecentlyCreatedCraftSection),
    "myne.spaces.workspace-list.default": registered("workspaceList", DefaultWorkspaceListSection),
    "myne.spaces.workspace-list.dense": registered("workspaceList", DenseWorkspaceListSection),
    "myne.spaces.spaces.default": registered("spaces", DefaultSpacesSection),
    "myne.spaces.space-picker.default": registered("spacePicker", DefaultSpacePickerModal),
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
