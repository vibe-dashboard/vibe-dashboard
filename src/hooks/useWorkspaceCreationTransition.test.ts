// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWorkspaceCreationTransition } from './useWorkspaceCreationTransition';
import type { WorkspaceState, SavedWorkspaceSession } from '../types';
import type {
  WorkspaceActions,
  SessionActions,
} from '../components/WorkspaceShell';

vi.mock('../lib/vkWorkspaceRecord', () => ({
  loadVkWorkspaceRecord: vi.fn(async () => ({
    id: 'vk-new',
    name: 'New workspace',
    branch: 'branch',
    container_ref: '/repo',
  })),
}));

afterEach(cleanup);

describe('created workspace navigation', () => {
  function setup(saved = false) {
    const workspace: WorkspaceState = {
      spaces: [
        {
          id: 'space',
          name: 'Space',
          icon: 'folder',
          tabGroupIds: ['source', 'other-create'],
        },
      ],
      tabGroups: ['source', 'other-create'].map((id) => ({
        id,
        label: 'Create Workspace',
        tabs: [],
        pairs: [],
        order: 0,
      })),
      nextId: 3,
    };
    const savedSession: SavedWorkspaceSession = {
      id: 'voyage',
      slug: 'voyage',
      name: 'Voyage',
      createdAt: '',
      updatedAt: '',
      activeSpaceId: 'space',
      activeTabGroupId: 'source',
      activeVoyageEntryId: 'source-entry',
      voyageEntries: [
        { id: 'source-entry', tabGroupId: 'source', viewIds: ['create'] },
        {
          id: 'destination-entry',
          tabGroupId: 'destination',
          viewIds: ['agent'],
        },
      ],
      activeItemsByVoyageEntryId: {
        'source-entry': 'create',
        'destination-entry': 'agent',
      },
      visitedTabGroupIds: ['source', 'destination'],
    };
    const actions = {
      addVKWorkspace: vi.fn(async () => ({
        tabGroupId: 'destination',
        agentTabId: 'agent',
      })),
      openVKWorkspaceInSavedSession: vi.fn(async () => ({
        savedSession,
        selection: {
          spaceId: 'space',
          tabGroupId: 'destination',
          tabId: 'agent',
        },
      })),
      deleteTabGroup: vi.fn(async () => ({ wasDeleted: true })),
    };
    const sessionActions = {
      selectSessionTab: vi.fn(),
      activateSavedSession: vi.fn(),
      addTabGroupToSession: vi.fn(),
      removeTabGroupFromSession: vi.fn(),
    };
    const props = {
      workspace,
      currentSessionId: 'voyage',
      activeTabGroupId: 'source',
      savedSessions: saved ? [savedSession] : [],
      actions: actions as unknown as WorkspaceActions,
      sessionActions: sessionActions as unknown as SessionActions,
      resolveComposition: vi.fn(() => ({}) as never),
    };
    const hook = renderHook((input) => useWorkspaceCreationTransition(input), {
      initialProps: props,
    });
    const origin = {
      workspaceId: 'vk-new',
      sourceTabGroupId: 'source',
      spaceId: 'space',
      sessionId: 'voyage',
    };
    const readyWorkspace: WorkspaceState = {
      ...workspace,
      spaces: [
        {
          ...workspace.spaces[0]!,
          tabGroupIds: ['source', 'other-create', 'destination'],
        },
      ],
      tabGroups: [
        ...workspace.tabGroups,
        {
          id: 'destination',
          label: 'New workspace',
          order: 2,
          pairs: [],
          tabs: [{ id: 'agent', title: 'Agent', url: '/agent' }],
        },
      ],
    };
    return { actions, sessionActions, props, hook, origin, readyWorkspace };
  }

  it('waits for the destination Agent surface, then selects it and removes only the source craft', async () => {
    const s = setup();
    let completion!: Promise<void>;
    await act(async () => {
      completion = s.hook.result.current(s.origin);
      await Promise.resolve();
    });
    expect(s.actions.deleteTabGroup).not.toHaveBeenCalled();
    expect(s.sessionActions.selectSessionTab).not.toHaveBeenCalled();
    s.hook.rerender({ ...s.props, workspace: s.readyWorkspace });
    await act(async () => {
      await completion;
    });
    expect(s.sessionActions.selectSessionTab).toHaveBeenCalledWith(
      'space',
      'destination',
      'agent',
    );
    expect(s.actions.deleteTabGroup).toHaveBeenCalledExactlyOnceWith({
      spaceId: 'space',
      tabGroupId: 'source',
    });
  });

  it.each(['other-craft', 'other-voyage'])(
    'preserves navigation to %s during creation',
    async (navigation) => {
      const s = setup();
      let completion!: Promise<void>;
      await act(async () => {
        completion = s.hook.result.current(s.origin);
        await Promise.resolve();
      });
      s.hook.rerender({
        ...s.props,
        workspace: s.readyWorkspace,
        activeTabGroupId: 'other-create',
        currentSessionId:
          navigation === 'other-voyage' ? 'different' : 'voyage',
      });
      await act(async () => {
        await completion;
      });
      expect(s.sessionActions.selectSessionTab).not.toHaveBeenCalled();
      expect(s.sessionActions.activateSavedSession).not.toHaveBeenCalled();
      expect(s.actions.deleteTabGroup).toHaveBeenCalledExactlyOnceWith({
        spaceId: 'space',
        tabGroupId: 'source',
      });
    },
  );

  it('keeps the creation craft if opening the workspace fails', async () => {
    const s = setup();
    s.actions.addVKWorkspace.mockRejectedValueOnce(new Error('open failed'));
    await act(async () => {
      await expect(s.hook.result.current(s.origin)).rejects.toThrow(
        'open failed',
      );
    });
    expect(s.actions.deleteTabGroup).not.toHaveBeenCalled();
    expect(s.sessionActions.removeTabGroupFromSession).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'adds the destination to its saved voyage without preemptive selection (still on source: %s)',
    async (stillOnSource) => {
      const s = setup(true);
      let completion!: Promise<void>;
      await act(async () => {
        completion = s.hook.result.current(s.origin);
        await Promise.resolve();
      });
      s.hook.rerender({
        ...s.props,
        workspace: s.readyWorkspace,
        activeTabGroupId: stillOnSource ? 'source' : 'other-create',
      });
      await act(async () => {
        await completion;
      });
      expect(s.actions.openVKWorkspaceInSavedSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'voyage',
          select: false,
          activeSpaceId: 'space',
          taskAttemptId: 'vk-new',
        }),
      );
      if (stillOnSource) {
        expect(s.sessionActions.activateSavedSession).toHaveBeenCalledWith(
          expect.objectContaining({
            activeVoyageEntryId: 'destination-entry',
            activeTabGroupId: 'destination',
          }),
        );
      } else {
        expect(s.sessionActions.activateSavedSession).not.toHaveBeenCalled();
      }
      expect(s.actions.deleteTabGroup).toHaveBeenCalledExactlyOnceWith({
        spaceId: 'space',
        tabGroupId: 'source',
      });
    },
  );
});
