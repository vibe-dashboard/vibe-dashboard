import { WORKSPACE_ATTACHMENT_PATH_PATTERN } from '@vibe/ui/lib/workspaceAttachments';

function isSlashCommandPrompt(prompt: string): boolean {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith('/')) return false;

  const match = /^\/([^\s/]+)(?:\s|$)/.exec(trimmed);
  if (!match) return false;

  return true;
}

export function buildAgentPrompt(
  rawUserMessage: string,
  contextParts: (string | null | undefined)[]
) {
  const trimmed = rawUserMessage.trim();
  const isSlashCommand = !!trimmed && isSlashCommandPrompt(trimmed);

  const parts = isSlashCommand
    ? [trimmed]
    : [...contextParts, rawUserMessage].filter(Boolean);

  let prompt = parts.join('\n\n');
  const attachmentLinks = new RegExp(
    String.raw`!?\[(?:\\.|[^\]\\])*\]\((${WORKSPACE_ATTACHMENT_PATH_PATTERN})`,
    'g'
  );
  const directories = [
    ...new Set(
      Array.from(prompt.matchAll(attachmentLinks), (match) =>
        match[1].slice(0, -1)
      )
    ),
  ];

  if (!isSlashCommand && directories.length > 0) {
    prompt += `\n\nUser attachments are stored in ${directories.map((directory) => `\`${directory}/\``).join(' and ')} relative to your session's working directory. Open the linked attachment paths above to inspect their contents. For image attachments, use your image-viewing tool to inspect the image itself.`;
  }

  return {
    prompt,
    isSlashCommand,
  };
}
