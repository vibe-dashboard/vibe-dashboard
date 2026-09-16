import { useCallback, useEffect, useState } from "react";
import { vkClient, type RepoWithBranch, type WorkspaceSummary } from "../lib/vk-client";
import {
  createAppHooksV1,
  type SpacesRepoDTO,
  type SpacesStateV1,
  type SpacesWorkspaceDTO,
} from "./AppHooks";
import { createProductionAppearanceModule } from "./AppearanceHooks.host";

function useHostSpacesOverview(): SpacesStateV1 {
  const [workspaces, setWorkspaces] = useState<readonly SpacesWorkspaceDTO[]>([]);
  const [repos, setRepos] = useState<readonly SpacesRepoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [workspaceResult, summaryResult, reposResult] = await Promise.allSettled([
        vkClient.getWorkspaces(), vkClient.getWorkspaceSummaries(false), vkClient.getRepos(),
      ]);
      if (workspaceResult.status === "rejected") throw new Error("Failed to load workspaces");
      const active = workspaceResult.value.filter((workspace) => !workspace.archived);
      const summaries = new Map<string, WorkspaceSummary>();
      if (summaryResult.status === "fulfilled") {
        for (const summary of summaryResult.value.summaries) summaries.set(summary.workspace_id, summary);
      }
      const workspaceRepos = await Promise.allSettled(active.map((workspace) =>
        vkClient.getWorkspaceRepos(workspace.id).then((value) => [workspace.id, value] as const),
      ));
      const repoMap = new Map<string, RepoWithBranch[]>(workspaceRepos.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ));
      setWorkspaces(active.map((workspace) => {
        const summary = summaries.get(workspace.id);
        return {
          id: workspace.id, name: workspace.name || workspace.branch, branch: workspace.branch,
          pinned: workspace.pinned, createdAt: workspace.created_at, updatedAt: workspace.updated_at,
          taskId: workspace.task_id, containerRef: workspace.container_ref,
          filesChanged: summary?.files_changed ?? null, linesAdded: summary?.lines_added ?? null,
          linesRemoved: summary?.lines_removed ?? null,
          latestProcessStatus: summary?.latest_process_status ?? null,
          latestProcessCompletedAt: summary?.latest_process_completed_at ?? null,
          hasPendingApproval: summary?.has_pending_approval ?? false,
          hasRunningDevServer: summary?.has_running_dev_server ?? false,
          hasUnseenTurns: summary?.has_unseen_turns ?? false,
          pullRequestStatus: summary?.pr_status ?? null,
          repos: (repoMap.get(workspace.id) ?? []).map((repo) => ({
            id: repo.id, name: repo.name, displayName: repo.display_name,
            targetBranch: repo.target_branch,
          })),
        };
      }));
      setRepos(reposResult.status === "fulfilled" ? reposResult.value.map((repo) => ({
        id: repo.id, name: repo.name, displayName: repo.display_name,
      })) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load data");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refetch();
    const interval = setInterval(() => void refetch(true), 30_000);
    return () => clearInterval(interval);
  }, [refetch]);
  return { workspaces, repos, loading, error, refetch };
}

function useHostSpacesModule() {
  return { available: true as const, value: useHostSpacesOverview() };
}

export const productionAppearanceHost = createProductionAppearanceModule();

export const hostAppHooksV1 = createAppHooksV1([
  Object.freeze({
      id: "myne.spaces", version: 1, availability: Object.freeze({ available: true }),
      useSpacesOverview: useHostSpacesModule,
      stopWorkspaceExecution: async (workspaceId: string) => {
        if (!workspaceId.trim()) throw new Error("workspaceId must be non-empty");
        await vkClient.stopWorkspaceExecution(workspaceId);
      },
  }),
  productionAppearanceHost.module,
]);
