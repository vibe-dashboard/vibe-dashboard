import type {
  SpacesOverviewComponentProps,
  SpacesOverviewUIPack,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
} from "./SpacesOverview.contracts";
import {
  RecentlyCreatedTabGroups,
  RecentlyVisitedTabGroups,
  RecentSessionsSection,
  SpacesSection,
  StarredTabGroups,
} from "./craftSections.view";
import { RunningDevServersSection } from "./RunningDevServersSection.view";
import { SpacePickerModal } from "./SpacePickerModal.view";
import { Pagination, RepoFilterBar, WorkspaceRow } from "./workspaceList.view";
import { createSpacesOverviewUI } from "./SpacesOverview.ui";
import styles from "./SpacesOverview.skin.module.css";
import { MyneHeading, MyneText } from "../../theme/skins";
import type { SpacesOverviewSlotProps } from "./SpacesOverview.slots";

export function DefaultPageHeader(_props: SpacesOverviewSlotProps<"pageHeader">) {
  return (
    <div className="mb-6" data-myne-slot="page-header">
      <MyneHeading className="text-2xl font-bold" level={1}>
        Dashboard
      </MyneHeading>
      <MyneText as="p" className="mt-1 text-sm" tone="muted">
        Workspace activity feed
      </MyneText>
    </div>
  );
}

export function DefaultRecentSessionsSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"recentSessions">) {
  return <RecentSessionsSection model={model} actions={actions} />;
}

export function DefaultStarredCraftSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"starredCraft">) {
  return (
    <StarredTabGroups
      items={model.starredTabGroups}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultRunningDevServersSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"runningDevServers">) {
  return (
    <RunningDevServersSection
      workspaces={model.workspaces}
      loading={model.loading}
      onStop={actions.stopDevServer}
      stoppingIds={model.stoppingDevServerIds}
      workspaceTabGroupMap={model.workspaceTabGroupMap}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      onRequestOpenWorkspace={
        model.canOpenWorkspaceInSpace
          ? actions.openSpacePickerForWorkspace
          : undefined
      }
    />
  );
}

export function DefaultRecentlyVisitedCraftSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"recentlyVisitedCraft">) {
  return (
    <RecentlyVisitedTabGroups
      items={model.recentlyVisited.items}
      page={model.recentlyVisited.page}
      totalPages={model.recentlyVisited.totalPages}
      onPageChange={actions.setRecentlyVisitedPage}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultRecentlyCreatedCraftSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"recentlyCreatedCraft">) {
  return (
    <RecentlyCreatedTabGroups
      items={model.recentlyCreated.items}
      page={model.recentlyCreated.page}
      totalPages={model.recentlyCreated.totalPages}
      onPageChange={actions.setRecentlyCreatedPage}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultWorkspaceListSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"workspaceList">) {
  const {
    effectiveRepos,
    loading,
    error,
    selectedRepoId,
    sortedWorkspaces,
    pagedWorkspaces,
    workspacePage,
    workspaceTotalPages,
    stoppingDevServerIds,
    workspaceTabGroupMap,
    canOpenWorkspaceInSpace,
  } = model;

  return (
    <div className="mb-10" data-myne-slot="workspace-list">
      <div className="flex items-center justify-between mb-3">
        <MyneHeading className="text-lg font-semibold" level={2}>
          VK Workspaces
        </MyneHeading>
        {!loading && sortedWorkspaces.length > 0 && (
          <MyneText className="text-xs" tone="muted">
            {sortedWorkspaces.length} workspace
            {sortedWorkspaces.length !== 1 ? "s" : ""}
          </MyneText>
        )}
      </div>

      <RepoFilterBar
        repos={effectiveRepos}
        selectedRepoId={selectedRepoId}
        onSelectRepo={actions.selectRepo}
      />

      {loading ? (
        <div
          className="flex items-center justify-center py-12 myne-state myne-state--loading"
        >
          <div className="w-6 h-6 border-2 border-t-current rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="py-8 text-center myne-state myne-state--error">
          <MyneText as="p" className="text-sm" tone="secondary">
            {error}
          </MyneText>
          <MyneText as="p" className="mt-1 text-xs" tone="muted">
            VK backend may not be running
          </MyneText>
        </div>
      ) : sortedWorkspaces.length === 0 ? (
        <div className="py-8 text-center myne-state myne-state--empty">
          <MyneText as="p" className="text-sm" tone="muted">
            {selectedRepoId
              ? "No workspaces for this repository"
              : "No active workspaces"}
          </MyneText>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {pagedWorkspaces.map((workspace) => {
              const nav = workspaceTabGroupMap.get(workspace.id);
              const tabGroupNav = nav
                ? {
                    ...nav,
                    onNavigate: () =>
                      actions.navigateToTabGroup(nav.spaceId, nav.tabGroupId),
                  }
                : null;
              return (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  isStoppingDevServer={stoppingDevServerIds.has(workspace.id)}
                  onStopDevServer={
                    workspace.has_running_dev_server ||
                    stoppingDevServerIds.has(workspace.id)
                      ? () => actions.stopDevServer(workspace.id)
                      : undefined
                  }
                  {...(tabGroupNav ? { tabGroupNav } : {})}
                  {...(!tabGroupNav && canOpenWorkspaceInSpace
                    ? {
                        onOpenInNewTabGroup: () =>
                          actions.openSpacePickerForWorkspace(workspace),
                      }
                    : {})}
                />
              );
            })}
          </div>
          <Pagination
            page={workspacePage}
            totalPages={workspaceTotalPages}
            onPageChange={actions.setWorkspacePage}
          />
        </>
      )}
    </div>
  );
}

export function DefaultSpacesSection({
  model,
  actions,
}: SpacesOverviewSlotProps<"spaces">) {
  if (!model.hasSpaces) return null;

  return (
    <>
      <div className="my-8 border-t " />
      <SpacesSection
        spacesWithTabGroups={model.spacesWithTabGroups}
        onNavigateToTabGroup={actions.navigateToTabGroup}
        tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
      />
    </>
  );
}

export function DefaultSpacePickerModal({
  model,
  actions,
}: SpacesOverviewSlotProps<"spacePicker">) {
  const {
    workspace,
    spacePickerTarget,
    pendingOpenCraftRequest,
    openCraftRetryRequest,
    openCraftActionError,
    canOpenWorkspaceInSpace,
  } = model;

  if (!(spacePickerTarget && canOpenWorkspaceInSpace)) return null;

  return (
    <SpacePickerModal
      workspace={workspace}
      targetWorkspace={spacePickerTarget}
      onSelect={(spaceId) => {
        actions.runOpenCraftRequest({
          workspace: spacePickerTarget,
          spaceId,
        });
      }}
      onClose={actions.closeSpacePicker}
      pendingSpaceId={
        pendingOpenCraftRequest?.workspace.id === spacePickerTarget.id
          ? pendingOpenCraftRequest.spaceId
          : null
      }
      actionError={openCraftActionError}
      onRetry={openCraftRetryRequest ? actions.retryOpenCraftRequest : undefined}
    />
  );
}

export const defaultSpacesOverviewUI = createSpacesOverviewUI({
  PageHeader: DefaultPageHeader,
  RecentSessionsSection: DefaultRecentSessionsSection,
  StarredCraftSection: DefaultStarredCraftSection,
  RunningDevServersSection: DefaultRunningDevServersSection,
  RecentlyVisitedCraftSection: DefaultRecentlyVisitedCraftSection,
  RecentlyCreatedCraftSection: DefaultRecentlyCreatedCraftSection,
  WorkspaceListSection: DefaultWorkspaceListSection,
  SpacesSection: DefaultSpacesSection,
  SpacePickerModal: DefaultSpacePickerModal,
});

export function DefaultSpacesOverviewLayout({
  model,
  actions,
  ui,
  viewPackId = "myne.spaces.view-pack.default",
}: {
  model: SpacesOverviewViewModel;
  actions: SpacesOverviewViewActions;
  ui: SpacesOverviewUIPack;
  viewPackId?: string;
}) {
  return (
    <main
      className={`${styles.surface} h-full w-full overflow-auto p-6 md:p-8`}
      data-myne-surface="spaces-overview"
      data-myne-view-pack={viewPackId}
    >
      <div className="max-w-4xl mx-auto">
        <ui.PageHeader model={model} actions={actions} />
        <ui.RecentSessionsSection model={model} actions={actions} />
        <ui.StarredCraftSection model={model} actions={actions} />
        <ui.RunningDevServersSection model={model} actions={actions} />
        <ui.RecentlyVisitedCraftSection model={model} actions={actions} />
        <ui.RecentlyCreatedCraftSection model={model} actions={actions} />
        <ui.WorkspaceListSection model={model} actions={actions} />
        <ui.SpacesSection model={model} actions={actions} />
      </div>
      <ui.SpacePickerModal model={model} actions={actions} />
    </main>
  );
}

export function DefaultSpacesOverviewView(
  props: SpacesOverviewComponentProps,
) {
  return <DefaultSpacesOverviewLayout {...props} ui={defaultSpacesOverviewUI} />;
}
