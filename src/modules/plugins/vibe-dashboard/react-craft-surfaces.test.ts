import { describe, expect, it } from 'vitest';
import { getPreviewServerTabId, getReactCraftSurfaceTarget } from './react-craft-surfaces';

describe('getReactCraftSurfaceTarget', () => {
  it('routes workspace Diffs through the registered React surface with workspace identity', () => {
    expect(getReactCraftSurfaceTarget(
      { id: 'diff', title: 'Diffs', url: 'internal://diff' },
      { tabs: [], workspace: { workspaceId: 'workspace-1', workspaceDir: '/repo' } },
    )).toEqual({
      kind: 'react',
      pluginId: 'vd.built-in',
      surfaceKey: 'diffs',
      props: { workspaceId: 'workspace-1', workspaceDir: '/repo' },
    });
  });
  it('gives the two native Agent views distinct stable surface identities', () => {
    const craft = {
      id: 'craft-1',
      tabs: [],
      workspace: { workspaceId: 'workspace-1', workspaceDir: '/repo' },
    };
    const left = getReactCraftSurfaceTarget(
      { id: 'agent', title: 'Agent', url: '/workspaces/workspace-1' },
      craft,
    );
    const right = getReactCraftSurfaceTarget(
      { id: 'agent-2', title: 'Agent 2', url: '/workspaces/workspace-1' },
      craft,
    );
    expect(left).toMatchObject({
      surfaceKey: 'agent-chat',
      props: { workspaceId: 'workspace-1', surfaceId: 'craft-1:agent' },
    });
    expect(right).toMatchObject({
      surfaceKey: 'agent-chat',
      props: { workspaceId: 'workspace-1', surfaceId: 'craft-1:agent-2' },
    });
  });
});

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
