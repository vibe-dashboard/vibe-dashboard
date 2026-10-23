declare module '@vibe/inline-chat' {
  import type { CSSProperties, ReactElement, ReactNode } from 'react';

  export type InlineVkAgentChatTheme = {
    className?: string;
    style?: CSSProperties;
  };

  export type InlineVkAgentChatProps = {
    workspaceId: string;
    surfaceId: string;
    title?: string;
    theme?: InlineVkAgentChatTheme;
    chatViewMode?: 'full' | 'mostly-zen' | 'zen';
    workspacePreview?: ReactNode;
    onOpenCraft?: () => void;
    onRemoveCraft?: () => void;
    onViewDiffs?: () => void;
  };

  export type InlineVkCreateWorkspaceProps = {
    surfaceId: string;
    theme?: InlineVkAgentChatTheme;
    onWorkspaceCreated?: (workspaceId: string) => void;
    chatViewMode?: 'full' | 'mostly-zen' | 'zen';
  };

  export function InlineVkAgentChat(
    props: InlineVkAgentChatProps,
  ): ReactElement;

  export function InlineVkCreateWorkspace(
    props: InlineVkCreateWorkspaceProps,
  ): ReactElement;
}
