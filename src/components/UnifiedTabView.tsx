import React from 'react';
import { AddressBar } from './AddressBar';
import { IframePanel } from './IframePanel';
import {
  getEffectivePairs,
  getEffectiveTabs,
  BUILT_IN_DIFF_TAB_ID,
} from '../modules/plugins/vibe-dashboard/craft-surfaces';
import type {
  TabGroup,
  WorkspaceState,
  SavedWorkspaceSession,
} from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';
import { BUILT_IN_AGENT_TAB_ID } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import { getPreviewServerTabId } from '../modules/plugins/vibe-dashboard/react-craft-surfaces';
import type { WorkspaceCreationOrigin } from '../lib/workspaceCreationTransition';

interface UnifiedTabViewProps {
  tabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  disableSplitViews?: boolean;
  workspace: WorkspaceState;
  showAddressBar: boolean;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  onOpenVKWorkspace: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => Promise<void>;
  onOpenCraft: () => void;
  onWorkspaceCreated: (origin: WorkspaceCreationOrigin) => Promise<void>;
}

export function UnifiedTabView({
  tabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  disableSplitViews,
  workspace,
  showAddressBar,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
  onOpenCraft,
  onWorkspaceCreated,
}: UnifiedTabViewProps) {
  const activeTabGroup = tabGroups.find((tg) => tg.id === activeTabGroupId);
  const activeItemId = activeTabGroup
    ? getSingleViewActiveItemId(
        activeTabGroup,
        sessionActions.getActiveItem(activeTabGroup.id),
        disableSplitViews,
      )
    : '';

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {showAddressBar && activeTabGroup && (
        <AddressBar
          tabGroup={activeTabGroup}
          activeItemId={activeItemId}
          onNavigate={(tabId, newUrl) =>
            actions.updateTabUrl({
              tabGroupId: activeTabGroup.id,
              tabId,
              newUrl,
            })
          }
        />
      )}

      <div className="flex-1 min-h-0">
        {activeTabGroup ? (
          <IframePanel
            tabGroup={activeTabGroup}
            activeItemId={activeItemId}
            onUpdatePairRatios={(pairId, ratios) =>
              actions.updatePairRatios({
                tabGroupId: activeTabGroup.id,
                pairId,
                ratios,
              })
            }
            workspace={workspace}
            savedSessions={savedSessions}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onStartNewSession={onStartNewSession}
            onNavigateToTabGroup={onNavigateToTabGroup}
            onOpenVKWorkspace={onOpenVKWorkspace}
            onBeadReferenceClick={async (agentTabId, beadId) => {
              const result = await actions.openFormsForBead({
                tabGroupId: activeTabGroup.id,
                agentTabId,
                beadId,
              });
              if (result) {
                sessionActions.selectTab(result.tabGroupId, result.formsTabId);
              }
            }}
            onBeadFormSubmitted={() => {
              sessionActions.selectTab(activeTabGroup.id, BUILT_IN_AGENT_TAB_ID);
            }}
            onConfigurePreviewSlots={() => {
              const previewTabId = getPreviewServerTabId(activeTabGroup);
              if (previewTabId) {
                sessionActions.selectTab(activeTabGroup.id, previewTabId);
              }
            }}
            onWorkspaceCreated={(workspaceId) => {
              void (async () => {
                const spaceId =
                  workspace.spaces.find((space) =>
                    space.tabGroupIds.includes(activeTabGroup.id),
                  )?.id ?? workspace.spaces[0]?.id;
                if (!spaceId) throw new Error('No voyage space is available');
                await onWorkspaceCreated({
                  workspaceId,
                  sourceTabGroupId: activeTabGroup.id,
                  spaceId,
                  sessionId: currentSessionId,
                });
              })().catch((error) => {
                console.error('Failed to open the created workspace', error);
              });
            }}
            onOpenCraft={onOpenCraft}
            onViewDiffs={(agentTabId) => {
              const pair = getEffectivePairs(activeTabGroup).find(
                (item) =>
                  item.tabIds[0] === agentTabId &&
                  item.tabIds[1] === BUILT_IN_DIFF_TAB_ID,
              );
              if (pair) sessionActions.selectPair(activeTabGroup.id, pair.id);
            }}
            onRemoveCraft={() => {
              const spaceId = workspace.spaces.find((space) =>
                space.tabGroupIds.includes(activeTabGroup.id),
              )?.id;
              if (!spaceId) return;
              if (confirm('Remove this stale craft?')) {
                void actions.deleteTabGroup({
                  spaceId,
                  tabGroupId: activeTabGroup.id,
                });
              }
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-default-500">
            <p>No craft selected</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getSingleViewActiveItemId(
  tabGroup: TabGroup,
  activeItemId: string,
  disableSplitViews: boolean | undefined,
): string {
  if (!disableSplitViews) return activeItemId;

  const activePair = getEffectivePairs(tabGroup).find((pair) => pair.id === activeItemId);
  if (!activePair) return activeItemId;

  return getEffectiveTabs(tabGroup)[0]?.id || activePair.tabIds[0] || activeItemId;
}
