import type { Hono } from 'hono';
import {
  createNodeBeadsClient,
  type BeadsClient,
} from '../lib/beadsClient.node';

export function registerWorkspaceTaskRoutes(
  app: Hono,
  options: { client?: BeadsClient } = {},
): void {
  app.get('/dashboard/api/workspaces/:workspaceId/beads/tasks', async (c) => {
    const workspaceId = c.req.param('workspaceId') ?? '';
    if (!workspaceId.trim()) {
      return c.json({ message: 'workspaceId is required' }, 400);
    }

    try {
      const client = options.client ?? createNodeBeadsClient();
      return c.json(await client.listWorkspaceTasks({ workspaceId }));
    } catch (error) {
      return c.json({
        message: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  });
}
