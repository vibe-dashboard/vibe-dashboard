import { serverRegistry } from 'springboard/server/register';
import { createExternalTrackerAuth, createExternalTrackerAuthService } from './server/auth';
import { getExternalIntegrationsDb } from '../server/database';
import { registerExternalTrackerBoardRoutes } from './server/boardRoutes';
import { registerExternalTrackerAuthRoutes } from './server/routes';

serverRegistry.registerServerModule(async (api) => {
  const handlePromise = getExternalIntegrationsDb();
  const authPromise = handlePromise.then((handle) => createExternalTrackerAuthService(createExternalTrackerAuth({
    sqlite: handle.sqlite,
    kysely: handle.db,
  })));
  const getDb = async () => (await handlePromise).db;
  const getAuth = async () => authPromise;

<<<<<<< HEAD
  registerExternalTrackerAuthRoutes(api.hono, { auth: getAuth });
  registerExternalTrackerBoardRoutes(api.hono, { auth: getAuth, db: getDb });
=======
  registerExternalTrackerAuthRoutes(api.hono, { auth });
  registerExternalTrackerBoardRoutes(api.hono, { auth, db: handle.db, workspaceBeads: {} });
>>>>>>> d5a5220e (feat: manage workspace-scoped beads in VD)
});
