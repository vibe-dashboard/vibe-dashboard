import React from 'react';
import { UnifiedTabView } from './UnifiedTabView';
import type { TabGroup, WorkspaceState, SavedWorkspaceSession } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';
import type { WorkspaceCreationOrigin } from '../lib/workspaceCreationTransition';

interface WorkspaceContentViewProps {
  activeTabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  disableSplitViews?: boolean;
  onDragStart: (e: React.DragEvent, tabGroupId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetGroupId: string) => void;
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

export function WorkspaceContentView({
  activeTabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  disableSplitViews,
  onDragStart,
  onDragOver,
  onDrop,
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
}: WorkspaceContentViewProps) {
  if (activeTabGroups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-default-500">
        <p>
          No craft in this space. Hover left to switch spaces.
        </p>
      </div>
    );
  }

  return (
    <UnifiedTabView
      tabGroups={activeTabGroups}
      activeTabGroupId={activeTabGroupId}
      actions={actions}
      sessionActions={sessionActions}
      disableSplitViews={disableSplitViews}
      workspace={workspace}
      showAddressBar={showAddressBar}
      savedSessions={savedSessions}
      currentSessionId={currentSessionId}
      onResumeSession={onResumeSession}
      onRenameSession={onRenameSession}
      onDeleteSession={onDeleteSession}
      onStartNewSession={onStartNewSession}
      onNavigateToTabGroup={onNavigateToTabGroup}
      onOpenVKWorkspace={onOpenVKWorkspace}
      onOpenCraft={onOpenCraft}
      onWorkspaceCreated={onWorkspaceCreated}
    />
  );
}
