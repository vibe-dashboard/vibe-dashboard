import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentPaneFooter } from './AgentPaneFooter';

describe('AgentPaneFooter', () => {
  it('renders compact session, executor, model, queue, stop, and send controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentPaneFooter, {
        workspaceId: 'workspace-1',
        sessions: [
          {
            id: 'session-1',
            workspace_id: 'workspace-1',
            executor: 'CODEX',
            created_at: '2026-09-14T00:00:00Z',
            updated_at: '2026-09-14T00:00:00Z',
          },
        ],
        selectedSessionId: 'session-1',
        loading: false,
        error: null,
        onSelect: () => undefined,
        onRetry: () => undefined,
        style: { left: 0, right: 0 },
      }),
    );

    expect(html).toContain('aria-label="Agent session"');
    expect(html).toContain('aria-label="Executor"');
    expect(html).toContain('aria-label="Model"');
    expect(html).toContain('aria-label="Reasoning"');
    expect(html).toContain('aria-label="Permission policy"');
    expect(html).toContain('Queue');
    expect(html).toContain('Stop');
    expect(html).toContain('Send');
  });
});
