import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoNudgeStatusRequest, AutoNudgeStatusResponse, ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import {
  abortableDelay, acquireLock, attachWorkflowForm, createAutoNudgeClient, disableAutoNudgeWorkspace, enableAutoNudgeWorkspace, formatWorkspaceCriteriaBlock, isAutoNudgeEnabled, loadAutoNudgeConfig, pollIntervalSeconds, readAutoNudgeState, readAutoNudgeWorkspaceRegistry, readWorkflowArtifact, runAutoNudgeCycle, runWithOwnerLock, writeAutoNudgeState,
  type AutoNudgeClient, type AutoNudgeOptions,
} from './auto-nudge.js';
import { appendResponseRoute, bindResponseRouteProcess, readResponseRouteState, updateResponseRoute } from './response-routes.js';
import { enqueueSend, readSendQueue, writeSendQueue } from './send-queue.js';
import { DEFAULT_OVERSEER_RESULT_SCHEMA, DEFAULT_WORKFLOW_CONFIG_YAML } from './workflow-config.js';
import { schemaHash } from './workflow-xml.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const iso = (minutes: number) => `2026-09-18T00:${String(minutes).padStart(2, '0')}:00.000Z`;
const proc = (id: string, sessionId: string, status: ExecutionProcess['status'], minute: number): ExecutionProcess => ({
  id, session_id: sessionId, status, created_at: iso(minute), started_at: iso(minute), updated_at: iso(minute),
  completed_at: status === 'running' ? null : iso(minute), exit_code: status === 'completed' ? 0 : 1,
  dropped: false, run_reason: 'codingagent', executor_action: { typ: { prompt: 'work' } },
});
const session = (id: string, name: string, executor: Session['executor'] = 'CODEX'): Session => ({
  id, name, workspace_id: 'w1', executor, created_at: iso(0), updated_at: iso(5),
});
const msg = (text: string): ConversationEntry => ({ content: { entry_type: { type: 'assistant_message' }, content: text } });
const tool: ConversationEntry = { content: { entry_type: { type: 'tool_use' }, content: 'tool' } };
const finalResponse = (process: ExecutionProcess, response: string | null) => ({
  process_id: process.id,
  status: process.status,
  finished: process.status !== 'running',
  final_response: response,
  terminal_no_response: process.status !== 'running' && response == null,
});
const resultEnvelope = (outcome: 'complete' | 'delegated' | 'waiting' | 'blocked', actions: unknown[] = []) => `<auto-nudge-result schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="${schemaHash(DEFAULT_OVERSEER_RESULT_SCHEMA)}" format="json">${JSON.stringify({ outcome, actions })}</auto-nudge-result>`;

function aggregateStatus(
  request: AutoNudgeStatusRequest,
  input: { processes: Record<string, ExecutionProcess[]>; entries?: Record<string, ConversationEntry[]>; workspaces?: string[]; sessions?: Session[] },
): AutoNudgeStatusResponse {
  const defaultSessions = [session('overseer', 'overseer'), session('impl', 'impl')];
  const missingProcessSessions = Object.keys(input.processes)
    .filter(id => !defaultSessions.some(item => item.id === id))
    .map(id => session(id, id));
  const sessions = input.sessions ?? [...defaultSessions, ...missingProcessSessions];
  const workspaceIds = [...new Set([...request.registered_workspace_ids, ...(input.workspaces ?? ['w1'])])];
  const windowResults = (request.process_window_queries ?? []).map(query => ({
    id: query.id,
    process_ids: (input.processes[query.session_id] ?? [])
      .filter(item => {
        const createdAt = new Date(item.created_at).getTime();
        return item.run_reason === 'codingagent' && !item.dropped
          && createdAt >= new Date(query.started_at).getTime()
          && createdAt <= new Date(query.ended_at).getTime();
      })
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
      .map(item => item.id),
  }));
  const workspaces = workspaceIds.map(workspaceId => {
    const workspaceSessions = sessions.filter(item => item.workspace_id === workspaceId);
    const statusSessions = workspaceSessions.map(item => {
      const latest = (input.processes[item.id] ?? [])
        .filter(process => process.run_reason === 'codingagent' && !process.dropped)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] ?? null;
      const response = latest
        ? input.entries?.[latest.id]?.find(entry => entry.content?.entry_type?.type === 'assistant_message' && typeof entry.content.content === 'string')?.content?.content
        : null;
      return {
        ...item,
        name: item.name ?? null,
        latest_codingagent_process: latest ? {
          ...latest,
          final_response: typeof response === 'string' ? response : null,
          terminal_no_response: latest.status !== 'running' && typeof response !== 'string',
        } : null,
        has_active_codingagent: Boolean(latest && latest.status === 'running' && !latest.dropped),
      };
    });
    return {
      workspace_id: workspaceId,
      archived: false,
      registered: request.registered_workspace_ids.includes(workspaceId),
      sessions: statusSessions,
      has_active_codingagent: statusSessions.some(item => item.has_active_codingagent),
    };
  });
  return {
    workspaces,
    process_window_results: windowResults,
    next_cursor: request.include_global_recent ? 'cursor-next' : request.global_cursor,
    truncated: request.include_global_recent,
    counts: {
      registered_workspaces: request.registered_workspace_ids.length,
      global_workspaces: request.include_global_recent ? Math.max(0, workspaces.length - request.registered_workspace_ids.length) : 0,
      sessions: workspaces.reduce((count, item) => count + item.sessions.length, 0),
      processes: workspaces.reduce((count, item) => count + item.sessions.filter(session => session.latest_codingagent_process).length, 0),
      pages: 1,
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-')); dirs.push(dir);
  const options: AutoNudgeOptions = {
    config: { version: 1, discord: { enabled: false }, workspaces: [{ workspaceId: 'w1', overseerSessionId: 'overseer' }] },
    statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'), responseRoutesPath: join(dir, 'response-routes.json'),
    workflowConfigPath: join(dir, 'workflow.yaml'), sendQueuePath: join(dir, 'send-queue.json'), handlerLogPath: join(dir, 'handler-runs.jsonl'),
    now: () => new Date(iso(10)), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 1_000,
    responseTimeoutMs: 1_000, concurrency: 2, dryRun: false,
  };
  return { dir, options };
}

function fake(input: { processes: Record<string, ExecutionProcess[]>; entries?: Record<string, ConversationEntry[]>; response?: string; sessions?: Session[] }) {
  const sent: Array<{ sessionId: string; body: SendMessageBody }> = [];
  const client: AutoNudgeClient = {
    async getSessions() { return [session('overseer', 'overseer'), session('impl', 'impl')]; },
    async getSession(id) { return session(id, id); },
    async getSessionProcesses() { throw new Error('session-process WebSocket scan is forbidden in auto-nudge'); },
    async getAutoNudgeStatus(request) { return aggregateStatus(request, input); },
    async fetchConversation(id) { return id === 'checkpoint' ? [msg(input.response ?? 'Continuing')] : input.entries?.[id] ?? []; },
    async getExecutionProcessFinalResponse(id) {
      const process = Object.values(input.processes).flat().find(item => item.id === id) ?? proc(id, id === 'checkpoint' ? 'overseer' : 'impl', 'completed', 10);
      const entryContent = input.entries?.[id]?.find(entry => entry.content?.entry_type?.type === 'assistant_message' && typeof entry.content.content === 'string')?.content?.content;
      const response = id === 'checkpoint' ? input.response ?? 'Continuing' : typeof entryContent === 'string' ? entryContent : null;
      return finalResponse(process, response);
    },
    async getExecutionProcessFinalResponseStrict(id) { return this.getExecutionProcessFinalResponse(id); },
    async sendMessage(id, body) { sent.push({ sessionId: id, body }); return proc(id === 'overseer' ? 'checkpoint' : `sent-${sent.length}`, id, 'running', 10); },
    async createSession(body) { return session(`fresh-${sent.length + 1}`, body.name ?? 'fresh', body.executor); },
    async getExecutionProcess(id) { return proc(id, 'overseer', 'completed', 10); },
  };
  return { client, sent };
}

describe('auto-nudge enable switch', () => {
  it('is disabled unless VD_AUTO_NUDGE_ENABLED explicitly opts in', () => {
    expect(isAutoNudgeEnabled({})).toBe(false);
    expect(isAutoNudgeEnabled({ VD_AUTO_NUDGE_ENABLED: 'false' })).toBe(false);
    expect(isAutoNudgeEnabled({ VD_AUTO_NUDGE_ENABLED: 'true' })).toBe(true);
    expect(isAutoNudgeEnabled({ VD_AUTO_NUDGE_ENABLED: '1' })).toBe(true);
  });
});

describe('auto nudge', () => {
  it('uses a bounded seconds-based poll interval', () => {
    expect(pollIntervalSeconds({})).toBe(300);
    expect(pollIntervalSeconds({ VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS: '30' })).toBe(30);
    for (const value of ['0', '4', '3601', '-1', '1.5', 'nope']) {
      expect(() => pollIntervalSeconds({ VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS: value })).toThrow(/POLL_INTERVAL_SECONDS/);
    }
  });

  it('validates config and rejects duplicate workspaces', () => {
    const { dir } = setup(); const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ version: 1, workspaces: [{ workspaceId: 'w', overseerSessionId: 'o' }, { workspaceId: 'w', overseerSessionId: 'x' }] }));
    expect(() => loadAutoNudgeConfig(path)).toThrow(/duplicate workspaceId/);
  });

  it('persists dynamic workspace overseer registration and disablement', () => {
    const { dir } = setup(); const path = join(dir, 'workspaces.json');
    enableAutoNudgeWorkspace(path, 'w1', 'overseer', new Date(iso(1)), { goal: 'Ship the branch', beads: ['vkvw-ke5n2'], beadsDir: dir });
    expect(readAutoNudgeWorkspaceRegistry(path).workspaces.w1).toMatchObject({ workspaceId: 'w1', overseerSessionId: 'overseer', criteria: { goal: 'Ship the branch', beads: ['vkvw-ke5n2'], beadsDir: dir } });
    expect(disableAutoNudgeWorkspace(path, 'w1')).toBe(true);
    expect(readAutoNudgeWorkspaceRegistry(path).workspaces.w1).toBeUndefined();
  });

  it('keeps old workspace registry entries without criteria valid', () => {
    const { dir } = setup(); const path = join(dir, 'workspaces.json');
    writeFileSync(path, JSON.stringify({ version: 1, workspaces: { w1: { workspaceId: 'w1', overseerSessionId: 'overseer', registeredAt: iso(1), registeredBySessionId: 'overseer' } } }));
    expect(readAutoNudgeWorkspaceRegistry(path).workspaces.w1?.criteria).toBeUndefined();
  });

  it('formats workspace completion criteria blocks', () => {
    expect(formatWorkspaceCriteriaBlock()).toBe('');
    expect(formatWorkspaceCriteriaBlock({ goal: 'Ship the branch', beads: ['vkvw-ke5n2', 'vkvw-u4m13'] })).toBe([
      'Workspace completion criteria:',
      'Goal: Ship the branch',
      'Beads:',
      '- vkvw-ke5n2',
      '- vkvw-u4m13',
    ].join('\n'));
  });

  it('leaves registered terminal-no-response recovery to VK', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
  });

  it('leaves unregistered terminal-no-response recovery to VK', async () => {
    const { options } = setup();
    options.config.workspaces = [];
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p] }, entries: { failed: [tool] } });
    client.getAllWorkspaces = async () => [{ id: 'w1', archived: false } as any];
    client.getSessions = async () => [session('impl', 'impl')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers).toEqual({});
  });

  it('keeps dry-run read-only for terminal-no-response work', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    options.dryRun = true;
    expect((await runAutoNudgeCycle(client, options)).teammateNudges).toBe(0);
    expect(existsSync(options.statePath)).toBe(false);
    options.dryRun = false;
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
  });

  it('sends nothing while any workspace teammate is active', async () => {
    const { options } = setup();
    const failed = proc('failed', 'impl', 'failed', 8);
    const active = proc('active', 'review', 'running', 9);
    const { client, sent } = fake({ processes: { impl: [failed], review: [active], overseer: [] }, entries: { failed: [tool] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
  });

  it('does not recover two failed sessions owned by VK', async () => {
    const { options } = setup();
    const older = proc('older', 'impl', 'failed', 7); const newer = proc('newer', 'review', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [older], review: [newer], overseer: [] }, entries: { older: [tool], newer: [tool] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
  });

  it('treats newer teammate progress as acknowledgement before checkpointing', async () => {
    const { options } = setup();
    const completed = proc('complete', 'impl', 'completed', 5);
    const newer = proc('reviewed', 'review', 'completed', 7);
    const { client, sent } = fake({ processes: { impl: [completed], review: [newer], overseer: [] }, entries: { complete: [msg('Finished')], reviewed: [msg('Reviewed')] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    const state = readAutoNudgeState(options.statePath);
    expect(state.triggers.complete).toBeUndefined();
    expect(state.triggers.reviewed).toBeDefined();
  });

  it('creates a checkpoint and closes only that trigger on outcome complete', async () => {
    const { options } = setup();
    const complete = proc('complete-1', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { 'complete-1': [msg('Finished')] }, response: resultEnvelope('complete') });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.sessionId).toBe('overseer');
    expect(sent[0]?.body.prompt).toContain('beads-form');
    expect(sent[0]?.body.prompt).toContain('auto-nudge-result');
    expect(readAutoNudgeState(options.statePath).triggers['complete-1']?.status).toBe('done');

    const next = proc('complete-2', 'impl', 'completed', 7);
    const nextClient = fake({ processes: { impl: [next, complete], overseer: [] }, entries: { 'complete-2': [msg('More work')], 'complete-1': [msg('Finished')] } });
    await runAutoNudgeCycle(nextClient.client, options);
    expect(nextClient.sent[0]?.sessionId).toBe('overseer');
  });

  it('appends registered workspace criteria to overseer checkpoint prompts', async () => {
    const { dir, options } = setup();
    options.workspaceRegistryPath = join(dir, 'workspaces.json');
    enableAutoNudgeWorkspace(options.workspaceRegistryPath, 'w1', 'overseer', new Date(iso(1)), { goal: 'Finish the auto-nudge handoff', beads: ['vkvw-ke5n2', 'vkvw-u4m13'], beadsDir: dir });
    const complete = proc('complete-criteria', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { 'complete-criteria': [msg('Finished')] }, response: resultEnvelope('complete') });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.body.prompt).toContain('Workspace completion criteria:');
    expect(sent[0]?.body.prompt).toContain('Goal: Finish the auto-nudge handoff');
    expect(sent[0]?.body.prompt).toContain('- vkvw-ke5n2');
    expect(sent[0]?.body.prompt).toContain('- vkvw-u4m13');
  });

  it('rejects legacy marker-only checkpoint responses and sends one correction', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Please fill out the form.\nCREATED FORM' });
    await runAutoNudgeCycle(client, options);
    const trigger = readAutoNudgeState(options.statePath).triggers.complete;
    expect(trigger?.status).toBe('checkpoint-sent');
    expect(trigger).toMatchObject({ correctionAttempts: 1, correctionSendId: 'complete:schema-correction' });
    expect(readSendQueue(options.sendQueuePath!).sends['complete:schema-correction']).toMatchObject({ status: 'queued' });
  });

  it('does not persist a correction reference before its queue intent exists', async () => {
    const { options } = setup();
    writeSendQueue(options.sendQueuePath!, { version: 1, sends: {
      'complete:schema-correction': {
        id: 'complete:schema-correction', status: 'accepted', targetRole: 'overseer', targetSessionId: 'overseer', executor: 'CODEX',
        prompt: 'conflicting prompt', replySessionId: null, createdAt: iso(1), updatedAt: iso(1), processId: 'already-sent', error: null,
      },
    } });
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'plain text' });
    await runAutoNudgeCycle(client, options);
    const trigger = readAutoNudgeState(options.statePath).triggers.complete;
    expect(trigger).toMatchObject({
      status: 'invalid-response',
      error: expect.stringContaining('correction failed'),
    });
    expect(trigger).not.toHaveProperty('correctionAttempts');
    expect(trigger).not.toHaveProperty('correctionSendId');
  });

  it('sends exactly one schema correction then persists visible invalid response state', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'plain text' });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent.filter(item => item.body.prompt.includes('corrected final envelope'))).toHaveLength(1);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'invalid-response', correctionAttempts: 1, error: expect.stringContaining('invalid response') });
  });

  it('validates against the exact authoritative schema bytes that were hashed', async () => {
    const { options } = setup();
    const schema = structuredClone(DEFAULT_OVERSEER_RESULT_SCHEMA) as any;
    schema.properties.outcome.enum = ['complete'];
    mkdirSync(join(dirname(options.workflowConfigPath!), 'schemas'), { recursive: true });
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML);
    writeFileSync(join(dirname(options.workflowConfigPath!), 'schemas/overseer-result.schema.json'), JSON.stringify(schema));
    const complete = proc('complete', 'impl', 'completed', 5);
    const response = `<auto-nudge-result schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="${schemaHash(schema)}" format="json">${JSON.stringify({ outcome: 'waiting', actions: [] })}</auto-nudge-result>`;
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ correctionAttempts: 1, error: expect.stringContaining('authoritative schema') });
  });

  it('fails startup when the configured authoritative schema is invalid', async () => {
    const { options } = setup();
    mkdirSync(join(dirname(options.workflowConfigPath!), 'schemas'), { recursive: true });
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML);
    writeFileSync(join(dirname(options.workflowConfigPath!), 'schemas/overseer-result.schema.json'), JSON.stringify({ type: 'not-a-json-schema-type' }));
    const { client } = fake({ processes: {} });
    await expect(runAutoNudgeCycle(client, options)).rejects.toThrow(/Invalid workflow response schema/);
  });

  it('keeps a persisted correction intent at-most-once across cycles', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    writeAutoNudgeState(options.statePath, { version: 1, nudgedProcessIds: [], outbox: {}, globalCursor: null, triggers: {
      complete: { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(5), status: 'checkpoint-sent', checkpointProcessId: null, correctionAttempts: 1, correctionSendId: 'complete:schema-correction', updatedAt: iso(9), error: 'bad response' },
    } });
    enqueueSend(options.sendQueuePath!, { id: 'complete:schema-correction', targetRole: 'overseer', targetSessionId: 'overseer', executor: 'CODEX', prompt: 'correct it', replySessionId: null, now: new Date(iso(9)) });
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: resultEnvelope('complete') });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent.filter(item => item.body.prompt === 'correct it')).toHaveLength(1);
  });

  it('keeps an invalid checkpoint visible without a causally newer teammate process', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'I will continue' });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('checkpoint-sent');
  });

  it('does not infer valid delegation from post-checkpoint process discovery', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'impl', 'completed', 11);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Continuing' });
    let reads = 0;
    client.getAutoNudgeStatus = async request => aggregateStatus(request, { processes: { impl: (++reads > 1 ? [delegated, complete] : [complete]), overseer: [] }, entries: { complete: [msg('Finished')] } });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', correctionAttempts: 1 });
  });

  it('requires an explicit envelope when a baton pass has no final message', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'review', 'running', 9);
    const { client } = fake({ processes: { impl: [complete], review: [], overseer: [] }, entries: { complete: [msg('Finished')] }, response: '' });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    let reads = 0;
    client.getAutoNudgeStatus = async request => aggregateStatus(request, { processes: { impl: [complete], review: (++reads > 1 ? [delegated] : []), overseer: [] }, entries: { complete: [msg('Finished')] }, sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')] });
    client.getExecutionProcess = async id => proc(id, 'overseer', 'completed', 10);
    client.getExecutionProcessFinalResponse = async id => id === 'complete'
      ? finalResponse(complete, 'Finished')
      : finalResponse(proc(id, 'overseer', 'completed', 10), null);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', correctionAttempts: 1 });
  });

  it('requires an explicit envelope when a baton pass has only prose', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'review', 'running', 9);
    const { client } = fake({ processes: { impl: [complete], review: [], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Sent to review.' });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    let reads = 0;
    client.getAutoNudgeStatus = async request => aggregateStatus(request, { processes: { impl: [complete], review: (++reads > 1 ? [delegated] : []), overseer: [] }, entries: { complete: [msg('Finished')] }, sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')] });
    client.getExecutionProcess = async id => proc(id, 'overseer', 'completed', 10);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', correctionAttempts: 1 });
  });

  it('does not nudge while an authoritative callback is running', async () => {
    const { options } = setup();
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(1), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'complete', triggerProcessId: 'complete', error: null }] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Waiting')] } });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('waiting-callback');
  });

  it('takes no later workspace action while a correlated callback is running', async () => {
    const { options } = setup();
    const callbackSource = proc('callback-source', 'impl', 'completed', 9);
    const otherCompletion = proc('other-complete', 'other', 'completed', 8);
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(9), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'callback-source', triggerProcessId: 'callback-source', error: null }] }));
    const sent: string[] = [];
    const client: AutoNudgeClient = {
      async getSessions() { return [session('overseer', 'overseer'), session('impl', 'impl'), session('other', 'other')]; },
      async getSession(id) { return session(id, id); },
      async getSessionProcesses() { throw new Error('session-process WebSocket scan is forbidden in auto-nudge'); },
      async getAutoNudgeStatus(request) { return aggregateStatus(request, { processes: { impl: [callbackSource], other: [otherCompletion], overseer: [] }, entries: { 'callback-source': [msg('Finished')], 'other-complete': [msg('Finished')] }, sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('other', 'other')] }); },
      async fetchConversation() { return [msg('Finished')]; }, async getExecutionProcess() { throw new Error('unexpected'); },
      async getExecutionProcessFinalResponse(id) { return finalResponse(id === 'callback-source' ? callbackSource : otherCompletion, 'Finished'); },
      async getExecutionProcessFinalResponseStrict(id) { return this.getExecutionProcessFinalResponse(id); },
      async sendMessage(id) { sent.push(id); return proc('sent', id, 'running', 10); },
    };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers['callback-source']?.status).toBe('waiting-callback');
  });

  it('ignores an unrelated session callback', async () => {
    const { options } = setup();
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{ id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: iso(1), timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: process.pid, sourceProcessId: 'other', triggerProcessId: 'other', error: null }] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'DONE' });
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
  });

  it('persists verified exhaustion despite successful exit and retries one deduplicated alert after restart', async () => {
    const { options } = setup();
    options.config.discord = { enabled: true }; options.discordWebhookUrl = 'https://discord.test/hook'; options.vkOrigin = 'https://vk.example/';
    const complete = proc('exhausted', 'impl', 'completed', 1);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] } });
    const evidence = { code: 'usage_limit_exceeded' as const, thread_id: 'thread', turn_id: 'turn' };
    client.getExecutionProcessFinalResponseStrict = vi.fn(async () => ({ ...finalResponse(complete, null), usage_limit_events: [evidence, evidence] }));
    const delivery = vi.fn().mockRejectedValueOnce(new Error('Discord down')).mockResolvedValue(undefined);
    options.deliverDiscord = delivery;
    enqueueSend(options.sendQueuePath!, { id: 'queued', targetRole: 'impl', targetSessionId: 'impl', executor: 'CODEX', prompt: 'Later work', replySessionId: null, now: options.now() });
    const first = await runAutoNudgeCycle(client, options);
    expect(first.errors).toEqual([expect.stringContaining('Discord down')]);
    expect(readAutoNudgeState(options.statePath).triggers.exhausted?.status).toBe('rate-limited');
    expect(Object.values(readAutoNudgeState(options.statePath).outbox)).toMatchObject([{ attempts: 1, deliveredAt: null, content: expect.stringContaining('https://vk.example/workspaces/w1') }]);
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(client.getExecutionProcessFinalResponseStrict).toHaveBeenCalledTimes(1);
    expect(delivery).toHaveBeenCalledTimes(2);
    expect(Object.values(readAutoNudgeState(options.statePath).outbox)).toMatchObject([{ attempts: 2, deliveredAt: expect.any(String) }]);
    expect(readSendQueue(options.sendQueuePath!).sends.queued?.status).toBe('queued');
    expect(sent).toEqual([]);
  });

  it('retains evidence when VK_ORIGIN is missing and enqueues the same event after configuration repair', async () => {
    const { options } = setup();
    options.config.discord = { enabled: true }; options.discordWebhookUrl = 'https://discord.test/hook'; options.vkOrigin = '';
    options.deliverDiscord = vi.fn(async () => {});
    const complete = proc('exhausted', 'impl', 'completed', 1);
    const { client } = fake({ processes: { impl: [complete], overseer: [] } });
    client.getExecutionProcessFinalResponseStrict = vi.fn(async () => ({ ...finalResponse(complete, null), usage_limit_events: [{ code: 'usage_limit_exceeded' as const, thread_id: 'thread', turn_id: 'turn' }] }));
    expect((await runAutoNudgeCycle(client, options)).errors).toEqual([expect.stringContaining('VK_ORIGIN is required')]);
    expect(readAutoNudgeState(options.statePath).triggers.exhausted?.status).toBe('rate-limited');
    expect(readAutoNudgeState(options.statePath).outbox).toEqual({});
    options.vkOrigin = 'https://vk.example';
    await runAutoNudgeCycle(client, options);
    expect(client.getExecutionProcessFinalResponseStrict).toHaveBeenCalledTimes(1);
    expect(options.deliverDiscord).toHaveBeenCalledTimes(1);
  });

  it('keeps usage inspection dry-run read-only and never treats prose as evidence', async () => {
    const { options } = setup(); options.dryRun = true;
    const complete = proc('exhausted', 'impl', 'completed', 1);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] } });
    client.getExecutionProcessFinalResponseStrict = vi.fn(async () => ({ ...finalResponse(complete, null), usage_limit_events: [{ code: 'usage_limit_exceeded' as const, thread_id: 'thread', turn_id: 'turn' }] }));
    await runAutoNudgeCycle(client, options);
    expect(existsSync(options.statePath)).toBe(false);
    expect(sent).toEqual([]);
    options.dryRun = false;
    client.getExecutionProcessFinalResponseStrict = async () => finalResponse(complete, 'usageLimitExceeded usedPercent=100');
    await runAutoNudgeCycle(client, options);
    expect(Object.values(readAutoNudgeState(options.statePath).triggers).some(trigger => trigger.status === 'rate-limited')).toBe(false);
    expect(readAutoNudgeState(options.statePath).outbox).toEqual({});
  });

  it('can enable alerts after detection and evaluates a later process without permanently blocking the workspace', async () => {
    const { options } = setup();
    const exhausted = proc('exhausted', 'impl', 'completed', 1);
    const recovered = proc('recovered', 'impl', 'completed', 2);
    const input = { processes: { impl: [exhausted], overseer: [] as ExecutionProcess[] }, entries: { recovered: [msg('Work complete')] }, response: resultEnvelope('complete') };
    const { client, sent } = fake(input);
    client.getExecutionProcessFinalResponseStrict = vi.fn(async id => id === exhausted.id
      ? { ...finalResponse(exhausted, null), usage_limit_events: [{ code: 'usage_limit_exceeded' as const, thread_id: 'thread', turn_id: 'turn' }] }
      : client.getExecutionProcessFinalResponse(id));
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).outbox).toEqual({});
    options.config.discord = { enabled: true }; options.discordWebhookUrl = 'https://discord.test/hook'; options.vkOrigin = 'https://vk.example';
    options.deliverDiscord = vi.fn(async () => {});
    await runAutoNudgeCycle(client, options);
    expect(options.deliverDiscord).toHaveBeenCalledTimes(1);
    input.processes.impl = [recovered, exhausted];
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    expect(readAutoNudgeState(options.statePath).triggers.recovered?.status).toBe('done');
    expect(readAutoNudgeState(options.statePath).triggers.exhausted?.status).toBe('rate-limited');
    expect(options.deliverDiscord).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a strict evidence response for another process without sending a checkpoint', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 1);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcessFinalResponseStrict = async () => finalResponse(proc('unrelated', 'impl', 'completed', 1), 'Finished');
    expect((await runAutoNudgeCycle(client, options)).errors).toEqual([expect.stringContaining('process identity mismatch')]);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).outbox).toEqual({});
  });

  it('marks an exhausted checkpoint trigger rate-limited instead of scheduling schema correction after later progress', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 1);
    const checkpoint = proc('checkpoint', 'overseer', 'completed', 2);
    const input = { processes: { impl: [complete], overseer: [checkpoint] }, entries: { complete: [msg('Finished')] } };
    const { client, sent } = fake(input);
    client.getExecutionProcessFinalResponseStrict = async id => id === checkpoint.id
      ? { ...finalResponse(checkpoint, null), usage_limit_events: [{ code: 'usage_limit_exceeded', thread_id: 'thread', turn_id: 'turn' }] }
      : client.getExecutionProcessFinalResponse(id);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', sessionId: 'impl', workspaceId: 'w1', observedAt: iso(1), updatedAt: iso(2), status: 'checkpoint-sent', checkpointProcessId: checkpoint.id, error: null };
    writeAutoNudgeState(options.statePath, state);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('rate-limited');
    input.processes.overseer = [proc('later-overseer', 'overseer', 'completed', 3)];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(existsSync(options.sendQueuePath!)).toBe(false);
  });

  it('retries durable Discord outbox items until delivery succeeds', async () => {
    const { options } = setup();
    const state = readAutoNudgeState(options.statePath);
    state.outbox.event = { id: 'event', workspaceId: 'w1', content: 'alert', createdAt: iso(1), deliveredAt: null, attempts: 0 };
    writeAutoNudgeState(options.statePath, state);
    let attempts = 0;
    options.config.discord = { enabled: true };
    options.discordWebhookUrl = 'https://discord.invalid';
    options.deliverDiscord = async () => { attempts++; if (attempts === 1) throw new Error('down'); };
    const { client } = fake({ processes: { impl: [], overseer: [] } });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).outbox.event.deliveredAt).not.toBeNull();
  });

  it('delivers pending response routes through the daemon cycle', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const { client, sent } = fake({ processes: { impl: [], overseer: [] } });
    client.getSession = async id => session(id, id, id === 'overseer' ? 'GEMINI' : 'CODEX');
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true, final_response: 'Looks good.', terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'overseer', body: expect.objectContaining({ prompt: 'Response from review:\n\nLooks good.' }) })]);
    expect(sent[0]!.body.executor_config?.executor).toBe('GEMINI');
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'delivered' });
  });

  it('does not deliver a response route into an active reply session', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const activeOverseer = proc('active-overseer', 'overseer', 'running', 9);
    const { client, sent } = fake({ processes: { review: [], overseer: [activeOverseer] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true, final_response: 'Wait until overseer is idle.', terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'pending' });
  });

  it('does not send a checkpoint to a reply session already sent a response route this cycle', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], review: [], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcessFinalResponse = async id => id === 'target-process'
      ? { process_id: id, status: 'completed', finished: true, final_response: 'Review response.', terminal_no_response: false }
      : finalResponse(complete, 'Finished');
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'overseer', body: expect.objectContaining({ prompt: 'Response from review:\n\nReview response.' }) })]);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toBeUndefined();
  });

  it('does not process a queued send to a session already sent a response route this cycle', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    enqueueSend(options.sendQueuePath!, {
      id: 'queued-overseer',
      targetRole: 'overseer',
      targetSessionId: 'overseer',
      executor: 'CODEX',
      prompt: 'do not overlap',
      now: new Date(iso(2)),
    });
    const { client, sent } = fake({ processes: { impl: [], review: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true, final_response: 'Review response.', terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'overseer', body: expect.objectContaining({ prompt: 'Response from review:\n\nReview response.' }) })]);
    expect(readSendQueue(options.sendQueuePath!).sends['queued-overseer']).toMatchObject({ status: 'queued' });
  });

  it('reconciles a pre-send response-route intent after an accepted dropped follow-up', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    const intent = appendResponseRoute(options.responseRoutesPath, {
      processId: null, targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const accepted = proc('accepted-process', 'review', 'completed', 2);
    const { client, sent } = fake({ processes: { review: [accepted], impl: [], overseer: [] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('review', 'review')];
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true, final_response: 'Recovered response.', terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]).toMatchObject({ sessionId: 'overseer', body: { prompt: 'Response from review:\n\nRecovered response.' } });
    expect(readResponseRouteState(options.responseRoutesPath).routes[intent.id]).toMatchObject({ processId: 'accepted-process', status: 'delivered' });
  });

  it('does not bind a failed pre-accept response-route intent to later unrelated work', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    const intent = appendResponseRoute(options.responseRoutesPath, {
      processId: null, targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(2), sendStartedAt: iso(1), sendFinishedAt: iso(2),
    });
    updateResponseRoute(options.responseRoutesPath, intent.id, route => ({
      ...route,
      status: 'failed',
      updatedAt: iso(2),
      error: 'Validation error: unexpected follow-up',
    }));
    const later = proc('later-unrelated', 'review', 'completed', 9);
    const { client, sent } = fake({ processes: { review: [later], impl: [], overseer: [] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes[intent.id]).toMatchObject({ processId: null, status: 'failed' });
  });

  it('fails closed instead of binding a stale uncertain response-route intent to much later work', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    const intent = appendResponseRoute(options.responseRoutesPath, {
      processId: null, targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(2), sendStartedAt: iso(1), sendFinishedAt: iso(2),
    });
    updateResponseRoute(options.responseRoutesPath, intent.id, route => ({ ...route, error: 'fetch failed' }));
    const muchLater = proc('much-later', 'review', 'completed', 9);
    const { client, sent } = fake({ processes: { review: [muchLater], impl: [], overseer: [] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes[intent.id]).toMatchObject({
      processId: null,
      status: 'failed',
      error: 'stale response route intent did not reconcile to an accepted process',
    });
  });

  it('fails closed when a pre-send response-route intent matches multiple processes', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    const intent = appendResponseRoute(options.responseRoutesPath, {
      processId: null, targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const first = proc('first', 'review', 'completed', 2);
    const second = proc('second', 'review', 'completed', 3);
    const { client, sent } = fake({ processes: { review: [first, second], impl: [], overseer: [] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes[intent.id]).toMatchObject({ processId: null, status: 'failed', error: expect.stringContaining('ambiguous') });
  });

  it('updates one response route without overwriting routes appended under the same file lock', () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'old-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const added = appendResponseRoute(options.responseRoutesPath, {
      processId: null, targetRole: 'impl', targetSessionId: 'impl', replySessionId: 'overseer',
      createdAt: iso(2), updatedAt: iso(2),
    });
    updateResponseRoute(options.responseRoutesPath, 'old-process:overseer', route => ({ ...route, status: 'delivered', deliveredProcessId: 'delivery', updatedAt: iso(3) }));
    bindResponseRouteProcess(options.responseRoutesPath, added.id, 'new-process', iso(3));
    expect(Object.keys(readResponseRouteState(options.responseRoutesPath).routes).sort()).toEqual(['old-process:overseer', added.id].sort());
    expect(readResponseRouteState(options.responseRoutesPath).routes[added.id]).toMatchObject({ processId: 'new-process', status: 'pending' });
  });

  it('does not notify the sender when a pending response route ends with no final response', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const { client, sent } = fake({ processes: { impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'failed', finished: true, final_response: null, terminal_no_response: true,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'terminal-no-response' });
  });

  it('waits when a completed callback spawned a completion process that is still running', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'review', command: 'ci', status: 'completed', startedAt: iso(1), timeoutMs: null,
      finishedAt: iso(2), completionProcessId: 'completion-process', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: null,
    }] }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => id === 'completion-process'
      ? { process_id: id, status: 'running', finished: false, final_response: null, terminal_no_response: false }
      : { process_id: id, status: 'completed', finished: true, final_response: 'stale original', terminal_no_response: false };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'pending', processId: 'completion-process' });
  });

  it('delivers the completion process final response after a completed callback', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'review', command: 'ci', status: 'completed', startedAt: iso(1), timeoutMs: null,
      finishedAt: iso(2), completionProcessId: 'completion-process', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: null,
    }] }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true,
      final_response: id === 'completion-process' ? 'post-callback answer' : 'stale original',
      terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'overseer', body: expect.objectContaining({ prompt: 'Response from review:\n\npost-callback answer' }) })]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'delivered', processId: 'completion-process' });
  });

  it('delivers the completion process response after a failed callback', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'review', command: 'ci', status: 'failed', startedAt: iso(1), timeoutMs: null,
      finishedAt: iso(2), completionProcessId: 'completion-process', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: 'command failed',
    }] }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true,
      final_response: id === 'completion-process' ? 'failed callback follow-up' : 'stale original',
      terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ body: expect.objectContaining({ prompt: 'Response from review:\n\nfailed callback follow-up' }) })]);
  });

  it('waits when a timed-out callback spawned a completion process that is still running', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'review', command: 'ci', status: 'timed-out', startedAt: iso(1), timeoutMs: 1000,
      finishedAt: iso(2), completionProcessId: 'completion-process', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: 'timeout',
    }] }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => id === 'completion-process'
      ? { process_id: id, status: 'running', finished: false, final_response: null, terminal_no_response: false }
      : { process_id: id, status: 'completed', finished: true, final_response: 'stale original', terminal_no_response: false };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'pending', processId: 'completion-process' });
  });

  it('waits through a second callback started by the completion process', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const callbacks = [{
      id: 'cb1', sessionId: 'review', command: 'ci', status: 'completed', startedAt: iso(1), timeoutMs: null,
      finishedAt: iso(2), completionProcessId: 'completion-1', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: null,
    }, {
      id: 'cb2', sessionId: 'review', command: 'deploy', status: 'running', startedAt: iso(3), timeoutMs: null,
      finishedAt: null, completionProcessId: null, runnerPid: process.pid,
      sourceProcessId: 'completion-1', triggerProcessId: 'completion-1', error: null,
    }];
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true,
      final_response: id === 'completion-2' ? 'final chained answer' : `response from ${id}`,
      terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'pending', processId: 'completion-1' });
    callbacks[1] = { ...callbacks[1], status: 'completed', finishedAt: iso(4), completionProcessId: 'completion-2', runnerPid: null };
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks }));
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ body: expect.objectContaining({ prompt: 'Response from review:\n\nfinal chained answer' }) })]);
  });

  it('waits through a callback started by a failed callback completion process', async () => {
    const { options } = setup();
    options.responseRoutesPath = join(options.statePath, '..', 'routes.json');
    appendResponseRoute(options.responseRoutesPath, {
      processId: 'target-process', targetRole: 'review', targetSessionId: 'review', replySessionId: 'overseer',
      createdAt: iso(1), updatedAt: iso(1),
    });
    const callbacks = [{
      id: 'cb1', sessionId: 'review', command: 'ci', status: 'failed', startedAt: iso(1), timeoutMs: null,
      finishedAt: iso(2), completionProcessId: 'completion-1', runnerPid: null,
      sourceProcessId: 'target-process', triggerProcessId: 'target-process', error: 'command failed',
    }, {
      id: 'cb2', sessionId: 'review', command: 'repair', status: 'running', startedAt: iso(3), timeoutMs: null,
      finishedAt: null, completionProcessId: null, runnerPid: process.pid,
      sourceProcessId: 'completion-1', triggerProcessId: 'completion-1', error: null,
    }];
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks }));
    const { client, sent } = fake({ processes: { review: [], impl: [], overseer: [] } });
    client.getExecutionProcessFinalResponse = async id => ({
      process_id: id, status: 'completed', finished: true,
      final_response: id === 'completion-2' ? 'repaired answer' : `response from ${id}`,
      terminal_no_response: false,
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readResponseRouteState(options.responseRoutesPath).routes['target-process:overseer']).toMatchObject({ status: 'pending', processId: 'completion-1' });
    callbacks[1] = { ...callbacks[1], status: 'timed-out', finishedAt: iso(4), completionProcessId: 'completion-2', runnerPid: null, error: 'timeout' };
    writeFileSync(options.callbackRegistryPath, JSON.stringify({ version: 2, callbacks }));
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ body: expect.objectContaining({ prompt: 'Response from review:\n\nrepaired answer' }) })]);
  });

  it('fails closed for malformed and wrong-version state', () => {
    const { options } = setup();
    writeFileSync(options.statePath, '{broken');
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state JSON/);
    writeFileSync(options.statePath, JSON.stringify({ version: 2, nudgedProcessIds: [], triggers: {}, outbox: {} }));
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state schema/);
    writeFileSync(options.statePath, JSON.stringify({ version: 1, nudgedProcessIds: [42], triggers: {}, outbox: {} }));
    expect(() => readAutoNudgeState(options.statePath)).toThrow(/Invalid auto-nudge state schema/);
  });

  it('times out a hung workspace operation without sending', async () => {
    const { options } = setup(); options.operationTimeoutMs = 5;
    const { client, sent } = fake({ processes: {} });
    client.getAutoNudgeStatus = async () => new Promise(() => {});
    await expect(runAutoNudgeCycle(client, options)).rejects.toThrow(/aggregate status.*timed out/);
    expect(sent).toEqual([]);
  });

  it('persists a retryable failure when the correlated response wait times out', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    options.responseTimeoutMs = 5; options.checkpointPollMs = 1;
    client.getExecutionProcess = async id => proc(id, 'overseer', 'running', 10);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'checkpoint' });
  });

  it.each([
    ['completed', resultEnvelope('complete'), 'done', 'persisted'],
    ['failed', '', 'retryable-failure', null],
    ['killed', '', 'retryable-failure', null],
  ] as const)('reconciles a persisted %s checkpoint without resending', async (status, response, expectedStatus, expectedId) => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')], persisted: response ? [msg(response)] : [] } });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', status, 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: expectedStatus, checkpointProcessId: expectedId });
  });

  it('resumes polling a persisted running checkpoint instead of resending', async () => {
    const { options } = setup(); options.checkpointPollMs = 1;
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [proc('persisted', 'overseer', 'running', 8)] }, entries: { complete: [msg('Finished')], persisted: [msg(resultEnvelope('complete'))] } });
    let reads = 0;
    client.getExecutionProcess = async () => proc('persisted', 'overseer', ++reads === 1 ? 'running' : 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(reads).toBe(2);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('treats configured XML created-form handoff as actioned and sends the role message', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const response = resultEnvelope('waiting', [
      { type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff', beads: ['vkvw-pnhne'], forms: ['decision-form'] },
      { type: 'wait', mode: 'callback-wait' },
    ]);
    const { client } = fake({
      processes: { impl: [complete], overseer: [], decision: [] },
      sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')],
      entries: { persisted: [msg(response)] },
    });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
    const sends = Object.values(readSendQueue(options.sendQueuePath!).sends);
    expect(sends).toEqual([expect.objectContaining({
      id: 'complete:send_message:decision_maker:created_form_handoff',
      status: 'accepted',
      targetSessionId: 'decision',
      replySessionId: 'overseer',
    })]);
    expect(sends[0]?.prompt).toContain('The overseer created a decision form');
    expect(sends[0]?.prompt).toContain('Forms: decision-form');
  });

  it('creates one validated inline form through the injected durable form boundary', async () => {
    const { dir, options } = setup();
    options.workspaceRegistryPath = join(dir, 'workspaces.json');
    enableAutoNudgeWorkspace(options.workspaceRegistryPath, 'w1', 'overseer', new Date(iso(1)), { beadsDir: dir });
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const created: unknown[] = []; options.createForm = async input => { created.push(input); };
    const response = resultEnvelope('waiting', [
      { type: 'create_form', id: 'form-action', bead: 'task-4uf', form: { format: 'standard', id: 'decision', title: 'Decision', questions: [] } },
      { type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff', form_refs: ['form-action'] },
    ]);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { persisted: [msg(response)] }, sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')] });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(created).toEqual([expect.objectContaining({ beadId: 'task-4uf', beadsDir: dir, form: expect.objectContaining({ id: 'decision', html: expect.stringContaining('<form>') }) })]);
    expect(sent.find(item => item.sessionId === 'decision')?.body.prompt).toContain('Forms: decision');
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
  });

  it('confines create_form artifacts to real files under beadsDir', () => {
    const { dir } = setup();
    const root = join(dir, 'beads'); const outside = join(dir, 'outside.json');
    mkdirSync(join(root, 'forms'), { recursive: true });
    writeFileSync(join(root, 'forms', 'ok.json'), '{}'); writeFileSync(outside, '{}');
    expect(readWorkflowArtifact(root, 'forms/ok.json')).toBe('{}');
    expect(() => readWorkflowArtifact(root, '../outside.json')).toThrow(/escapes/);
    expect(() => readWorkflowArtifact(root, outside)).toThrow(/relative/);
    symlinkSync(outside, join(root, 'direct.json'));
    expect(() => readWorkflowArtifact(root, 'direct.json')).toThrow(/symbolic link/);
    symlinkSync(dirname(outside), join(root, 'linked-parent'));
    expect(() => readWorkflowArtifact(root, 'linked-parent/outside.json')).toThrow(/symbolic link/);
  });

  it('updates only owned bead metadata keys when attaching a form', async () => {
    const { dir } = setup(); let updateArgs: string[] = [];
    const form = { id: 'decision', title: 'Decision', html: '<form></form>' } as any;
    await attachWorkflowForm(dir, 'task-1', form, 'w1', 'overseer', async (_file, args) => {
      if (args[0] === 'show') {
        return { stdout: JSON.stringify([{ id: 'task-1', metadata: { untouched: true, beadForms: { forms: [{ id: 'old', responses: [{ answer: true }] }] } } }]) };
      }
      updateArgs = args;
      return { stdout: '' };
    });
    expect(updateArgs).not.toContain('--metadata');
    expect(updateArgs.filter(arg => arg === '--set-metadata')).toHaveLength(4);
    expect(updateArgs.join('\n')).toContain('"id":"old","responses":[{"answer":true}]');
    expect(updateArgs.join('\n')).not.toContain('untouched');
  });

  it('treats an existing matching workflow send as idempotent success on retry', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const response = resultEnvelope('waiting', [
      { type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff', forms: ['decision-form'] },
      { type: 'wait', mode: 'callback-wait' },
    ]);
    enqueueSend(options.sendQueuePath!, {
      id: 'complete:send_message:decision_maker:created_form_handoff',
      targetRole: 'decision_maker',
      targetSessionId: 'decision',
      executor: 'CODEX',
      prompt: 'The overseer created a decision form for the next milestone.\nPlease review the form and respond with the decision needed to continue.\nForms: decision-form',
      replySessionId: 'overseer',
      now: new Date(iso(7)),
    });
    const { client } = fake({
      processes: { impl: [complete], overseer: [], decision: [] },
      sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')],
      entries: { persisted: [msg(response)] },
    });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'delegated', error: null });
    expect(readSendQueue(options.sendQueuePath!).sends['complete:send_message:decision_maker:created_form_handoff']).toMatchObject({ status: 'accepted' });
  });

  it('uses explicit fresh workflow sessions for fresh message types', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML
      .replace('The overseer created a decision form for the next milestone.', 'fresh handoff')
      .replace('fresh: false\n    allowed_actions: [wait, run_handler, create_form]', 'fresh: true\n    allowed_actions: [wait, run_handler, create_form]'));
    const response = resultEnvelope('delegated', [{ type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff' }]);
    const { client, sent } = fake({
      processes: { impl: [complete], overseer: [], decision: [] },
      sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')],
      entries: { persisted: [msg(response)] },
    });
    client.createSession = async body => session('fresh-decision', body.name ?? 'fresh', body.executor);
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'fresh-decision', body: expect.objectContaining({ prompt: expect.stringContaining('fresh handoff') }) })]);
    expect(readSendQueue(options.sendQueuePath!).sends['complete:send_message:decision_maker:created_form_handoff']).toMatchObject({ targetSessionId: 'fresh-decision', status: 'accepted' });
  });

  it('processes queued sends through VK and records response routing', async () => {
    const { options } = setup();
    const { client, sent } = fake({ processes: { impl: [], overseer: [] } });
    enqueueSend(options.sendQueuePath!, {
      id: 'queued-1',
      targetRole: 'reviewer',
      targetSessionId: 'impl',
      executor: 'CODEX',
      prompt: 'queued `literal`',
      replySessionId: 'overseer',
      now: new Date(iso(1)),
    });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]).toMatchObject({ sessionId: 'impl', body: { prompt: 'queued `literal`' } });
    expect(readSendQueue(options.sendQueuePath!).sends['queued-1']).toMatchObject({ status: 'accepted', processId: 'sent-1' });
    expect(Object.values(readResponseRouteState(options.responseRoutesPath!).routes)[0]).toMatchObject({ processId: 'sent-1', replySessionId: 'overseer' });
  });

  it('does not send queued messages into active target sessions', async () => {
    const { options } = setup();
    const active = proc('active', 'impl', 'running', 9);
    const { client, sent } = fake({ processes: { impl: [active], overseer: [] } });
    enqueueSend(options.sendQueuePath!, {
      id: 'queued-1',
      targetRole: 'reviewer',
      targetSessionId: 'impl',
      executor: 'CODEX',
      prompt: 'wait for idle',
      replySessionId: 'overseer',
      now: new Date(iso(1)),
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readSendQueue(options.sendQueuePath!).sends['queued-1']).toMatchObject({ status: 'queued' });
  });

  it('sends at most one queued message per target session per cycle', async () => {
    const { options } = setup();
    const { client, sent } = fake({ processes: { impl: [], overseer: [] } });
    enqueueSend(options.sendQueuePath!, {
      id: 'first',
      targetRole: 'reviewer',
      targetSessionId: 'impl',
      executor: 'CODEX',
      prompt: 'first',
      replySessionId: 'overseer',
      now: new Date(iso(1)),
    });
    enqueueSend(options.sendQueuePath!, {
      id: 'second',
      targetRole: 'reviewer',
      targetSessionId: 'impl',
      executor: 'CODEX',
      prompt: 'second',
      replySessionId: 'overseer',
      now: new Date(iso(2)),
    });
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'impl', body: expect.objectContaining({ prompt: 'first' }) })]);
    expect(readSendQueue(options.sendQueuePath!).sends.first).toMatchObject({ status: 'accepted' });
    expect(readSendQueue(options.sendQueuePath!).sends.second).toMatchObject({ status: 'queued' });
  });

  it('surfaces failed workflow handlers and does not mark the trigger delegated', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML.replace('handlers: {}', `handlers:
  post:
    enabled: true
    timeout_ms: 1000
    command: [node, -e, 'process.stderr.write("bad"); process.exit(2)']
`));
    const response = resultEnvelope('delegated', [{ type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff' }, { type: 'run_handler', handler_id: 'post' }]);
    const { client, sent } = fake({
      processes: { impl: [complete], overseer: [], decision: [] },
      sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')],
      entries: { persisted: [msg(response)] },
    });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', error: expect.stringMatching(/handler post failed/) });
    expect(sent).toEqual([]);
    expect(Object.values(readSendQueue(options.sendQueuePath!).sends)).toEqual([]);
  });

  it('keeps handler dry-run read-only including log directories', async () => {
    const { dir, options } = setup();
    options.dryRun = true;
    options.handlerLogPath = join(dir, 'handler-log', 'handler-runs.jsonl');
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML.replace('handlers: {}', `handlers:
  post:
    enabled: true
    timeout_ms: 1000
    command: [echo, ok]
`));
    const response = resultEnvelope('delegated', [{ type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff' }, { type: 'run_handler', handler_id: 'post' }]);
    const { client } = fake({
      processes: { impl: [complete], overseer: [], decision: [] },
      sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('decision', 'decision_maker')],
      entries: { persisted: [msg(response)] },
    });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(existsSync(dirname(options.handlerLogPath!))).toBe(false);
  });

  it('runs a configured outcome handler once and deduplicates restart replay', async () => {
    const { dir, options } = setup(); const marker = join(dir, 'outcome.txt');
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    writeFileSync(options.workflowConfigPath!, DEFAULT_WORKFLOW_CONFIG_YAML
      .replace('handlers: {}', `handlers:\n  success:\n    enabled: true\n    timeout_ms: 1000\n    command: [node, -e, 'require("fs").appendFileSync(process.argv[1], "x")', '${marker}']`)
      .replace('outcome_handlers: {}', 'outcome_handlers:\n  complete: [success]'));
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { persisted: [msg(resultEnvelope('complete'))] } });
    client.getExecutionProcess = async () => proc('persisted', 'overseer', 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(readFileSync(marker, 'utf8')).toBe('x');
    const replay = readAutoNudgeState(options.statePath); replay.triggers.complete!.status = 'checkpoint-sent'; writeAutoNudgeState(options.statePath, replay);
    await runAutoNudgeCycle(client, options);
    expect(readFileSync(marker, 'utf8')).toBe('x');
  });

  it('does not mark a queued send accepted when response routing fails', async () => {
    const { dir, options } = setup();
    const { client } = fake({ processes: { impl: [], overseer: [] } });
    const originalSend = client.sendMessage;
    client.sendMessage = async (id, body) => {
      const sent = await originalSend(id, body);
      options.responseRoutesPath = dir;
      return sent;
    };
    enqueueSend(options.sendQueuePath!, {
      id: 'queued-1',
      targetRole: 'reviewer',
      targetSessionId: 'impl',
      executor: 'CODEX',
      prompt: 'queued',
      replySessionId: 'overseer',
      now: new Date(iso(1)),
    });
    const result = await runAutoNudgeCycle(client, options);
    expect(result.errors[0]).toMatch(/EISDIR/);
    expect(readSendQueue(options.sendQueuePath!).sends['queued-1']).toMatchObject({ status: 'failed', processId: null });
  });

  it('fails closed stale sending queue entries instead of retrying', async () => {
    const { options } = setup();
    const { client, sent } = fake({ processes: { impl: [], overseer: [] } });
    writeSendQueue(options.sendQueuePath!, {
      version: 1,
      sends: {
        stuck: {
          id: 'stuck',
          status: 'sending',
          targetRole: 'reviewer',
          targetSessionId: 'impl',
          executor: 'CODEX',
          prompt: 'do not duplicate',
          replySessionId: 'overseer',
          createdAt: iso(1),
          updatedAt: iso(1),
          processId: null,
          error: null,
        },
      },
    });
    const result = await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(result.errors[0]).toMatch(/automatic resend is disabled/);
    expect(readSendQueue(options.sendQueuePath!).sends.stuck).toMatchObject({ status: 'indeterminate' });
  });

  it('fails closed when a persisted checkpoint is missing', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'missing', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcess = async () => { throw new Error('Not found'); };
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'missing', error: 'Not found' });
  });

  it('converts a null-ID checkpoint to durable indeterminate state and never resends', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: null, baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    const first = await runAutoNudgeCycle(client, options);
    const second = await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(first.errors[0]).toMatch(/indeterminate.*manual recovery/);
    expect(second.errors[0]).toMatch(/indeterminate.*manual recovery/);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({
      status: 'checkpoint-indeterminate', checkpointProcessId: null,
      error: expect.stringMatching(/automatic resend is disabled/),
    });
  });

  it('persists checkpoint identity before a wait failure', async () => {
    const { options } = setup(); const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    client.getExecutionProcess = async () => { throw new Error('connection lost'); };
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete).toMatchObject({ status: 'checkpoint-sent', checkpointProcessId: 'checkpoint' });
  });

  it('uses aggregate cycle counts and persists global cursor without inspecting sessions individually', async () => {
    const { options } = setup();
    options.config.workspaces = ['w1', 'w2', 'w3'].map(workspaceId => ({ workspaceId, overseerSessionId: `overseer-${workspaceId}` }));
    let aggregateCalls = 0;
    const client: AutoNudgeClient = {
      async getSessions() { throw new Error('per-workspace session scan is forbidden in auto-nudge'); },
      async getSession(id) { return session(id, id); },
      async getSessionProcesses() { throw new Error('session-process WebSocket scan is forbidden in auto-nudge'); },
      async getAutoNudgeStatus(request) {
        aggregateCalls++;
        return aggregateStatus(request, {
          processes: {},
          workspaces: ['w1', 'w2', 'w3', 'global-1'],
          sessions: ['w1', 'w2', 'w3', 'global-1'].map(workspaceId => ({ ...session(`overseer-${workspaceId}`, 'overseer'), workspace_id: workspaceId })),
        });
      },
      async fetchConversation() { return []; },
      async getExecutionProcessFinalResponse() { throw new Error('unexpected'); },
      async getExecutionProcess() { throw new Error('unexpected'); }, async sendMessage() { throw new Error('unexpected'); },
    };
    const result = await runAutoNudgeCycle(client, options);
    expect(aggregateCalls).toBe(1);
    expect(result).toMatchObject({ registeredWorkspaces: 3, globalWorkspacesScanned: 0, sessionsScanned: 4, pagesFetched: 1, truncated: false, nextCursor: null });
    expect(readAutoNudgeState(options.statePath).globalCursor).toBeNull();
  });

  it('scans a large fake install through one bounded aggregate page without dry-run mutation', async () => {
    const { options } = setup();
    options.dryRun = true;
    options.config.workspaces = [{ workspaceId: 'w0000', overseerSessionId: 'w0000-overseer' }];
    const workspaces = Array.from({ length: 1_000 }, (_item, index) => `w${String(index).padStart(4, '0')}`);
    const sessions = workspaces.flatMap(workspaceId => [
      { ...session(`${workspaceId}-overseer`, 'overseer'), workspace_id: workspaceId },
      { ...session(`${workspaceId}-impl`, 'impl'), workspace_id: workspaceId },
      { ...session(`${workspaceId}-review`, 'review'), workspace_id: workspaceId },
    ]);
    const processes = Object.fromEntries(
      sessions
        .filter(item => item.name !== 'overseer')
        .map(item => [item.id, [proc(`${item.id}-p`, item.id, 'failed', 5)]]),
    );
    let request: AutoNudgeStatusRequest | null = null;
    const client: AutoNudgeClient = {
      async getSessions() { throw new Error('per-workspace session scan is forbidden'); },
      async getSession(id) { return session(id, id); },
      async getSessionProcesses() { throw new Error('session-process WebSocket scan is forbidden'); },
      async getAutoNudgeStatus(input) {
        request = input;
        const page = input.include_global_recent
          ? [input.registered_workspace_ids[0]!, ...workspaces.filter(id => id !== input.registered_workspace_ids[0]).slice(0, input.limit_workspaces)]
          : input.registered_workspace_ids;
        return aggregateStatus(input, { processes, workspaces: page, sessions: sessions.filter(item => page.includes(item.workspace_id)) });
      },
      async fetchConversation() { return []; },
      async getExecutionProcessFinalResponse() { throw new Error('unexpected final response fetch in dry run'); },
      async getExecutionProcess() { throw new Error('unexpected process fetch'); },
      async sendMessage() { throw new Error('dry run must not send'); },
    };
    const before = existsSync(options.statePath) ? readFileSync(options.statePath, 'utf8') : null;
    const result = await runAutoNudgeCycle(client, options);
    expect(request).toMatchObject({
      registered_workspace_ids: ['w0000'],
      include_global_recent: false,
      global_cursor: null,
      limit_workspaces: 25,
      limit_sessions: 250,
    });
    expect(result).toMatchObject({
      registeredWorkspaces: 1,
      globalWorkspacesScanned: 0,
      pagesFetched: 1,
      truncated: false,
      nextCursor: null,
    });
    expect(result.sessionsScanned).toBeLessThanOrEqual(78);
    expect(existsSync(options.statePath) ? readFileSync(options.statePath, 'utf8') : null).toBe(before);
  });

  it('fails fast when the aggregate scan endpoint is missing instead of falling back to WebSockets', async () => {
    const { options } = setup();
    const { client } = fake({ processes: {} });
    let websocketCalls = 0;
    client.getAutoNudgeStatus = async () => { throw new Error('HTTP 404'); };
    client.getSessionProcesses = async () => { websocketCalls++; return []; };
    await expect(runAutoNudgeCycle(client, options)).rejects.toThrow(/aggregate status endpoint is required.*HTTP 404/);
    expect(websocketCalls).toBe(0);
  });

  it('aborts a hung aggregate request and releases the owner lock', async () => {
    const { dir, options } = setup();
    const lock = join(dir, 'owner.lock');
    const controller = new AbortController();
    options.signal = controller.signal;
    const { client } = fake({ processes: {} });
    client.getAutoNudgeStatus = async (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aggregate aborted')), { once: true });
    });
    const running = runWithOwnerLock(lock, () => runAutoNudgeCycle(client, options));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(existsSync(lock)).toBe(true);
    controller.abort();
    await expect(running).rejects.toThrow(/aggregate status endpoint is required.*(Cancelled|aggregate aborted)/);
    expect(existsSync(lock)).toBe(false);
  });

  it('enforces owner lock contention and recovers a stale owner', () => {
    const { dir } = setup(); const lock = join(dir, 'owner.lock');
    const release = acquireLock(lock);
    expect(() => acquireLock(lock)).toThrow(/another auto-nudge owner/);
    release();
    const staleLock = join(dir, 'stale.lock');
    mkdirSync(staleLock); writeFileSync(join(staleLock, 'pid'), '2147483647');
    expect(() => acquireLock(staleLock)()).not.toThrow();
  });

  it('uses the existing REST client for exact process send/status and keeps logs separate', async () => {
    const sentProcess = proc('checkpoint', 'overseer', 'running', 8);
    const terminalProcess = proc('checkpoint', 'overseer', 'completed', 9);
    let observedTimeout: number | undefined;
    const adapter = createAutoNudgeClient({
      async getAllWorkspaces() { return []; },
      async getSessions() { return []; }, async getSessionProcesses() { return []; },
      async getSession(id) { return session(id, id); },
      async createSession(body) { return session('fresh-production', body.name ?? 'fresh', body.executor); },
      async sendMessage() { return sentProcess; },
      async fetchConversation(_id, timeout) { observedTimeout = timeout; return [msg('DONE')]; },
      async getExecutionProcess(id) { expect(id).toBe('checkpoint'); return terminalProcess; },
      async getExecutionProcessFinalResponse(id) { expect(id).toBe('checkpoint'); return finalResponse(terminalProcess, 'DONE'); },
      async getExecutionProcessFinalResponseStrict(id) { expect(id).toBe('checkpoint'); return finalResponse(terminalProcess, 'DONE'); },
      async getAutoNudgeStatus(request) { return aggregateStatus(request, { processes: {} }); },
    });
    expect((await adapter.sendMessage('overseer', {} as SendMessageBody)).id).toBe('checkpoint');
    expect((await adapter.createSession!({ workspace_id: 'w1', executor: 'CODEX', name: 'review' })).id).toBe('fresh-production');
    expect(await adapter.getExecutionProcess('checkpoint')).toBe(terminalProcess);
    await adapter.fetchConversation('checkpoint', 100);
    expect(observedTimeout).toBe(100);
  });

  it('keeps checkpoint dry-run state and outbox byte-for-byte unchanged', async () => {
    const { options } = setup(); options.dryRun = true;
    const state = readAutoNudgeState(options.statePath);
    state.outbox.event = { id: 'event', workspaceId: 'w1', content: 'alert', createdAt: iso(1), deliveredAt: null, attempts: 0 };
    writeAutoNudgeState(options.statePath, state);
    const before = readFileSync(options.statePath, 'utf8');
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] } });
    expect((await runAutoNudgeCycle(client, options)).checkpoints).toBe(1);
    expect(readFileSync(options.statePath, 'utf8')).toBe(before);
    expect(sent).toEqual([]);
  });

  it('aborts poll delay promptly and releases the owner lock', async () => {
    vi.useFakeTimers();
    const { dir } = setup(); const lock = join(dir, 'owner.lock'); const controller = new AbortController();
    const running = runWithOwnerLock(lock, async () => abortableDelay(300_000, controller.signal));
    expect(existsSync(lock)).toBe(true);
    controller.abort();
    await expect(running).rejects.toThrow('Cancelled');
    expect(existsSync(lock)).toBe(false);
    vi.useRealTimers();
  });
});
