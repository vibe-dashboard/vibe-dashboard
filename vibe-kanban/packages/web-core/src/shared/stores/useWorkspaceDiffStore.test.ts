import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspaceDiffStoreProvider,
  createWorkspaceDiffStore,
  useDiffStats,
} from './useWorkspaceDiffStore';

function DiffCount() {
  return createElement('span', null, useDiffStats().files_changed);
}

describe('createWorkspaceDiffStore', () => {
  it('keeps diff data isolated between store instances', () => {
    const first = createWorkspaceDiffStore({
      diffPaths: new Set(['first.ts']),
      diffStats: {
        files_changed: 1,
        lines_added: 4,
        lines_removed: 2,
      },
    });
    const second = createWorkspaceDiffStore();

    expect(first.getState().diffStats.files_changed).toBe(1);
    expect(first.getState().diffPaths).toEqual(new Set(['first.ts']));
    expect(second.getState().diffStats.files_changed).toBe(0);
    expect(second.getState().diffPaths).toEqual(new Set());

    second.getState().clearWorkspaceDiffData();

    expect(first.getState().diffStats.files_changed).toBe(1);
    expect(first.getState().diffPaths).toEqual(new Set(['first.ts']));

    const markup = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(
          WorkspaceDiffStoreProvider,
          { store: first },
          createElement(DiffCount)
        ),
        createElement(
          WorkspaceDiffStoreProvider,
          { store: second },
          createElement(DiffCount)
        )
      )
    );

    expect(markup).toBe('<div><span>1</span><span>0</span></div>');
  });
});
