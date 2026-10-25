import { execFile as execFileCallback } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { Hono } from 'hono';

const execFile = promisify(execFileCallback);
export type GitIdentity = { name: string; email: string };
const legacy =
  /^(vibe[ -]?kanban|vibe[ -]?dashboard|noreply@vibekanban\.com|vd-instance@localhost)$/i;

export function isConfiguredGitIdentity(identity: GitIdentity): boolean {
  return Boolean(
    identity.name.trim() &&
      /^[^\s<>@]+@[^\s<>@]+$/.test(identity.email) &&
      !/[\r\n\0<>]/.test(identity.name) &&
      !legacy.test(identity.name.trim()) &&
      !legacy.test(identity.email),
  );
}

export async function readGitIdentity(cwd = homedir()): Promise<GitIdentity> {
  const read = async (key: string) => {
    try {
      return (
        await execFile('git', ['config', '--get', key], { cwd })
      ).stdout.trim();
    } catch (error) {
      if ((error as { code?: number }).code === 1) return '';
      throw error;
    }
  };
  const [name, email] = await Promise.all([
    read('user.name'),
    read('user.email'),
  ]);
  return { name, email };
}

/** Validate the actual CLI author and committer, including local/env overrides. */
export async function requireGitIdentity(cwd: string): Promise<void> {
  if (!isConfiguredGitIdentity(await readGitIdentity(cwd))) {
    throw new Error(
      'Configure your Git name and email in Alohak onboarding before creating commits. Repository-local user.name/user.email must also identify you.',
    );
  }
  for (const role of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const { stdout } = await execFile('git', ['var', role], { cwd });
    const match = stdout.match(/^(.*?) <([^<>]+)> /);
    if (
      !match ||
      !isConfiguredGitIdentity({ name: match[1]!, email: match[2]! })
    ) {
      throw new Error(
        'A Git author or committer override uses an invalid identity. Configure your own name and email.',
      );
    }
  }
}

export function registerGitIdentityRoutes(hono: Hono): void {
  hono.get('/dashboard/api/git-identity', async (c) => {
    const identity = await readGitIdentity();
    return c.json({
      ...identity,
      configured: isConfiguredGitIdentity(identity),
    });
  });
  hono.put('/dashboard/api/git-identity', async (c) => {
    const body = await c.req.json().catch(() => null);
    const identity = {
      name: typeof body?.name === 'string' ? body.name.trim() : '',
      email: typeof body?.email === 'string' ? body.email.trim() : '',
    };
    if (!isConfiguredGitIdentity(identity))
      return c.json(
        { error: 'Enter your own Git name and email address.' },
        400,
      );
    await execFile('git', ['config', '--global', 'user.name', identity.name], {
      cwd: homedir(),
    });
    await execFile(
      'git',
      ['config', '--global', 'user.email', identity.email],
      { cwd: homedir() },
    );
    // An earlier version seeded the instance config repo with a product author.
    // Explicit confirmation above allows removing only those known defaults.
    const configRepo =
      process.env.VD_PLUGIN_INSTANCE_CONFIG_DIR ||
      '/var/lib/vd/instance-config';
    for (const key of ['user.name', 'user.email']) {
      try {
        const value = (
          await execFile('git', ['config', '--local', '--get', key], {
            cwd: configRepo,
          })
        ).stdout.trim();
        if (legacy.test(value))
          await execFile('git', ['config', '--local', '--unset-all', key], {
            cwd: configRepo,
          });
      } catch (error) {
        // Missing directory/repo/key is normal before the first plugin change.
        if (
          !['ENOENT', 1, 128].includes(
            (error as { code: string | number }).code,
          )
        )
          throw error;
      }
    }
    return c.json({ ...identity, configured: true });
  });
  // Read the authenticated human profile, not a GitHub App installation identity.
  // Return a suggestion for confirmation; never silently overwrite existing config.
  hono.get('/dashboard/api/git-identity/github', async (c) => {
    try {
      const options = {
        cwd: homedir(),
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      };
      const profile = JSON.parse(
        (
          await execFile(
            'gh',
            ['api', '--hostname', 'github.com', 'user'],
            options,
          )
        ).stdout,
      );
      let email = profile.email;
      if (!email) {
        const emails = JSON.parse(
          (
            await execFile(
              'gh',
              ['api', '--hostname', 'github.com', 'user/emails'],
              options,
            )
          ).stdout,
        );
        email = emails.find(
          (entry: { primary: boolean; verified: boolean }) =>
            entry.primary && entry.verified,
        )?.email;
      }
      const identity = {
        name: profile.name || profile.login || '',
        email: email || '',
      };
      if (!isConfiguredGitIdentity(identity))
        throw new Error('No usable profile identity');
      return c.json(identity);
    } catch {
      return c.json(
        {
          error:
            'Could not read your GitHub profile/email. Connect GitHub using gh auth login in the terminal, or enter your Git identity below.',
        },
        422,
      );
    }
  });
}
