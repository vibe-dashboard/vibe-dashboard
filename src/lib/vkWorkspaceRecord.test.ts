import { describe, expect, it, vi } from 'vitest';
import { loadVkWorkspaceRecord } from './vkWorkspaceRecord';

describe('loadVkWorkspaceRecord', () => {
  it('unwraps the VK API response envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'workspace-1',
            name: 'Craft',
            branch: 'vk/craft',
            container_ref: '/tmp/craft',
          },
        }),
      ),
    );

    await expect(
      loadVkWorkspaceRecord('workspace/1', fetchImpl as typeof fetch),
    ).resolves.toEqual({
      id: 'workspace-1',
      name: 'Craft',
      branch: 'vk/craft',
      container_ref: '/tmp/craft',
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/workspaces/workspace%2F1');
  });
});
