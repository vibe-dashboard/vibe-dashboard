/**
 * @vitest-environment jsdom
 */

import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesLayout } from './WorkspacesLayout';
import { useChangesView } from '@/shared/hooks/useChangesView';
import {
  RIGHT_MAIN_PANEL_MODES,
  useUiPreferencesStore,
} from '@/shared/stores/useUiPreferencesStore';
import { useWorkspaceDiffStore } from '@/shared/stores/useWorkspaceDiffStore';

const ROUTE_WORKSPACE_ID = 'route-workspace';
let routeWorkspaceId = ROUTE_WORKSPACE_ID;
let isMobile = false;

vi.mock('@/shared/hooks/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({
    workspaceId: routeWorkspaceId,
    workspace: undefined,
    isLoading: true,
    isCreateMode: false,
    selectedSession: undefined,
    selectedSessionId: undefined,
    sessions: [],
    isSessionsLoading: true,
    selectSession: vi.fn(),
    repos: [],
    isNewSessionMode: false,
    startNewSession: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/useIsMobile', () => ({
  useIsMobile: () => isMobile,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Panel: ({ children, id }: React.PropsWithChildren<{ id?: string }>) => (
    <div id={id}>{children}</div>
  ),
  Separator: () => null,
}));

vi.mock('@vibe/ui/components/Select', () => ({
  Select: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock('@/shared/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/shared/hooks/useAppNavigation', () => ({
  useAppNavigation: () => ({ goToWorkspace: vi.fn() }),
}));
vi.mock('@/shared/hooks/useUserSystem', () => ({
  useUserSystem: () => ({
    config: { showcases: { seen_features: ['workspaces-guide'] } },
    updateAndSaveConfig: vi.fn(),
    loading: false,
  }),
}));
vi.mock('@/shared/stores/useUiPreferencesStore', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/shared/stores/useUiPreferencesStore')
    >();
  return {
    ...original,
    usePaneSize: () => [50, vi.fn()],
  };
});

vi.mock('@/shared/hooks/ReviewProvider', () => ({
  ReviewProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock('./WorkspacesSidebarContainer', () => ({
  WorkspacesSidebarContainer: () => <div data-testid="workspaces-sidebar" />,
}));
vi.mock('./LogsContentContainer', () => ({
  LogsContentContainer: () => <div data-testid="logs-panel" />,
}));
vi.mock('./RightSidebar', () => ({ RightSidebar: () => null }));
vi.mock('./PreviewBrowserContainer', () => ({
  PreviewBrowserContainer: () => null,
}));
vi.mock('@/shared/components/CreateChatBoxContainer', () => ({
  CreateChatBoxContainer: () => null,
}));
vi.mock('@/features/create-mode/model/CreateModeProvider', () => ({
  CreateModeProvider: ({ children }: React.PropsWithChildren) => (
    <>{children}</>
  ),
}));
vi.mock('@/features/create-mode/model/createModeSeedStore', () => ({
  consumeCreateModeSeedState: () => null,
  getCreateModeSeedVersion: () => 0,
  subscribeCreateModeSeedState: () => () => {},
}));
vi.mock('@/shared/dialogs/shared/WorkspacesGuideDialog', () => ({
  WorkspacesGuideDialog: { show: vi.fn(), hide: vi.fn() },
}));

vi.mock('./WorkspacesMainContainer', () => ({
  WorkspacesMainContainer: React.forwardRef(function MockWorkspaceMain() {
    const { viewFileInChanges, findMatchingDiffPath } = useChangesView();
    return (
      <button
        onClick={() =>
          viewFileInChanges(
            findMatchingDiffPath('qa_output.txt') ?? 'qa_output.txt'
          )
        }
      >
        View target file
      </button>
    );
  }),
}));

vi.mock('./ChangesPanelContainer', () => ({
  ChangesPanelContainer: ({ workspaceId }: { workspaceId: string }) => {
    const { registerScrollToFile } = useChangesView();
    const [target, setTarget] = useState<string | null>(null);

    useEffect(() => {
      registerScrollToFile((path) => setTarget(path));
      return () => registerScrollToFile(null);
    }, [registerScrollToFile]);

    return (
      <div data-testid="changes-panel" data-workspace-id={workspaceId}>
        {target}
      </div>
    );
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  routeWorkspaceId = ROUTE_WORKSPACE_ID;
  isMobile = false;
  mockMatchMedia(false);
  useUiPreferencesStore.setState({
    chatViewMode: 'mostly-zen',
    mobileActiveTab: 'chat',
    workspacePanelStates: {},
    isLeftSidebarVisible: true,
    isRightSidebarVisible: false,
  });
  useWorkspaceDiffStore.setState({
    diffPaths: new Set(['repo/qa_output.txt']),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkspacesLayout Changes integration', () => {
  it('renders desktop Changes from route state while workspace data is unresolved', async () => {
    const view = await renderLayout();

    await act(async () => {
      useUiPreferencesStore
        .getState()
        .setRightMainPanelMode(
          RIGHT_MAIN_PANEL_MODES.CHANGES,
          ROUTE_WORKSPACE_ID
        );
    });

    expect(view.container.querySelector('#right-main')).not.toBeNull();
    expectChangesPanel(view.container);
    await view.unmount();
  });

  it('selects the mobile Changes tab when its persisted panel mode is active', async () => {
    isMobile = true;
    mockMatchMedia(true);
    useUiPreferencesStore.setState({
      mobileActiveTab: 'chat',
      workspacePanelStates: {
        [ROUTE_WORKSPACE_ID]: {
          rightMainPanelMode: RIGHT_MAIN_PANEL_MODES.CHANGES,
          isLeftMainPanelVisible: true,
        },
      },
    });
    const view = await renderLayout();

    await act(async () => {
      useUiPreferencesStore
        .getState()
        .toggleRightMainPanelMode(
          RIGHT_MAIN_PANEL_MODES.CHANGES,
          ROUTE_WORKSPACE_ID
        );
    });

    expect(useUiPreferencesStore.getState().mobileActiveTab).toBe('changes');
    expectChangesPanel(view.container);
    await view.unmount();
  });

  it('switches mobile tabs before replaying provider-driven target navigation', async () => {
    isMobile = true;
    mockMatchMedia(true);
    const view = await renderLayout();

    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiPreferencesStore.getState().mobileActiveTab).toBe('changes');
    expectChangesPanel(view.container, 'repo/qa_output.txt');
    await view.unmount();
  });

  it('remounts Changes navigation state when the route workspace changes', async () => {
    const view = await renderLayout();

    await act(async () => {
      useUiPreferencesStore
        .getState()
        .setRightMainPanelMode(
          RIGHT_MAIN_PANEL_MODES.CHANGES,
          ROUTE_WORKSPACE_ID
        );
      view.container
        .querySelector<HTMLButtonElement>('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expectChangesPanel(view.container, 'repo/qa_output.txt');

    routeWorkspaceId = 'workspace-b';
    await view.rerender();
    await act(async () => {
      useUiPreferencesStore
        .getState()
        .setRightMainPanelMode(
          RIGHT_MAIN_PANEL_MODES.CHANGES,
          routeWorkspaceId
        );
    });

    expectChangesPanel(view.container, '', 'workspace-b');
    await view.unmount();
  });
});

function expectChangesPanel(
  container: HTMLElement,
  target = '',
  workspaceId = ROUTE_WORKSPACE_ID
) {
  const panel = container.querySelector<HTMLElement>(
    '[data-testid="changes-panel"]'
  );
  expect(panel?.dataset.workspaceId).toBe(workspaceId);
  expect(panel?.textContent).toBe(target);
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function renderLayout() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<WorkspacesLayout />);
  });

  return {
    container,
    rerender: async () => {
      await act(async () => root.render(<WorkspacesLayout />));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
