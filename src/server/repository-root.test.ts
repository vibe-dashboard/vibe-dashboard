import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { registerVkRepoRoutes } from './vk-repo-routes';
import { getReposRoot } from './repository-root';

afterEach(() => vi.unstubAllEnvs());

it('uses the overridden repository root for cloning and the editor entrypoint', async () => {
  vi.stubEnv('REPOS_ROOT', '/custom/repos with spaces');
  const cloneRepo = vi.fn(async () => '/custom/repos with spaces/example');
  const registerRepo = vi.fn(async () => ({ id: 'repo-1' }) as any);
  const app = new Hono();
  registerVkRepoRoutes(app, { cloneRepo, vkClient: { registerRepo } });
  const response = await app.request(
    '/dashboard/api/external-trackers/vk/repos/clone',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/example/example' }),
    },
  );
  expect(response.status).toBe(200);
  expect(cloneRepo).toHaveBeenCalledWith(
    expect.objectContaining({ reposRoot: '/custom/repos with spaces' }),
  );
  const editor = await app.request('/dashboard/api/repos/editor');
  expect(editor.headers.get('location')).toBe(
    '/?folder=%2Fcustom%2Frepos%20with%20spaces',
  );
});

it('rejects relative root overrides', () => {
  vi.stubEnv('REPOS_ROOT', 'relative/repos');
  expect(() => getReposRoot()).toThrow('absolute path');
});
