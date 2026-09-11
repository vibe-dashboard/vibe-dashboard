import { useCallback, useEffect, useState } from "react";
import { vkClient, type Repo, type RepoWithBranch, type WorkspaceSummary } from "../lib/vk-client";
import type { DashboardWorkspace } from "../components/spaces-overview/SpacesOverview.contracts";
import {
  unavailableAppearanceHooksV1,
  type AppHooksV1,
  type SpacesOverviewHookValue,
} from "./AppHooks";

function useHostSpacesOverview(): SpacesOverviewHookValue {
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
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
          pinned: workspace.pinned, created_at: workspace.created_at, updated_at: workspace.updated_at,
          task_id: workspace.task_id, container_ref: workspace.container_ref,
          files_changed: summary?.files_changed ?? null, lines_added: summary?.lines_added ?? null,
          lines_removed: summary?.lines_removed ?? null,
          latest_process_status: summary?.latest_process_status ?? null,
          latest_process_completed_at: summary?.latest_process_completed_at ?? null,
          has_pending_approval: summary?.has_pending_approval ?? false,
          has_running_dev_server: summary?.has_running_dev_server ?? false,
          has_unseen_turns: summary?.has_unseen_turns ?? false,
          pr_status: summary?.pr_status ?? null, repos: repoMap.get(workspace.id) ?? [],
        };
      }));
      setRepos(reposResult.status === "fulfilled" ? reposResult.value : []);
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

export const hostAppHooksV1: AppHooksV1 = Object.freeze({
  contractVersion: 1,
  capabilities: Object.freeze({
    spaces: Object.freeze({
      id: "myne.spaces", version: 1, availability: Object.freeze({ available: true }),
      useSpacesOverview: useHostSpacesOverview,
      stopWorkspaceExecution: async (workspaceId: string) => {
        if (!workspaceId.trim()) throw new Error("workspaceId must be non-empty");
        await vkClient.stopWorkspaceExecution(workspaceId);
      },
    }),
    appearance: unavailableAppearanceHooksV1,
  }),
});
