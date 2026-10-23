import React from 'react';
import type { Tab, TabGroup } from '../../../types';
import { PreviewRunConfigsPanel } from '../../../components/PreviewRunConfigsPanel';
import { WorkspacePreviewMenu } from '../../../components/WorkspacePreviewMenu';
import { RetryableInlineSurface } from '../../../components/RetryableInlineSurface';
import {
  BUILT_IN_AGENT_TAB_ID,
  BUILT_IN_SECOND_AGENT_TAB_ID,
  BUILT_IN_DIFF_TAB_ID,
  getBuiltInWorkspaceMetadata,
} from './craft-surfaces';

const loadInlineVkAgentChat = () =>
  import('@vibe/inline-chat').then((module) => ({
    default: module.InlineVkAgentChat,
  }));
const loadInlineVkCreateWorkspace = () =>
  import('@vibe/inline-chat').then((module) => ({
    default: module.InlineVkCreateWorkspace,
  }));
const loadDiffView = () =>
  import('../../../components/DiffView').then((module) => ({
    default: module.DiffView,
  }));

export interface ReactCraftSurfaceTarget {
  kind: 'react';
  pluginId: string;
  surfaceKey: string;
  props: Record<string, string>;
}

export interface ReactCraftSurfaceHostContext {
  onConfigurePreviewSlots?: () => void;
  onWorkspaceCreated?: (workspaceId: string) => void;
  onOpenCraft?: () => void;
  onRemoveCraft?: () => void;
  onViewDiffs?: () => void;
}

interface ReactCraftSurfaceComponentProps {
  surfaceProps: Record<string, string>;
  host: ReactCraftSurfaceHostContext;
}

type ReactCraftSurfaceComponent = (
  props: ReactCraftSurfaceComponentProps,
) => React.ReactElement;

const FIRST_PARTY_REACT_SURFACES: Record<string, ReactCraftSurfaceComponent> = {
  'dev.mickmister.preview-server/run-configs': ({ surfaceProps }) => (
    <PreviewRunConfigsPanel workspaceId={surfaceProps.workspaceId ?? ''} />
  ),
  'vd.built-in/agent-chat': ({ surfaceProps, host }) => (
    <RetryableInlineSurface
      key={surfaceProps.surfaceId ?? surfaceProps.workspaceId}
      label="Agent chat"
      load={loadInlineVkAgentChat}
      componentProps={{
        workspaceId: surfaceProps.workspaceId ?? '',
        surfaceId:
          surfaceProps.surfaceId ?? surfaceProps.workspaceId ?? 'agent',
        workspacePreview:
          surfaceProps.workspaceId && host.onConfigurePreviewSlots ? (
            <WorkspacePreviewMenu
              workspaceId={surfaceProps.workspaceId}
              onConfigure={host.onConfigurePreviewSlots}
            />
          ) : undefined,
        onOpenCraft: host.onOpenCraft,
        onRemoveCraft: host.onRemoveCraft,
        onViewDiffs: host.onViewDiffs,
      }}
    />
  ),
  'vd.built-in/diffs': ({ surfaceProps }) => (
    <RetryableInlineSurface
      key={surfaceProps.workspaceId}
      label="Diffs"
      load={loadDiffView}
      componentProps={{
        workspaceId: surfaceProps.workspaceId ?? '',
        workspaceDir: surfaceProps.workspaceDir ?? '',
      }}
    />
  ),
  'vd.built-in/create-workspace': ({ surfaceProps, host }) => (
    <RetryableInlineSurface
      key={surfaceProps.surfaceId}
      label="Create Workspace"
      load={loadInlineVkCreateWorkspace}
      componentProps={{
        surfaceId: surfaceProps.surfaceId ?? 'create-workspace',
        onWorkspaceCreated: host.onWorkspaceCreated,
      }}
    />
  ),
};

export function getReactCraftSurfaceTarget(
  tab: Tab,
  tabGroup: Pick<TabGroup, 'tabs' | 'workspace'> & { id?: string },
): ReactCraftSurfaceTarget | null {
  const workspace = getBuiltInWorkspaceMetadata(tabGroup);

  if (tab.id === BUILT_IN_DIFF_TAB_ID && workspace?.workspaceId) {
    return {
      kind: 'react',
      pluginId: 'vd.built-in',
      surfaceKey: 'diffs',
      props: {
        workspaceId: workspace.workspaceId,
        workspaceDir: workspace.workspaceDir,
      },
    };
  }

  if (
    (tab.id === BUILT_IN_AGENT_TAB_ID || tab.id === BUILT_IN_SECOND_AGENT_TAB_ID) &&
    workspace?.workspaceId
  ) {
    return {
      kind: 'react',
      pluginId: 'vd.built-in',
      surfaceKey: 'agent-chat',
      props: {
        workspaceId: workspace.workspaceId,
        surfaceId: `${tabGroup.id ?? workspace.workspaceId}:${tab.id}`,
      },
    };
  }

  if (isCreateWorkspaceTab(tab)) {
    return {
      kind: 'react',
      pluginId: 'vd.built-in',
      surfaceKey: 'create-workspace',
      props: {
        surfaceId: `${tabGroup.id ?? 'workspace'}:${tab.id}`,
      },
    };
  }

  if (tab.ephemeral?.kind !== 'craft-surface') return null;

  const key = getReactCraftSurfaceLookupKey(tab.ephemeral);
  if (!key) return null;

  return {
    kind: 'react',
    pluginId: tab.ephemeral.pluginId,
    surfaceKey: tab.ephemeral.surfaceKey,
    props: workspace?.workspaceId ? { workspaceId: workspace.workspaceId } : {},
  };
}

export function getPreviewServerTabId(
  tabGroup: Pick<TabGroup, 'tabs'>,
): string | null {
  return (
    tabGroup.tabs.find(
      (tab) =>
        tab.ephemeral?.kind === 'craft-surface' &&
        tab.ephemeral.pluginId === 'dev.mickmister.preview-server' &&
        tab.ephemeral.surfaceKey ===
          'dev.mickmister.preview-server/run-configs',
    )?.id ?? null
  );
}

function isCreateWorkspaceTab(tab: Tab): boolean {
  if (tab.title !== 'Create Workspace') return false;
  try {
    const url = new URL(tab.url, 'https://workspace.local');
    return url.pathname === '/workspaces';
  } catch {
    return tab.url === '/workspaces';
  }
}

export function hasReactCraftSurface(
  target: Pick<ReactCraftSurfaceTarget, 'pluginId' | 'surfaceKey'>,
): boolean {
  return getReactCraftSurfaceComponent(target) != null;
}

export function ReactCraftSurfaceHost({
  target,
  context = {},
}: {
  target: ReactCraftSurfaceTarget;
  context?: ReactCraftSurfaceHostContext;
}): React.ReactElement {
  const Component = getReactCraftSurfaceComponent(target);
  if (!Component) return <UnknownReactCraftSurface target={target} />;
  return (
    <div
      className="h-full min-h-0 bg-neutral-950"
      data-testid={`react-craft-surface:${target.pluginId}/${target.surfaceKey}`}
    >
      <Component surfaceProps={target.props} host={context} />
    </div>
  );
}

function getReactCraftSurfaceLookupKey(surface: {
  pluginId: string;
  surfaceKey: string;
  sourceKey?: string;
}): string | null {
  const keys = [
    surface.sourceKey ? `${surface.pluginId}/${surface.sourceKey}` : null,
    `${surface.pluginId}/${surface.surfaceKey}`,
  ].filter((key): key is string => key != null);

  return keys.find((key) => FIRST_PARTY_REACT_SURFACES[key]) ?? null;
}

function getReactCraftSurfaceComponent(target: {
  pluginId: string;
  surfaceKey: string;
}): ReactCraftSurfaceComponent | null {
  const sourceKey = target.surfaceKey.startsWith(`${target.pluginId}/`)
    ? target.surfaceKey.slice(target.pluginId.length + 1)
    : null;
  const keys = [
    sourceKey ? `${target.pluginId}/${sourceKey}` : null,
    `${target.pluginId}/${target.surfaceKey}`,
  ].filter((key): key is string => key != null);

  const key = keys.find((candidate) => FIRST_PARTY_REACT_SURFACES[candidate]);
  if (!key) return null;
  return FIRST_PARTY_REACT_SURFACES[key] ?? null;
}

function UnknownReactCraftSurface({
  target,
}: {
  target: ReactCraftSurfaceTarget;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-950 p-6 text-center text-sm text-neutral-400">
      <div>
        <p className="font-medium text-neutral-200">
          React surface unavailable
        </p>
        <p className="mt-2">
          {target.pluginId}/{target.surfaceKey}
        </p>
      </div>
    </div>
  );
}
