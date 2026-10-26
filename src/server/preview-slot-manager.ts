import { buildPreviewSlotUrl } from '../lib/previewSlotUrl';
import type { VibeKanbanServerClient } from './vk-client';

export type PreviewSlotManagementClient = Pick<
  VibeKanbanServerClient,
  | 'getRunConfigs'
  | 'upsertRunConfig'
  | 'deletePreviewSlot'
  | 'deleteRunConfig'
  | 'resolvePreview'
  | 'stopExecutionProcess'
  | 'startPreviewSlot'
>;

export class PreviewSlotManagementError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export class PreviewSlotManager {
  constructor(private readonly client: PreviewSlotManagementClient) {}

  private async load(workspaceId: string, slotId: string) {
    const configs = await this.client.getRunConfigs(workspaceId);
    const slot = configs.preview_slots.find(
      (entry) => entry.id === slotId && entry.enabled,
    );
    if (!slot)
      throw new PreviewSlotManagementError('Preview slot was not found', 404);
    const config = configs.run_configs.find(
      (entry) => entry.id === slot.run_config_id,
    );
    if (!config)
      throw new PreviewSlotManagementError('Preview script was not found', 404);
    return { configs, slot, config };
  }

  private async process(workspaceId: string, slotId: string) {
    const loaded = await this.load(workspaceId, slotId);
    const parts = loaded.configs.preview_url_parts.find(
      (entry) => entry.previewSlotId === slotId,
    );
    if (!parts)
      throw new PreviewSlotManagementError(
        'Preview URL metadata was not found',
        404,
      );
    const { host } = buildPreviewSlotUrl(parts, process.env.SITE_ORIGIN);
    const result = await this.client.resolvePreview({
      host,
      workspaceToken: parts.workspaceToken,
      repoSlug: parts.repoSlug,
      slotSlug: parts.slotSlug,
      ensure: false,
      method: 'GET',
      path: '/',
    });
    if (['unavailable', 'error', 'capacity_full'].includes(result.status)) {
      throw new Error('Preview process could not be located');
    }
    return { ...loaded, result };
  }

  async getProcess(workspaceId: string, slotId: string) {
    const { result } = await this.process(workspaceId, slotId);
    return {
      processId: result.executionProcessId ?? null,
      message: result.executionProcessId
        ? null
        : 'No active preview process. Restart this slot to start its server.',
    };
  }

  async updateScript(workspaceId: string, slotId: string, command: unknown) {
    if (typeof command !== 'string' || !command.trim()) {
      throw new PreviewSlotManagementError('Script must not be empty', 400);
    }
    const { config } = await this.load(workspaceId, slotId);
    return this.client.upsertRunConfig(workspaceId, {
      id: config.id,
      repo_id: config.repo_id,
      slug: config.slug,
      name: config.name,
      command,
      working_dir: config.working_dir,
      kind: config.kind,
      enabled: config.enabled,
    });
  }

  async restart(workspaceId: string, slotId: string) {
    const { result } = await this.process(workspaceId, slotId);
    if (result.executionProcessId)
      await this.client.stopExecutionProcess(result.executionProcessId);
    return this.client.startPreviewSlot(workspaceId, slotId);
  }

  async delete(workspaceId: string, slotId: string) {
    const configs = await this.client.getRunConfigs(workspaceId);
    if (!configs.preview_slots.some((slot) => slot.id === slotId)) {
      throw new PreviewSlotManagementError('Preview slot was not found', 404);
    }
    await this.client.deletePreviewSlot(workspaceId, slotId);
  }

  async deleteRunConfig(workspaceId: string, configId: string) {
    const configs = await this.client.getRunConfigs(workspaceId);
    if (!configs.run_configs.some((config) => config.id === configId)) {
      throw new PreviewSlotManagementError('Run config was not found', 404);
    }
    if (configs.preview_slots.some((slot) => slot.run_config_id === configId)) {
      throw new PreviewSlotManagementError('Delete linked preview slots before deleting this run config.', 400);
    }
    await this.client.deleteRunConfig(workspaceId, configId);
  }
}
