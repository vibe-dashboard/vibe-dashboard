import { serverRegistry } from 'springboard/server/register';
import { getExternalIntegrationsDb } from '../server/database';
import { registerLinearBoardRoutes } from './server/boardRoutes';

serverRegistry.registerServerModule(async (api) => {
  const handlePromise = getExternalIntegrationsDb();
  registerLinearBoardRoutes(api.hono, { db: async () => (await handlePromise).db });
});
