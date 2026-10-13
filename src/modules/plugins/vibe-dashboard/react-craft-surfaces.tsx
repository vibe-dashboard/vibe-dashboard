import React from 'react';
import type { Tab, TabGroup } from '../../../types';
import { PreviewRunConfigsPanel } from '../../../components/PreviewRunConfigsPanel';
import {
  BUILT_IN_AGENT_TAB_ID,
  getBuiltInWorkspaceMetadata,
} from './craft-surfaces';

const InlineVkAgentChat = React.lazy(() =>
  import('@vibe/inline-chat').then((module) => ({
    default: module.InlineVkAgentChat,
  })),
);
const InlineVkCreateWorkspace = React.lazy(() =>
  import('@vibe/inline-chat').then((module) => ({
    default: module.InlineVkCreateWorkspace,
  })),
);

export interface ReactCraftSurfaceTarget {
  kind: 'react';
  pluginId: string;
  surfaceKey: string;
  props: Record<string, string>;
}

type ReactCraftSurfaceComponent = (
  props: Record<string, string>,
) => React.ReactElement;

const FIRST_PARTY_REACT_SURFACES: Record<string, ReactCraftSurfaceComponent> = {
  'dev.mickmister.preview-server/run-configs': (props) => (
    <PreviewRunConfigsPanel workspaceId={props.workspaceId ?? ''} />
  ),
  'vd.built-in/agent-chat': (props) => (
    <React.Suspense fallback={<InlineSurfaceLoading />}>
      <InlineVkAgentChat
        workspaceId={props.workspaceId ?? ''}
        surfaceId={props.surfaceId ?? props.workspaceId ?? 'agent'}
      />
    </React.Suspense>
  ),
  'vd.built-in/create-workspace': (props) => (
    <React.Suspense fallback={<InlineSurfaceLoading />}>
      <InlineVkCreateWorkspace
        surfaceId={props.surfaceId ?? 'create-workspace'}
      />
    </React.Suspense>
  ),
};

export function getReactCraftSurfaceTarget(
  tab: Tab,
  tabGroup: Pick<TabGroup, 'tabs' | 'workspace'> & { id?: string },
): ReactCraftSurfaceTarget | null {
  const workspace = getBuiltInWorkspaceMetadata(tabGroup);

  if (tab.id === BUILT_IN_AGENT_TAB_ID && workspace?.workspaceId) {
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
    props: workspace?.workspaceId
      ? { workspaceId: workspace.workspaceId }
      : {},
  };
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
}: {
  target: ReactCraftSurfaceTarget;
}): React.ReactElement {
  const Component = getReactCraftSurfaceComponent(target);
  if (!Component) return <UnknownReactCraftSurface target={target} />;
  return (
    <div
      className="h-full min-h-0 bg-neutral-950"
      data-testid={`react-craft-surface:${target.pluginId}/${target.surfaceKey}`}
    >
      <Component {...target.props} />
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

function InlineSurfaceLoading() {
  return (
    <div
      className="flex h-full items-center justify-center bg-neutral-950 text-sm text-neutral-400"
      data-testid="inline-vk-agent-chat"
    >
      Loading agent chat
    </div>
  );
}
