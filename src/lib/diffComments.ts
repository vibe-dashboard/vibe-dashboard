export type DiffComparison = {
  repoRelativePath: string;
  baseRef: string | null;
  headRef: string;
};

export type DiffCommentMarkdownInput = DiffComparison & {
  filePath: string;
  lineNumber: string | number;
  body: string;
  codeLine?: string | null;
  side: 'additions' | 'deletions';
};

export function isCommentForComparison(
  comment: DiffComparison,
  comparison: DiffComparison,
): boolean {
  return (
    comment.repoRelativePath === comparison.repoRelativePath &&
    comment.baseRef === comparison.baseRef &&
    comment.headRef === comparison.headRef
  );
}

export function workspaceCommentPath(
  comment: Pick<DiffCommentMarkdownInput, 'repoRelativePath' | 'filePath'>,
): string {
  return `${comment.repoRelativePath}/${comment.filePath}`;
}

export function formatReviewCommentsMarkdown(
  comments: DiffCommentMarkdownInput[],
): string {
  const header = `## Review Comments (${comments.length})\n\n`;
  return (
    header +
    comments.map(formatReviewCommentMarkdown).join('\n')
  );
}

function formatReviewCommentMarkdown(
  comment: DiffCommentMarkdownInput,
): string {
  const path = escapeMarkdownText(workspaceCommentPath(comment));
  const codeLine = formatCodeLine(comment.codeLine);
  const quotedBody = quoteMarkdown(comment.body.trim());
  const context = `Repository: ${escapeMarkdownText(comment.repoRelativePath)}\nComparison: \`${comment.baseRef ?? 'no base'}\` → \`${comment.headRef}\`\nSide: ${comment.side === 'deletions' ? 'old' : 'new'}\n`;

  if (codeLine) {
    return `${context}\n**${path}** (Line ${comment.lineNumber})\n${codeLine}\n\n${quotedBody}\n`;
  }
  return `${context}\n**${path}** (Line ${comment.lineNumber})\n\n${quotedBody}\n`;
}

function formatCodeLine(line?: string | null): string {
  const trimmed = line?.trim();
  if (!trimmed) return '';
  if (trimmed.includes('`')) {
    return `\`\`\`\n${trimmed}\n\`\`\``;
  }
  return `\`${trimmed}\``;
}

function quoteMarkdown(value: string): string {
  if (!value) return '> ';
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|-])/g, '\\$1');
}
