import React, {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Provider as NiceModalProvider } from '@ebay/nice-modal-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Workspace as RemoteWorkspace } from 'shared/remote-types';
import type { Workspace } from 'shared/types';
import { CreateModeProvider } from '@/features/create-mode/model/CreateModeProvider';
import { WorkspacesMainContainer } from '@/pages/workspaces/WorkspacesMainContainer';
import { CreateChatBoxContainer } from '@/shared/components/CreateChatBoxContainer';
import { AppNavigationProvider } from '@/shared/hooks/useAppNavigation';
import { AppRuntimeProvider } from '@/shared/hooks/useAppRuntime';
import { ActionsContext, type ActionsContextValue } from '@/shared/hooks/useActions';
import { AuthContext } from '@/shared/hooks/auth/useAuth';
import { ExecutionProcessesProvider } from '@/shared/providers/ExecutionProcessesProvider';
import { UserContext } from '@/shared/hooks/useUserContext';
import { UserSystemContext } from '@/shared/hooks/useUserSystem';
import { useUserSystemController } from '@/shared/hooks/useUserSystemController';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useDiffStream } from '@/shared/hooks/useDiffStream';
import { useWorkspaceRecord } from '@/shared/hooks/useWorkspaceRecord';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useWorkspaceSessions } from '@/shared/hooks/useWorkspaceSessions';
import { useWorkspaces } from '@/shared/hooks/useWorkspaces';
import { configApi } from '@/shared/lib/api';
import type { AppDestination, AppNavigation } from '@/shared/lib/routes/appNavigation';
import { resolveLabel, type ActionDefinition } from '@/shared/types/actions';
import { WorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useWorkspaceDiffStore } from '@/shared/stores/useWorkspaceDiffStore';
import '@/i18n/config';

export type InlineVkAgentChatTheme = {
  className?: string;
  style?: CSSProperties;
};

export type InlineVkAgentChatProps = {
  workspaceId: string;
  surfaceId: string;
  title?: string;
  theme?: InlineVkAgentChatTheme;
  chatViewMode?: 'full' | 'zen';
};

export type InlineVkCreateWorkspaceProps = {
  surfaceId: string;
  theme?: InlineVkAgentChatTheme;
  onWorkspaceCreated?: (workspaceId: string) => void;
  chatViewMode?: 'full' | 'zen';
};

const inlineQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

const emptyRemoteWorkspaces: RemoteWorkspace[] = [];

function noop(): void {}

const inlineNavigation: AppNavigation = {
  resolveFromPath(path: string): AppDestination | null {
    const workspaceMatch = path.match(/\/workspaces\/([^/?#]+)/);
    if (workspaceMatch?.[1]) {
      return {
        kind: 'workspace',
        workspaceId: decodeURIComponent(workspaceMatch[1]),
      };
    }
    if (path === '/workspaces') return { kind: 'workspaces-create' };
    return null;
  },
  goToRoot: noop,
  goToOnboarding: noop,
  goToOnboardingSignIn: noop,
  goToWorkspaces: noop,
  goToWorkspacesCreate: noop,
  goToWorkspace: noop,
  goToWorkspaceVsCode: noop,
  goToExport: noop,
  goToProject: noop,
  goToProjectIssue: noop,
  goToProjectIssueWorkspace: noop,
  goToProjectIssueWorkspaceCreate: noop,
  goToProjectWorkspaceCreate: noop,
};

function InlineUserSystemProvider({ children }: { children: ReactNode }) {
  const loadConfig = useCallback(() => configApi.getConfig(null), []);
  const saveConfig = useCallback(
    (config: Parameters<typeof configApi.saveConfig>[0]) =>
      configApi.saveConfig(config, null),
    [],
  );
  const { value } = useUserSystemController({
    queryKey: ['inline-vk-user-system', 'local'],
    load: loadConfig,
    save: saveConfig,
  });

  return (
    <UserSystemContext.Provider value={value}>
      {children}
    </UserSystemContext.Provider>
  );
}

function InlineUserProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      workspaces: emptyRemoteWorkspaces,
      isLoading: false,
      error: null,
      retry: noop,
      getWorkspacesForIssue: () => emptyRemoteWorkspaces,
    }),
    [],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

function InlineActionsProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ActionsContextValue>(() => {
    const executorContext = {
      appRuntime: 'local' as const,
      currentHostId: null,
      appNavigation: inlineNavigation,
      queryClient: inlineQueryClient,
      selectWorkspace: noop,
      activeWorkspaces: [],
      currentWorkspaceId: null,
      containerRef: null,
      runningDevServers: [],
      startDevServer: noop,
      stopDevServer: noop,
      currentLogs: null,
      logsPanelContent: null,
      openStatusSelection: async () => {},
      openPrioritySelection: async () => {},
      openAssigneeSelection: async () => {},
      openSubIssueSelection: async () => undefined,
      openWorkspaceSelection: async () => {},
      openRelationshipSelection: async () => {},
      navigateToCreateIssue: noop,
      remoteWorkspaces: emptyRemoteWorkspaces,
    };

    return {
      executeAction: async (_action: ActionDefinition) => {},
      getLabel: (action: ActionDefinition, workspace?: Workspace) =>
        resolveLabel(action, workspace),
      openStatusSelection: executorContext.openStatusSelection,
      openPrioritySelection: executorContext.openPrioritySelection,
      openAssigneeSelection: executorContext.openAssigneeSelection,
      openSubIssueSelection: executorContext.openSubIssueSelection,
      openWorkspaceSelection: executorContext.openWorkspaceSelection,
      openRelationshipSelection: executorContext.openRelationshipSelection,
      setDefaultCreateStatusId: noop,
      registerProjectMutations: noop,
      executorContext,
    };
  }, []);

  return (
    <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
  );
}

function InlineVkRuntime({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={inlineQueryClient}>
      <AppRuntimeProvider runtime="local">
        <AppNavigationProvider value={inlineNavigation}>
          <AuthContext.Provider
            value={{ isSignedIn: false, isLoaded: true, userId: null }}
          >
            <InlineUserSystemProvider>
              <InlineUserProvider>
                <InlineActionsProvider>
                  <NiceModalProvider>{children}</NiceModalProvider>
                </InlineActionsProvider>
              </InlineUserProvider>
            </InlineUserSystemProvider>
          </AuthContext.Provider>
        </AppNavigationProvider>
      </AppRuntimeProvider>
    </QueryClientProvider>
  );
}

function WorkspaceDiffBridge({
  workspaceId,
  enabled,
}: {
  workspaceId: string;
  enabled: boolean;
}) {
  const { diffs } = useDiffStream(workspaceId, enabled, { statsOnly: true });

  useEffect(() => {
    const diffStats = {
      files_changed: diffs.length,
      lines_added: diffs.reduce((sum, diff) => sum + (diff.additions ?? 0), 0),
      lines_removed: diffs.reduce((sum, diff) => sum + (diff.deletions ?? 0), 0),
    };
    useWorkspaceDiffStore.getState().setWorkspaceDiffData({
      diffs,
      diffPaths: new Set(diffs.map((diff) => diff.newPath || diff.oldPath || '').filter(Boolean)),
      diffStats,
      gitHubComments: [],
      isGitHubCommentsLoading: false,
      showGitHubComments: false,
      setShowGitHubComments: noop,
      getGitHubCommentsForFile: () => [],
      getGitHubCommentCountForFile: () => 0,
      getFilesWithGitHubComments: () => [],
      getFirstCommentLineForFile: () => null,
    });
  }, [diffs]);

  useEffect(
    () => () => {
      useWorkspaceDiffStore.getState().clearWorkspaceDiffData();
    },
    [],
  );

  return null;
}

function InlineWorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const {
    workspaces: activeWorkspaces,
    archivedWorkspaces,
    isLoading: isWorkspacesListLoading,
  } = useWorkspaces();
  const workspaceQuery = useWorkspaceRecord(workspaceId, { enabled: !!workspaceId });
  const sessionsState = useWorkspaceSessions(workspaceId, { enabled: !!workspaceId });
  const reposState = useWorkspaceRepo(workspaceId, { enabled: !!workspaceId });
  const workspace = workspaceQuery.data;

  const value = useMemo(
    () => ({
      workspaceId,
      workspace,
      activeWorkspaces,
      archivedWorkspaces,
      isWorkspacesListLoading,
      isLoading: isWorkspacesListLoading || workspaceQuery.isLoading,
      isCreateMode: false,
      selectWorkspace: noop,
      navigateToCreate: noop,
      sessions: sessionsState.sessions,
      selectedSession: sessionsState.selectedSession,
      selectedSessionId: sessionsState.selectedSessionId,
      selectSession: sessionsState.selectSession,
      selectLatestSession: sessionsState.selectLatestSession,
      isSessionsLoading: sessionsState.isLoading,
      isNewSessionMode: sessionsState.isNewSessionMode,
      startNewSession: sessionsState.startNewSession,
      repos: reposState.repos,
      isReposLoading: reposState.isLoading,
    }),
    [
      activeWorkspaces,
      archivedWorkspaces,
      isWorkspacesListLoading,
      reposState.isLoading,
      reposState.repos,
      sessionsState.isLoading,
      sessionsState.isNewSessionMode,
      sessionsState.selectLatestSession,
      sessionsState.selectSession,
      sessionsState.selectedSession,
      sessionsState.selectedSessionId,
      sessionsState.sessions,
      sessionsState.startNewSession,
      workspace,
      workspaceId,
      workspaceQuery.isLoading,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceDiffBridge workspaceId={workspaceId} enabled={!!workspace} />
      <ExecutionProcessesProvider sessionId={sessionsState.selectedSessionId}>
        {children}
      </ExecutionProcessesProvider>
    </WorkspaceContext.Provider>
  );
}

function InlineWorkspaceChat({
  workspaceId,
  chatViewMode = 'full',
}: {
  workspaceId: string;
  chatViewMode?: 'full' | 'zen';
}) {
  const workspaceContextRef = useRef<{
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
  }>(null);

  return (
    <InlineWorkspaceProvider workspaceId={workspaceId}>
      <InlineWorkspaceChatContent
        refHolder={workspaceContextRef}
        chatViewMode={chatViewMode}
      />
    </InlineWorkspaceProvider>
  );
}

function InlineWorkspaceChatContent({
  refHolder,
  chatViewMode,
}: {
  refHolder: React.RefObject<{
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
  } | null>;
  chatViewMode: 'full' | 'zen';
}) {
  const workspace = useWorkspaceContext();

  return (
      <WorkspacesMainContainer
        ref={refHolder}
        selectedWorkspace={workspace.workspace ?? null}
        selectedSession={workspace.selectedSession}
        selectedSessionId={workspace.selectedSessionId}
        sessions={workspace.sessions}
        repos={workspace.repos}
        onSelectSession={workspace.selectSession}
        isLoading={workspace.isLoading}
        isSessionsLoading={workspace.isSessionsLoading}
        isNewSessionMode={workspace.isNewSessionMode}
        onStartNewSession={workspace.startNewSession}
        chatViewMode={chatViewMode}
      />
  );
}

export function InlineVkAgentChat({
  workspaceId,
  surfaceId: _surfaceId,
  theme,
  chatViewMode = 'full',
}: InlineVkAgentChatProps) {
  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center bg-primary p-base text-low">
        No workspace selected
      </div>
    );
  }

  return (
    <div
      className={theme?.className ?? 'h-full min-h-0 bg-primary text-normal'}
      data-testid="inline-vk-agent-chat"
      style={theme?.style}
    >
      <InlineVkRuntime>
        <InlineWorkspaceChat workspaceId={workspaceId} chatViewMode={chatViewMode} />
      </InlineVkRuntime>
    </div>
  );
}

export function InlineVkCreateWorkspace({
  surfaceId: _surfaceId,
  theme,
  onWorkspaceCreated,
  chatViewMode = 'full',
}: InlineVkCreateWorkspaceProps) {
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const handleWorkspaceCreated = useCallback(
    (workspaceId: string) => {
      setCreatedWorkspaceId(workspaceId);
      onWorkspaceCreated?.(workspaceId);
    },
    [onWorkspaceCreated],
  );

  return (
    <div
      className={theme?.className ?? 'h-full min-h-0 bg-primary text-normal'}
      data-testid="inline-vk-create-workspace"
      style={theme?.style}
    >
      <InlineVkRuntime>
        {createdWorkspaceId ? (
          <InlineWorkspaceChat workspaceId={createdWorkspaceId} chatViewMode={chatViewMode} />
        ) : (
          <CreateModeProvider>
            <CreateChatBoxContainer
              onWorkspaceCreated={handleWorkspaceCreated}
              chatViewMode={chatViewMode}
            />
          </CreateModeProvider>
        )}
      </InlineVkRuntime>
    </div>
  );
}
