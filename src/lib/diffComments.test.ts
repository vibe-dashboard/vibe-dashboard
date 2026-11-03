import { describe, expect, it } from 'vitest';
import {
  formatReviewCommentsMarkdown,
  isCommentForComparison,
  workspaceCommentPath,
} from './diffComments';

describe('workspaceCommentPath', () => {
  it('uses workspace-relative paths even when only one repo is attached', () => {
    expect(
      workspaceCommentPath(
        { repoRelativePath: 'vibe-kanban', filePath: 'src/main.ts' },
      ),
    ).toBe('vibe-kanban/src/main.ts');
  });

  it('uses workspace-relative paths for nested repos in multi-repo workspaces', () => {
    expect(
      workspaceCommentPath(
        { repoRelativePath: 'backend', filePath: 'src/main.ts' },
      ),
    ).toBe('backend/src/main.ts');
  });

});

describe('formatReviewCommentsMarkdown', () => {
  it('formats comments as markdown and quotes every body line', () => {
    expect(
      formatReviewCommentsMarkdown(
        [
          {
            repoRelativePath: 'backend',
            baseRef: 'base-sha',
            headRef: 'head-sha',
            filePath: 'src/main.ts',
            lineNumber: 12,
            body: 'First line\nSecond line',
            codeLine: 'const value = true;',
            side: 'additions',
          },
        ],
      ),
    ).toContain(
      '**backend/src/main\\.ts** (Line 12)\n`const value = true;`\n\n> First line\n> Second line',
    );
  });

  it('labels every queued comparison and old/new line side', () => {
    const markdown = formatReviewCommentsMarkdown([
      { repoRelativePath: 'backend', baseRef: 'base-a', headRef: 'head-a', filePath: 'a.ts', lineNumber: 7, body: 'First', side: 'deletions' },
      { repoRelativePath: 'frontend', baseRef: 'base-b', headRef: 'head-b', filePath: 'b.ts', lineNumber: 7, body: 'Second', side: 'additions' },
    ]);
    expect(markdown).toContain('Repository: backend\nComparison: `base-a` → `head-a`\nSide: old');
    expect(markdown).toContain('Repository: frontend\nComparison: `base-b` → `head-b`\nSide: new');
    expect(markdown).toContain('First');
    expect(markdown).toContain('Second');
  });
});

describe('isCommentForComparison', () => {
  const original = { repoRelativePath: 'backend', baseRef: 'base', headRef: 'head' };

  it('requires both resolved revisions and repo identity to match', () => {
    expect(isCommentForComparison(original, original)).toBe(true);
    expect(isCommentForComparison(original, { ...original, repoRelativePath: 'frontend' })).toBe(false);
    expect(isCommentForComparison(original, { ...original, baseRef: 'other' })).toBe(false);
    expect(isCommentForComparison(original, { ...original, headRef: 'other' })).toBe(false);
  });
});
