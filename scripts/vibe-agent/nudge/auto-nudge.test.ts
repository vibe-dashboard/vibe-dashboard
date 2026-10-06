import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoNudgeStatusRequest, AutoNudgeStatusResponse, ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import {
  abortableDelay, acquireLock, createAutoNudgeClient, DEFAULT_OVERSEER_PROMPT, DEFAULT_NUDGE_CONFIG_PATH, disableAutoNudgeWorkspace, enableAutoNudgeWorkspace, formatWorkspaceCriteriaBlock, isAutoNudgeEnabled, loadAutoNudgeConfig, loadNudgeRuntimeConfig, readAutoNudgeState, readAutoNudgeWorkspaceRegistry, responseMatchesEndCondition, runAutoNudgeCycle, runWithOwnerLock, writeAutoNudgeState,
  type AutoNudgeClient, type AutoNudgeOptions,
} from './auto-nudge.js';
import { appendResponseRoute, bindResponseRouteProcess, readResponseRouteState, updateResponseRoute } from './response-routes.js';
import { enqueueSend, readSendQueue } from './send-queue.js';

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
    async sendMessage(id, body) { sent.push({ sessionId: id, body }); return proc(id === 'overseer' ? 'checkpoint' : `sent-${sent.length}`, id, 'running', 10); },
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
  it('loads runtime nudge config defaults and validates overrides', () => {
    const { dir } = setup(); const path = join(dir, 'nudge_config.json');
    expect(DEFAULT_NUDGE_CONFIG_PATH).toBe('/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/nudge_config.json');
    expect(loadNudgeRuntimeConfig(join(dir, 'missing.json'))).toMatchObject({
      error: null,
      config: { version: 1, endConditions: ['DONE', 'CREATED FORM'] },
    });
    expect(loadNudgeRuntimeConfig(join(dir, 'missing.json')).config.overseerPrompt).toContain('beads-form');
    writeFileSync(path, JSON.stringify({ version: 1, overseerPrompt: 'custom prompt', endConditions: ['DONE', 'WAITING USER'] }));
    expect(loadNudgeRuntimeConfig(path)).toEqual({
      error: null,
      config: { version: 1, overseerPrompt: 'custom prompt', endConditions: ['DONE', 'WAITING USER'] },
    });
  });

  it('falls back safely when runtime nudge config is malformed', () => {
    const { dir } = setup(); const path = join(dir, 'nudge_config.json');
    writeFileSync(path, '{bad');
    const loaded = loadNudgeRuntimeConfig(path);
    expect(loaded.error).toMatch(/Invalid nudge config/);
    expect(loaded.config).toMatchObject({ version: 1, endConditions: ['DONE', 'CREATED FORM'] });
    expect(loaded.config.overseerPrompt).toBe(DEFAULT_OVERSEER_PROMPT);
  });

  it('matches case-sensitive end-condition markers only as suffix lines', () => {
    expect(responseMatchesEndCondition('All done.\nDONE', ['DONE', 'CREATED FORM'])).toBe(true);
    expect(responseMatchesEndCondition('Please fill out the form.\nCREATED FORM', ['DONE', 'CREATED FORM'])).toBe(true);
    expect(responseMatchesEndCondition('DONE ', ['DONE', 'CREATED FORM'])).toBe(true);
    expect(responseMatchesEndCondition('All done.\ndone', ['DONE', 'CREATED FORM'])).toBe(false);
    expect(responseMatchesEndCondition('CREATED FORM please', ['DONE', 'CREATED FORM'])).toBe(false);
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

  it('nudges an idle teammate terminal turn without a final response exactly once', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sessionId: 'impl', body: { prompt: 'Please continue' } });
  });

  it('nudges terminal no-final work in an unregistered workspace without checkpointing', async () => {
    const { options } = setup();
    options.config.workspaces = [];
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p] }, entries: { failed: [tool] } });
    client.getAllWorkspaces = async () => [{ id: 'w1', archived: false } as any];
    client.getSessions = async () => [session('impl', 'impl')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
    expect(readAutoNudgeState(options.statePath).triggers).toEqual({});
  });

  it('keeps dry-run read-only and sends exactly once on the following real cycle', async () => {
    const { options } = setup();
    const p = proc('failed', 'impl', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [p], overseer: [] }, entries: { failed: [tool] } });
    options.dryRun = true;
    expect((await runAutoNudgeCycle(client, options)).teammateNudges).toBe(1);
    expect(existsSync(options.statePath)).toBe(false);
    options.dryRun = false;
    await runAutoNudgeCycle(client, options);
    await runAutoNudgeCycle(client, options);
    expect(sent).toHaveLength(1);
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

  it('executes at most one deterministic recovery for two failed sessions', async () => {
    const { options } = setup();
    const older = proc('older', 'impl', 'failed', 7); const newer = proc('newer', 'review', 'failed', 8);
    const { client, sent } = fake({ processes: { impl: [older], review: [newer], overseer: [] }, entries: { older: [tool], newer: [tool] } });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([expect.objectContaining({ sessionId: 'review' })]);
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

  it('creates a checkpoint for an old teammate completion and closes only that trigger on DONE', async () => {
    const { options } = setup();
    const complete = proc('complete-1', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { 'complete-1': [msg('Finished')] }, response: 'All done.\nDONE' });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.sessionId).toBe('overseer');
    expect(sent[0]?.body.prompt).toContain('beads-form');
    expect(sent[0]?.body.prompt).toContain('CREATED FORM');
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
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { 'complete-criteria': [msg('Finished')] }, response: 'DONE' });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.body.prompt).toContain('Workspace completion criteria:');
    expect(sent[0]?.body.prompt).toContain('Goal: Finish the auto-nudge handoff');
    expect(sent[0]?.body.prompt).toContain('- vkvw-ke5n2');
    expect(sent[0]?.body.prompt).toContain('- vkvw-u4m13');
  });

  it('treats CREATED FORM suffix as a terminal checkpoint outcome', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Please fill out the form.\nCREATED FORM' });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('uses configured checkpoint prompt and end conditions', async () => {
    const { dir, options } = setup();
    options.nudgeConfigPath = join(dir, 'nudge_config.json');
    writeFileSync(options.nudgeConfigPath, JSON.stringify({ version: 1, overseerPrompt: 'custom checkpoint', endConditions: ['WAITING USER'] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Need input.\nWAITING USER' });
    await runAutoNudgeCycle(client, options);
    expect(sent[0]?.body.prompt).toBe('custom checkpoint');
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('falls back to default prompt and markers when runtime config is malformed during a cycle', async () => {
    const { dir, options } = setup();
    options.nudgeConfigPath = join(dir, 'nudge_config.json');
    writeFileSync(options.nudgeConfigPath, JSON.stringify({ version: 2, overseerPrompt: 'bad', endConditions: ['NOPE'] }));
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'DONE' });
    const result = await runAutoNudgeCycle(client, options);
    expect(result.errors).toEqual([expect.stringMatching(/Invalid nudge config/)]);
    expect(sent[0]?.body.prompt).toBe(DEFAULT_OVERSEER_PROMPT);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('keeps a non-DONE checkpoint open without a causally newer teammate process', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'I will continue' });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('observed');
  });

  it('accepts delegation only from a new post-checkpoint process ID', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'impl', 'completed', 11);
    const { client } = fake({ processes: { impl: [complete], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Continuing' });
    let reads = 0;
    client.getAutoNudgeStatus = async request => aggregateStatus(request, { processes: { impl: (++reads > 1 ? [delegated, complete] : [complete]), overseer: [] }, entries: { complete: [msg('Finished')] } });
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
  });

  it('treats a baton pass before checkpoint terminal as delegated with no final message', async () => {
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
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
  });

  it('treats a baton pass before checkpoint terminal as delegated with a small final explanation', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const delegated = proc('delegated', 'review', 'running', 9);
    const { client } = fake({ processes: { impl: [complete], review: [], overseer: [] }, entries: { complete: [msg('Finished')] }, response: 'Sent to review.' });
    client.getSessions = async () => [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')];
    let reads = 0;
    client.getAutoNudgeStatus = async request => aggregateStatus(request, { processes: { impl: [complete], review: (++reads > 1 ? [delegated] : []), overseer: [] }, entries: { complete: [msg('Finished')] }, sessions: [session('overseer', 'overseer'), session('impl', 'impl'), session('review', 'review')] });
    client.getExecutionProcess = async id => proc(id, 'overseer', 'completed', 10);
    await runAutoNudgeCycle(client, options);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('delegated');
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
    ['completed', 'DONE', 'done', 'persisted'],
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
    const { client, sent } = fake({ processes: { impl: [complete], overseer: [proc('persisted', 'overseer', 'running', 8)] }, entries: { complete: [msg('Finished')], persisted: [msg('DONE')] } });
    let reads = 0;
    client.getExecutionProcess = async () => proc('persisted', 'overseer', ++reads === 1 ? 'running' : 'completed', 8);
    await runAutoNudgeCycle(client, options);
    expect(sent).toEqual([]);
    expect(reads).toBe(2);
    expect(readAutoNudgeState(options.statePath).triggers.complete?.status).toBe('done');
  });

  it('treats configured XML created-form handoff as actioned and enqueues the role message', async () => {
    const { options } = setup();
    const complete = proc('complete', 'impl', 'completed', 5);
    const state = readAutoNudgeState(options.statePath);
    state.triggers.complete = { processId: 'complete', workspaceId: 'w1', sessionId: 'impl', observedAt: iso(6), status: 'checkpoint-sent', checkpointProcessId: 'persisted', baselineProcessIds: ['complete'], updatedAt: iso(6), error: null };
    writeAutoNudgeState(options.statePath, state);
    const response = `<auto-nudge-result version="1">
  <actions>
    <action type="send_message" role="decision_maker" message_type="created_form_handoff">
      <bead id="vkvw-pnhne" />
      <form id="decision-form" />
    </action>
    <action type="wait" mode="callback-wait" />
  </actions>
</auto-nudge-result>`;
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
      status: 'queued',
      targetSessionId: 'decision',
      replySessionId: 'overseer',
    })]);
    expect(sends[0]?.prompt).toContain('The overseer created a decision form');
    expect(sends[0]?.prompt).toContain('Forms: decision-form');
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
    expect(result).toMatchObject({ registeredWorkspaces: 3, globalWorkspacesScanned: 1, sessionsScanned: 4, pagesFetched: 1, truncated: true, nextCursor: 'cursor-next' });
    expect(readAutoNudgeState(options.statePath).globalCursor).toBe('cursor-next');
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
        const page = [input.registered_workspace_ids[0]!, ...workspaces.filter(id => id !== input.registered_workspace_ids[0]).slice(0, input.limit_workspaces)];
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
      include_global_recent: true,
      global_cursor: null,
      limit_workspaces: 25,
      limit_sessions: 250,
    });
    expect(result).toMatchObject({
      registeredWorkspaces: 1,
      globalWorkspacesScanned: 25,
      pagesFetched: 1,
      truncated: true,
      nextCursor: 'cursor-next',
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
      async sendMessage() { return sentProcess; },
      async fetchConversation(_id, timeout) { observedTimeout = timeout; return [msg('DONE')]; },
      async getExecutionProcess(id) { expect(id).toBe('checkpoint'); return terminalProcess; },
      async getExecutionProcessFinalResponse(id) { expect(id).toBe('checkpoint'); return finalResponse(terminalProcess, 'DONE'); },
      async getExecutionProcessFinalResponseStrict(id) { expect(id).toBe('checkpoint'); return finalResponse(terminalProcess, 'DONE'); },
      async getAutoNudgeStatus(request) { return aggregateStatus(request, { processes: {} }); },
    });
    expect((await adapter.sendMessage('overseer', {} as SendMessageBody)).id).toBe('checkpoint');
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
