declare module '@vibe/inline-chat' {
  import type { CSSProperties, ReactElement } from 'react';

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

  export function InlineVkAgentChat(
    props: InlineVkAgentChatProps,
  ): ReactElement;

  export function InlineVkCreateWorkspace(
    props: InlineVkCreateWorkspaceProps,
  ): ReactElement;
}
