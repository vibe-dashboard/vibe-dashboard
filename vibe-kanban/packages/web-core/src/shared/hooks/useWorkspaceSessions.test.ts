import { describe, expect, it } from 'vitest';
import { resolveSessionSelection } from './useWorkspaceSessions';

describe('resolveSessionSelection', () => {
  const sessions = [{ id: 'latest' }, { id: 'persisted' }];

  it('restores a valid preferred session', () => {
    expect(
      resolveSessionSelection(undefined, sessions, 'persisted', false)
    ).toEqual({ mode: 'existing', sessionId: 'persisted' });
  });

  it('preserves a valid explicit selection when sessions refresh', () => {
    expect(
      resolveSessionSelection(
        { mode: 'existing', sessionId: 'persisted' },
        sessions,
        'latest',
        false
      )
    ).toEqual({ mode: 'existing', sessionId: 'persisted' });
  });

  it('falls back to the latest session for an invalid stored id', () => {
    expect(
      resolveSessionSelection(undefined, sessions, 'deleted', false)
    ).toEqual({ mode: 'existing', sessionId: 'latest' });
  });

  it('preserves new-session mode only within the same workspace', () => {
    expect(
      resolveSessionSelection({ mode: 'new' }, sessions, null, false)
    ).toEqual({
      mode: 'new',
    });
    expect(
      resolveSessionSelection({ mode: 'new' }, sessions, null, true)
    ).toEqual({
      mode: 'existing',
      sessionId: 'latest',
    });
  });
});
