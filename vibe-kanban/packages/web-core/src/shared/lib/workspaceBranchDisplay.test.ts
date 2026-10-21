import { describe, expect, it } from 'vitest';
import {
  getEffectiveRepoSourceBranch,
  getWorkspaceBranchPanelState,
} from './workspaceBranchDisplay';

const workspace = { branch: 'vk/generated' };

describe('workspaceBranchDisplay', () => {
  it('uses the generated workspace branch for create-branch repos', () => {
    expect(
      getEffectiveRepoSourceBranch(workspace, {
        create_branch: true,
        checkout_branch: 'feature',
      })
    ).toBe('vk/generated');

    expect(
      getWorkspaceBranchPanelState(workspace, [
        { create_branch: true, checkout_branch: null },
      ])
    ).toEqual({ label: 'vk/generated', canRename: true });
  });

  it('shows the direct checkout branch and disables rename for direct mode', () => {
    expect(
      getEffectiveRepoSourceBranch(workspace, {
        create_branch: false,
        checkout_branch: 'feature',
      })
    ).toBe('feature');

    const state = getWorkspaceBranchPanelState(workspace, [
      { create_branch: false, checkout_branch: 'feature' },
    ]);

    expect(state.label).toBe('feature');
    expect(state.canRename).toBe(false);
    expect(state.helpText).toContain('direct-branch workspaces');
  });

  it('summarizes multiple direct branches instead of exposing generated branch as editable', () => {
    const state = getWorkspaceBranchPanelState(workspace, [
      { create_branch: false, checkout_branch: 'feature-a' },
      { create_branch: false, checkout_branch: 'feature-b' },
    ]);

    expect(state.label).toBe('Multiple direct checkout branches');
    expect(state.canRename).toBe(false);
  });
});
