import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { getDefaultSpace, type SavedWorkspaceSession, type WorkspaceState } from "../types";
import {
  branchBelongsToRemoteOrLocal,
  chooseBestContainingBranch,
  findMatchingRepoRemotes,
  findOpenWorkspaceLocation,
  findWorkspaceIdsForPr,
  getRemoteDefaultBranch,
  getOpenFromGithubUrl,
  parseGithubOpenUrl,
  removeOpenFromGithubParam,
  resolveGithubTreeBlobBranch,
  resolveGithubTreeBlobCommitTarget,
  selectPreferredRemoteBranch,
  type MatchingRepoRemote,
  type ParsedGithubIssueUrl,
  type ParsedGithubPrUrl,
  type ParsedGithubTreeBlobUrl,
  type OpenWorkspaceLocation,
  type ResolvedGithubTreeBlobTarget,
} from "../lib/openFromGithub";
import {
  vkClient,
  type GithubAssociatedPullRequest,
  type GitBranch,
  type PullRequestDetail,
  type Workspace as VkWorkspace,
  type WorkspaceSummary,
} from "../lib/vk-client";
import { buildSavedVoyageDashboardPath } from "../lib/voyageUrl";

export interface OpenFromGitHubProps {
  workspace: WorkspaceState;
  savedVoyages?: SavedWorkspaceSession[];
  addSpace: (args: {
    name: string;
  }) => Promise<{ spaceId: string; tabGroupId: string } | undefined>;
  deleteTabGroup: (args: { spaceId: string; tabGroupId: string }) => Promise<
    | {
        wasDeleted: boolean;
        deletedTabGroupId?: string;
        nextTabGroupId?: string;
      }
    | undefined
  >;
  addVKWorkspace: (args: {
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
  }) => Promise<
    { tabGroupId: string; pairId: string; agentTabId: string } | undefined
  >;
  selectSessionTabGroup: (spaceId: string, tabGroupId: string) => void;
  selectSessionTab: (
    spaceId: string,
    tabGroupId: string,
    tabId: string,
  ) => void;
  createSavedSessionForSelection: (args: {
    name: string;
    spaceId: string;
    tabGroupId: string;
    tabId?: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  addSelectionToSavedSession: (args: {
    sessionId: string;
    spaceId: string;
    tabGroupId: string;
    voyageEntryId?: string;
    tabId?: string;
    viewIds?: string[];
  }) => Promise<SavedWorkspaceSession | undefined>;
}

type PendingTarget =
  | {
      type: "existing";
      workspace: VkWorkspace;
      prInfo: PullRequestDetail;
    }
  | {
      type: "create";
      match: MatchingRepoRemote;
      prInfo: PullRequestDetail;
    }
  | {
      type: "existing-issue";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "create-issue";
      match: MatchingRepoRemote;
      issue: ParsedGithubIssueUrl;
      targetBranch?: string;
      checkoutBranch?: string;
      createBranch?: boolean;
      workspaceName?: string;
      duplicateConfirmed?: boolean;
    }
  | {
      type: "create-tree-blob";
      match: MatchingRepoRemote;
      target: ResolvedGithubTreeBlobTarget;
      targetBranch: string;
      checkoutBranch?: string;
      createBranch?: boolean;
      workspaceName?: string;
    };

type ExistingVoyageChoice = {
  savedVoyage: SavedWorkspaceSession;
  voyageEntryId?: string;
};

type UnclonedTarget =
  | { type: "pr"; parsed: ParsedGithubPrUrl; prInfo: PullRequestDetail }
  | { type: "issue"; issue: ParsedGithubIssueUrl }
  | { type: "tree-blob"; target: ParsedGithubTreeBlobUrl };

type DialogState =
  | null
  | {
      type: "processing";
      title: string;
      message: string;
    }
  | {
      type: "choose-repo";
      target:
        | { type: "pr"; prInfo: PullRequestDetail }
        | { type: "issue"; issue: ParsedGithubIssueUrl; duplicateConfirmed?: boolean }
        | { type: "tree-blob"; target: ParsedGithubTreeBlobUrl };
      matches: MatchingRepoRemote[];
    }
  | {
      type: "choose-branch";
      match: MatchingRepoRemote;
      target: ResolvedGithubTreeBlobTarget;
      branches: string[];
      message: string;
    }
  | {
      type: "choose-work-mode";
      target:
        | Extract<PendingTarget, { type: "create-issue" }>
        | Extract<PendingTarget, { type: "create-tree-blob" }>;
      branches: GitBranch[];
      selectedBranch: string;
      defaultCreateBranch: boolean;
      protectionStatus: "protected" | "unprotected" | "unknown";
    }
  | {
      type: "choose-voyage";
      title: string;
      message: string;
      choices: ExistingVoyageChoice[];
      mode:
        | {
            type: "existing-location";
            openLocation: OpenWorkspaceLocation;
          }
        | {
            type: "target";
            target: PendingTarget;
          };
    }
  | {
      type: "confirm-reopen-archived";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "existing-issue-workspace";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
      openLocation?: OpenWorkspaceLocation;
    }
  | {
      type: "choose-pr-workspace";
      candidates: Array<{ workspace: VkWorkspace; summary?: WorkspaceSummary }>;
      prInfo: PullRequestDetail;
    }
  | { type: "choose-clone-intent"; target: UnclonedTarget }
  | {
      type: "choose-fork";
      target: UnclonedTarget;
      sourceRepoUrl: string;
      forks: Array<{ fullName: string; cloneUrl: string }>;
    }
  | {
      type: "await-fork";
      target: UnclonedTarget;
      sourceRepoUrl: string;
      forkUrl: string;
      viewer: string;
    }
  | {
      type: "stale-issue-mapping";
      issue: ParsedGithubIssueUrl;
      workspaceId: string;
    }
  | {
      type: "choose-associated-pr";
      issue: ParsedGithubIssueUrl;
      pullRequests: GithubAssociatedPullRequest[];
    }
  | {
      type: "opening";
      title: string;
      message: string;
    }
  | {
      type: "error";
      title: string;
      message: string;
    };

export function hasOpenFromGitHubParam(search: string): boolean {
  return getOpenFromGithubUrl(search) != null;
}

export function OpenFromGitHub({
  workspace,
  savedVoyages = [],
  addSpace,
  deleteTabGroup,
  addVKWorkspace,
  selectSessionTabGroup,
  selectSessionTab,
  createSavedSessionForSelection,
  addSelectionToSavedSession,
}: OpenFromGitHubProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const processedUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const latestRuntimeRef = useRef({
    workspace,
    savedVoyages,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
    createSavedSessionForSelection,
    addSelectionToSavedSession,
  });
  latestRuntimeRef.current = {
    workspace,
    savedVoyages,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
    createSavedSessionForSelection,
    addSelectionToSavedSession,
  };
  const [dialog, setDialog] = useState<DialogState>(null);

  const requestedUrl = getOpenFromGithubUrl(location.search);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearParam = () => {
    const { location: latestLocation, navigate: latestNavigate } =
      latestRuntimeRef.current;
    const nextSearch = removeOpenFromGithubParam(latestLocation.search);
    latestNavigate(`${latestLocation.pathname}${nextSearch}`, {
      replace: true,
    });
  };

  const isTargetCurrent = (target: PendingTarget): boolean =>
    mountedRef.current &&
    isSameOpenTarget(
      target,
      getOpenFromGithubUrl(latestRuntimeRef.current.location.search),
    );

  const routeExistingLocation = (args: {
    openLocation: OpenWorkspaceLocation;
    title: string;
    message: string;
  }) => {
    const existingVoyages = findSavedVoyagesForTabGroup(
      latestRuntimeRef.current.savedVoyages,
      args.openLocation.tabGroupId,
      latestRuntimeRef.current.workspace,
    );

    if (existingVoyages.length === 1) {
      const [existingVoyage] = existingVoyages;
      if (existingVoyage) {
        openSavedVoyage(
          existingVoyage.savedVoyage,
          existingVoyage.voyageEntryId ||
            existingVoyage.savedVoyage.activeVoyageEntryId,
        );
      }
      return;
    }

    if (existingVoyages.length > 1) {
      setDialog({
        type: "choose-voyage",
        title: args.title,
        message: args.message,
        choices: existingVoyages,
        mode: {
          type: "existing-location",
          openLocation: args.openLocation,
        },
      });
      return;
    }

    setDialog({
      type: "choose-voyage",
      title: args.title,
      message:
        "This craft is open, but it is not part of any saved Voyage yet. Choose a recently opened Voyage to add it to, or create a new Voyage.",
      choices: getRecentVoyageChoices(latestRuntimeRef.current.savedVoyages),
      mode: {
        type: "existing-location",
        openLocation: args.openLocation,
      },
    });
  };

  const openSavedVoyage = (
    savedVoyage: SavedWorkspaceSession,
    voyageEntryId: string,
  ) => {
    const { workspace, savedVoyages, location, navigate } =
      latestRuntimeRef.current;
    const nextSearch = removeOpenFromGithubParam(location.search);
    const nextPath = buildSavedVoyageDashboardPath({
      currentSearch: nextSearch,
      workspace,
      session: savedVoyage,
      savedSessions: savedVoyages,
      voyageEntryId,
    });
    setDialog(null);
    navigate(nextPath, { replace: true });
  };

  const chooseVoyageForTarget = (target: PendingTarget) => {
    if (
      (target.type === "create-issue" || target.type === "create-tree-blob") &&
      target.createBranch === undefined
    ) {
      void showWorkMode(target);
      return;
    }
    setDialog({
      type: "choose-voyage",
      title: `${getTargetVerb(target)} in Voyage`,
      message:
        "Choose a recently opened Voyage to add this craft to, or create a new Voyage.",
      choices: getRecentVoyageChoices(latestRuntimeRef.current.savedVoyages),
      mode: {
        type: "target",
        target,
      },
    });
  };

  const showWorkMode = async (
    target:
      | Extract<PendingTarget, { type: "create-issue" }>
      | Extract<PendingTarget, { type: "create-tree-blob" }>,
  ) => {
    try {
      const branches = await vkClient.getRepoBranches(target.match.repo.id);
      const available = branches.filter((branch) =>
        branchBelongsToRemoteOrLocal(branch.name, target.match.remote.name),
      );
      const selectedBranch = target.type === "create-tree-blob"
        ? target.targetBranch
        : await getIssueTargetBranch(target.match);
      const configuredDefault = getRemoteDefaultBranch(
        target.match.repo.default_target_branch,
        target.match.remote.name,
      );
      const defaultCreateBranch =
        selectedBranch === configuredDefault ||
        selectedBranch === `${target.match.remote.name}/main`;
      const protectionStatus = await vkClient
        .getGithubBranchProtection(
          target.match.remote.url,
          getGithubRefForTargetBranchName(
            selectedBranch,
            target.match.remote.name,
          ),
        )
        .then((result) => result.protected ? "protected" as const : "unprotected" as const)
        .catch(() => "unknown" as const);
      const selectedMetadata = available.find((branch) => branch.name === selectedBranch) ?? {
        name: selectedBranch,
        is_current: false,
        is_remote: selectedBranch.startsWith(`${target.match.remote.name}/`),
        last_commit_date: new Date(0),
      };
      setDialog({
        type: "choose-work-mode",
        target,
        branches: available.some((branch) => branch.name === selectedBranch)
          ? available
          : [selectedMetadata, ...available],
        selectedBranch,
        defaultCreateBranch:
          defaultCreateBranch ||
          protectionStatus !== "unprotected",
        protectionStatus,
      });
    } catch (error) {
      setDialog({
        type: "error",
        title: "Could not load repository branches",
        message: error instanceof Error ? error.message : "Unknown branch lookup error.",
      });
    }
  };

  const selectVoyageForDialog = async (choice: ExistingVoyageChoice) => {
    if (dialog?.type !== "choose-voyage") return;
    if (dialog.mode.type === "existing-location") {
      await addExistingLocationToVoyage(dialog.mode.openLocation, choice);
      return;
    }
    await openWorkspaceInVoyage(dialog.mode.target, choice.savedVoyage);
  };

  const addExistingLocationToVoyage = async (
    openLocation: OpenWorkspaceLocation,
    choice: ExistingVoyageChoice,
  ) => {
    const result = await latestRuntimeRef.current.addSelectionToSavedSession({
      sessionId: choice.savedVoyage.id,
      spaceId: openLocation.spaceId,
      tabGroupId: openLocation.tabGroupId,
      voyageEntryId: choice.voyageEntryId,
    });
    const savedVoyage = result || choice.savedVoyage;
    const voyageEntryId =
      result?.activeVoyageEntryId || choice.voyageEntryId || undefined;
    openSavedVoyage(savedVoyage, voyageEntryId || savedVoyage.activeVoyageEntryId);
  };

  const createVoyageForDialog = async (name: string) => {
    if (dialog?.type !== "choose-voyage") return;
    if (dialog.mode.type === "existing-location") {
      await createVoyageFromExistingLocation(name, dialog.mode.openLocation);
      return;
    }
    await openWorkspaceInNewVoyage(dialog.mode.target, name);
  };

  const createVoyageFromExistingLocation = async (
    name: string,
    openLocation: OpenWorkspaceLocation,
  ) => {
    const savedVoyage =
      await latestRuntimeRef.current.createSavedSessionForSelection({
        name,
        spaceId: openLocation.spaceId,
        tabGroupId: openLocation.tabGroupId,
      });
    if (!savedVoyage) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "The existing craft could not be saved into a new Voyage.",
      });
      return;
    }
    openSavedVoyage(savedVoyage, savedVoyage.activeVoyageEntryId);
  };

  const getFallbackSpaceId = (): string | undefined => {
    const { workspace } = latestRuntimeRef.current;
    return getDefaultSpace(workspace)?.id;
  };

  const openWorkspaceInVoyage = async (
    target: PendingTarget,
    savedVoyage: SavedWorkspaceSession,
  ): Promise<boolean> => {
    const spaceId = getFallbackSpaceId();
    if (!spaceId) {
      setDialog({
        type: "error",
        title: "Could not open Voyage",
        message: "No space is available to host the new craft.",
      });
      clearParam();
      return false;
    }

    const result = await openWorkspaceInSpace(target, spaceId, {
      clearWhenDone: false,
      selectWhenDone: false,
    });
    if (!result) return false;

    const updatedVoyage =
      await latestRuntimeRef.current.addSelectionToSavedSession({
        sessionId: savedVoyage.id,
        spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.agentTabId,
      });
    openSavedVoyage(
      updatedVoyage || savedVoyage,
      updatedVoyage?.activeVoyageEntryId || savedVoyage.activeVoyageEntryId,
    );
    return true;
  };

  const openWorkspaceInNewVoyage = async (
    target: PendingTarget,
    name: string,
  ): Promise<boolean> => {
    const spaceId = getFallbackSpaceId();
    if (!spaceId) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "No space is available to host the new craft.",
      });
      clearParam();
      return false;
    }

    const result = await openWorkspaceInSpace(target, spaceId, {
      clearWhenDone: false,
      selectWhenDone: false,
    });
    if (!result) return false;

    const savedVoyage =
      await latestRuntimeRef.current.createSavedSessionForSelection({
        name,
        spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.agentTabId,
      });
    if (!savedVoyage) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "The new craft could not be saved into a new Voyage.",
      });
      return false;
    }

    openSavedVoyage(savedVoyage, savedVoyage.activeVoyageEntryId);
    return true;
  };

  const openWorkspaceInSpace = async (
    target: PendingTarget,
    spaceId: string,
    options: { clearWhenDone?: boolean; selectWhenDone?: boolean } = {},
  ): Promise<
    | {
        tabGroupId: string;
        agentTabId: string;
      }
    | false
  > => {
    const { clearWhenDone = true, selectWhenDone = true } = options;
    const isCurrentTarget = () => isTargetCurrent(target);
    if (!isCurrentTarget()) return false;

    try {
      setDialog({
        type: "opening",
        title: target.type === "create-tree-blob"
          ? "Opening GitHub URL"
          : target.type.endsWith("issue")
            ? "Opening GitHub issue"
            : "Opening GitHub PR",
        message: "Preparing the VK workspace and opening it in VD.",
      });

      const workspaceToOpen = await resolveWorkspaceToOpen(
        target,
        isCurrentTarget,
      );
      if (!isCurrentTarget()) return false;

      const result = await latestRuntimeRef.current.addVKWorkspace({
        taskAttemptId: workspaceToOpen.id,
        name: workspaceToOpen.name || getTargetTitle(target),
        containerRef: workspaceToOpen.container_ref || "",
        activeSpaceId: spaceId,
      });

      if (!isCurrentTarget()) return false;

      if (result && selectWhenDone) {
        latestRuntimeRef.current.selectSessionTab(
          spaceId,
          result.tabGroupId,
          result.agentTabId,
        );
      }

      setDialog(null);
      if (clearWhenDone) {
        clearParam();
      }
      return result
        ? {
            tabGroupId: result.tabGroupId,
            agentTabId: result.agentTabId,
          }
        : false;
    } catch (error) {
      if (error instanceof StaleOpenFromGithubRunError || !isCurrentTarget()) {
        return false;
      }
      setDialog({
        type: "error",
        title: target.type === "create-tree-blob"
          ? "Could not open GitHub URL"
          : target.type.endsWith("issue")
            ? "Could not open GitHub issue"
            : "Could not open GitHub PR",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while opening GitHub URL.",
      });
      clearParam();
      return false;
    }
  };

  const resolveWorkspaceToOpen = async (
    target: PendingTarget,
    isCurrentTarget: () => boolean,
  ): Promise<VkWorkspace> => {
    if (target.type === "existing" || target.type === "existing-issue") {
      if (target.workspace.archived) {
        const workspace = await vkClient.updateWorkspace(target.workspace.id, {
          archived: false,
        });
        if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
        return workspace;
      }
      return target.workspace;
    }

    if (target.type === "create-tree-blob") {
      const checkoutBranch = await prepareCheckoutBranch(target);
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      const workspace = (
        await vkClient.createWorkspaceFromTreeBlob({
          repo_id: target.match.repo.id,
          target_branch: target.targetBranch,
          normalized_url: target.target.normalizedUrl,
          ref: target.target.ref,
          kind: target.target.kind,
          path: target.target.path,
          permalink_commit: target.target.permalinkCommit,
          create_branch: target.createBranch ?? true,
          checkout_branch: target.createBranch === false ? checkoutBranch : null,
          name: target.workspaceName,
          branch_name: target.createBranch === false ? null : target.workspaceName,
        })
      ).workspace;
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      return workspace;
    }

    if (target.type === "create-issue") {
      const targetBranch = target.targetBranch ?? await getIssueTargetBranch(target.match);
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      const checkoutBranch = await prepareCheckoutBranch(target);
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      if (target.duplicateConfirmed) {
        const workspace = (
          await vkClient.createWorkspaceFromIssue({
            repo_id: target.match.repo.id,
            target_branch: targetBranch,
            issue_url: target.issue.normalizedIssueUrl,
            issue_number: target.issue.number,
            run_setup: true,
            create_branch: target.createBranch ?? true,
            checkout_branch: target.createBranch === false ? checkoutBranch : null,
            name: target.workspaceName,
            branch_name: target.createBranch === false ? null : target.workspaceName,
          })
        ).workspace;
        if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
        return workspace;
      }
      const workspace = (
        await vkClient.resolveOrCreateGithubIssueWorkspace({
          owner: target.issue.owner.toLowerCase(),
          repo: target.issue.repo.toLowerCase(),
          repo_id: target.match.repo.id,
          target_branch: targetBranch,
          issue_url: target.issue.normalizedIssueUrl,
          issue_number: target.issue.number,
          run_setup: true,
          create_branch: target.createBranch ?? true,
          checkout_branch: target.createBranch === false ? checkoutBranch : null,
          name: target.workspaceName,
          branch_name: target.createBranch === false ? null : target.workspaceName,
        })
      ).workspace;
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      return workspace;
    }

    const workspace = (
      await vkClient.createWorkspaceFromPr({
        repo_id: target.match.repo.id,
        pr_number: target.prInfo.number,
        pr_title: target.prInfo.title,
        pr_url: target.prInfo.url,
        head_branch: target.prInfo.head_branch,
        base_branch: target.prInfo.base_branch,
        run_setup: true,
        remote_name: target.match.remote.name,
      })
    ).workspace;
    if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
    return workspace;
  };

  const prepareCheckoutBranch = async (
    target:
      | Extract<PendingTarget, { type: "create-issue" }>
      | Extract<PendingTarget, { type: "create-tree-blob" }>,
  ): Promise<string | null> => {
    if (target.createBranch !== false) return null;
    const branch = target.checkoutBranch;
    if (!branch) throw new Error("A branch must be selected to work on it.");
    const prepared = await vkClient.prepareGithubSelectedBranch({
      repoId: target.match.repo.id,
      branch,
      remoteName: target.match.remote.name,
    });
    return prepared.checkoutBranch;
  };

  const finishProvisionedTarget = async (
    target: UnclonedTarget,
    repoUrl: string,
    upstreamRepoUrl?: string,
  ) => {
    setDialog({
      type: "processing",
      title: "Preparing GitHub repository",
      message: `Cloning and registering ${repoUrl}`,
    });
    const ensured = upstreamRepoUrl
      ? await vkClient.ensureGithubRepo(repoUrl, upstreamRepoUrl)
      : await vkClient.ensureGithubRepo(repoUrl);
    const remotes = await vkClient.getRepoRemotes(ensured.repo.id).catch(() => []);
    const source = target.type === "pr" ? target.parsed : target.type === "issue" ? target.issue : target.target;
    const matches = findMatchingRepoRemotes(
      [ensured.repo],
      new Map([[ensured.repo.id, remotes]]),
      source,
    );
    const match = matches[0] ?? {
      repo: ensured.repo,
      remote: {
        name: upstreamRepoUrl ? "upstream" : "origin",
        url: upstreamRepoUrl ?? repoUrl,
      },
    };

    if (target.type === "pr") {
      chooseVoyageForTarget({ type: "create", match, prInfo: target.prInfo });
    } else if (target.type === "issue") {
      chooseVoyageForTarget({ type: "create-issue", match, issue: target.issue });
    } else {
      await resolveTreeBlobMatch(match, target.target, () => false);
    }
  };

  const chooseCloneIntent = async (
    target: UnclonedTarget,
    intent: "analysis" | "changes",
  ) => {
    const sourceRepoUrl = `https://github.com/${
      target.type === "pr"
        ? target.parsed.normalizedRepo
        : target.type === "issue"
          ? target.issue.normalizedRepo
          : target.target.normalizedRepo
    }`;
    try {
      if (intent === "analysis") {
        await finishProvisionedTarget(target, sourceRepoUrl);
        return;
      }

      setDialog({
        type: "processing",
        title: "Checking GitHub access",
        message: `Checking push access with gh CLI for ${sourceRepoUrl}`,
      });
      const access = await vkClient.getGithubRepoAccess(sourceRepoUrl);
      if (access.sourceCanPush) {
        await finishProvisionedTarget(target, sourceRepoUrl);
      } else if (access.writableForks.length === 1 && access.writableForks[0]) {
        await finishProvisionedTarget(
          target,
          `https://github.com/${access.writableForks[0].fullName}`,
          sourceRepoUrl,
        );
      } else if (access.writableForks.length > 1) {
        setDialog({
          type: "choose-fork",
          target,
          sourceRepoUrl,
          forks: access.writableForks,
        });
      } else {
        window.open(access.forkUrl, "_blank", "noopener,noreferrer");
        setDialog({
          type: "await-fork",
          target,
          sourceRepoUrl,
          forkUrl: access.forkUrl,
          viewer: access.viewer,
        });
      }
    } catch (error) {
      setDialog({
        type: "error",
        title: "Could not prepare GitHub repository",
        message: error instanceof Error ? error.message : "Unknown GitHub repository error.",
      });
    }
  };

  useEffect(() => {
    if (dialog?.type !== "await-fork") return;
    const recheck = () => {
      if (document.visibilityState === "visible") {
        void chooseCloneIntent(dialog.target, "changes");
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [dialog]);

  const runIssueOpen = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
    checkAssociatedPullRequests = true,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub issue",
      message: `Resolving ${issue.normalizedIssueUrl}`,
    });

    try {
      if (checkAssociatedPullRequests) {
        const pullRequests = await vkClient
          .getGithubIssuePullRequests(issue.normalizedIssueUrl)
          .then((result) => result.pullRequests)
          .catch(() => []);
        if (isCancelled()) return;
        if (pullRequests.length > 0) {
          setDialog({ type: "choose-associated-pr", issue, pullRequests });
          return;
        }
      }
      const mapping = await vkClient.getGithubIssueWorkspaceMapping({
        owner: issue.owner.toLowerCase(),
        repo: issue.repo.toLowerCase(),
        number: issue.number,
      });
      if (isCancelled()) return;

      if (mapping.mapping) {
        let existingWorkspace: VkWorkspace;
        try {
          existingWorkspace = await vkClient.getWorkspace(
            mapping.mapping.workspaceId,
          );
          if (isCancelled()) return;
        } catch (error) {
          if (isCancelled()) return;
          if (!isNotFoundError(error)) {
            throw error;
          }
          setDialog({
            type: "stale-issue-mapping",
            issue,
            workspaceId: mapping.mapping.workspaceId,
          });
          return;
        }

        const openLocation = findOpenWorkspaceLocation(
          latestRuntimeRef.current.workspace,
          existingWorkspace.id,
        );
        if (!existingWorkspace.archived) {
          setDialog({
            type: "existing-issue-workspace",
            workspace: existingWorkspace,
            issue,
            ...(openLocation ? { openLocation } : {}),
          });
          return;
        }

        if (existingWorkspace.archived) {
          setDialog({
            type: "confirm-reopen-archived",
            workspace: existingWorkspace,
            issue,
          });
          return;
        }

        chooseVoyageForTarget({
          type: "existing-issue",
          workspace: existingWorkspace,
          issue,
        });
        return;
      }

      await showCreateIssueOptions(issue, isCancelled);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not open GitHub issue",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while resolving GitHub issue.",
      });
      clearParam();
    }
  };

  const findOrEnsureIssueRepo = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
  ) => {
    const repos = await vkClient.getRepos();
    if (isCancelled()) return [];
    const remoteResults = await Promise.allSettled(
      repos.map(async (repo) => ({
        repoId: repo.id,
        remotes: await vkClient.getRepoRemotes(repo.id),
      })),
    );
    const remotesByRepoId = new Map(
      remoteResults.flatMap((result) =>
        result.status === "fulfilled"
          ? [[result.value.repoId, result.value.remotes] as const]
          : [],
      ),
    );
    if (isCancelled()) return [];
    const matches = findMatchingRepoRemotes(repos, remotesByRepoId, issue);
    if (matches.length > 0) return matches;

    setDialog({ type: "choose-clone-intent", target: { type: "issue", issue } });
    return null;
  };

  const showCreateIssueOptions = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
    duplicateConfirmed = false,
  ) => {
    const matches = await findOrEnsureIssueRepo(issue, isCancelled);
    if (isCancelled()) return;
    if (matches === null) return;
    if (matches.length === 1 && matches[0]) {
      chooseVoyageForTarget({
        type: "create-issue",
        match: matches[0],
        issue,
        duplicateConfirmed,
      });
      return;
    }

    if (matches.length > 1) {
      setDialog({
        type: "choose-repo",
        target: { type: "issue", issue, duplicateConfirmed },
        matches,
      });
      return;
    }

    setDialog({
      type: "error",
      title: "Could not open GitHub issue",
      message: `No matching repository found for ${issue.normalizedRepo}.`,
    });
    clearParam();
  };

  const forgetStaleIssueMappingAndCreateReplacement = async (
    issue: ParsedGithubIssueUrl,
  ) => {
    const isCancelled = () => {
      if (!mountedRef.current) return true;
      const requestedUrl = getOpenFromGithubUrl(
        latestRuntimeRef.current.location.search,
      );
      const parsed = requestedUrl ? parseGithubOpenUrl(requestedUrl) : null;
      return (
        parsed?.type !== "issue" ||
        parsed.issue.normalizedIssueUrl !== issue.normalizedIssueUrl
      );
    };

    setDialog({
      type: "processing",
      title: "Repairing GitHub issue mapping",
      message: `Forgetting stale workspace mapping for ${issue.normalizedIssueUrl}`,
    });

    try {
      await vkClient.deleteGithubIssueWorkspaceMapping({
        owner: issue.owner.toLowerCase(),
        repo: issue.repo.toLowerCase(),
        number: issue.number,
      });
      if (isCancelled()) return;
      await showCreateIssueOptions(issue, isCancelled);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not repair GitHub issue mapping",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while repairing GitHub issue mapping.",
      });
      clearParam();
    }
  };

  const runTreeBlobOpen = async (
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub URL",
      message: `Resolving ${target.normalizedUrl}`,
    });

    try {
      const matches = await findOrEnsureTreeBlobRepo(target, isCancelled);
      if (isCancelled()) return;
      if (matches === null) return;

      if (matches.length === 1 && matches[0]) {
        await resolveTreeBlobMatch(matches[0], target, isCancelled);
        return;
      }

      if (matches.length > 1) {
        setDialog({
          type: "choose-repo",
          target: { type: "tree-blob", target },
          matches,
        });
        return;
      }

      setDialog({
        type: "error",
        title: "Could not open GitHub URL",
        message: `No matching repository found for ${target.normalizedRepo}.`,
      });
      clearParam();
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not open GitHub URL",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while resolving GitHub URL.",
      });
      clearParam();
    }
  };

  const findOrEnsureTreeBlobRepo = async (
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    const repos = await vkClient.getRepos();
    if (isCancelled()) return [];
    const remoteResults = await Promise.allSettled(
      repos.map(async (repo) => ({
        repoId: repo.id,
        remotes: await vkClient.getRepoRemotes(repo.id),
      })),
    );
    const remotesByRepoId = new Map(
      remoteResults.flatMap((result) =>
        result.status === "fulfilled"
          ? [[result.value.repoId, result.value.remotes] as const]
          : [],
      ),
    );
    if (isCancelled()) return [];
    const matches = findMatchingRepoRemotes(repos, remotesByRepoId, target);
    if (matches.length > 0) return matches;

    setDialog({
      type: "choose-clone-intent",
      target: { type: "tree-blob", target },
    });
    return null;
  };

  const resolveTreeBlobMatch = async (
    match: MatchingRepoRemote,
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub URL",
      message: `Resolving branch/ref for ${target.normalizedUrl}`,
    });

    let branches: Awaited<ReturnType<typeof vkClient.getRepoBranches>>;
    try {
      branches = await vkClient.getRepoBranches(match.repo.id);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not load repository branches",
        message:
          error instanceof Error
            ? `Could not load branches for ${match.repo.display_name || match.repo.name}. Fetch/register the repo and try again. ${error.message}`
            : `Could not load branches for ${match.repo.display_name || match.repo.name}. Fetch/register the repo and try again.`,
      });
      clearParam();
      return;
    }
    if (isCancelled()) return;

    if (target.kind === "tree" && target.segments.length === 0) {
      const preferredBranch = selectPreferredRemoteBranch(
        branches.map((branch) => branch.name),
        match.repo.default_target_branch,
        match.remote.name,
      );
      if (preferredBranch) {
        chooseVoyageForTarget({
            type: "create-tree-blob",
            match,
            target: {
              kind: "tree",
              owner: target.owner,
              repo: target.repo,
              normalizedRepo: target.normalizedRepo,
              ref: getGithubRefForTargetBranchName(
                preferredBranch,
                match.remote.name,
              ),
              path: null,
              normalizedUrl: target.normalizedUrl,
              permalinkCommit: null,
            },
          targetBranch: preferredBranch,
        });
        return;
      }
    }

    const branchResult = resolveGithubTreeBlobBranch(
      target,
      branches,
      match.remote.name,
    );
    if (branchResult) {
      chooseVoyageForTarget({
          type: "create-tree-blob",
          match,
          target: branchResult.resolved,
        targetBranch: branchResult.targetBranch,
      });
      return;
    }

    const commitTarget = resolveGithubTreeBlobCommitTarget(target);
    if (!commitTarget?.permalinkCommit) {
      setDialog({
        type: "error",
        title: "Unsupported GitHub ref",
        message: `Could not resolve ${target.normalizedUrl} to a fetched branch. Tags and missing refs are unsupported unless they appear in the VK branch list. Fetch the repo or choose a branch URL and try again.`,
      });
      clearParam();
      return;
    }

    let containingBranches: string[];
    try {
      containingBranches = (
        await vkClient.getGitBranchesContainingCommit({
          repoId: match.repo.id,
          commit: commitTarget.permalinkCommit,
        })
      ).branches;
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not resolve commit permalink",
        message:
          error instanceof Error
            ? `Could not find branches containing ${commitTarget.permalinkCommit}. Fetch the repo and verify the commit exists, then try again. ${error.message}`
            : `Could not find branches containing ${commitTarget.permalinkCommit}. Fetch the repo and verify the commit exists, then try again.`,
      });
      clearParam();
      return;
    }
    if (isCancelled()) return;

    const bestBranch = chooseBestContainingBranch(
      containingBranches,
      match.repo.default_target_branch,
      match.remote.name,
    );
    if (bestBranch) {
      chooseVoyageForTarget({
          type: "create-tree-blob",
          match,
          target: commitTarget,
        targetBranch: bestBranch,
      });
      return;
    }

    const availableBranches = (
      containingBranches.length
        ? containingBranches
        : branches.map((branch) => branch.name)
    ).filter((branch) =>
      branchBelongsToRemoteOrLocal(branch, match.remote.name),
    );
    if (availableBranches.length === 0) {
      setDialog({
        type: "error",
        title: "No branch base available",
        message: `No branch containing ${commitTarget.permalinkCommit} was found, and no repository branches could be loaded to choose a base manually. Fetch the repo and try again.`,
      });
      clearParam();
      return;
    }

    setDialog({
      type: "choose-branch",
      match,
      target: commitTarget,
      branches: availableBranches,
      message: containingBranches.length
        ? `Commit ${commitTarget.permalinkCommit} is contained in multiple branches. Choose the branch to use as the base for a new VK workspace branch.`
        : `No branch containing ${commitTarget.permalinkCommit} was found. Choose an available branch to use as the base for a new VK workspace branch, or cancel and fetch the repo first.`,
    });
  };

  useEffect(() => {
    if (!requestedUrl) {
      processedUrlRef.current = null;
      return;
    }
    if (processedUrlRef.current === requestedUrl) return;
    processedUrlRef.current = requestedUrl;

    let cancelled = false;

    const run = async () => {
      const parsedOpenUrl = parseGithubOpenUrl(requestedUrl);
      if (!parsedOpenUrl) {
        setDialog({
          type: "error",
          title: "Unsupported GitHub URL",
          message:
            "Only GitHub pull request, issue, repo root, tree, and blob URLs are supported for external_view_url.",
        });
        clearParam();
        return;
      }

      if (parsedOpenUrl.type === "issue") {
        await runIssueOpen(parsedOpenUrl.issue, () => cancelled);
        return;
      }

      if (parsedOpenUrl.type === "tree-blob") {
        await runTreeBlobOpen(parsedOpenUrl.target, () => cancelled);
        return;
      }

      const parsedPr = parsedOpenUrl.pr;

      setDialog({
        type: "processing",
        title: "Opening GitHub PR",
        message: `Resolving ${parsedPr.normalizedPrUrl}`,
      });

      try {
        const prInfo = await vkClient.getPrInfo(parsedPr.normalizedPrUrl);
        if (cancelled) return;
        const [activeSummaries, archivedSummaries] = await Promise.all([
          vkClient.getWorkspaceSummaries(false),
          vkClient.getWorkspaceSummaries(true),
        ]);
        const existingWorkspaceIds = findWorkspaceIdsForPr(
          [...activeSummaries.summaries, ...archivedSummaries.summaries],
          parsedPr,
          prInfo,
        );

        if (cancelled) return;

        if (existingWorkspaceIds.length > 1) {
          const summaries = [...activeSummaries.summaries, ...archivedSummaries.summaries];
          const existingWorkspaces = await Promise.all(
            existingWorkspaceIds.map((id) => vkClient.getWorkspace(id)),
          );
          if (cancelled) return;
          setDialog({
            type: "choose-pr-workspace",
            candidates: existingWorkspaces
              .sort((left, right) => Number(left.archived) - Number(right.archived))
              .map((workspace) => ({
                workspace,
                summary: summaries.find((entry) => entry.workspace_id === workspace.id),
              })),
            prInfo,
          });
          return;
        }

        const existingWorkspaceId = existingWorkspaceIds[0];
        if (existingWorkspaceId) {
          const openLocation = findOpenWorkspaceLocation(
            latestRuntimeRef.current.workspace,
            existingWorkspaceId,
          );
          if (openLocation) {
            routeExistingLocation({
              openLocation,
              title: "Open existing PR workspace?",
              message: `PR #${prInfo.number}: ${prInfo.title} is already open in multiple Voyages. Choose which one to open.`,
            });
            return;
          }

          const existingWorkspace =
            await vkClient.getWorkspace(existingWorkspaceId);
          if (cancelled) return;
          chooseVoyageForTarget({
            type: "existing",
            workspace: existingWorkspace,
            prInfo,
          });
          return;
        }

        const repos = await vkClient.getRepos();
        if (cancelled) return;
        const remoteResults = await Promise.allSettled(
          repos.map(async (repo) => ({
            repoId: repo.id,
            remotes: await vkClient.getRepoRemotes(repo.id),
          })),
        );
        const remotesByRepoId = new Map(
          remoteResults.flatMap((result) =>
            result.status === "fulfilled"
              ? [[result.value.repoId, result.value.remotes] as const]
              : [],
          ),
        );
        const matches = findMatchingRepoRemotes(
          repos,
          remotesByRepoId,
          parsedPr,
        );

        if (cancelled) return;

        if (matches.length === 0) {
          setDialog({
            type: "choose-clone-intent",
            target: { type: "pr", parsed: parsedPr, prInfo },
          });
          return;
        }

        if (matches.length === 1) {
          const [match] = matches;
          if (!match) return;
          chooseVoyageForTarget({ type: "create", match, prInfo });
          return;
        }

        setDialog({
          type: "choose-repo",
          target: { type: "pr", prInfo },
          matches,
        });
      } catch (error) {
        if (cancelled) return;
        setDialog({
          type: "error",
          title: "Could not open GitHub PR",
          message:
            error instanceof Error
              ? error.message
              : "Unknown error while resolving GitHub PR.",
        });
        clearParam();
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [requestedUrl]);

  return (
    <OpenFromGithubDialog
      state={dialog}
      workspace={workspace}
      savedVoyages={savedVoyages}
      onClose={() => {
        setDialog(null);
        clearParam();
      }}
      onSelectRepo={(match) => {
        if (dialog?.type !== "choose-repo") return;
        if (dialog.target.type === "pr") {
          chooseVoyageForTarget({
            type: "create",
            match,
            prInfo: dialog.target.prInfo,
          });
          return;
        }
        if (dialog.target.type === "issue") {
          chooseVoyageForTarget({
            type: "create-issue",
            match,
            issue: dialog.target.issue,
            duplicateConfirmed: dialog.target.duplicateConfirmed,
          });
          return;
        }
        const treeBlobTarget = dialog.target.target;
        void resolveTreeBlobMatch(match, treeBlobTarget, () => {
          const requestedUrl = getOpenFromGithubUrl(
            latestRuntimeRef.current.location.search,
          );
          const parsed = requestedUrl ? parseGithubOpenUrl(requestedUrl) : null;
          return (
            !mountedRef.current ||
            parsed?.type !== "tree-blob" ||
            parsed.target.normalizedUrl !== treeBlobTarget.normalizedUrl
          );
        });
      }}
      onSelectPrWorkspace={(selectedWorkspace) => {
        if (dialog?.type !== "choose-pr-workspace") return;
        chooseVoyageForTarget({
          type: "existing",
          workspace: selectedWorkspace,
          prInfo: dialog.prInfo,
        });
      }}
      onSelectCloneIntent={(intent) => {
        if (dialog?.type !== "choose-clone-intent") return;
        void chooseCloneIntent(dialog.target, intent);
      }}
      onSelectFork={(fork) => {
        if (dialog?.type !== "choose-fork") return;
        void finishProvisionedTarget(
          dialog.target,
          `https://github.com/${fork.fullName}`,
          dialog.sourceRepoUrl,
        );
      }}
      onRecheckFork={() => {
        if (dialog?.type !== "await-fork") return;
        void chooseCloneIntent(dialog.target, "changes");
      }}
      onSelectBranch={(branch) => {
        if (dialog?.type !== "choose-branch") return;
        chooseVoyageForTarget({
            type: "create-tree-blob",
            match: dialog.match,
            target: dialog.target,
          targetBranch: branch,
        });
      }}
      onConfirmWorkMode={({ branch, createBranch, workspaceName }) => {
        if (dialog?.type !== "choose-work-mode") return;
        const configuredDefault = getRemoteDefaultBranch(
          dialog.target.match.repo.default_target_branch,
          dialog.target.match.remote.name,
        ) ?? `${dialog.target.match.remote.name}/main`;
        const target = {
          ...dialog.target,
          targetBranch: createBranch ? branch : configuredDefault,
          checkoutBranch: createBranch ? undefined : branch,
          createBranch,
          workspaceName,
        };
        chooseVoyageForTarget(target);
      }}
      onSelectVoyage={(choice) => {
        void selectVoyageForDialog(choice);
      }}
      onConfirmReopenArchived={() => {
        if (dialog?.type !== "confirm-reopen-archived") return;
        chooseVoyageForTarget({
          type: "existing-issue",
          workspace: dialog.workspace,
          issue: dialog.issue,
        });
      }}
      onForgetStaleIssueMapping={() => {
        if (dialog?.type !== "stale-issue-mapping") return;
        void forgetStaleIssueMappingAndCreateReplacement(dialog.issue);
      }}
      onOpenExistingIssueWorkspace={() => {
        if (dialog?.type !== "existing-issue-workspace") return;
        if (dialog.openLocation) {
          routeExistingLocation({
            openLocation: dialog.openLocation,
            title: "Open existing issue workspace?",
            message: `GitHub issue ${dialog.issue.normalizedIssueUrl} is already open in multiple Voyages. Choose which one to open.`,
          });
          return;
        }
        chooseVoyageForTarget({
          type: "existing-issue",
          workspace: dialog.workspace,
          issue: dialog.issue,
        });
      }}
      onCreateDuplicateIssueWorkspace={() => {
        if (dialog?.type !== "existing-issue-workspace") return;
        const issue = dialog.issue;
        void showCreateIssueOptions(
          issue,
          () => {
            if (!mountedRef.current) return true;
            const requestedUrl = getOpenFromGithubUrl(
              latestRuntimeRef.current.location.search,
            );
            const parsed = requestedUrl ? parseGithubOpenUrl(requestedUrl) : null;
            return (
              parsed?.type !== "issue" ||
              parsed.issue.normalizedIssueUrl !== issue.normalizedIssueUrl
            );
          },
          true,
        );
      }}
      onSelectAssociatedPr={(url) => {
        const runtime = latestRuntimeRef.current;
        const params = new URLSearchParams(runtime.location.search);
        params.set("external_view_url", url);
        processedUrlRef.current = null;
        runtime.navigate(`${runtime.location.pathname}?${params.toString()}`, {
          replace: true,
        });
      }}
      onContinueIssue={() => {
        if (dialog?.type !== "choose-associated-pr") return;
        void runIssueOpen(dialog.issue, () => !mountedRef.current, false);
      }}
      onCreateVoyage={(name) => {
        void createVoyageForDialog(name);
      }}
    />
  );
}

function findSavedVoyagesForTabGroup(
  savedVoyages: SavedWorkspaceSession[],
  tabGroupId: string,
  _workspace?: WorkspaceState,
): ExistingVoyageChoice[] {
  return savedVoyages
    .flatMap((savedVoyage) => {
      const matchingEntries = savedVoyage.voyageEntries.filter(
        (entry) => entry.tabGroupId === tabGroupId,
      );
      if (!matchingEntries.length) return [];
      const activeMatchingEntry = matchingEntries.find(
        (entry) => entry.id === savedVoyage.activeVoyageEntryId,
      );
      const entry = activeMatchingEntry || matchingEntries[0];
      return entry ? [{ savedVoyage, voyageEntryId: entry.id }] : [];
    })
    .sort(
      (a, b) =>
        Date.parse(b.savedVoyage.updatedAt) - Date.parse(a.savedVoyage.updatedAt),
    );
}

function getRecentVoyageChoices(
  savedVoyages: SavedWorkspaceSession[],
): ExistingVoyageChoice[] {
  return [...savedVoyages]
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .map((savedVoyage) => ({
      savedVoyage,
      voyageEntryId: savedVoyage.activeVoyageEntryId,
    }));
}

function formatVoyageTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

class StaleOpenFromGithubRunError extends Error {
  constructor() {
    super("Stale external_view_url run");
    this.name = "StaleOpenFromGithubRunError";
  }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status?: unknown }).status === 404,
  );
}

function getGithubRefForTargetBranchName(
  branchName: string,
  remoteName: string,
): string {
  return branchName.startsWith(`${remoteName}/`)
    ? branchName.slice(remoteName.length + 1)
    : branchName;
}

function isSameOpenTarget(
  target: PendingTarget,
  requestedUrl: string | null,
): boolean {
  if (!requestedUrl) return false;
  const parsed = parseGithubOpenUrl(requestedUrl);
  if (!parsed) return false;

  if (target.type === "existing" || target.type === "create") {
    const prUrl = target.prInfo.url || target.prInfo.number.toString();
    const parsedTarget = parseGithubOpenUrl(prUrl);
    return (
      parsed.type === "pr" &&
      parsedTarget?.type === "pr" &&
      parsed.pr.normalizedPrUrl === parsedTarget.pr.normalizedPrUrl
    );
  }

  if (target.type === "create-tree-blob") {
    return (
      parsed.type === "tree-blob" &&
      parsed.target.normalizedUrl === target.target.normalizedUrl
    );
  }

  return (
    parsed.type === "issue" &&
    parsed.issue.normalizedIssueUrl === target.issue.normalizedIssueUrl
  );
}

function getTargetTitle(target: PendingTarget): string {
  if (target.type === "existing" || target.type === "create") {
    return target.prInfo.title;
  }
  if (target.type === "create-tree-blob") {
    return `${target.target.kind} ${target.target.ref}`;
  }
  return `issue #${target.issue.number}`;
}

function getTargetVerb(target: PendingTarget): string {
  if (target.type === "create-tree-blob") return "Open GitHub URL";
  return target.type.endsWith("issue") ? "Open GitHub issue" : "Open GitHub PR";
}

async function getIssueTargetBranch(match: MatchingRepoRemote): Promise<string> {
  const fallback = getRemoteDefaultBranch(
    match.repo.default_target_branch,
    match.remote.name,
  ) ?? `${match.remote.name}/main`;

  let branches: Awaited<ReturnType<typeof vkClient.getRepoBranches>>;
  try {
    branches = await vkClient.getRepoBranches(match.repo.id);
  } catch {
    // If branch discovery fails, keep issue provisioning usable by falling back
    // to the backend's configured repo default, scoped to the matched remote.
    return fallback;
  }

  const selected = selectPreferredRemoteBranch(
    branches.map((branch) => branch.name),
    match.repo.default_target_branch,
    match.remote.name,
  );
  if (selected) {
    return selected;
  }

  throw new Error(
    `Could not find ${fallback} or ${match.remote.name}/main in fetched branches for ${match.repo.display_name || match.repo.name}. ` +
      `Fetch ${match.remote.name} and try again.`,
  );
}

type OpenFromGithubDialogProps = {
  state: DialogState;
  workspace: WorkspaceState;
  savedVoyages: SavedWorkspaceSession[];
  onClose: () => void;
  onSelectRepo: (match: MatchingRepoRemote) => void;
  onSelectPrWorkspace: (workspace: VkWorkspace) => void;
  onSelectCloneIntent: (intent: "analysis" | "changes") => void;
  onSelectFork: (fork: { fullName: string; cloneUrl: string }) => void;
  onRecheckFork: () => void;
  onSelectVoyage: (choice: ExistingVoyageChoice) => void;
  onSelectBranch: (branch: string) => void;
  onConfirmWorkMode: (args: {
    branch: string;
    createBranch: boolean;
    workspaceName: string;
  }) => void;
  onCreateVoyage: (name: string) => void;
  onConfirmReopenArchived: () => void;
  onForgetStaleIssueMapping: () => void;
  onOpenExistingIssueWorkspace: () => void;
  onCreateDuplicateIssueWorkspace: () => void;
  onSelectAssociatedPr: (url: string) => void;
  onContinueIssue: () => void;
};

type WizardStageView = {
  title: string;
  message: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
  closeLabel?: string;
};

type BranchChoiceViewModel = {
  workModeBranch: string;
  createWorkBranch: boolean;
  branchProtectionStatus: "protected" | "unprotected" | "unknown";
  workspaceName: string;
  setCreateWorkBranch: (value: boolean) => void;
  setWorkspaceName: (value: string) => void;
  selectWorkModeBranch: (branch: string) => Promise<void>;
};

function OpenFromGithubDialog(props: OpenFromGithubDialogProps) {
  const { state, onClose } = props;
  const [newVoyageName, setNewVoyageName] = useState("");
  const [workModeBranch, setWorkModeBranch] = useState("");
  const [createWorkBranch, setCreateWorkBranch] = useState(true);
  const [branchProtectionStatus, setBranchProtectionStatus] = useState<
    "protected" | "unprotected" | "unknown"
  >("unknown");
  const [workspaceName, setWorkspaceName] = useState("");
  const branchProtectionRequestRef = useRef(0);

  useEffect(() => {
    if (state?.type !== "choose-work-mode") return;
    setWorkModeBranch(state.selectedBranch);
    setCreateWorkBranch(state.defaultCreateBranch);
    setBranchProtectionStatus(state.protectionStatus);
    setWorkspaceName(
      state.target.type === "create-issue"
        ? `Issue #${state.target.issue.number}`
        : `GitHub ${state.target.target.kind} ${state.target.target.ref}`,
    );
    setNewVoyageName(props.savedVoyages.length ? "" : "GitHub work");
  }, [state, props.savedVoyages.length]);

  if (!state) return null;

  const selectWorkModeBranch = async (branch: string) => {
    const request = ++branchProtectionRequestRef.current;
    setWorkModeBranch(branch);
    setCreateWorkBranch(true);
    setBranchProtectionStatus("unknown");
    if (state.type !== "choose-work-mode") return;
    const configuredDefault = getRemoteDefaultBranch(
      state.target.match.repo.default_target_branch,
      state.target.match.remote.name,
    );
    const protectionStatus = await vkClient
      .getGithubBranchProtection(
        state.target.match.remote.url,
        getGithubRefForTargetBranchName(branch, state.target.match.remote.name),
      )
      .then((result) => result.protected ? "protected" as const : "unprotected" as const)
      .catch(() => "unknown" as const);
    if (request !== branchProtectionRequestRef.current) return;
    setBranchProtectionStatus(protectionStatus);
    setCreateWorkBranch(
      branch === configuredDefault ||
        branch === `${state.target.match.remote.name}/main` ||
        protectionStatus !== "unprotected",
    );
  };

  const stage = buildOpenFromGithubStage({
    ...props,
    state,
    newVoyageName,
    setNewVoyageName,
    branchChoice: state.type === "choose-work-mode" ? {
      workModeBranch,
      createWorkBranch,
      branchProtectionStatus,
      workspaceName,
      setCreateWorkBranch,
      setWorkspaceName,
      selectWorkModeBranch,
    } : undefined,
  });

  return (
    <DialogFrame
      title={stage.title}
      message={stage.message}
      actions={stage.actions}
      closeLabel={stage.closeLabel}
      onClose={onClose}
    >
      {stage.body}
    </DialogFrame>
  );
}

type BuildOpenFromGithubStageArgs = Omit<OpenFromGithubDialogProps, "state"> & {
  state: NonNullable<DialogState>;
  newVoyageName: string;
  setNewVoyageName: (value: string) => void;
  branchChoice?: BranchChoiceViewModel;
};

function buildOpenFromGithubStage(args: BuildOpenFromGithubStageArgs): WizardStageView {
  const { state } = args;
  switch (state.type) {
    case "processing":
    case "opening":
      return { title: state.title, message: state.message, body: <RunningStage /> };
    case "error":
      return { title: state.title, message: state.message, body: <ErrorStage message={state.message} />, closeLabel: "Close" };
    case "choose-repo":
      return { title: "Choose repository", message: repositoryChoiceMessage(state), body: <RepositoryChoiceStage state={state} onSelectRepo={args.onSelectRepo} /> };
    case "choose-pr-workspace":
      return {
        title: "Choose PR workspace",
        message: `Multiple workspaces match PR #${state.prInfo.number}. Choose the workspace to open.`,
        body: <ExistingPrWorkspaceStage state={state} workspace={args.workspace} savedVoyages={args.savedVoyages} onSelectPrWorkspace={args.onSelectPrWorkspace} />,
      };
    case "choose-clone-intent":
      return {
        title: "Would you like to fork or just clone this repository?",
        message: "This only shows for new repositories that haven't been cloned on this machine yet.",
        body: <RepositoryAccessStage onSelectCloneIntent={args.onSelectCloneIntent} />,
      };
    case "choose-fork":
      return { title: "Choose a writable fork", message: "Several writable forks are available to your authenticated gh CLI account.", body: <ForkChoiceStage state={state} onSelectFork={args.onSelectFork} /> };
    case "await-fork":
      return {
        title: "Create a GitHub fork",
        message: `No writable fork was found for ${state.viewer}. Create one on GitHub, then return to this window. VD rechecks automatically on focus.`,
        body: <AwaitForkStage state={state} onRecheckFork={args.onRecheckFork} onSelectCloneIntent={args.onSelectCloneIntent} />,
      };
    case "choose-associated-pr":
      return {
        title: "Related pull request found",
        message: `Issue #${state.issue.number} has related pull request work. Choose a PR or continue with the issue.`,
        body: <AssociatedPrStage state={state} onSelectAssociatedPr={args.onSelectAssociatedPr} onContinueIssue={args.onContinueIssue} />,
      };
    case "choose-work-mode":
      if (!args.branchChoice) throw new Error("Branch choice state is required.");
      return {
        title: "How should this workspace work?",
        message: "Choose a branch. Non-default, unprotected branches default to working on the selected branch. Protected, default, or unknown-protection branches default to a new editable workspace branch.",
        body: <BranchChoiceStage state={state} branchChoice={args.branchChoice} onConfirmWorkMode={args.onConfirmWorkMode} />,
      };
    case "choose-branch":
      return { title: "Choose branch base", message: state.message, body: <BranchBaseStage state={state} onSelectBranch={args.onSelectBranch} /> };
    case "confirm-reopen-archived":
      return {
        title: "Reopen archived issue workspace?",
        message: `GitHub issue ${state.issue.normalizedIssueUrl} is mapped to archived workspace ${state.workspace.name || state.workspace.branch}. Reopen and unarchive it instead of creating a duplicate branch?`,
        body: <ReopenArchivedStage state={state} />,
        actions: <StageButton tone="warning" onClick={args.onConfirmReopenArchived}>Reopen workspace</StageButton>,
      };
    case "stale-issue-mapping":
      return {
        title: "Issue workspace no longer exists",
        message: `GitHub issue ${state.issue.normalizedIssueUrl} was mapped to deleted workspace ${state.workspaceId}. Forget the stale mapping before creating a replacement workspace.`,
        body: <StaleIssueMappingStage />,
        actions: <StageButton tone="warning" onClick={args.onForgetStaleIssueMapping}>Forget mapping and create replacement</StageButton>,
      };
    case "existing-issue-workspace":
      return {
        title: "Existing issue workspace found",
        message: `GitHub issue ${state.issue.normalizedIssueUrl} already has an active workspace. Open it, or explicitly create a separate workspace.`,
        body: <ExistingIssueWorkspaceStage state={state} />,
        actions: (
          <>
            <StageButton tone="secondary" onClick={args.onCreateDuplicateIssueWorkspace}>Create new workspace instead</StageButton>
            <StageButton tone="primary" onClick={args.onOpenExistingIssueWorkspace}>Open existing workspace</StageButton>
          </>
        ),
      };
    case "choose-voyage":
      return {
        title: state.title,
        message: state.message,
        body: <VoyageStage state={state} newVoyageName={args.newVoyageName} setNewVoyageName={args.setNewVoyageName} onSelectVoyage={args.onSelectVoyage} onCreateVoyage={args.onCreateVoyage} />,
      };
  }
}

function DialogFrame({ title, message, children, actions, closeLabel, onClose }: {
  title: string;
  message: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  closeLabel?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-5 text-neutral-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-neutral-400">{message}</p>
        </div>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          {actions}
          <button type="button" className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700" onClick={onClose}>
            {closeLabel || "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StageButton({ tone, onClick, children }: { tone: "primary" | "secondary" | "warning"; onClick: () => void; children: React.ReactNode }) {
  const className = tone === "primary"
    ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
    : tone === "warning"
      ? "rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/30"
      : "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700";
  return <button type="button" className={className} onClick={onClick}>{children}</button>;
}

function repositoryChoiceMessage(state: Extract<DialogState, { type: "choose-repo" }>): string {
  if (state.target.type === "pr") return `Multiple VK repos match PR #${state.target.prInfo.number}: ${state.target.prInfo.title}`;
  if (state.target.type === "issue") return `Multiple VK repos match issue #${state.target.issue.number}: ${state.target.issue.normalizedIssueUrl}`;
  return `Multiple VK repos match ${state.target.target.normalizedUrl}`;
}

function RunningStage() {
  return <div className="py-6 text-sm text-neutral-300">Working…</div>;
}

function ErrorStage({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{message}</div>;
}

function RepositoryChoiceStage({ state, onSelectRepo }: { state: Extract<DialogState, { type: "choose-repo" }>; onSelectRepo: (match: MatchingRepoRemote) => void }) {
  return <div className="space-y-2">{state.matches.map((match) => <button key={`${match.repo.id}:${match.remote.name}`} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700" onClick={() => onSelectRepo(match)}><div className="text-sm font-medium text-white">{match.repo.display_name || match.repo.name}</div><div className="mt-1 text-xs text-neutral-400">{match.remote.name} · {match.remote.url}</div></button>)}</div>;
}

function ExistingPrWorkspaceStage({ state, workspace, savedVoyages, onSelectPrWorkspace }: { state: Extract<DialogState, { type: "choose-pr-workspace" }>; workspace: WorkspaceState; savedVoyages: SavedWorkspaceSession[]; onSelectPrWorkspace: (workspace: VkWorkspace) => void }) {
  return (
    <div className="space-y-2">
      {state.candidates.map(({ workspace: candidate, summary }) => {
        const openLocation = findOpenWorkspaceLocation(workspace, candidate.id);
        const voyageNames = openLocation ? findSavedVoyagesForTabGroup(savedVoyages, openLocation.tabGroupId).map((choice) => choice.savedVoyage.name) : [];
        return <button key={candidate.id} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700" onClick={() => onSelectPrWorkspace(candidate)}><div className="text-sm font-medium text-white">{candidate.name || candidate.branch}</div><div className="mt-1 text-xs text-neutral-400">{candidate.archived ? "Archived" : "Active"} · {candidate.branch}</div><div className="mt-1 text-xs text-neutral-500">Updated {formatVoyageTimestamp(candidate.updated_at)}{summary?.latest_process_status ? ` · ${summary.latest_process_status}` : ""}{voyageNames.length ? ` · ${voyageNames.join(", ")}` : ""}</div></button>;
      })}
    </div>
  );
}

function RepositoryAccessStage({ onSelectCloneIntent }: { onSelectCloneIntent: (intent: "analysis" | "changes") => void }) {
  return <div className="space-y-2"><button type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectCloneIntent("changes")}><div className="text-sm font-medium text-white">Fork</div><div className="mt-1 text-xs text-neutral-400">This allows you to make changes and push to GitHub.</div></button><button type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectCloneIntent("analysis")}><div className="text-sm font-medium text-white">Clone without fork</div><div className="mt-1 text-xs text-neutral-400">This is useful for general analysis of the code and local-only development. You can always fork later if you decide you want to push changes.</div></button></div>;
}

function ForkChoiceStage({ state, onSelectFork }: { state: Extract<DialogState, { type: "choose-fork" }>; onSelectFork: (fork: { fullName: string; cloneUrl: string }) => void }) {
  return <div className="space-y-2">{state.forks.map((fork) => <button key={fork.fullName} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectFork(fork)}><div className="text-sm font-medium text-white">{fork.fullName}</div></button>)}</div>;
}

function AwaitForkStage({ state, onRecheckFork, onSelectCloneIntent }: { state: Extract<DialogState, { type: "await-fork" }>; onRecheckFork: () => void; onSelectCloneIntent: (intent: "analysis" | "changes") => void }) {
  return <div className="space-y-2"><a href={state.forkUrl} target="_blank" rel="noreferrer" className="block w-full rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-500">Open GitHub fork page</a><button type="button" className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-white hover:bg-neutral-800" onClick={onRecheckFork}>Check again</button><button type="button" className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={() => onSelectCloneIntent("analysis")}>Continue as analysis only</button></div>;
}

function AssociatedPrStage({ state, onSelectAssociatedPr, onContinueIssue }: { state: Extract<DialogState, { type: "choose-associated-pr" }>; onSelectAssociatedPr: (url: string) => void; onContinueIssue: () => void }) {
  return <div className="space-y-2">{state.pullRequests.map((pr) => <button key={pr.url} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectAssociatedPr(pr.url)}><div className="text-sm font-medium text-white">PR #{pr.number}: {pr.title}</div><div className="mt-1 text-xs uppercase text-neutral-400">{pr.state}</div></button>)}<button type="button" className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={onContinueIssue}>Continue with issue #{state.issue.number}</button></div>;
}

function BranchChoiceStage({ state, branchChoice, onConfirmWorkMode }: { state: Extract<DialogState, { type: "choose-work-mode" }>; branchChoice: BranchChoiceViewModel; onConfirmWorkMode: (args: { branch: string; createBranch: boolean; workspaceName: string }) => void }) {
  const selectedWorkModeBranch = state.branches.find((branch) => branch.name === branchChoice.workModeBranch);
  const selectedBranchIsRemote = selectedWorkModeBranch?.is_remote === true;
  return (
    <div className="space-y-3">
      <label className="block text-sm text-neutral-300">Branch<select value={branchChoice.workModeBranch} onChange={(event) => void branchChoice.selectWorkModeBranch(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white">{state.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select></label>
      <div className="grid gap-2 sm:grid-cols-2"><button type="button" aria-pressed={!branchChoice.createWorkBranch} className={`rounded-lg border p-3 text-left ${!branchChoice.createWorkBranch ? "border-blue-500 bg-blue-500/10" : "border-neutral-700 bg-neutral-800"}`} onClick={() => branchChoice.setCreateWorkBranch(false)}><div className="text-sm font-medium text-white">Work on selected branch</div><div className="mt-1 text-xs text-neutral-400">{selectedBranchIsRemote ? `Create a local tracking branch for ${branchChoice.workModeBranch}, then work there.` : `Commit on ${branchChoice.workModeBranch}.`}</div></button><button type="button" aria-pressed={branchChoice.createWorkBranch} className={`rounded-lg border p-3 text-left ${branchChoice.createWorkBranch ? "border-blue-500 bg-blue-500/10" : "border-neutral-700 bg-neutral-800"}`} onClick={() => branchChoice.setCreateWorkBranch(true)}><div className="text-sm font-medium text-white">Create new workspace branch</div><div className="mt-1 text-xs text-neutral-400">Start an editable workspace branch from {branchChoice.workModeBranch}.</div></button></div>
      {branchChoice.branchProtectionStatus === "unknown" ? <div className="text-xs text-amber-300">Branch protection could not be verified. Creating a new branch is the safe default; working on the selected branch remains available when you choose it deliberately.</div> : null}
      {branchChoice.createWorkBranch ? <label className="block text-sm text-neutral-300">Suggested workspace branch name<input value={branchChoice.workspaceName} onChange={(event) => branchChoice.setWorkspaceName(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label> : null}
      <div className="rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-300"><div><span className="text-neutral-500">Repository:</span> {state.target.match.repo.display_name || state.target.match.repo.name}</div><div><span className="text-neutral-500">Remote:</span> {state.target.match.remote.name} ({state.target.match.remote.url})</div><div><span className="text-neutral-500">Checkout:</span> {branchChoice.createWorkBranch ? "new workspace branch" : branchChoice.workModeBranch}</div><div><span className="text-neutral-500">Base/target:</span> {branchChoice.createWorkBranch ? branchChoice.workModeBranch : getRemoteDefaultBranch(state.target.match.repo.default_target_branch, state.target.match.remote.name) || `${state.target.match.remote.name}/main`}</div></div>
      <button type="button" className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50" disabled={!branchChoice.workModeBranch || (branchChoice.createWorkBranch && !branchChoice.workspaceName.trim())} onClick={() => onConfirmWorkMode({ branch: branchChoice.workModeBranch, createBranch: branchChoice.createWorkBranch, workspaceName: branchChoice.workspaceName.trim() || `Selected ${branchChoice.workModeBranch}` })}>Continue</button>
    </div>
  );
}

function BranchBaseStage({ state, onSelectBranch }: { state: Extract<DialogState, { type: "choose-branch" }>; onSelectBranch: (branch: string) => void }) {
  return <div className="space-y-2">{state.branches.map((branch) => <button key={branch} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left font-mono text-sm text-white transition-colors hover:bg-neutral-700" onClick={() => onSelectBranch(branch)}>{branch}</button>)}</div>;
}

function ReopenArchivedStage({ state }: { state: Extract<DialogState, { type: "confirm-reopen-archived" }> }) {
  return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">Reopening will make the prior workspace active again and reuse branch <span className="font-mono">{state.workspace.branch}</span>.</div>;
}

function StaleIssueMappingStage() {
  return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">The previous workspace record is gone. Forgetting this mapping lets VD create and store a replacement issue workspace.</div>;
}

function ExistingIssueWorkspaceStage({ state }: { state: Extract<DialogState, { type: "existing-issue-workspace" }> }) {
  return <div className="space-y-3"><div className="rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-200"><div className="font-medium text-white">{state.workspace.name || state.workspace.branch}</div><div className="mt-1 text-xs text-neutral-400">Active · {state.workspace.branch}{state.openLocation ? " · already open in VD" : ""}</div></div><div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">Creating another workspace for the same issue is allowed only when you explicitly choose it here.</div></div>;
}

function VoyageStage({ state, newVoyageName, setNewVoyageName, onSelectVoyage, onCreateVoyage }: { state: Extract<DialogState, { type: "choose-voyage" }>; newVoyageName: string; setNewVoyageName: (value: string) => void; onSelectVoyage: (choice: ExistingVoyageChoice) => void; onCreateVoyage: (name: string) => void }) {
  return (
    <div className="space-y-4"><div className="space-y-2">{state.choices.length === 0 ? <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">No recently opened Voyages yet. Create one below.</div> : state.choices.map((choice) => <button key={`${choice.savedVoyage.id}:${choice.voyageEntryId || "active"}`} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700" onClick={() => onSelectVoyage(choice)}><div className="text-sm font-medium text-white">{choice.savedVoyage.name}</div><div className="mt-1 text-xs text-neutral-400">Updated {formatVoyageTimestamp(choice.savedVoyage.updatedAt)}</div></button>)}</div><div className="flex gap-2 border-t border-neutral-800 pt-4"><input className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500" placeholder="New Voyage name" value={newVoyageName} onChange={(event) => setNewVoyageName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && newVoyageName.trim()) { onCreateVoyage(newVoyageName.trim()); setNewVoyageName(""); } }} /><button type="button" disabled={!newVoyageName.trim()} className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { if (!newVoyageName.trim()) return; onCreateVoyage(newVoyageName.trim()); setNewVoyageName(""); }}>Create</button></div></div>
  );
}
