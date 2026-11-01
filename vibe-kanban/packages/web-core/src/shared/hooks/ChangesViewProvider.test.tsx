/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangesViewProvider } from './ChangesViewProvider';
import {
  useChangesView,
  type ScrollToFileCallback,
} from '@/shared/hooks/useChangesView';
import {
  RIGHT_MAIN_PANEL_MODES,
  useUiPreferencesStore,
} from '@/shared/stores/useUiPreferencesStore';
import { useFileInViewStore } from '@/shared/stores/useFileInViewStore';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
  useUiPreferencesStore.setState({
    mobileActiveTab: 'chat',
    workspacePanelStates: {},
    isLeftSidebarVisible: true,
  });
  useFileInViewStore.setState({ fileInView: null });
});

describe('ChangesViewProvider', () => {
  it('replays a pending selected file once when a scroll callback registers', async () => {
    const { getApi, unmount } = await renderProviderProbe();
    const scrollToFile = vi.fn<ScrollToFileCallback>();

    await act(async () => {
      getApi().scrollToFile('src/file-a.ts', 12);
    });

    expect(scrollToFile).not.toHaveBeenCalled();

    await act(async () => {
      getApi().registerScrollToFile(scrollToFile);
    });

    expect(scrollToFile).toHaveBeenCalledTimes(1);
    expect(scrollToFile).toHaveBeenLastCalledWith('src/file-a.ts', 12);

    await act(async () => {
      getApi().registerScrollToFile(scrollToFile);
    });

    expect(scrollToFile).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('queues the same file again when it is selected while unregistered', async () => {
    const { getApi, unmount } = await renderProviderProbe();
    const scrollToFile = vi.fn<ScrollToFileCallback>();

    await act(async () => {
      getApi().scrollToFile('src/file-a.ts');
      getApi().registerScrollToFile(scrollToFile);
      getApi().registerScrollToFile(null);
      getApi().scrollToFile('src/file-a.ts');
      getApi().registerScrollToFile(scrollToFile);
    });

    expect(scrollToFile).toHaveBeenCalledTimes(2);
    expect(scrollToFile).toHaveBeenNthCalledWith(1, 'src/file-a.ts', undefined);
    expect(scrollToFile).toHaveBeenNthCalledWith(2, 'src/file-a.ts', undefined);

    await unmount();
  });

  it('replays a file opened from chat after the changes panel mounts', async () => {
    mockMatchMedia(true);

    const { getApi, unmount } = await renderProviderProbe({
      workspaceId: 'workspace-1',
    });
    const scrollToFile = vi.fn<ScrollToFileCallback>();

    await act(async () => {
      getApi().viewFileInChanges('src/from-chat.ts');
    });

    expect(scrollToFile).not.toHaveBeenCalled();

    await act(async () => {
      getApi().registerScrollToFile(scrollToFile);
    });

    expect(scrollToFile).toHaveBeenCalledTimes(1);
    expect(scrollToFile).toHaveBeenCalledWith('src/from-chat.ts', undefined);
    expect(
      useUiPreferencesStore.getState().getWorkspacePanelState('workspace-1')
        .rightMainPanelMode
    ).toBe(RIGHT_MAIN_PANEL_MODES.CHANGES);
    expect(useUiPreferencesStore.getState().mobileActiveTab).toBe('changes');

    await unmount();
  });

  it('does not switch panels when opening a file without a workspace id', async () => {
    mockMatchMedia(true);

    const { getApi, unmount } = await renderProviderProbe();

    await act(async () => {
      getApi().viewFileInChanges('src/from-chat.ts');
    });

    expect(
      useUiPreferencesStore.getState().getWorkspacePanelState('workspace-1')
        .rightMainPanelMode
    ).not.toBe(RIGHT_MAIN_PANEL_MODES.CHANGES);
    expect(useUiPreferencesStore.getState().mobileActiveTab).toBe('chat');

    await unmount();
  });

  it('isolates a pending unmounted Changes request across workspace transitions', async () => {
    const { getApi, rerenderWorkspace, unmount } = await renderProviderProbe({
      workspaceId: 'workspace-a',
    });

    await act(async () => {
      getApi().scrollToFile('src/workspace-a.ts', 17);
    });

    expect(getApi().selectedFilePath).toBe('src/workspace-a.ts');
    expect(getApi().selectedLineNumber).toBe(17);
    expect(useFileInViewStore.getState().fileInView).toBe('src/workspace-a.ts');

    await rerenderWorkspace('workspace-b');

    const workspaceBScroll = vi.fn<ScrollToFileCallback>();
    expect(getApi().selectedFilePath).toBeNull();
    expect(getApi().selectedLineNumber).toBeNull();
    expect(useFileInViewStore.getState().fileInView).toBeNull();

    await act(async () => {
      getApi().registerScrollToFile(workspaceBScroll);
    });

    expect(workspaceBScroll).not.toHaveBeenCalled();
    await unmount();
  });

  it('suppresses stale callbacks and replays a fresh workspace request exactly once', async () => {
    const { getApi, rerenderWorkspace, unmount } = await renderProviderProbe({
      workspaceId: 'workspace-a',
    });
    const workspaceAScroll = vi.fn<ScrollToFileCallback>();

    await act(async () => {
      getApi().scrollToFile('src/already-replayed.ts', 4);
      getApi().registerScrollToFile(workspaceAScroll);
    });

    expect(workspaceAScroll).toHaveBeenCalledTimes(1);
    const staleWorkspaceAApi = getApi();

    await rerenderWorkspace('workspace-b');

    await act(async () => {
      staleWorkspaceAApi.scrollToFile('src/stale-a.ts', 8);
    });

    expect(workspaceAScroll).toHaveBeenCalledTimes(1);
    expect(useFileInViewStore.getState().fileInView).toBeNull();

    const workspaceBScroll = vi.fn<ScrollToFileCallback>();
    await act(async () => {
      getApi().scrollToFile('src/fresh-b.ts', 22);
      getApi().registerScrollToFile(workspaceBScroll);
      getApi().registerScrollToFile(workspaceBScroll);
    });

    expect(workspaceBScroll).toHaveBeenCalledTimes(1);
    expect(workspaceBScroll).toHaveBeenCalledWith('src/fresh-b.ts', 22);
    expect(getApi().selectedFilePath).toBe('src/fresh-b.ts');
    expect(getApi().selectedLineNumber).toBe(22);
    expect(useFileInViewStore.getState().fileInView).toBe('src/fresh-b.ts');

    await unmount();
  });
});

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
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

async function renderProviderProbe({
  workspaceId,
}: { workspaceId?: string } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let api: ReturnType<typeof useChangesView> | null = null;

  function Probe() {
    api = useChangesView();
    return null;
  }

  const renderWorkspace = (nextWorkspaceId?: string) => (
    <ChangesViewProvider
      key={nextWorkspaceId ?? 'no-workspace'}
      workspaceId={nextWorkspaceId}
    >
      <Probe />
    </ChangesViewProvider>
  );

  await act(async () => {
    root.render(renderWorkspace(workspaceId));
  });

  return {
    getApi: () => {
      if (!api) throw new Error('ChangesViewProvider probe did not render');
      return api;
    },
    rerenderWorkspace: async (nextWorkspaceId?: string) => {
      api = null;
      await act(async () => {
        root.render(renderWorkspace(nextWorkspaceId));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
