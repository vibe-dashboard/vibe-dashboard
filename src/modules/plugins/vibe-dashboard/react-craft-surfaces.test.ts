import { describe, expect, it } from 'vitest';
import { getPreviewServerTabId } from './react-craft-surfaces';

describe('getPreviewServerTabId', () => {
  it('finds the PreviewServer React surface without relying on title or URL', () => {
    expect(
      getPreviewServerTabId({
        tabs: [
          { id: 'other', title: 'PreviewServer', url: '/wrong' },
          {
            id: 'preview-tab',
            title: 'Renamed',
            url: 'internal://preview',
            ephemeral: {
              kind: 'craft-surface',
              pluginId: 'dev.mickmister.preview-server',
              sourceKey: 'run-configs',
              surfaceKey: 'dev.mickmister.preview-server/run-configs',
            },
          },
        ],
      }),
    ).toBe('preview-tab');
  });
});
