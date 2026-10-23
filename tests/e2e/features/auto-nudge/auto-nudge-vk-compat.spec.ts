import { expect, test } from 'playwright/test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VibeClient } from '../../../../scripts/vibe-agent/core/client.js';
import { createAutoNudgeClient, readAutoNudgeState, runAutoNudgeCycle, writeAutoNudgeState, type AutoNudgeOptions } from '../../../../scripts/vibe-agent/nudge/auto-nudge.js';
import { createCallback } from '../../../../scripts/vibe-agent/nudge/callback-registry.js';
import { readResponseRouteState } from '../../../../scripts/vibe-agent/nudge/response-routes.js';
import type { ExecutionProcess, SendMessageBody, Session } from '../../../../scripts/vibe-agent/types.js';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const client = new VibeClient(sandboxUrl);
const cliPath = 'dist/vibe-agent/legacy-cli/vibe-agent.js';
const body = (prompt: string, session: Session): SendMessageBody => ({ prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null });
const api = (path: string, init?: RequestInit) => fetch(`${sandboxUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
async function runVibeAgent(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise(resolve => {
    execFile(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr });
    });
  });
}
async function terminal(processId: string): Promise<ExecutionProcess> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const process = await client.getExecutionProcess(processId); if (process.status !== 'running') return process;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`QA process ${processId} did not become terminal`);
}
async function context() {
  const workspace = (await client.getAllWorkspaces()).find(item => item.name === 'Basic Seeded VK Craft') ?? (await client.getAllWorkspaces())[0];
  if (!workspace) throw new Error('QA sandbox has no seeded workspace');
  const teammate = await client.createSession({ workspace_id: workspace.id, executor: 'CODEX', name: `auto-nudge-teammate-${Date.now()}` });
  const overseer = await client.createSession({ workspace_id: workspace.id, executor: 'CODEX', name: `auto-nudge-overseer-${Date.now()}` });
  const dir = await mkdtemp(join(tmpdir(), 'auto-nudge-qa-'));
  const options: AutoNudgeOptions = { config: { version: 1, workspaces: [{ workspaceId: workspace.id, overseerSessionId: overseer.id }] }, statePath: join(dir, 'state.json'), callbackRegistryPath: join(dir, 'callbacks.json'), responseRoutesPath: join(dir, 'response-routes.json'), now: () => new Date(), unacknowledgedAfterMs: 0, operationTimeoutMs: 5_000, responseTimeoutMs: 30_000, checkpointPollMs: 100, concurrency: 2, dryRun: false };
  return { workspace, teammate, overseer, dir, options };
}

test.describe.serial('auto-nudge compatibility with real VK QA-mode contracts', () => {
  test('VK atomically admits one concurrent follow-up and rejects the rest as busy', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `atomic-admission-${Date.now()}` });
      const requests = Array.from({ length: 4 }, (_, index) => api(`/api/sessions/${target.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify(body(`concurrent follow-up ${index}`, target)),
      }));
      const responses = await Promise.all(requests);
      expect(responses.filter(response => response.status === 200)).toHaveLength(1);
      expect(responses.filter(response => response.status === 409)).toHaveLength(3);
      for (const response of responses.filter(response => response.status === 409)) {
        await expect(response.json()).resolves.toMatchObject({ success: false, message: `Session ${target.id} already has an active coding-agent turn` });
      }
      const accepted = responses.find(response => response.status === 200)!;
      const payload = await accepted.json() as { data: ExecutionProcess };
      await terminal(payload.data.id);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('VK queue HTTP API preserves identity and never replaces an occupied slot', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `owned-queue-${Date.now()}` });
      const queueId = randomUUID();
      const queueBody = { queue_id: queueId, owner: 'qa-owner', message: 'queued one', executor_config: { executor: target.executor } };
      const queued = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) });
      expect(queued.status).toBe(200);
      await expect(queued.json()).resolves.toMatchObject({ data: { status: 'queued', message: { id: queueId, owner: 'qa-owner' } } });

      const replay = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ data: { status: 'queued', message: { id: queueId, owner: 'qa-owner' } } });

      const changedPayload = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify({ ...queueBody, message: 'changed' }) });
      expect(changedPayload.status).toBe(409);
      const changedOwner = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify({ ...queueBody, owner: 'other-owner' }) });
      expect(changedOwner.status).toBe(409);
      const occupied = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify({ ...queueBody, queue_id: randomUUID() }) });
      expect(occupied.status).toBe(409);

      const amended = await api(`/api/sessions/${target.id}/queue`, { method: 'PUT', body: JSON.stringify({ ...queueBody, message: 'amended' }) });
      expect(amended.status).toBe(200);
      await expect(amended.json()).resolves.toMatchObject({ data: { status: 'queued', message: { data: { message: 'amended' } } } });
      const wrongCancel = await api(`/api/sessions/${target.id}/queue?queue_id=${queueId}&owner=other-owner`, { method: 'DELETE' });
      expect(wrongCancel.status).toBe(409);
      const cancelled = await api(`/api/sessions/${target.id}/queue?queue_id=${queueId}&owner=qa-owner`, { method: 'DELETE' });
      expect(cancelled.status).toBe(200);
      await expect(cancelled.json()).resolves.toMatchObject({ data: { status: 'empty' } });
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('concurrent identified idle starts accept one child and validate durable replay', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `idle-dispatch-${Date.now()}` });
      const queueId = randomUUID(); const owner = 'qa-idle-dispatch';
      const queueBody = { queue_id: queueId, owner, message: 'QA_DELAY_BEFORE_SPAWN_MS=1000\nidentified idle dispatch', executor_config: { executor: target.executor } };
      const start = (payload = queueBody) => api(`/api/sessions/${target.id}/queue/${queueId}/start`, {
        method: 'POST', body: JSON.stringify({ owner: payload.owner, message: payload.message, executor_config: payload.executor_config }),
      });
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      const responses = await Promise.all(Array.from({ length: 4 }, () => start()));
      const results = await Promise.all(responses.map(async response => {
        expect(response.status).toBe(200);
        return await response.json() as { data: { status: string; process?: ExecutionProcess } };
      }));
      expect(results.every(result => ['started', 'pending', 'indeterminate'].includes(result.data.status))).toBe(true);
      expect(results.some(result => result.data.status === 'started')).toBe(true);
      const processId = results.find(result => result.data.status === 'started')!.data.process!.id;
      expect(results.filter(result => result.data.status === 'started').every(result => result.data.process?.id === processId)).toBe(true);
      await terminal(processId);
      expect(await client.getSessionProcesses(target.id)).toHaveLength(1);
      await expect(api(`/api/sessions/${target.id}/queue`).then(response => response.json())).resolves.toMatchObject({ data: { status: 'empty' } });
      await expect(start().then(response => response.json())).resolves.toMatchObject({ data: { status: 'started', process: { id: processId } } });
      expect((await start({ ...queueBody, owner: 'wrong-owner' })).status).toBe(409);
      expect((await start({ ...queueBody, message: 'changed payload' })).status).toBe(409);
      expect(await client.getSessionProcesses(target.id)).toHaveLength(1);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('started replay preserves an unrelated occupied queue slot', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `occupied-replay-${Date.now()}` });
      const queuePath = `/api/sessions/${target.id}/queue`;
      const queueId = randomUUID(); const owner = 'qa-started-replay';
      const queueBody = { queue_id: queueId, owner, message: 'original identified turn', executor_config: { executor: target.executor } };
      const start = (payload = queueBody) => api(`${queuePath}/${queueId}/start`, {
        method: 'POST', body: JSON.stringify({ owner: payload.owner, message: payload.message, executor_config: payload.executor_config }),
      });
      expect((await api(queuePath, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      const accepted = await start();
      expect(accepted.status).toBe(200);
      const acceptedPayload = await accepted.json() as { data: { status: string; process: ExecutionProcess } };
      expect(acceptedPayload.data).toMatchObject({ status: 'started', process: { session_id: target.id, status: 'running' } });
      const processId = acceptedPayload.data.process.id;

      // Keep the accepted child running so the unrelated slot stays queued.
      // Replay must precede both busy admission and any claim of that slot.
      const unrelated = { queue_id: randomUUID(), owner: 'qa-unrelated-owner', message: 'must retain this unrelated queued payload', executor_config: { executor: target.executor } };
      const queued = await api(queuePath, { method: 'POST', body: JSON.stringify(unrelated) });
      expect(queued.status).toBe(200);
      const occupied = await queued.json();
      expect(occupied).toMatchObject({ data: { status: 'queued', message: { id: unrelated.queue_id, owner: unrelated.owner, data: { message: unrelated.message, executor_config: unrelated.executor_config } } } });

      const replays = await Promise.all(Array.from({ length: 4 }, () => start()));
      for (const replay of replays) {
        expect(replay.status).toBe(200);
        await expect(replay.json()).resolves.toMatchObject({ data: { status: 'started', process: { id: processId, session_id: target.id } } });
      }
      expect((await start({ ...queueBody, owner: 'wrong-owner' })).status).toBe(409);
      expect((await start({ ...queueBody, message: 'changed original payload' })).status).toBe(409);
      const retained = await api(queuePath);
      expect(retained.status).toBe(200);
      await expect(retained.json()).resolves.toEqual(occupied);
      const processes = await client.getSessionProcesses(target.id);
      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({ id: processId, status: 'running' });
      await expect(api(`${queuePath}/${unrelated.queue_id}/process`).then(response => response.json())).resolves.toMatchObject({ data: null });

      // Remove only the unrelated queued item before the original finalizer can
      // legitimately consume it; no additional child should have been created.
      const cancelled = await api(`${queuePath}?queue_id=${unrelated.queue_id}&owner=${unrelated.owner}`, { method: 'DELETE' });
      expect(cancelled.status).toBe(200);
      await expect(cancelled.json()).resolves.toMatchObject({ data: { status: 'empty' } });
      await terminal(processId);
      expect((await client.getSessionProcesses(target.id)).map(process => process.id)).toEqual([processId]);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('identified start overlaps finalizer consumption without a duplicate child', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `idle-finalizer-race-${Date.now()}` });
      const predecessor = await client.sendMessage(target.id, body('idle/finalizer predecessor', target));
      const queueId = randomUUID(); const owner = 'qa-idle-finalizer';
      const queueBody = { queue_id: queueId, owner, message: 'QA_DELAY_BEFORE_SPAWN_MS=2000\nfinalizer-owned dispatch', executor_config: { executor: target.executor } };
      const start = () => api(`/api/sessions/${target.id}/queue/${queueId}/start`, {
        method: 'POST', body: JSON.stringify({ owner, message: queueBody.message, executor_config: queueBody.executor_config }),
      });
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      await terminal(predecessor.id);
      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue`)).json() as { data: { status: string } };
        return payload.data.status;
      }, { timeout: 15_000, intervals: [10, 20, 50] }).toBe('consuming');
      const responses = await Promise.all(Array.from({ length: 4 }, () => start()));
      const observedProcessIds: string[] = [];
      for (const response of responses) {
        expect(response.status).toBe(200);
        const payload = await response.json() as { data: { status: string; process?: ExecutionProcess } };
        expect(['pending', 'indeterminate', 'started']).toContain(payload.data.status);
        if (payload.data.status === 'started') observedProcessIds.push(payload.data.process!.id);
      }
      let processId: string | null = null;
      await expect.poll(async () => {
        const payload = await (await start()).json() as { data: { status: string; process?: ExecutionProcess } };
        processId = payload.data.process?.id ?? null;
        return payload.data.status;
      }, { timeout: 20_000 }).toBe('started');
      expect(observedProcessIds.every(id => id === processId)).toBe(true);
      await terminal(processId!);
      const processes = await client.getSessionProcesses(target.id);
      expect(processes).toHaveLength(2);
      expect(new Set(processes.map(process => process.id))).toEqual(new Set([predecessor.id, processId]));
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('queued consumption records durable started identity before removing its slot', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `queue-lifecycle-${Date.now()}` });
      const active = await client.sendMessage(target.id, body(`queue predecessor ${Date.now()}`, target));
      const queueId = randomUUID();
      const owner = 'qa-lifecycle';
      const queued = await api(`/api/sessions/${target.id}/queue`, {
        method: 'POST',
        body: JSON.stringify({ queue_id: queueId, owner, message: 'queued lifecycle follow-up', executor_config: { executor: target.executor } }),
      });
      expect(queued.status).toBe(200);
      await expect(api(`/api/sessions/${target.id}/queue/${queueId}/process`).then(response => response.json())).resolves.toMatchObject({ data: null });

      await terminal(active.id);
      let startedProcessId: string | null = null;
      await expect.poll(async () => {
        const response = await api(`/api/sessions/${target.id}/queue/${queueId}/process`);
        const payload = await response.json() as { data: { owner: string; lifecycle: string; process: ExecutionProcess | null } | null };
        startedProcessId = payload.data?.process?.id ?? null;
        return payload.data && { owner: payload.data.owner, lifecycle: payload.data.lifecycle, processId: startedProcessId };
      }, { timeout: 30_000 }).toEqual({ owner, lifecycle: 'started', processId: expect.any(String) });

      const queueStatus = await api(`/api/sessions/${target.id}/queue`);
      await expect(queueStatus.json()).resolves.toMatchObject({ data: { status: 'empty' } });
      const replay = await api(`/api/sessions/${target.id}/queue/${queueId}/process`);
      await expect(replay.json()).resolves.toMatchObject({ data: { owner, lifecycle: 'started', process: { id: startedProcessId } } });
      await terminal(startedProcessId!);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('queue cancellation and amendment lose once real consumption starts', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `queue-consuming-${Date.now()}` });
      const active = await client.sendMessage(target.id, body(`queue race predecessor ${Date.now()}`, target));
      const queueId = randomUUID();
      const owner = 'qa-consuming-race';
      const queueBody = { queue_id: queueId, owner, message: 'QA_DELAY_BEFORE_SPAWN_MS=2000\nconsume once', executor_config: { executor: target.executor } };
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);

      await terminal(active.id);
      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue`)).json() as { data: { status: string } };
        return payload.data.status;
      }, { timeout: 15_000, intervals: [10, 20, 50] }).toBe('consuming');

      const replay = await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ data: { status: 'consuming', message: { id: queueId, owner } } });
      const cancel = await api(`/api/sessions/${target.id}/queue?queue_id=${queueId}&owner=${owner}`, { method: 'DELETE' });
      expect(cancel.status).toBe(409);
      await expect(cancel.json()).resolves.toMatchObject({ success: false, message: expect.stringContaining('has already been consumed or is no longer queued') });
      const amend = await api(`/api/sessions/${target.id}/queue`, { method: 'PUT', body: JSON.stringify({ ...queueBody, message: 'changed too late' }) });
      expect(amend.status).toBe(409);
      await expect(amend.json()).resolves.toMatchObject({ success: false, message: expect.stringContaining('has already been consumed or is no longer queued') });

      let startedProcessId: string | null = null;
      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue/${queueId}/process`)).json() as { data: { lifecycle: string; process: ExecutionProcess | null } | null };
        startedProcessId = payload.data?.process?.id ?? null;
        return payload.data && { lifecycle: payload.data.lifecycle, processId: startedProcessId };
      }, { timeout: 20_000 }).toEqual({ lifecycle: 'started', processId: expect.any(String) });
      await terminal(startedProcessId!);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('post-start setup failure completes the accepted slot and replays exact identity', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `queue-post-start-${Date.now()}` });
      const active = await client.sendMessage(target.id, body(`post-start predecessor ${Date.now()}`, target));
      const queueId = randomUUID(); const owner = 'qa-post-start';
      const queueBody = { queue_id: queueId, owner, message: 'QA_FAIL_POST_START_SETUP', executor_config: { executor: target.executor } };
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      await terminal(active.id);

      let processId: string | null = null;
      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue/${queueId}/process`)).json() as { data: { lifecycle: string; process: ExecutionProcess | null } | null };
        processId = payload.data?.process?.id ?? null;
        return payload.data && { lifecycle: payload.data.lifecycle, processId };
      }, { timeout: 20_000 }).toEqual({ lifecycle: 'started', processId: expect.any(String) });
      await expect(api(`/api/sessions/${target.id}/queue`).then(response => response.json())).resolves.toMatchObject({ data: { status: 'empty' } });
      await expect(api(`/api/sessions/${target.id}/queue/${queueId}/process`).then(response => response.json())).resolves.toMatchObject({ data: { lifecycle: 'started', process: { id: processId } } });
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('active QA work is visible through the real snapshot stream and suppresses monitor action', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const active = await client.sendMessage(value.teammate.id, body(`auto-nudge active guard ${Date.now()}`, value.teammate));
      expect((await client.getSessionProcesses(value.teammate.id)).some(item => item.id === active.id && item.status === 'running')).toBe(true);
      const result = await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
      expect(result.teammateNudges + result.checkpoints).toBe(0);
      expect(await client.getSessionProcesses(value.overseer.id)).toHaveLength(0);
      await terminal(active.id);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('persisted checkpoint restart reconciles an exact real QA process without resending', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const checkpoint = await client.sendMessage(value.overseer.id, body(`auto-nudge restart reconciliation ${Date.now()}`, value.overseer)); await terminal(checkpoint.id);
      const state = readAutoNudgeState(value.options.statePath); state.triggers[checkpoint.id] = { processId: checkpoint.id, workspaceId: value.workspace.id, sessionId: value.teammate.id, observedAt: checkpoint.created_at, status: 'checkpoint-sent', checkpointProcessId: checkpoint.id, baselineProcessIds: [], updatedAt: checkpoint.updated_at, error: null }; writeAutoNudgeState(value.options.statePath, state);
      const before = (await client.getSessionProcesses(value.overseer.id)).length;
      await expect.poll(async () => {
        await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
        const status = readAutoNudgeState(value.options.statePath).triggers[checkpoint.id]?.status;
        return ['done', 'observed', 'delegated'].includes(status ?? '') ? 'reconciled' : status;
      }, { timeout: 10_000 }).toBe('reconciled');
      expect((await client.getSessionProcesses(value.overseer.id)).length).toBe(before);
      const trigger = readAutoNudgeState(value.options.statePath).triggers[checkpoint.id];
      expect(['done', 'observed', 'delegated']).toContain(trigger?.status);
      if (trigger?.status === 'observed') expect(trigger.checkpointProcessId).toBeNull();
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('a correlated durable callback suppresses checkpointing against real VK session/process contracts', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const source = await client.sendMessage(value.teammate.id, body(`auto-nudge callback source ${Date.now()}`, value.teammate)); await terminal(source.id);
      createCallback(value.options.callbackRegistryPath, { id: 'qa-callback', sessionId: value.teammate.id, command: 'qa', startedAt: new Date().toISOString(), sourceProcessId: source.id, triggerProcessId: source.id });
      const result = await runAutoNudgeCycle(createAutoNudgeClient(client), value.options);
      expect(result.checkpoints).toBe(0); expect(await client.getSessionProcesses(value.overseer.id)).toHaveLength(0);
      expect(readAutoNudgeState(value.options.statePath).triggers[source.id]?.status).toBe('waiting-callback');
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('default vibe-agent send routing requires the scanner, routes when enabled, and honors fire-and-forget', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const reply = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `auto-nudge-reply-${Date.now()}` });
      const routePath = join(value.dir, 'send-response-routes.json');
      const baseEnv = {
        VIBE_API_URL: sandboxUrl,
        VK_WORKSPACE_ID: value.workspace.id,
        VK_SESSION_ID: reply.id,
        VD_RESPONSE_ROUTES_PATH: routePath,
      };

      const disabled = await runVibeAgent(['send', 'reviewer', `disabled scanner ${Date.now()}`, '--json'], { ...baseEnv, VD_AUTO_NUDGE_ENABLED: '' });
      expect(disabled.code).not.toBe(0);
      expect(disabled.stderr).toContain('Default response routing requires the auto-nudge scanner');

      const routed = await runVibeAgent(['send', 'reviewer', `routed response ${Date.now()}`, '--json'], { ...baseEnv, VD_AUTO_NUDGE_ENABLED: 'true' });
      expect(routed.code).toBe(0);
      const routedJson = JSON.parse(routed.stdout) as { process_id: string; response_routing: string };
      expect(routedJson.response_routing).toBe('pending');
      await terminal(routedJson.process_id);
      const result = await runAutoNudgeCycle(createAutoNudgeClient(client), { ...value.options, config: { version: 1, workspaces: [] }, responseRoutesPath: routePath });
      expect(result.responseRoutes).toBe(1);
      const routes = Object.values(readResponseRouteState(routePath).routes);
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ status: 'delivered', processId: routedJson.process_id, replySessionId: reply.id, targetRole: 'reviewer' });
      expect(routes[0]?.deliveredProcessId).toEqual(expect.any(String));
      await terminal(routes[0]!.deliveredProcessId!);

      const fireAndForget = await runVibeAgent(['send', '--fire-and-forget', 'reviewer', `fire and forget ${Date.now()}`, '--json'], { ...baseEnv, VD_AUTO_NUDGE_ENABLED: '' });
      expect(fireAndForget.code).toBe(0);
      const fireAndForgetJson = JSON.parse(fireAndForget.stdout) as { process_id: string; response_routing?: string };
      expect(fireAndForgetJson.response_routing).toBeUndefined();
      await terminal(fireAndForgetJson.process_id);
      expect(Object.values(readResponseRouteState(routePath).routes)).toHaveLength(1);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  // These fault cases deliberately leave admission fail-closed. Keep them last so
  // their indeterminate real processes cannot suppress later workspace scans.
  test('post-spawn stdin failure remains indeterminate and blocks a second child', async () => {
    test.setTimeout(60_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `post-spawn-failure-${Date.now()}` });
      const failed = await api(`/api/sessions/${target.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify(body('QA_FAIL_STDIN_AFTER_SPAWN', target)),
      });
      expect(failed.status).toBe(500);

      const processes = await client.getSessionProcesses(target.id);
      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({ status: 'running' });

      const retry = await api(`/api/sessions/${target.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify(body('must not start a second child', target)),
      });
      expect(retry.status).toBe(409);
      await expect(retry.json()).resolves.toMatchObject({ success: false, message: `Session ${target.id} already has an active coding-agent turn` });
      expect(await client.getSessionProcesses(target.id)).toHaveLength(1);
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('failed durable-start persistence retains the claimed queue slot', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `queue-start-persist-${Date.now()}` });
      const active = await client.sendMessage(target.id, body(`persist predecessor ${Date.now()}`, target));
      const queueId = randomUUID(); const owner = 'qa-start-persist';
      const queueBody = { queue_id: queueId, owner, message: 'QA_FAIL_STARTED_PERSISTENCE', executor_config: { executor: target.executor } };
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      await terminal(active.id);

      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue/${queueId}/process`)).json() as { data: { lifecycle: string; process: ExecutionProcess | null } | null };
        return payload.data && { lifecycle: payload.data.lifecycle, processId: payload.data.process?.id ?? null };
      }, { timeout: 20_000 }).toEqual({ lifecycle: 'indeterminate', processId: expect.any(String) });
      await expect(api(`/api/sessions/${target.id}/queue`).then(response => response.json())).resolves.toMatchObject({ data: { status: 'consuming', message: { id: queueId, owner } } });
      const cancel = await api(`/api/sessions/${target.id}/queue?queue_id=${queueId}&owner=${owner}`, { method: 'DELETE' });
      expect(cancel.status).toBe(409); await expect(cancel.json()).resolves.toMatchObject({ success: false, message: expect.stringContaining('has already been consumed or is no longer queued') });
      const amend = await api(`/api/sessions/${target.id}/queue`, { method: 'PUT', body: JSON.stringify({ ...queueBody, message: 'must stay immutable' }) });
      expect(amend.status).toBe(409); await expect(amend.json()).resolves.toMatchObject({ success: false, message: expect.stringContaining('has already been consumed or is no longer queued') });
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });

  test('reconciliation failure retains consuming state after an uncertain real child start', async () => {
    test.setTimeout(90_000); const value = await context();
    try {
      const target = await client.createSession({ workspace_id: value.workspace.id, executor: 'CODEX', name: `queue-reconcile-failure-${Date.now()}` });
      const active = await client.sendMessage(target.id, body(`reconcile predecessor ${Date.now()}`, target));
      const queueId = randomUUID(); const owner = 'qa-reconcile-failure';
      const queueBody = { queue_id: queueId, owner, message: 'QA_FAIL_STDIN_AFTER_SPAWN\nQA_FAIL_QUEUE_RECONCILIATION', executor_config: { executor: target.executor } };
      expect((await api(`/api/sessions/${target.id}/queue`, { method: 'POST', body: JSON.stringify(queueBody) })).status).toBe(200);
      await terminal(active.id);

      await expect.poll(async () => {
        const payload = await (await api(`/api/sessions/${target.id}/queue`)).json() as { data: { status: string } };
        return payload.data.status;
      }, { timeout: 20_000 }).toBe('consuming');
      await expect(api(`/api/sessions/${target.id}/queue/${queueId}/process`).then(response => response.json())).resolves.toMatchObject({ data: { lifecycle: 'indeterminate', process: { id: expect.any(String) } } });
      const retry = await api(`/api/sessions/${target.id}/follow-up`, { method: 'POST', body: JSON.stringify(body('must remain busy', target)) });
      expect(retry.status).toBe(409); await expect(retry.json()).resolves.toMatchObject({ success: false, message: `Session ${target.id} already has an active coding-agent turn` });
      const cancel = await api(`/api/sessions/${target.id}/queue?queue_id=${queueId}&owner=${owner}`, { method: 'DELETE' });
      expect(cancel.status).toBe(409); await expect(cancel.json()).resolves.toMatchObject({ success: false, message: expect.stringContaining('has already been consumed or is no longer queued') });
    } finally { await rm(value.dir, { recursive: true, force: true }); }
  });
});
