export default `
ALTER TABLE "ExternalIssueWorkspaceLink" ADD COLUMN "workspaceBeadId" TEXT;
ALTER TABLE "ExternalIssueWorkspaceLink" ADD COLUMN "workspaceBeadsDirKey" TEXT;

CREATE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_workspaceBead_idx" ON "ExternalIssueWorkspaceLink"("workspaceBeadsDirKey", "workspaceBeadId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIssueWorkspaceLink_vkWorkspaceId_workspaceBeadId_key" ON "ExternalIssueWorkspaceLink"("vkWorkspaceId", "workspaceBeadId") WHERE "workspaceBeadId" IS NOT NULL;
`;
