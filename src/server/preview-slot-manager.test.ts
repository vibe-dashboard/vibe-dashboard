import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PreviewSlotManager,
  type PreviewSlotManagementClient,
} from './preview-slot-manager';

function setup() {
  const slot = {
    id: 'slot1',
    repo_id: 'repo1',
    run_config_id: 'config1',
    slot_slug: 'web',
    title: 'Web',
    enabled: true,
    created_at: '',
    updated_at: '',
  };
  const config = {
    id: 'config1',
    repo_id: 'repo1',
    slug: 'web',
    name: 'Web server',
    command: 'old script',
    working_dir: null,
    kind: 'long_running' as const,
    enabled: true,
    created_at: '',
    updated_at: '',
  };
  const client = {
    getRunConfigs: vi.fn(async () => ({
      run_configs: [config],
      preview_slots: [slot],
      preview_url_parts: [
        {
          previewSlotId: 'slot1',
          workspaceToken: '0123456789abcdef',
          repoSlug: 'repo',
          slotSlug: 'web',
        },
      ],
    })),
    resolvePreview: vi.fn<PreviewSlotManagementClient['resolvePreview']>(
      async () => ({
        status: 'ready',
        executionProcessId: 'process1',
        upstream: 'http://127.0.0.1:4000',
      }),
    ),
    stopExecutionProcess: vi.fn(async () => {}),
    startPreviewSlot: vi.fn<PreviewSlotManagementClient['startPreviewSlot']>(),
    upsertRunConfig: vi.fn(async () => config),
    deletePreviewSlot: vi.fn(async () => {}),
    deleteRunConfig: vi.fn(async () => {}),
  };
  return { client, manager: new PreviewSlotManager(client), config, slot };
}

describe('preview slot management', () => {
  const origin = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (origin === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = origin;
  });

  it('edits the stored script while retaining run-config identity and settings', async () => {
    const { client, manager, config } = setup();
    await manager.updateScript('workspace1', 'slot1', 'npm run dev\n');
    const { created_at, updated_at, ...settings } = config;
    expect(client.upsertRunConfig).toHaveBeenCalledWith('workspace1', {
      ...settings,
      command: 'npm run dev\n',
    });
    expect(client.startPreviewSlot).not.toHaveBeenCalled();
    await expect(
      manager.updateScript('workspace1', 'slot1', '  '),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects slots outside the workspace before updating anything', async () => {
    const { client, manager } = setup();
    await expect(
      manager.updateScript('workspace1', 'foreign-slot', 'new script'),
    ).rejects.toMatchObject({ status: 404 });
    expect(client.upsertRunConfig).not.toHaveBeenCalled();
  });

  it('waits for the current process to stop before starting a replacement', async () => {
    process.env.SITE_ORIGIN = 'https://jamtools.dev';
    const { client, manager } = setup();
    const events: string[] = [];
    client.stopExecutionProcess.mockImplementation(async () => {
      events.push('stopped');
    });
    client.startPreviewSlot.mockImplementation(async () => {
      events.push('started');
      return {} as any;
    });
    await manager.restart('workspace1', 'slot1');
    expect(events).toEqual(['stopped', 'started']);
    expect(client.stopExecutionProcess).toHaveBeenCalledWith('process1');
    expect(client.startPreviewSlot).toHaveBeenCalledWith('workspace1', 'slot1');
    expect(client.resolvePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        ensure: false,
        workspaceToken: '0123456789abcdef',
      }),
    );
  });

  it('does not start another process if stopping the old one fails', async () => {
    process.env.SITE_ORIGIN = 'https://jamtools.dev';
    const { client, manager } = setup();
    client.stopExecutionProcess.mockRejectedValue(new Error('stop failed'));
    await expect(manager.restart('workspace1', 'slot1')).rejects.toThrow(
      'stop failed',
    );
    expect(client.startPreviewSlot).not.toHaveBeenCalled();
  });

  it('uses native deletion for enabled and previously disabled preview slots', async () => {
    const { client, manager, slot } = setup();
    await manager.delete('workspace1', 'slot1');
    expect(client.deletePreviewSlot).toHaveBeenCalledWith('workspace1', 'slot1');
    slot.enabled = false;
    await manager.delete('workspace1', 'slot1');
    expect(client.deletePreviewSlot).toHaveBeenCalledTimes(2);
    expect(client.upsertRunConfig).not.toHaveBeenCalled();
  });

  it('requires every linked slot to be deleted before deleting a run config', async () => {
    const { client, manager, slot } = setup();
    slot.enabled = false;
    await expect(manager.deleteRunConfig('workspace1', 'config1')).rejects.toMatchObject({ status: 400, message: 'Delete linked preview slots before deleting this run config.' });
    expect(client.deleteRunConfig).not.toHaveBeenCalled();
    const configs = await client.getRunConfigs();
    configs.preview_slots = [];
    client.getRunConfigs.mockResolvedValue(configs);
    await manager.deleteRunConfig('workspace1', 'config1');
    expect(client.deleteRunConfig).toHaveBeenCalledWith('workspace1', 'config1');
  });

  it('looks up logs without starting a stopped server', async () => {
    process.env.SITE_ORIGIN = 'https://jamtools.dev';
    const { client, manager } = setup();
    client.resolvePreview.mockResolvedValue({ status: 'starting' });
    await expect(
      manager.getProcess('workspace1', 'slot1'),
    ).resolves.toMatchObject({ processId: null });
    expect(client.resolvePreview).toHaveBeenCalledWith(
      expect.objectContaining({ ensure: false }),
    );
    expect(client.startPreviewSlot).not.toHaveBeenCalled();
  });
});
