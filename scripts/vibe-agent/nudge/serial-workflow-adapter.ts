import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VibeClient } from '../core/client.js';
import type { ExecutionProcessFinalResponse, QueueEffectReconciliation, QueueStatus, Session } from '../types.js';
import { mutateSerialRun, readSerialRun, type SerialResult, type WorkflowDispatch } from './serial-workflow.js';

export interface SerialWorkflowTransportClient {
  getSessions(workspaceId: string): Promise<Session[]>;
  createIdentifiedSession(sessionId: string, body: { workspace_id: string; executor: Session['executor']; name?: string | null; agent_working_dir: string | null }): Promise<Session>;
  queueMessage(sessionId: string, body: { queue_id: string; owner: string; message: string; executor_config: { executor: Session['executor'] } }): Promise<QueueStatus>;
  reconcileQueuedExecution(sessionId: string, queueId: string): Promise<QueueEffectReconciliation | null>;
  startQueuedExecution(sessionId: string, queueId: string, body: { owner: string; message: string; executor_config: { executor: Session['executor'] } }): Promise<{ status: string; process?: { id: string }; message?: string }>;
  getExecutionProcessFinalResponseStrict(processId: string): Promise<ExecutionProcessFinalResponse>;
}

export function roleDispatchPrompt(runFile: string, dispatchId: string): string {
  const run = readSerialRun(runFile);
  const item = run.template.items[run.currentIndex]!;
  return `${item.prompt.trim()}\n\nReturn exactly one JSON object matching this contract. Ordinary prose does not complete this workflow item.\nSchema: ${item.schema.schemaId} v${item.schema.schemaVersion} ${item.schema.schemaHash}\nCorrelation: run_id=${run.id} item_id=${item.id} revision=${run.revision} dispatch_id=${dispatchId}\nExample: ${JSON.stringify({ run_id: run.id, item_id: item.id, revision: run.revision, dispatch_id: dispatchId, outcome: Object.keys(item.outcomes)[0], details: {} })}`;
}

function currentDispatch(runFile: string): WorkflowDispatch | null {
  const run = readSerialRun(runFile);
  const id = run.items[run.currentIndex]?.dispatchId;
  return id ? run.dispatches.find(dispatch => dispatch.id === id) ?? null : null;
}

async function acquireWorkspaceLock(runFile: string, workspaceId: string): Promise<() => void> {
  const lock = path.join(path.dirname(runFile), `.workspace-${workspaceId}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        process.kill(owner, 0);
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH') { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      }
      if (Date.now() >= deadline) throw new Error(`Workspace ${workspaceId} already has an active workflow mutation`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

export async function dispatchSerialWorkflow(
  runFile: string,
  client: SerialWorkflowTransportClient,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<WorkflowDispatch> {
  let run = readSerialRun(runFile);
  const releaseWorkspace = await acquireWorkspaceLock(runFile, run.workspaceId);
  try {
  for (const sibling of fs.readdirSync(path.dirname(runFile)).filter(name => name.endsWith('.json'))) {
    const siblingFile = path.join(path.dirname(runFile), sibling);
    if (siblingFile === runFile) continue;
    const other = readSerialRun(siblingFile);
    if (other.workspaceId === run.workspaceId && ['active', 'waiting'].includes(other.status)) {
      throw new Error(`Workspace ${run.workspaceId} already has active workflow run ${other.id}`);
    }
  }
  let dispatch = currentDispatch(runFile);
  if (!dispatch) {
    if (run.version !== expectedVersion) throw new Error(`Workflow version conflict: expected ${expectedVersion}, actual ${run.version}`);
    const item = run.template.items[run.currentIndex]!;
    const sessions = await client.getSessions(run.workspaceId);
    const current = sessions.find(session => session.name === item.role);
    if (!current?.executor) throw new Error(`No current executor-backed session found for role ${item.role}`);
    const dispatchId = randomUUID();
    const sessionId = item.fresh ? randomUUID() : current.id;
    const freshSession = item.fresh ? {
      id: sessionId, workspaceId: run.workspaceId, executor: current.executor,
      name: item.role, agentWorkingDir: current.agent_working_dir ?? null,
    } : null;
    mutateSerialRun(runFile, expectedVersion, idempotencyKey, {
      type: 'start', dispatchId,
      transport: {
        owner: `workflow:${run.id}`, sessionId, messageType: item.messageType, fresh: item.fresh,
        prompt: roleDispatchPrompt(runFile, dispatchId), executorConfig: { executor: current.executor }, freshSession,
      },
    });
    dispatch = currentDispatch(runFile)!;
  }

  if (dispatch.status === 'accepted') return dispatch;
  if (dispatch.status === 'uncertain') throw new Error('Dispatch is indeterminate and requires exact reconciliation');
  const transport = dispatch.transport;
  if (transport.freshSession) {
    const fresh = transport.freshSession;
    await client.createIdentifiedSession(fresh.id, {
      workspace_id: fresh.workspaceId,
      executor: fresh.executor as Session['executor'],
      name: fresh.name,
      agent_working_dir: fresh.agentWorkingDir,
    });
  }

  const requestedBody = { owner: transport.owner, message: transport.prompt, executor_config: transport.executorConfig as { executor: Session['executor'] } };
  let effect = await client.reconcileQueuedExecution(transport.sessionId, dispatch.id);
  if (effect) {
    if (effect.owner !== transport.owner || effect.session_id !== transport.sessionId) throw new Error('Durable queue identity conflicts with workflow intent');
    const reconciled = await client.startQueuedExecution(transport.sessionId, dispatch.id, requestedBody);
    if (reconciled.status === 'started' && reconciled.process) {
      const latest = readSerialRun(runFile);
      mutateSerialRun(runFile, latest.version, `${idempotencyKey}:accepted:${dispatch.attempt}`, { type: 'accept', dispatchId: dispatch.id, processId: reconciled.process.id });
      return currentDispatch(runFile)!;
    }
    if (reconciled.status === 'indeterminate' || effect.lifecycle === 'reserved' || effect.lifecycle === 'indeterminate') throw new Error(`Queue effect is ${effect.lifecycle}; refusing duplicate start`);
  }

  if (dispatch.status === 'intent') {
    mutateSerialRun(runFile, readSerialRun(runFile).version, `${idempotencyKey}:submitting:${dispatch.attempt}`, { type: 'submitting', dispatchId: dispatch.id });
  }
  const queued = await client.queueMessage(transport.sessionId, {
    queue_id: dispatch.id,
    owner: transport.owner,
    message: transport.prompt,
    executor_config: requestedBody.executor_config,
  });
  if (queued.status === 'empty' || queued.message.id !== dispatch.id || queued.message.owner !== transport.owner) throw new Error('VK did not preserve exact queued workflow identity');
  const outcome = await client.startQueuedExecution(transport.sessionId, dispatch.id, requestedBody);
  if (outcome.status === 'started' && outcome.process) {
    const latest = readSerialRun(runFile);
    mutateSerialRun(runFile, latest.version, `${idempotencyKey}:accepted:${dispatch.attempt}`, { type: 'accept', dispatchId: dispatch.id, processId: outcome.process.id });
  } else if (outcome.status === 'failed_before_start') {
    const latest = readSerialRun(runFile);
    mutateSerialRun(runFile, latest.version, `${idempotencyKey}:failed:${dispatch.attempt}`, { type: 'delivery_failed', dispatchId: dispatch.id, disposition: 'proven_unaccepted', reason: outcome.message ?? 'VK proved no child started' });
  } else if (outcome.status === 'indeterminate') {
    const latest = readSerialRun(runFile);
    mutateSerialRun(runFile, latest.version, `${idempotencyKey}:uncertain:${dispatch.attempt}`, { type: 'delivery_failed', dispatchId: dispatch.id, disposition: 'uncertain', reason: outcome.message ?? 'VK start is indeterminate' });
  }
  return currentDispatch(runFile)!;
  } finally {
    releaseWorkspace();
  }
}

export async function submitObservedSerialResult(
  runFile: string,
  client: Pick<VibeClient, 'getExecutionProcessFinalResponseStrict'>,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<void> {
  const run = readSerialRun(runFile);
  const dispatch = currentDispatch(runFile);
  if (!dispatch?.processId || dispatch.status !== 'accepted') throw new Error('Current workflow dispatch is not accepted');
  const observed = await client.getExecutionProcessFinalResponseStrict(dispatch.processId);
  if (observed.process_id !== dispatch.processId || !observed.finished) throw new Error('Accepted workflow process is not terminal');
  if (!observed.final_response) {
    mutateSerialRun(runFile, expectedVersion, idempotencyKey, { type: 'missing_result', dispatchId: dispatch.id, sourceProcessId: dispatch.processId });
    return;
  }
  let result: SerialResult;
  try { result = JSON.parse(observed.final_response) as SerialResult; }
  catch { throw new Error('Accepted workflow process final response is not JSON'); }
  const item = run.template.items[run.currentIndex]!;
  mutateSerialRun(runFile, expectedVersion, idempotencyKey, { type: 'result', schema: item.schema, sourceProcessId: dispatch.processId, result });
}
