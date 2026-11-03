import type { Hono } from 'hono';
import { buildPreviewSlotUrl } from '../lib/previewSlotUrl';
import {
  PreviewSlotManager,
  PreviewSlotManagementError,
} from './preview-slot-manager';
import {
  VibeKanbanServerClient,
  VkApiError,
  type PreviewResolveRequest,
  type PreviewResolveResponse,
  type UpsertPreviewSlot,
  type UpsertRunConfig,
} from './vk-client';

export interface RegisterPreviewResolverRoutesOptions {
  vkClient?: Pick<VibeKanbanServerClient, 'resolvePreview'> &
    Partial<
      Pick<
        VibeKanbanServerClient,
        | 'getRunConfigs'
        | 'upsertRunConfig'
        | 'upsertPreviewSlot'
        | 'startRunConfig'
        | 'startPreviewSlot'
        | 'stopExecutionProcess'
        | 'deletePreviewSlot'
        | 'deleteRunConfig'
      >
    >;
}

const VALID_RESOLVE_STATUSES = new Set([
  'ready',
  'starting',
  'not_found',
  'capacity_full',
  'failed',
  'unavailable',
  'error',
]);

export function registerPreviewResolverRoutes(
  app: Hono,
  options: RegisterPreviewResolverRoutesOptions = {},
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();
  const slotManager = new PreviewSlotManager(
    vkClient as VibeKanbanServerClient,
  );

  const slotPath =
    '/internal/preview/workspaces/:workspaceId/preview-slots/:previewSlotId';
  app.put(`${slotPath}/script`, async (c) => {
    const payload = await parseJson<{ command?: unknown }>(c.req.raw);
    if (!payload.ok) return c.json({ message: payload.message }, 400);
    try {
      return c.json(
        await slotManager.updateScript(
          c.req.param('workspaceId'),
          c.req.param('previewSlotId'),
          payload.value?.command,
        ),
      );
    } catch (error) {
      if (error instanceof PreviewSlotManagementError)
        return c.json({ message: error.message }, error.status);
      console.warn('Preview script update failed', error);
      return c.json({ message: 'Preview script could not be saved' }, 502);
    }
  });
  app.post(`${slotPath}/restart`, async (c) => {
    try {
      return c.json(
        await slotManager.restart(
          c.req.param('workspaceId'),
          c.req.param('previewSlotId'),
        ),
      );
    } catch (error) {
      if (error instanceof PreviewSlotManagementError)
        return c.json({ message: error.message }, error.status);
      console.warn('Preview restart failed', error);
      return c.json({ message: 'Preview server could not be restarted' }, 502);
    }
  });
  app.delete(slotPath, async (c) => {
    try {
      await slotManager.delete(
        c.req.param('workspaceId'),
        c.req.param('previewSlotId'),
      );
      return c.json({ deleted: true });
    } catch (error) {
      if (error instanceof PreviewSlotManagementError)
        return c.json({ message: error.message }, error.status);
      if (error instanceof VkApiError && error.status === 405)
        return c.json({ message: 'Deleting preview slots requires an updated VK backend.' }, 502);
      console.warn('Preview slot deletion failed', error);
      return c.json({ message: 'Preview slot could not be deleted' }, 502);
    }
  });
  app.delete('/internal/preview/workspaces/:workspaceId/run-configs/:runConfigId', async (c) => {
    try {
      await slotManager.deleteRunConfig(c.req.param('workspaceId'), c.req.param('runConfigId'));
      return c.json({ deleted: true });
    } catch (error) {
      if (error instanceof PreviewSlotManagementError)
        return c.json({ message: error.message }, error.status);
      if (error instanceof VkApiError && error.status === 405)
        return c.json({ message: 'Deleting run configs requires an updated VK backend.' }, 502);
      if (error instanceof VkApiError && error.status === 400)
        return c.json({ message: error.message }, 400);
      console.warn('Run config deletion failed', error);
      return c.json({ message: 'Run config could not be deleted' }, 502);
    }
  });
  app.get(`${slotPath}/process`, async (c) => {
    try {
      return c.json(
        await slotManager.getProcess(
          c.req.param('workspaceId'),
          c.req.param('previewSlotId'),
        ),
      );
    } catch (error) {
      if (error instanceof PreviewSlotManagementError)
        return c.json({ message: error.message }, error.status);
      console.warn('Preview process lookup failed', error);
      return c.json({ message: 'Preview process could not be loaded' }, 502);
    }
  });

  app.post('/internal/preview/resolve', async (c) => {
    let payload: PreviewResolveRequest;
    try {
      payload = await c.req.json<PreviewResolveRequest>();
    } catch {
      return c.json(
        { status: 'error', message: 'Invalid preview resolve JSON' },
        400,
      );
    }

    const validationError = validatePreviewResolveRequest(payload);
    if (validationError) {
      return c.json({ status: 'not_found', message: validationError }, 200);
    }

    try {
      const response = await vkClient.resolvePreview(payload);
      return c.json(normalizeResolveResponse(response), 200);
    } catch (error) {
      console.warn('Preview resolver VK request failed', error);
      return c.json(
        {
          status: 'unavailable',
          message: 'Preview resolver backend is unavailable',
        },
        200,
      );
    }
  });

  app.get(
    '/internal/preview/workspaces/:workspaceId/run-configs',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      try {
        const response = await vkClient.getRunConfigs!(workspaceId);
        const previewUrls = Object.fromEntries(
          response.preview_url_parts.map((parts) => [
            parts.previewSlotId,
            buildPreviewSlotUrl(parts, optionalEnvString('SITE_ORIGIN')).url,
          ]),
        );
        return c.json({ ...response, preview_urls: previewUrls }, 200);
      } catch (error) {
        console.warn('Preview run config list failed', error);
        return c.json(
          { message: 'Preview run config backend is unavailable' },
          502,
        );
      }
    },
  );

  app.post(
    '/internal/preview/workspaces/:workspaceId/run-configs',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const payload = await parseJson<UpsertRunConfig>(c.req.raw);
      if (!payload.ok) return c.json({ message: payload.message }, 400);
      try {
        const response = await vkClient.upsertRunConfig!(
          workspaceId,
          payload.value,
        );
        return c.json(response, 200);
      } catch (error) {
        console.warn('Preview run config upsert failed', error);
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : 'Preview run config backend failed',
          },
          502,
        );
      }
    },
  );

  app.post(
    '/internal/preview/workspaces/:workspaceId/preview-slots',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const payload = await parseJson<UpsertPreviewSlot>(c.req.raw);
      if (!payload.ok) return c.json({ message: payload.message }, 400);
      try {
        const response = await vkClient.upsertPreviewSlot!(
          workspaceId,
          payload.value,
        );
        return c.json(response, 200);
      } catch (error) {
        console.warn('Preview slot upsert failed', error);
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : 'Preview slot backend failed',
          },
          502,
        );
      }
    },
  );

  app.post(
    '/internal/preview/workspaces/:workspaceId/run-configs/:runConfigId/start',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const runConfigId = c.req.param('runConfigId');
      try {
        const response = await vkClient.startRunConfig!(
          workspaceId,
          runConfigId,
        );
        return c.json(response, 200);
      } catch (error) {
        console.warn('Preview run config start failed', error);
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : 'Preview run config start failed',
          },
          502,
        );
      }
    },
  );

  app.post(
    '/internal/preview/workspaces/:workspaceId/preview-slots/:previewSlotId/start',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const previewSlotId = c.req.param('previewSlotId');
      try {
        const response = await vkClient.startPreviewSlot!(
          workspaceId,
          previewSlotId,
        );
        return c.json(response, 200);
      } catch (error) {
        console.warn('Preview slot start failed', error);
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : 'Preview slot start failed',
          },
          502,
        );
      }
    },
  );

  app.get(
    '/internal/preview/workspaces/:workspaceId/preview-slots/:previewSlotId/url',
    async (c) => {
      const workspaceId = c.req.param('workspaceId');
      const previewSlotId = c.req.param('previewSlotId');
      try {
        const configs = await vkClient.getRunConfigs!(workspaceId);
        const parts = configs.preview_url_parts.find(
          (entry) => entry.previewSlotId === previewSlotId,
        );
        if (!parts)
          return c.json({ message: 'Preview slot was not found' }, 404);
        const response = buildPreviewSlotUrl(
          parts,
          optionalEnvString('SITE_ORIGIN'),
        );
        return c.json(response, 200);
      } catch (error) {
        console.warn('Preview slot URL generation failed', error);
        return c.json(
          {
            message:
              'Preview URL could not be generated. Check SITE_ORIGIN and the VK backend.',
          },
          502,
        );
      }
    },
  );
}

function optionalEnvString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function parseJson<T>(
  request: Request,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: (await request.json()) as T };
  } catch {
    return { ok: false, message: 'Invalid JSON body' };
  }
}

function validatePreviewResolveRequest(
  payload: PreviewResolveRequest,
): string | null {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.host !== 'string'
  ) {
    return 'Invalid preview resolve request';
  }
  if (!/^[a-f0-9]{16}$/.test(payload.workspaceToken)) {
    return 'Invalid preview workspace token';
  }
  if (!/^[a-z0-9]{1,18}$/.test(payload.repoSlug)) {
    return 'Invalid preview repo slug';
  }
  if (!/^[a-z0-9]{1,10}$/.test(payload.slotSlug)) {
    return 'Invalid preview slot slug';
  }
  try {
    const expected = buildPreviewSlotUrl(
      { ...payload, previewSlotId: '' },
      optionalEnvString('SITE_ORIGIN'),
    );
    const hostname = payload.host
      .toLowerCase()
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
    if (hostname !== new URL(expected.url).hostname) {
      return 'Preview hostname does not match SITE_ORIGIN';
    }
  } catch {
    return 'Invalid preview hostname or SITE_ORIGIN';
  }
  return null;
}

function normalizeResolveResponse(
  response: PreviewResolveResponse,
): PreviewResolveResponse {
  const status = String(
    response.status || '',
  ).toLowerCase() as PreviewResolveResponse['status'];
  if (!VALID_RESOLVE_STATUSES.has(status)) {
    return {
      status: 'error',
      message: 'Preview resolver backend returned an invalid status',
    };
  }
  return {
    status,
    upstream: response.upstream ?? undefined,
    message: response.message ?? undefined,
    executionProcessId: response.executionProcessId ?? undefined,
  };
}
