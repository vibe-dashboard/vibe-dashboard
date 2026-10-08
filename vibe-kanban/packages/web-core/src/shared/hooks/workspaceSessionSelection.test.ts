import { describe, expect, it } from 'vitest';
import { resolveWorkspaceSessionId } from './workspaceSessionSelection';

const sessions = [{ id: 'latest' }, { id: 'requested' }];

describe('resolveWorkspaceSessionId', () => {
  it('uses a valid route session before local selection is initialized', () => {
    expect(resolveWorkspaceSessionId(sessions, undefined, 'requested')).toBe(
      'requested'
    );
  });

  it('falls back to latest for invalid or missing selections', () => {
    expect(resolveWorkspaceSessionId(sessions, undefined, 'missing')).toBe(
      'latest'
    );
    expect(resolveWorkspaceSessionId(sessions, undefined, undefined)).toBe(
      'latest'
    );
  });

  it('preserves an explicit local selection when there is no route request', () => {
    expect(resolveWorkspaceSessionId(sessions, 'requested', undefined)).toBe(
      'requested'
    );
  });
});
