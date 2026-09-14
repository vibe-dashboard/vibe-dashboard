import { describe, expect, it } from 'vitest';
import type { Session } from './vk-client';
import {
  buildAgentSessionUrl,
  resolveInitialAgentSessionId,
  sortAgentSessions,
} from './vkAgentSession';

const session = (
  id: string,
  updatedAt: string,
  createdAt = updatedAt,
): Session => ({
  id,
  workspace_id: 'workspace-1',
  executor: 'CODEX',
  created_at: createdAt,
  updated_at: updatedAt,
});

describe('VK Agent session helpers', () => {
  it('preserves the requested session when it belongs to the workspace', () => {
    const sessions = [
      session('older', '2026-09-12T00:00:00Z'),
      session('requested', '2026-09-11T00:00:00Z'),
    ];

    expect(resolveInitialAgentSessionId(sessions, 'requested')).toBe(
      'requested',
    );
  });

  it('falls back deterministically to the most recently updated session', () => {
    const sessions = [
      session('older', '2026-09-12T00:00:00Z'),
      session('latest', '2026-09-13T00:00:00Z'),
    ];

    expect(resolveInitialAgentSessionId(sessions, 'missing')).toBe('latest');
    expect(resolveInitialAgentSessionId([], 'missing')).toBeNull();
  });

  it('uses creation time and then id as stable sort tie breakers', () => {
    const sessions = [
      session('b', 'invalid', '2026-09-12T00:00:00Z'),
      session('a', 'invalid', '2026-09-12T00:00:00Z'),
      session('newest', 'invalid', '2026-09-13T00:00:00Z'),
    ];

    expect(sortAgentSessions(sessions).map(({ id }) => id)).toEqual([
      'newest',
      'a',
      'b',
    ]);
  });

  it('sets and removes session_id without disturbing chat_only or hashes', () => {
    const base =
      'https://vd.example/workspaces/workspace-1/vscode?chat_only=true#feed';

    expect(buildAgentSessionUrl(base, 'session / 1')).toBe(
      'https://vd.example/workspaces/workspace-1/vscode?chat_only=true&session_id=session+%2F+1#feed',
    );
    expect(
      buildAgentSessionUrl(
        'https://vd.example/workspaces/workspace-1/vscode?chat_only=true&session_id=old',
        null,
      ),
    ).toBe(
      'https://vd.example/workspaces/workspace-1/vscode?chat_only=true',
    );
  });
});
