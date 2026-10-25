import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isConfiguredGitIdentity,
  readGitIdentity,
  registerGitIdentityRoutes,
  requireGitIdentity,
} from './git-identity';

const execFile = promisify(execFileCallback);
let root: string;
let app: Hono;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'alohak-identity-'));
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'global.gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv(
    'VD_PLUGIN_INSTANCE_CONFIG_DIR',
    join(root, 'instance-config-not-yet-created'),
  );
  await execFile('git', ['init', root]);
  app = new Hono();
  registerGitIdentityRoutes(app);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('configured Git identity onboarding', () => {
  it('requires a real configured identity instead of old product defaults', async () => {
    for (const identity of [
      { name: '', email: '' },
      { name: 'Vibe Kanban', email: 'noreply@vibekanban.com' },
      { name: 'Vibe Dashboard', email: 'vd-instance@localhost' },
      { name: 'Actual User', email: 'noreply@vibekanban.com' },
    ]) {
      expect(isConfiguredGitIdentity(identity)).toBe(false);
      const response = await app.request('/dashboard/api/git-identity', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(identity),
      });
      expect(response.status).toBe(400);
    }
    await expect(requireGitIdentity(root)).rejects.toThrow(
      'Configure your Git name',
    );
  });

  it('persists confirmed identity and uses it for actual author and committer signatures', async () => {
    const identity = { name: 'Actual User', email: 'actual@example.com' };
    const response = await app.request('/dashboard/api/git-identity', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(identity),
    });
    expect(response.status).toBe(200);
    expect(await readGitIdentity(root)).toEqual(identity);
    await expect(requireGitIdentity(root)).resolves.toBeUndefined();
    await execFile(
      'git',
      ['commit', '--allow-empty', '-m', 'Identity verification'],
      { cwd: root },
    );
    const { stdout } = await execFile(
      'git',
      ['log', '-1', '--format=%an <%ae>|%cn <%ce>'],
      { cwd: root },
    );
    expect(stdout.trim()).toBe(
      'Actual User <actual@example.com>|Actual User <actual@example.com>',
    );
    vi.stubEnv('GIT_COMMITTER_NAME', 'Vibe Kanban');
    await expect(requireGitIdentity(root)).rejects.toThrow('override');
  });

  it('clears only known seeded local defaults when a user confirms their identity', async () => {
    vi.stubEnv('VD_PLUGIN_INSTANCE_CONFIG_DIR', root);
    await execFile('git', ['config', 'user.name', 'Vibe Dashboard'], {
      cwd: root,
    });
    await execFile('git', ['config', 'user.email', 'vd-instance@localhost'], {
      cwd: root,
    });
    const response = await app.request('/dashboard/api/git-identity', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Actual User',
        email: 'actual@example.com',
      }),
    });
    expect(response.status).toBe(200);
    expect(await readGitIdentity(root)).toEqual({
      name: 'Actual User',
      email: 'actual@example.com',
    });
    await execFile('git', ['config', 'user.name', 'Project Maintainer'], {
      cwd: root,
    });
    await app.request('/dashboard/api/git-identity', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Another User',
        email: 'another@example.com',
      }),
    });
    expect((await readGitIdentity(root)).name).toBe('Project Maintainer');
  });

  it('suggests a verified GitHub email without silently configuring Git', async () => {
    const gh = join(root, 'gh');
    await writeFile(
      gh,
      '#!/bin/sh\ncase "$4" in\nuser) printf \'{"login":"actual","name":"Actual User","email":null}\' ;;\nuser/emails) printf \'[{"email":"private@example.com","primary":true,"verified":true}]\' ;;\nesac\n',
      { mode: 0o755 },
    );
    vi.stubEnv('PATH', `${root}:${process.env.PATH}`);
    const response = await app.request('/dashboard/api/git-identity/github');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: 'Actual User',
      email: 'private@example.com',
    });
    expect(await readGitIdentity(root)).toEqual({ name: '', email: '' });
  });
});
