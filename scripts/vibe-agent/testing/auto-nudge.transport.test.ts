import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VibeClient } from '../core/client.js';
import { createAutoNudgeClient, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState, type AutoNudgeOptions } from '../nudge/auto-nudge.js';
import { createCallback } from '../nudge/callback-registry.js';
import { DEFAULT_OVERSEER_RESULT_SCHEMA } from '../nudge/workflow-config.js';
import { schemaHash } from '../nudge/workflow-xml.js';
import { appendResponseRoute, readResponseRouteState } from '../nudge/response-routes.js';
import { FakeDiscordServer } from './fake-discord-server.js';
import { FakeVkServer, type FakeVkProcess, type FakeVkScenario } from './fake-vk-server.js';
import type { SendMessageBody, Session } from '../types.js';

const now = '2026-09-21T00:10:00.000Z'; const old = '2026-09-21T00:00:00.000Z';
const completeResult = `<auto-nudge-result schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="${schemaHash(DEFAULT_OVERSEER_RESULT_SCHEMA)}" format="json">{"outcome":"complete","actions":[]}</auto-nudge-result>`;
const process = (id: string, sessionId: string, status: FakeVkProcess['status'], final?: string): FakeVkProcess => ({
  id, session_id: sessionId, status, created_at: old, started_at: old, updated_at: old, completed_at: status === 'running' ? null : old,
  exit_code: status === 'completed' ? 0 : 1, run_reason: 'codingagent', dropped: false, executor_action: { typ: { prompt: 'work' } },
  conversation: final == null ? [{ content: { entry_type: { type: 'tool_use' }, content: 'work' } }] : [{ content: { entry_type: { type: 'assistant_message' }, content: final } }],
});
function base(processes: FakeVkProcess[]): FakeVkScenario { return {
  workspaces: [{ id: 'workspace' }], sessions: [
    { id: 'impl', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', created_at: old, updated_at: old, processes },
    { id: 'overseer', workspace_id: 'workspace', name: 'overseer', executor: 'CODEX', created_at: old, updated_at: old, processes: [] },
  ], followUps: [],
}; }
const body = (prompt: string, session: Pick<Session, 'executor'>): SendMessageBody => ({
  prompt,
  executor_config: { executor: session.executor },
  retry_process_id: null,
  force_when_dirty: null,
  perform_git_reset: null,
});
const dirs: string[] = []; const vkServers: FakeVkServer[] = []; const discordServers: FakeDiscordServer[] = [];
afterEach(async () => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); await Promise.all(vkServers.splice(0).map(item => item.stop())); await Promise.all(discordServers.splice(0).map(item => item.stop())); });
async function setup(scenario: FakeVkScenario) {
  const server = await new FakeVkServer(scenario).start(); vkServers.push(server);
  const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-transport-')); dirs.push(dir);
  const options: AutoNudgeOptions = {
    config: { version: 1, discord: { enabled: false }, workspaces: [{ workspaceId: 'workspace', overseerSessionId: 'overseer' }] },
    statePath: join(dir, 'state.json'),
    callbackRegistryPath: join(dir, 'callbacks.json'),
    workflowConfigPath: join(dir, 'workflow.yaml'),
    sendQueuePath: join(dir, 'send-queue.json'),
    handlerLogPath: join(dir, 'handler-runs.jsonl'),
    now: () => new Date(now),
    unacknowledgedAfterMs: 60_000,
    operationTimeoutMs: 500,
    responseTimeoutMs: 1_000,
    checkpointPollMs: 5,
    concurrency: 2,
    dryRun: false,
  };
  options.responseRoutesPath = join(dir, 'response-routes.json');
  return { server, options, client: createAutoNudgeClient(new VibeClient(server.baseUrl)) };
}

describe('auto-nudge across real VK transport', () => {
  it('leaves terminal teammate recovery to VK across repeated cycles', async () => {
    const scenario = base([process('failed', 'impl', 'failed')]);
    const { server, options, client } = await setup(scenario);
    await runAutoNudgeCycle(client, options); await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(readAutoNudgeState(options.statePath).nudgedProcessIds).toEqual([]);
  });

  it('suppresses action while work is active', async () => {
    const { server, options, client } = await setup(base([process('active', 'impl', 'running')]));
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
  });

  it('checkpoints and closes the trigger on structured completion', async () => {
    const scenario = base([process('complete', 'impl', 'completed', 'Finished')]);
    const checkpoint = process('checkpoint', 'overseer', 'running', completeResult); checkpoint.statusSequence = ['completed'];
    scenario.followUps = [{ sessionId: 'overseer', process: checkpoint }];
    const { options, client } = await setup(scenario);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'done', checkpointProcessId: 'checkpoint' });
  });

  it('requires a checkpoint envelope even when a real teammate handoff starts during the turn', async () => {
    const scenario = base([process('complete', 'impl', 'completed', 'Finished')]);
    const checkpoint = process('checkpoint', 'overseer', 'running'); checkpoint.statusSequence = ['completed'];
    scenario.sessions.push({ id: 'review', workspace_id: 'workspace', name: 'review', executor: 'CODEX', created_at: old, updated_at: old, processes: [] });
    scenario.followUps = [{ sessionId: 'overseer', process: checkpoint }, { sessionId: 'review', process: process('handoff', 'review', 'running') }];
    const { options, client } = await setup(scenario);
    const original = client.sendMessage;
    client.sendMessage = async (sessionId, message) => {
      const accepted = await original(sessionId, message);
      if (sessionId === 'overseer') await original('review', body('Review the work', { executor: 'CODEX' }));
      return accepted;
    };
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', correctionAttempts: 1 });
    const observed = await client.getAutoNudgeStatus({ registered_workspace_ids: ['workspace'], include_global_recent: false, global_cursor: null, updated_after: old, limit_workspaces: 25, limit_sessions: 250 });
    expect(observed.workspaces[0]?.sessions.find(item => item.id === 'review')?.latest_codingagent_process?.id).toBe('handoff');
  });

  it('restarts from persisted checkpoint identity without another follow-up', async () => {
    const scenario = base([process('complete', 'impl', 'completed', 'Finished')]);
    const checkpoint = process('checkpoint', 'overseer', 'completed', completeResult); scenario.sessions[1].processes.push(checkpoint);
    const { server, options, client } = await setup(scenario);
    const state = readAutoNudgeState(options.statePath); state.triggers.complete = { processId: 'complete', workspaceId: 'workspace', sessionId: 'impl', observedAt: old, status: 'checkpoint-sent', checkpointProcessId: 'checkpoint', baselineProcessIds: ['complete'], updatedAt: old, error: null }; writeAutoNudgeState(options.statePath, state);
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(readAutoNudgeState(options.statePath).triggers.complete.status).toBe('done');
  });

  it('suppresses checkpointing while a correlated callback is running', async () => {
    const { server, options, client } = await setup(base([process('complete', 'impl', 'completed', 'Finished')]));
    createCallback(options.callbackRegistryPath, { id: 'callback', sessionId: 'impl', command: 'ci', startedAt: now, sourceProcessId: 'complete', triggerProcessId: 'complete' });
    await runAutoNudgeCycle(client, options);
    expect(server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(readAutoNudgeState(options.statePath).triggers.complete.status).toBe('waiting-callback');
  });

  it('retries a durable Discord delivery after restart without losing the event', async () => {
    const discord = await new FakeDiscordServer(1).start(); discordServers.push(discord);
    const { options, client } = await setup(base([])); options.config.discord = { enabled: true }; options.discordWebhookUrl = discord.url;
    const state = readAutoNudgeState(options.statePath); state.outbox.alert = { id: 'alert', workspaceId: 'workspace', content: 'quota event', createdAt: old, deliveredAt: null, attempts: 0 }; writeAutoNudgeState(options.statePath, state);
    expect((await runAutoNudgeCycle(client, options)).errors).toHaveLength(1);
    expect((await runAutoNudgeCycle(client, options)).discordDeliveries).toBe(1);
    expect((await runAutoNudgeCycle(client, options)).discordDeliveries).toBe(0);
    expect(discord.deliveries).toEqual([{ content: 'quota event' }, { content: 'quota event' }]);
    expect(readAutoNudgeState(options.statePath).outbox.alert).toMatchObject({ attempts: 2, deliveredAt: now });
  });

  it('consumes structured usage evidence over REST and retries one Discord alert across client restart without WebSockets', async () => {
    const exhausted = process('exhausted', 'impl', 'completed');
    exhausted.usageLimitEvents = [
      { code: 'usage_limit_exceeded', thread_id: 'thread', turn_id: 'turn' },
      { code: 'usage_limit_exceeded', thread_id: 'thread', turn_id: 'turn' },
    ];
    const { server, options, client } = await setup(base([exhausted]));
    const discord = await new FakeDiscordServer(1).start(); discordServers.push(discord);
    options.config.discord = { enabled: true }; options.discordWebhookUrl = discord.url; options.vkOrigin = 'https://vk.example';
    expect((await runAutoNudgeCycle(client, options)).errors).toHaveLength(1);
    const restarted = createAutoNudgeClient(new VibeClient(server.baseUrl));
    expect((await runAutoNudgeCycle(restarted, options)).discordDeliveries).toBe(1);
    expect((await runAutoNudgeCycle(restarted, options)).discordDeliveries).toBe(0);
    expect(server.journal.filter(item => item.type === 'websocket-opened' || item.type === 'follow-up-accepted')).toEqual([]);
    expect(server.journal.filter(item => item.type === 'final-response-polled')).toHaveLength(1);
    expect(discord.deliveries).toHaveLength(2);
    expect(discord.deliveries[0]).toMatchObject({ content: expect.stringContaining('https://vk.example/workspaces/workspace') });
    expect(readAutoNudgeState(options.statePath).triggers.exhausted?.status).toBe('rate-limited');
    expect(Object.values(readAutoNudgeState(options.statePath).outbox)).toHaveLength(1);
  });

  it('recovers response routing when VK accepts a follow-up then drops the HTTP response', async () => {
    const accepted = process('accepted-follow-up', 'impl', 'completed', 'Recovered final');
    const scenario = base([]);
    scenario.followUps = [
      { sessionId: 'impl', process: accepted },
      { sessionId: 'overseer', process: process('delivered-response', 'overseer', 'running') },
    ];
    scenario.faults = [{ id: 'drop', operation: 'follow-up', targetId: 'impl', kind: 'accept-then-drop' }];
    const server = await new FakeVkServer(scenario).start(); vkServers.push(server);
    const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-transport-')); dirs.push(dir);
    const options: AutoNudgeOptions = {
      config: { version: 1, discord: { enabled: false }, workspaces: [{ workspaceId: 'workspace', overseerSessionId: 'overseer' }] },
      statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'), responseRoutesPath: join(dir, 'response-routes.json'),
      workflowConfigPath: join(dir, 'workflow.yaml'), sendQueuePath: join(dir, 'send-queue.json'), handlerLogPath: join(dir, 'handler-runs.jsonl'),
      now: () => new Date(now), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 1_000, responseTimeoutMs: 1_000, checkpointPollMs: 5, concurrency: 2, dryRun: false,
    };
    const rawClient = new VibeClient(server.baseUrl);
    const responseRoutesPath = options.responseRoutesPath!;
    const targetSession = scenario.sessions[0];
    if (!targetSession) throw new Error('missing target session');
    const intent = appendResponseRoute(responseRoutesPath, {
      processId: null, targetRole: 'impl', targetSessionId: 'impl', replySessionId: 'overseer',
      createdAt: old, updatedAt: old, sendStartedAt: old, sendFinishedAt: now,
    });
    await expect(rawClient.sendMessage('impl', body('please work', targetSession))).rejects.toThrow();
    await runAutoNudgeCycle(createAutoNudgeClient(rawClient), options);
    expect(readResponseRouteState(responseRoutesPath).routes[intent.id]).toMatchObject({ processId: 'accepted-follow-up', status: 'delivered' });
    expect(server.journal.filter(item => item.type === 'follow-up-accepted').map(item => item.correlationId)).toContain('accepted-follow-up');
  });
});
