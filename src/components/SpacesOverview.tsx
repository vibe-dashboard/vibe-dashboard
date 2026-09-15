import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceState, TabGroup } from "../types";
import {
  APP_HOOKS_V1_REQUIREMENTS,
  assertAppHooksV1Compatible,
} from "../app-hooks/AppHooks";
import { SkinRoot } from "../theme/skins";
import { selectedSpacesOverviewView } from "./spaces-overview/SpacesOverview.selected";
import type {
  DashboardWorkspace,
  SpacesOverviewProps,
  SpacesOverviewRepo,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
  SpacesOverviewViewProps,
  TabGroupWithSpace,
} from "./spaces-overview/SpacesOverview.contracts";
import { sortDashboardWorkspaces } from "./spaces-overview/SpacesOverview.model";

export type {
  DashboardWorkspace,
  SpacesOverviewPresentation,
  SpacesOverviewProps,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
  SpacesOverviewViewProps,
  TabGroupWithSpace,
} from "./spaces-overview/SpacesOverview.contracts";

const PAGE_SIZE = 20;
const TAB_GROUP_PAGE_SIZE = 10;

function getTabGroupWorkspaceId(tabGroup: TabGroup): string | null {
  for (const tab of tabGroup.tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function getTabGroupDisplayLabel(
  tabGroup: TabGroup,
  workspaceNameById: Map<string, string>,
): string {
  const workspaceId = getTabGroupWorkspaceId(tabGroup);
  const workspaceName = workspaceId
    ? workspaceNameById.get(workspaceId)
    : undefined;
  return tabGroup.label.includes("...") && workspaceName
    ? workspaceName
    : tabGroup.label;
}

function getNonSystemTabGroups(workspace: WorkspaceState): TabGroupWithSpace[] {
  const seen = new Set<string>();
  const items: TabGroupWithSpace[] = [];
  for (const space of workspace.spaces) {
    if (space.isSystem) continue;
    for (const tgId of space.tabGroupIds) {
      if (seen.has(tgId)) continue;
      seen.add(tgId);
      const tg = workspace.tabGroups.find((group) => group.id === tgId);
      if (tg) items.push({ space, tg });
    }
  }
  return items;
}

export function SpacesOverview(props: SpacesOverviewProps) {
  assertAppHooksV1Compatible(
    props.appHooks,
    APP_HOOKS_V1_REQUIREMENTS.spacesOverview,
  );
  return <SpacesOverviewContainer {...props} />;
}

function SpacesOverviewContainer({ appHooks, ...props }: SpacesOverviewProps) {
  const spacesModule = appHooks.modules.get("myne.spaces");
  const { workspaces: workspaceDTOs, repos: repoDTOs, loading, error, refetch } =
    spacesModule.useSpacesOverview();
  const workspaces: DashboardWorkspace[] = useMemo(() => workspaceDTOs.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    branch: workspace.branch,
    pinned: workspace.pinned,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    task_id: workspace.taskId,
    container_ref: workspace.containerRef,
    files_changed: workspace.filesChanged,
    lines_added: workspace.linesAdded,
    lines_removed: workspace.linesRemoved,
    latest_process_status: workspace.latestProcessStatus,
    latest_process_completed_at: workspace.latestProcessCompletedAt,
    has_pending_approval: workspace.hasPendingApproval,
    has_running_dev_server: workspace.hasRunningDevServer,
    has_unseen_turns: workspace.hasUnseenTurns,
    pr_status: workspace.pullRequestStatus,
    repos: workspace.repos.map((repo) => ({
      id: repo.id, name: repo.name, display_name: repo.displayName,
      target_branch: repo.targetBranch,
    })),
  })), [workspaceDTOs]);
  const repos: SpacesOverviewRepo[] = useMemo(() => repoDTOs.map((repo) => ({
    id: repo.id, name: repo.name, display_name: repo.displayName,
  })), [repoDTOs]);
  const [stoppingDevServerIds, setStoppingDevServerIds] = useState<Set<string>>(
    new Set(),
  );

  const handleStopDevServer = useCallback(
    async (workspaceId: string) => {
      if (stoppingDevServerIds.has(workspaceId)) return;
      setStoppingDevServerIds((prev) => new Set(prev).add(workspaceId));

      let clearDelayMs = 5000;
      try {
        await spacesModule.stopWorkspaceExecution(workspaceId);
        setTimeout(() => refetch(true), 1000);
      } catch (err) {
        clearDelayMs = 0;
        console.error("Failed to stop dev server:", err);
      } finally {
        setTimeout(() => {
          setStoppingDevServerIds((prev) => {
            const next = new Set(prev);
            next.delete(workspaceId);
            return next;
          });
        }, clearDelayMs);
      }
    },
    [refetch, spacesModule, stoppingDevServerIds],
  );

  return (
    <SpacesOverviewView
      {...props}
      workspaces={workspaces}
      repos={repos}
      loading={loading}
      error={error}
      stoppingDevServerIds={stoppingDevServerIds}
      onStopDevServer={handleStopDevServer}
      {...(props.onOpenVKWorkspace
        ? {
            onOpenWorkspaceInSpace: (
              targetWorkspace: DashboardWorkspace,
              spaceId: string,
            ) =>
              props.onOpenVKWorkspace?.(
                targetWorkspace.id,
                targetWorkspace.name,
                targetWorkspace.container_ref || "",
                spaceId,
              ),
          }
        : {})}
    />
  );
}

export function SpacesOverviewView({
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  workspaces,
  repos,
  loading,
  error,
  stoppingDevServerIds: externalStoppingDevServerIds,
  onStopDevServer,
  onOpenWorkspaceInSpace,
  initialSelectedRepoId = null,
  initialSpacePickerTargetId = null,
  initialOpenCraftActionError = null,
  skinState,
  presentation: Presentation = selectedSpacesOverviewView,
}: SpacesOverviewViewProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(
    initialSelectedRepoId,
  );
  const [workspacePage, setWorkspacePage] = useState(0);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [recentlyVisitedPage, setRecentlyVisitedPage] = useState(0);
  const [recentlyCreatedPage, setRecentlyCreatedPage] = useState(0);
  const initialSpacePickerTarget = useMemo(() => {
    if (!initialSpacePickerTargetId) return null;
    return (
      workspaces.find(
        (candidate) => candidate.id === initialSpacePickerTargetId,
      ) ?? null
    );
  }, [initialSpacePickerTargetId, workspaces]);
  const [spacePickerTarget, setSpacePickerTarget] =
    useState<DashboardWorkspace | null>(initialSpacePickerTarget);
  const [pendingOpenCraftRequest, setPendingOpenCraftRequest] =
    useState<{ workspace: DashboardWorkspace; spaceId: string } | null>(null);
  const [openCraftRetryRequest, setOpenCraftRetryRequest] =
    useState<{ workspace: DashboardWorkspace; spaceId: string } | null>(null);
  const [openCraftActionError, setOpenCraftActionError] = useState<
    string | null
  >(initialOpenCraftActionError);
  const stoppingDevServerIds = externalStoppingDevServerIds ?? new Set<string>();

  useEffect(() => {
    setSpacePickerTarget(initialSpacePickerTarget);
  }, [initialSpacePickerTarget]);

  useEffect(() => {
    setOpenCraftActionError(initialOpenCraftActionError);
  }, [initialOpenCraftActionError]);

  useEffect(() => {
    setSelectedRepoId(initialSelectedRepoId);
  }, [initialSelectedRepoId]);

  useEffect(() => {
    setWorkspacePage(0);
  }, [selectedRepoId]);

  const runOpenCraftRequest = useCallback(
    async (request: { workspace: DashboardWorkspace; spaceId: string }) => {
      if (!onOpenWorkspaceInSpace) {
        setOpenCraftActionError("Open Craft is unavailable.");
        return;
      }

      setPendingOpenCraftRequest(request);
      setOpenCraftRetryRequest(request);
      setOpenCraftActionError(null);
      try {
        await onOpenWorkspaceInSpace(request.workspace, request.spaceId);
        setSpacePickerTarget(null);
        setOpenCraftRetryRequest(null);
      } catch (err) {
        setOpenCraftActionError(getDashboardOpenCraftErrorMessage(err));
      } finally {
        setPendingOpenCraftRequest(null);
      }
    },
    [onOpenWorkspaceInSpace],
  );

  const model = useMemo<SpacesOverviewViewModel>(() => {
    const workspaceNameById = new Map<string, string>();
    for (const item of workspaces) {
      workspaceNameById.set(item.id, item.name || item.branch);
    }

    const tabGroupDisplayLabelById = new Map<string, string>();
    for (const tabGroup of workspace.tabGroups) {
      tabGroupDisplayLabelById.set(
        tabGroup.id,
        getTabGroupDisplayLabel(tabGroup, workspaceNameById),
      );
    }

    const effectiveRepos =
      repos.length > 0
        ? repos
        : Array.from(
            workspaces
              .flatMap((ws) => ws.repos)
              .reduce((seen, repo) => {
                if (!seen.has(repo.id)) {
                  seen.set(repo.id, {
                    id: repo.id,
                    name: repo.name,
                    display_name: repo.display_name,
                  });
                }
                return seen;
              }, new Map<string, SpacesOverviewRepo>())
              .values(),
          );

    const sortedWorkspaces = sortDashboardWorkspaces(
      selectedRepoId
        ? workspaces.filter((ws) =>
            ws.repos.some((repo) => repo.id === selectedRepoId),
          )
        : workspaces,
    );
    const workspaceTotalPages = Math.ceil(sortedWorkspaces.length / PAGE_SIZE);
    const pagedWorkspaces = sortedWorkspaces.slice(
      workspacePage * PAGE_SIZE,
      (workspacePage + 1) * PAGE_SIZE,
    );

    const workspaceTabGroupMap = new Map<
      string,
      { spaceId: string; tabGroupId: string; label: string }
    >();
    for (const space of workspace.spaces) {
      const tabGroups = workspace.tabGroups.filter((tabGroup) =>
        space.tabGroupIds.includes(tabGroup.id),
      );
      for (const tabGroup of tabGroups) {
        for (const tab of tabGroup.tabs) {
          const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
          if (match?.[1]) {
            workspaceTabGroupMap.set(match[1], {
              spaceId: space.id,
              tabGroupId: tabGroup.id,
              label: tabGroup.label,
            });
          }
        }
      }
    }

    const allTabGroups = getNonSystemTabGroups(workspace);
    const recentlyVisitedItems = allTabGroups
      .filter(({ tg }) => tg.lastVisitedAt)
      .sort(
        (left, right) =>
          new Date(right.tg.lastVisitedAt!).getTime() -
          new Date(left.tg.lastVisitedAt!).getTime(),
      );
    const recentlyCreatedItems = allTabGroups
      .filter(({ tg }) => tg.createdAt)
      .sort(
        (left, right) =>
          new Date(right.tg.createdAt!).getTime() -
          new Date(left.tg.createdAt!).getTime(),
      );

    return {
      workspace,
      savedSessions,
      currentSessionId,
      workspaces,
      effectiveRepos,
      loading,
      error,
      selectedRepoId,
      sortedWorkspaces,
      pagedWorkspaces,
      workspacePage,
      workspaceTotalPages,
      stoppingDevServerIds,
      tabGroupDisplayLabelById,
      workspaceTabGroupMap,
      hasSpaces: workspace.spaces.some((space) => !space.isSystem),
      sortedSessions: [...savedSessions].sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      ),
      expandedSessionId,
      editingSessionId,
      sessionNameDraft,
      starredTabGroups: allTabGroups.filter(({ tg }) => tg.starred),
      recentlyVisited: {
        items: recentlyVisitedItems.slice(
          recentlyVisitedPage * TAB_GROUP_PAGE_SIZE,
          (recentlyVisitedPage + 1) * TAB_GROUP_PAGE_SIZE,
        ),
        page: recentlyVisitedPage,
        totalPages: Math.ceil(recentlyVisitedItems.length / TAB_GROUP_PAGE_SIZE),
      },
      recentlyCreated: {
        items: recentlyCreatedItems.slice(
          recentlyCreatedPage * TAB_GROUP_PAGE_SIZE,
          (recentlyCreatedPage + 1) * TAB_GROUP_PAGE_SIZE,
        ),
        page: recentlyCreatedPage,
        totalPages: Math.ceil(recentlyCreatedItems.length / TAB_GROUP_PAGE_SIZE),
      },
      spacesWithTabGroups: workspace.spaces
        .filter((space) => !space.isSystem)
        .map((space) => ({
          space,
          tabGroups: workspace.tabGroups
            .filter((tabGroup) => space.tabGroupIds.includes(tabGroup.id))
            .sort((left, right) => left.order - right.order),
        })),
      spacePickerTarget,
      pendingOpenCraftRequest,
      openCraftRetryRequest,
      openCraftActionError,
      isOpenCraftPending: pendingOpenCraftRequest != null,
      canOpenWorkspaceInSpace: Boolean(onOpenWorkspaceInSpace),
    };
  }, [
    currentSessionId,
    editingSessionId,
    error,
    expandedSessionId,
    loading,
    onOpenWorkspaceInSpace,
    openCraftActionError,
    openCraftRetryRequest,
    pendingOpenCraftRequest,
    recentlyCreatedPage,
    recentlyVisitedPage,
    repos,
    savedSessions,
    selectedRepoId,
    sessionNameDraft,
    spacePickerTarget,
    stoppingDevServerIds,
    workspace,
    workspacePage,
    workspaces,
  ]);

  const actions = useMemo<SpacesOverviewViewActions>(
    () => ({
      resumeSession: onResumeSession,
      renameSession: onRenameSession,
      deleteSession: onDeleteSession,
      startNewSession: onStartNewSession,
      navigateToTabGroup: onNavigateToTabGroup,
      selectRepo: setSelectedRepoId,
      setWorkspacePage,
      stopDevServer: (workspaceId) => {
        void onStopDevServer?.(workspaceId);
      },
      openSpacePickerForWorkspace: (targetWorkspace) => {
        setOpenCraftActionError(null);
        setOpenCraftRetryRequest(null);
        setSpacePickerTarget(targetWorkspace);
      },
      runOpenCraftRequest: (request) => {
        void runOpenCraftRequest(request);
      },
      closeSpacePicker: () => {
        if (pendingOpenCraftRequest) return;
        setSpacePickerTarget(null);
        setOpenCraftActionError(null);
        setOpenCraftRetryRequest(null);
      },
      retryOpenCraftRequest: () => {
        if (openCraftRetryRequest) {
          void runOpenCraftRequest(openCraftRetryRequest);
        }
      },
      toggleExpandedSession: (sessionId) => {
        setExpandedSessionId((previous) =>
          previous === sessionId ? null : sessionId,
        );
      },
      startRenameSession: (sessionId, name) => {
        setEditingSessionId(sessionId);
        setSessionNameDraft(name);
      },
      setSessionNameDraft,
      submitRenameSession: (sessionId) => {
        if (sessionNameDraft.trim()) {
          onRenameSession(sessionId, sessionNameDraft.trim());
        }
        setEditingSessionId(null);
        setSessionNameDraft("");
      },
      cancelRenameSession: () => {
        setEditingSessionId(null);
        setSessionNameDraft("");
      },
      setRecentlyVisitedPage,
      setRecentlyCreatedPage,
    }),
    [
      onDeleteSession,
      onNavigateToTabGroup,
      onRenameSession,
      onResumeSession,
      onStartNewSession,
      onStopDevServer,
      openCraftRetryRequest,
      pendingOpenCraftRequest,
      runOpenCraftRequest,
      sessionNameDraft,
    ],
  );

  return (
    <SkinRoot className="h-full w-full" state={skinState}>
      <Presentation model={model} actions={actions} />
    </SkinRoot>
  );
}

function getDashboardOpenCraftErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Open Craft failed. Please retry or cancel.";
}
