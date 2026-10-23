import { useEffect, useRef } from 'react';
import type {
  WorkspaceActions,
  SessionActions,
} from '../components/WorkspaceShell';
import type { WorkspaceState, SavedWorkspaceSession } from '../types';
import type { ResolvedWorkspaceComposition } from '../modules/plugins/vibe-dashboard/workspace-composition';
import { loadVkWorkspaceRecord } from '../lib/vkWorkspaceRecord';
import {
  completeWorkspaceCreation,
  type WorkspaceCreationOrigin,
} from '../lib/workspaceCreationTransition';

export function useWorkspaceCreationTransition(input: {
  workspace: WorkspaceState;
  currentSessionId: string;
  activeTabGroupId: string;
  savedSessions: SavedWorkspaceSession[];
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  resolveComposition: (args: {
    workspaceId: string;
    name: string;
    containerRef: string;
  }) => ResolvedWorkspaceComposition;
}) {
  const latest = useRef(input);
  latest.current = input;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return async (origin: WorkspaceCreationOrigin) => {
    const { actions, sessionActions, resolveComposition, savedSessions } =
      input;
    await completeWorkspaceCreation({
      open: async () => {
        const created = await loadVkWorkspaceRecord(origin.workspaceId);
        const name = created.name ?? created.branch;
        const containerRef = created.container_ref ?? '';
        const args = {
          taskAttemptId: created.id,
          name,
          containerRef,
          activeSpaceId: origin.spaceId,
          composition: resolveComposition({
            workspaceId: created.id,
            name,
            containerRef,
          }),
        };
        if (savedSessions.some((entry) => entry.id === origin.sessionId)) {
          const result = await actions.openVKWorkspaceInSavedSession({
            ...args,
            sessionId: origin.sessionId,
            select: false,
          });
          if (!result?.selection.tabId)
            throw new Error(
              'Could not open the created workspace in its voyage',
            );
          return {
            tabGroupId: result.selection.tabGroupId,
            agentTabId: result.selection.tabId,
            savedSession: result.savedSession,
          };
        }
        const result = await actions.addVKWorkspace(args);
        if (!result) throw new Error('Could not open the created workspace');
        return { ...result, savedSession: undefined };
      },
      waitUntilReady: async (destination) => {
        const deadline = Date.now() + 30_000;
        while (mounted.current && Date.now() < deadline) {
          const workspace = latest.current.workspace;
          const group = workspace.tabGroups.find(
            (entry) => entry.id === destination.tabGroupId,
          );
          if (
            group?.tabs.some((tab) => tab.id === destination.agentTabId) &&
            workspace.spaces.some(
              (space) =>
                space.id === origin.spaceId &&
                space.tabGroupIds.includes(group.id),
            )
          ) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(
          'Created workspace did not become available; preserving the creation craft',
        );
      },
      isSourceSelected: () =>
        mounted.current &&
        latest.current.currentSessionId === origin.sessionId &&
        latest.current.activeTabGroupId === origin.sourceTabGroupId,
      focus: (destination) => {
        if (destination.savedSession) {
          const entry = destination.savedSession.voyageEntries.find(
            (item) => item.tabGroupId === destination.tabGroupId,
          );
          if (!entry)
            throw new Error('Created workspace is missing from its voyage');
          sessionActions.activateSavedSession({
            ...destination.savedSession,
            activeVoyageEntryId: entry.id,
            activeSpaceId: origin.spaceId,
            activeTabGroupId: destination.tabGroupId,
          });
        } else {
          sessionActions.selectSessionTab(
            origin.spaceId,
            destination.tabGroupId,
            destination.agentTabId,
          );
        }
      },
      closeSource: async (destination) => {
        await actions.deleteTabGroup({
          spaceId: origin.spaceId,
          tabGroupId: origin.sourceTabGroupId,
        });
        if (latest.current.currentSessionId === origin.sessionId) {
          sessionActions.addTabGroupToSession(destination.tabGroupId, {
            select: false,
          });
        }
      },
    });
  };
}
