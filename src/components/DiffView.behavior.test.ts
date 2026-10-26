// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { DiffView } from './DiffView';
import { ThemeModeContext } from '../hooks/useThemeMode';
import type {
  DiffCompareMode,
  DiffRouteResponse,
} from '../modules/GitDiffModule';

const { loadDiff, writeText } = vi.hoisted(() => ({
  loadDiff: vi.fn(),
  writeText: vi.fn(),
}));
const gitDiffModule = { actions: { loadDiff } };
vi.mock('../hooks/useModule', () => ({ useModule: () => gitDiffModule }));

// Exercise the actual view's loading, queue, comparison and clipboard behavior;
// replace only the presentation widgets and the diff library's DOM renderer.
vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    isDisabled?: boolean;
    isLoading?: boolean;
  }) =>
    React.createElement(
      'button',
      { onClick: onPress, disabled: isDisabled || isLoading },
      children,
    ),
  Textarea: ({
    minRows,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number;
  }) => React.createElement('textarea', { ...props, rows: minRows }),
}));
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({
    lineAnnotations = [],
    renderAnnotation,
    options,
  }: {
    lineAnnotations?: Array<{ metadata?: unknown }>;
    renderAnnotation: (annotation: { metadata?: unknown }) => React.ReactNode;
    options: { onLineNumberClick: (line: unknown) => void; themeType: string };
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'file-diff', 'data-theme-type': options.themeType },
      React.createElement(
        'button',
        {
          onClick: () =>
            options.onLineNumberClick({
              lineNumber: 1,
              annotationSide: 'additions',
              lineElement: { textContent: 'new line' },
            }),
        },
        'Comment on line 1',
      ),
      ...lineAnnotations.map((annotation, index) =>
        React.createElement(
          'div',
          { key: index },
          renderAnnotation(annotation),
        ),
      ),
    ),
}));

const branchBase = 'a'.repeat(40);
const branchHead = 'b'.repeat(40);
const olderCommit = 'c'.repeat(40);
const commitParent = 'd'.repeat(40);

function response(mode: DiffCompareMode): DiffRouteResponse {
  return {
    workspaceDir: '/workspace',
    repos: [
      {
        name: 'backend',
        path: '/workspace/backend',
        relativePath: 'backend',
        branch: 'feature',
        targetBranch: 'main',
        baseRef: mode.type === 'branch' ? branchBase : commitParent,
        headRef: mode.type === 'branch' ? branchHead : olderCommit,
        compareMode: mode,
        commits: [
          {
            sha: olderCommit,
            subject: 'Earlier change',
            createdAt: '2026-01-01T12:00:00Z',
            linesAdded: 1,
            linesRemoved: 1,
          },
        ],
        files: [{ path: 'src/a.ts', status: 'M' }],
        patch:
          'diff --git a/src/a.ts b/src/a.ts\nindex 1111111..2222222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n',
      },
    ],
  };
}

beforeEach(() => {
  loadDiff.mockReset();
  loadDiff.mockImplementation(
    async ({
      compareModes,
    }: {
      compareModes: Record<string, DiffCompareMode>;
    }) => response(compareModes.backend ?? { type: 'branch' }),
  );
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});
afterEach(cleanup);

async function queueComment(body: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Comment on line 1' }),
  );
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Inline review comment' }),
    { target: { value: body } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
  await screen.findByText(body);
}

describe('Diff review workflow', () => {
  it('updates diff rendering mode without losing comments or reloading the comparison', async () => {
    const themedView = (mode: 'light' | 'dark') =>
      React.createElement(
        ThemeModeContext.Provider,
        { value: mode },
        React.createElement(DiffView, {
          workspaceId: 'workspace-id',
          workspaceDir: '/workspace',
        }),
      );
    const view = render(themedView('dark'));
    await queueComment('Keep through theme changes');
    const loadCount = loadDiff.mock.calls.length;
    expect(
      screen.getByTestId('file-diff').getAttribute('data-theme-type'),
    ).toBe('dark');

    view.rerender(themedView('light'));
    expect(
      screen.getByTestId('file-diff').getAttribute('data-theme-type'),
    ).toBe('light');
    expect(screen.getByText('Keep through theme changes')).toBeTruthy();
    expect(screen.getByText('1 queued comment')).toBeTruthy();
    expect(loadDiff).toHaveBeenCalledTimes(loadCount);
  });

  it('does not carry queued comments into a different workspace with the same repo name and revisions', async () => {
    const view = render(
      React.createElement(DiffView, {
        workspaceId: 'first',
        workspaceDir: '/workspace',
      }),
    );
    await queueComment('First workspace only');
    view.rerender(
      React.createElement(DiffView, {
        workspaceId: 'second',
        workspaceDir: '/other-workspace',
      }),
    );
    await screen.findByRole('button', { name: 'Comment on line 1' });
    expect(screen.queryByText('First workspace only')).toBeNull();
    expect(screen.getByText('0 queued comments')).toBeTruthy();
  });

  it('isolates annotations by resolved comparison, restores them on return, and copies all comparisons', async () => {
    render(
      React.createElement(DiffView, {
        workspaceId: 'workspace-id',
        workspaceDir: '/workspace',
      }),
    );
    await queueComment('Branch comment');

    fireEvent.click(screen.getByRole('button', { name: /Earlier change/ }));
    await screen.findByRole('button', { name: 'Comment on line 1' });
    expect(screen.queryByText('Branch comment')).toBeNull();
    expect(screen.getByText('1 queued comment')).toBeTruthy();
    await queueComment('Earlier commit comment');

    fireEvent.click(
      screen.getByRole('button', { name: 'Show all changes on this branch' }),
    );
    await screen.findByText('Branch comment');
    expect(screen.queryByText('Earlier commit comment')).toBeNull();
    expect(screen.getByText('2 queued comments')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('2 review comments copied to clipboard.');
    const markdown = writeText.mock.calls[0]![0] as string;
    expect(markdown).toContain(
      `Comparison: \`${branchBase}\` → \`${branchHead}\``,
    );
    expect(markdown).toContain(
      `Comparison: \`${commitParent}\` → \`${olderCommit}\``,
    );
    expect(markdown).toContain('Branch comment');
    expect(markdown).toContain('Earlier commit comment');
    expect(screen.getByText('0 queued comments')).toBeTruthy();
  });

  it('preserves the queue and exposes revision-labeled manual copy text when clipboard access fails', async () => {
    writeText.mockRejectedValue(new Error('Permission denied'));
    render(
      React.createElement(DiffView, {
        workspaceId: 'workspace-id',
        workspaceDir: '/workspace',
      }),
    );
    await queueComment('Keep this comment');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    const manual = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Review comments markdown',
    });
    expect(manual.value).toContain('Keep this comment');
    expect(manual.value).toContain(branchHead);
    expect(screen.getByText('1 queued comment')).toBeTruthy();
    expect(screen.getByText('Keep this comment')).toBeTruthy();

    writeText.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('1 review comment copied to clipboard.');
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Review comments markdown' }),
      ).toBeNull(),
    );
  });

  it('does not discard comments added while a clipboard write is pending', async () => {
    let finishCopy!: () => void;
    writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    render(
      React.createElement(DiffView, {
        workspaceId: 'workspace-id',
        workspaceDir: '/workspace',
      }),
    );
    await queueComment('First comment');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await queueComment('Added during copy');
    finishCopy();
    await screen.findByText('1 review comment copied to clipboard.');
    expect(screen.getByText('1 queued comment')).toBeTruthy();
    expect(screen.getByText('Added during copy')).toBeTruthy();
    expect(screen.queryByText('First comment')).toBeNull();
  });
});
