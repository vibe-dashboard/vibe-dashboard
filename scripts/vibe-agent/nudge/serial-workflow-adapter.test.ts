import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSerialRun, mutateSerialRun, readSerialRun, SERIAL_RESULT_SCHEMA, type SerialTemplate } from './serial-workflow.js';
import { dispatchSerialWorkflow, projectSerialWorkflowToBeads, submitObservedSerialResult, type SerialWorkflowTransportClient } from './serial-workflow-adapter.js';
import { schemaHash } from './workflow-xml.js';
import type { ExecutionProcess, QueueStatus, Session } from '../types.js';
import { VibeClient } from '../core/client.js';
import { FakeVkServer, type FakeVkScenario } from '../testing/fake-vk-server.js';

const dirs: string[] = [];
const servers: FakeVkServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.stop(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const identity = { schemaId: 'vd.workflow.role-result', schemaVersion: 1, schemaHash: schemaHash(SERIAL_RESULT_SCHEMA) };
function template(fresh = false): SerialTemplate {
  return { id: 'serial', version: 1, items: [{ id: 'implement', label: 'Implement', role: 'impl', prompt: 'Implement it.', messageType: 'implement_change', fresh, schema: identity, resultSchema: SERIAL_RESULT_SCHEMA, outcomes: { complete: { action: 'advance' } } }] };
}
function process(id: string, sessionId: string): ExecutionProcess {
  return { id, session_id: sessionId, status: 'running', created_at: '', started_at: '', completed_at: null, updated_at: '', exit_code: null, dropped: false, run_reason: 'codingagent', executor_action: {} };
}
class Client implements SerialWorkflowTransportClient {
  sessions: Session[] = [{ id: 'impl-session', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', agent_working_dir: null, created_at: '', updated_at: '' }];
  effect = null as Awaited<ReturnType<SerialWorkflowTransportClient['reconcileQueuedExecution']>>;
  outcome: { status: string; process?: ExecutionProcess; message?: string } = { status: 'started', process: process('process-one', 'impl-session') };
  queueCalls: Array<{ sessionId: string; body: Record<string, unknown> }> = [];
  created: Array<{ id: string; body: Record<string, unknown> }> = [];
  finalResponse: Awaited<ReturnType<SerialWorkflowTransportClient['getExecutionProcessFinalResponseStrict']>> = { process_id: 'process-one', status: 'completed', finished: true, terminal_no_response: false, final_response: null };
  async getSessions() { return this.sessions; }
  async createIdentifiedSession(id: string, body: Parameters<SerialWorkflowTransportClient['createIdentifiedSession']>[1]) { this.created.push({ id, body }); return { ...this.sessions[0]!, ...body, id, workspace_id: body.workspace_id }; }
  async queueMessage(sessionId: string, body: Parameters<SerialWorkflowTransportClient['queueMessage']>[1]): Promise<QueueStatus> {
    this.queueCalls.push({ sessionId, body });
    return { status: 'queued', message: { id: body.queue_id, owner: body.owner, session_id: sessionId, data: { message: body.message, executor_config: body.executor_config, session_command: null }, requested_payload_fingerprint: 'sha256:payload', queued_at: '' } };
  }
  async reconcileQueuedExecution() { return this.effect; }
  async startQueuedExecution() { return this.outcome; }
  async getExecutionProcessFinalResponseStrict() { return this.finalResponse; }
}
function setup(fresh = false) {
  const dir = mkdtempSync(join(tmpdir(), 'serial-adapter-')); dirs.push(dir);
  const file = join(dir, 'run.json');
  createSerialRun(file, { id: 'run', workspaceId: 'workspace', beadIds: ['bead'], template: template(fresh), authority: { mode: 'human' } }, 'create');
  return file;
}

describe('serial workflow VK dispatch adapter', () => {
  it('persists immutable identity before transport and binds the exact started process', async () => {
    const file = setup(); const client = new Client();
    const dispatch = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    expect(dispatch).toMatchObject({ status: 'accepted', processId: 'process-one', attempt: 1 });
    expect(client.queueCalls[0]).toMatchObject({ sessionId: 'impl-session', body: { queue_id: dispatch.id, owner: 'workflow:run' } });
    expect(String(client.queueCalls[0]!.body.message)).toContain(`dispatch_id=${dispatch.id}`);
  });

  it('retries failed-before-start with the exact same queue identity and payload', async () => {
    const file = setup(); const client = new Client(); client.outcome = { status: 'failed_before_start', message: 'not spawned' };
    const failed = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    mutateSerialRun(file, readSerialRun(file).version, 'retry', { type: 'retry' });
    client.outcome = { status: 'started', process: process('process-two', failed.transport.sessionId) };
    const accepted = await dispatchSerialWorkflow(file, client, readSerialRun(file).version, 'retry-dispatch');
    expect(accepted.id).toBe(failed.id);
    expect(accepted.attempt).toBe(2);
    expect(client.queueCalls[1]!.body).toEqual(client.queueCalls[0]!.body);
  });

  it('replays durable started before enqueueing and creates fresh sessions by immutable identity', async () => {
    const file = setup(true); const client = new Client();
    const first = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    expect(client.created).toHaveLength(1);
    expect(client.created[0]!.id).toBe(first.transport.sessionId);
    const replayFile = setup(); const replay = new Client();
    const run = readSerialRun(replayFile); const dispatchId = 'stable-id';
    mutateSerialRun(replayFile, run.version, 'start', { type: 'start', dispatchId, transport: { owner: 'workflow:run', sessionId: 'impl-session', messageType: 'implement_change', fresh: false, prompt: 'same', executorConfig: { executor: 'CODEX' }, freshSession: null } });
    replay.effect = { queue_id: dispatchId, owner: 'workflow:run', session_id: 'impl-session', requested_payload_fingerprint: 'sha256:payload', lifecycle: 'started', process: process('exact-process', 'impl-session') };
    replay.outcome = { status: 'started', process: process('exact-process', 'impl-session') };
    const result = await dispatchSerialWorkflow(replayFile, replay, readSerialRun(replayFile).version, 'resume');
    expect(result.processId).toBe('exact-process');
    expect(replay.queueCalls).toHaveLength(0);
  });

  it('submits only the final response fetched for the accepted process', async () => {
    const file = setup(); const client = new Client(); const dispatch = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    client.finalResponse = { process_id: dispatch.processId!, status: 'completed', finished: true, terminal_no_response: false, final_response: JSON.stringify({ run_id: 'run', item_id: 'implement', revision: 1, dispatch_id: dispatch.id, outcome: 'complete', details: {} }) };
    await submitObservedSerialResult(file, client, readSerialRun(file).version, 'result');
    expect(readSerialRun(file).status).toBe('completed');
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['schema violation', JSON.stringify({ run_id: 'run' })],
    ['stale correlation', JSON.stringify({ run_id: 'other', item_id: 'implement', revision: 1, dispatch_id: 'wrong', outcome: 'complete', details: {} })],
    ['disallowed outcome', JSON.stringify({ run_id: 'run', item_id: 'implement', revision: 1, dispatch_id: 'DISPATCH', outcome: 'unknown', details: {} })],
  ])('durably marks terminal %s as needs attention', async (_label, response) => {
    const file = setup(); const client = new Client(); const dispatch = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    client.finalResponse = {
      process_id: dispatch.processId!, status: 'completed', finished: true,
      terminal_no_response: false, final_response: response.replace('DISPATCH', dispatch.id),
    };
    await submitObservedSerialResult(file, client, readSerialRun(file).version, 'result');
    const run = readSerialRun(file);
    expect(run.status).toBe('needs_attention');
    expect(run.dispatches[0]!.resultError).toMatch(/terminal process/i);
  });

  it('reconciles an uncertain dispatch to its exact durable started process without resending', async () => {
    const file = setup(); const client = new Client(); client.outcome = { status: 'indeterminate', message: 'response lost' };
    const uncertain = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    client.effect = { queue_id: uncertain.id, owner: uncertain.transport.owner, session_id: uncertain.transport.sessionId, requested_payload_fingerprint: 'sha256:payload', lifecycle: 'started', process: process('reconciled-process', uncertain.transport.sessionId) };
    client.outcome = { status: 'started', process: process('reconciled-process', uncertain.transport.sessionId) };
    const accepted = await dispatchSerialWorkflow(file, client, readSerialRun(file).version, 'reconcile');
    expect(accepted).toMatchObject({ status: 'accepted', processId: 'reconciled-process' });
    expect(client.queueCalls).toHaveLength(1);
  });

  it('keeps workspace ownership while another run has an unresolved accepted dispatch', async () => {
    const first = setup(); const client = new Client(); await dispatchSerialWorkflow(first, client, 1, 'first');
    client.finalResponse = { process_id: 'process-one', status: 'completed', finished: true, terminal_no_response: false, final_response: '{bad' };
    await submitObservedSerialResult(first, client, readSerialRun(first).version, 'invalid');
    const second = join(join(first, '..'), 'second.json');
    createSerialRun(second, { id: 'second', workspaceId: 'workspace', beadIds: ['other'], template: template(), authority: { mode: 'human' } }, 'create');
    await expect(dispatchSerialWorkflow(second, new Client(), 1, 'second')).rejects.toThrow(/already has active workflow run/);
  });

  it('retries a failed bead projection and records only a complete snapshot', () => {
    const file = setup(); let calls = 0;
    expect(() => projectSerialWorkflowToBeads(file, '/beads', () => { calls++; throw new Error('bd unavailable'); })).toThrow('bd unavailable');
    expect(existsSync(`${file}.projection.json`)).toBe(false);
    projectSerialWorkflowToBeads(file, '/beads', () => { calls++; });
    expect(existsSync(`${file}.projection.json`)).toBe(true);
    projectSerialWorkflowToBeads(file, '/beads', () => { calls++; });
    expect(calls).toBe(2);
    const run = readSerialRun(file);
    mutateSerialRun(file, run.version, 'start-for-projection', {
      type: 'start', dispatchId: 'projection-dispatch',
      transport: { owner: 'workflow:run', sessionId: 'impl-session', messageType: 'implement_change', fresh: false, prompt: 'work', executorConfig: { executor: 'CODEX' }, freshSession: null },
    });
    projectSerialWorkflowToBeads(file, '/beads', () => { calls++; });
    expect(calls).toBe(3);
  });

  it('uses the real VibeClient queue/start/reconcile contracts without follow-up or WebSocket', async () => {
    const file = setup();
    const queuedProcess = { ...process('transport-process', 'impl-session'), status: 'completed' as const, completed_at: '', exit_code: 0, conversation: [] };
    const scenario: FakeVkScenario = { workspaces: [{ id: 'workspace' }], sessions: [{ id: 'impl-session', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', created_at: '', updated_at: '', processes: [] }], followUps: [{ sessionId: 'impl-session', process: queuedProcess }] };
    const server = await new FakeVkServer(scenario).start(); servers.push(server);
    const client = new VibeClient(server.baseUrl);
    const accepted = await dispatchSerialWorkflow(file, client, 1, 'dispatch');
    expect(accepted.processId).toBe('transport-process');
    expect(server.journal.some(entry => entry.path?.includes('/queue/'))).toBe(true);
    expect(server.journal.some(entry => entry.path?.endsWith('/follow-up'))).toBe(false);
  });

  it('fails a missing strict final-response endpoint without opening normalized-log WebSockets', async () => {
    const scenario: FakeVkScenario = { workspaces: [], sessions: [] };
    const server = await new FakeVkServer(scenario).start(); servers.push(server);
    const client = new VibeClient(server.baseUrl);
    await expect(client.getExecutionProcessFinalResponseStrict('missing')).rejects.toThrow();
    expect(server.journal.some(entry => entry.path?.includes('normalized-logs'))).toBe(false);
  });

  it('allows only one active serial run per workspace', async () => {
    const first = setup(); const second = join(join(first, '..'), 'second.json');
    createSerialRun(second, { id: 'second', workspaceId: 'workspace', beadIds: ['other'], template: template(), authority: { mode: 'human' } }, 'create');
    await dispatchSerialWorkflow(first, new Client(), 1, 'first');
    await expect(dispatchSerialWorkflow(second, new Client(), 1, 'second')).rejects.toThrow(/already has active workflow run/);
  });
});
