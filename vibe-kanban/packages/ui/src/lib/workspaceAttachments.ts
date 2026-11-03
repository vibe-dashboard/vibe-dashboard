export const WORKSPACE_ATTACHMENT_PATH_PATTERN = String.raw`(?:\.alohak-attachments|\.vibe-attachments)/`;

const workspaceAttachmentPath = new RegExp(
  `^${WORKSPACE_ATTACHMENT_PATH_PATTERN}`
);

export function isWorkspaceAttachmentPath(path: string): boolean {
  return workspaceAttachmentPath.test(path);
}
