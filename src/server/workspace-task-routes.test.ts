import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkspaceTaskRoutes } from './workspace-task-routes';

describe('workspace task routes', () => {
  it('returns bd-backed workspace tasks for an Agent surface', async () => {
    const client = {
      listWorkspaceTasks: vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({
        workspaceId,
        dir: `/var/lib/vd/beads/workspaces/${workspaceId}/.beads`,
        dirExists: true,
        initialized: true,
        tasks: [],
        counts: { open: 1, inProgress: 2, done: 3 },
        groups: { open: [], inProgress: [], done: [] },
        updateStrategy: {
          mode: 'short-poll-when-visible',
          intervalMs: 20_000,
          rationale: 'test',
        },
      })),
    };
    const app = new Hono();
    registerWorkspaceTaskRoutes(app, { client: client as never });

    const response = await app.request('/dashboard/api/workspaces/workspace-1/beads/tasks');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      counts: { open: 1, inProgress: 2, done: 3 },
    });
    expect(client.listWorkspaceTasks).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
  });
});
