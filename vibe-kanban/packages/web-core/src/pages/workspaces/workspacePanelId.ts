export function getWorkspacePanelId(
  routeWorkspaceId: string | undefined,
  isCreateMode: boolean
): string | undefined {
  return isCreateMode ? undefined : routeWorkspaceId;
}
