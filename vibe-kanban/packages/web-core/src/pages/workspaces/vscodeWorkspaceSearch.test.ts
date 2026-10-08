import { describe, expect, it } from 'vitest';
import { parseVSCodeWorkspaceSearch } from './vscodeWorkspaceSearch';

describe('parseVSCodeWorkspaceSearch', () => {
  it('enables chat-only mode only for an explicit true value', () => {
    expect(parseVSCodeWorkspaceSearch({ chat_only: 'true' }).chatOnly).toBe(
      true
    );
    expect(parseVSCodeWorkspaceSearch({ chat_only: true }).chatOnly).toBe(true);
    expect(parseVSCodeWorkspaceSearch({ chat_only: 'false' }).chatOnly).toBe(
      false
    );
    expect(parseVSCodeWorkspaceSearch({ chat_only: '1' }).chatOnly).toBe(false);
  });

  it('accepts a non-empty session_id and ignores invalid values', () => {
    expect(
      parseVSCodeWorkspaceSearch({ session_id: 'session-123' }).sessionId
    ).toBe('session-123');
    expect(parseVSCodeWorkspaceSearch({ session_id: '' }).sessionId).toBe(
      undefined
    );
    expect(parseVSCodeWorkspaceSearch({ session_id: 123 }).sessionId).toBe(
      undefined
    );
  });
});
