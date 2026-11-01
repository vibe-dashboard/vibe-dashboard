import { describe, expect, it } from 'vitest';
import { getWorkspacePanelId } from './workspacePanelId';

describe('getWorkspacePanelId', () => {
  it('uses the route workspace id while workspace data is still loading', () => {
    expect(getWorkspacePanelId('route-workspace', false)).toBe(
      'route-workspace'
    );
  });

  it('does not expose a workspace id in create mode', () => {
    expect(getWorkspacePanelId('create', true)).toBeUndefined();
  });
});
