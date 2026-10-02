import type { Hono } from 'hono';
import type { ExternalTrackerAuthService } from './auth';
import { getJiraProviderScopes, isJiraExternalTrackerProvider } from './config';

type AuthProvider = ExternalTrackerAuthService | (() => Promise<ExternalTrackerAuthService>);

export function registerExternalTrackerAuthRoutes(
  hono: Hono,
  options: {
    /** @deprecated Ignored; external Kanban auth routes are always registered. */
    enabled?: boolean;
    auth: AuthProvider;
  },
): void {
  const getAuth = async () => typeof options.auth === 'function' ? await options.auth() : options.auth;

  hono.all('/dashboard/api/auth/*', async (c) => {
    return (await getAuth()).handler(c.req.raw);
  });

  hono.get('/dashboard/api/external-trackers/auth/status', async (c) => {
    const session = await (await getAuth()).getSession(c.req.raw.headers);
    return c.json({
      enabled: true,
      authenticated: Boolean(session),
      userId: session?.user.id,
    });
  });

  hono.post('/dashboard/api/external-trackers/auth/:provider/link', async (c) => {
    const provider = c.req.param('provider');
    if (!isJiraExternalTrackerProvider(provider)) {
      return c.json({ error: 'unsupported_external_tracker_provider' }, 400);
    }

    const auth = await getAuth();
    const session = await auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ error: 'authentication_required' }, 401);
    }

    const body = await c.req.json().catch(() => ({} as { callbackURL?: string }));
    const result = await auth.linkSocialAccount({
      headers: c.req.raw.headers,
      provider,
      callbackURL: typeof body.callbackURL === 'string' ? body.callbackURL : undefined,
    });

    if (result instanceof Response) return result;
    return c.json({ provider, scopes: getJiraProviderScopes(), result });
  });
}
