export type VkWorkspaceRecord = {
  id: string;
  name: string | null;
  branch: string;
  container_ref: string | null;
};

export async function loadVkWorkspaceRecord(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VkWorkspaceRecord> {
  const response = await fetchImpl(
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
  );
  if (!response.ok) throw new Error(await response.text());
  const payload = (await response.json()) as {
    data?: unknown;
    success?: boolean;
  };
  const workspace = (payload.data ?? payload) as Partial<VkWorkspaceRecord>;
  if (
    typeof workspace.id !== 'string' ||
    typeof workspace.branch !== 'string'
  ) {
    throw new Error('Workspace response was invalid');
  }
  return {
    id: workspace.id,
    name: typeof workspace.name === 'string' ? workspace.name : null,
    branch: workspace.branch,
    container_ref:
      typeof workspace.container_ref === 'string'
        ? workspace.container_ref
        : null,
  };
}
