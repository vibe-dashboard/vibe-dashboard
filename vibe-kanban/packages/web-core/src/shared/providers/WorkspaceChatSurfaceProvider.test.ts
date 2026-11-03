import { describe, expect, it } from 'vitest';
import { scopeWorkspaceChatStateKey } from './WorkspaceChatSurfaceProvider';

describe('scopeWorkspaceChatStateKey', () => {
  it('isolates identical display keys between Agent surfaces', () => {
    expect(scopeWorkspaceChatStateKey('tool:entry-1', 'left')).toBe(
      'surface:left:tool:entry-1'
    );
    expect(scopeWorkspaceChatStateKey('tool:entry-1', 'right')).toBe(
      'surface:right:tool:entry-1'
    );
  });

  it('preserves standalone VK keys without a surface provider', () => {
    expect(scopeWorkspaceChatStateKey('tool:entry-1', null)).toBe(
      'tool:entry-1'
    );
  });
});
