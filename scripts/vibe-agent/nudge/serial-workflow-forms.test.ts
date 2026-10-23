import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSerialRun, mutateSerialRun, readSerialRun, SERIAL_RESULT_SCHEMA, type FormAuthority } from './serial-workflow.js';
import { syncSerialWorkflowForm, type SavedWorkflowForm, type WorkflowFormsStore } from './serial-workflow-forms.js';
import type { SerialWorkflowTransportClient } from './serial-workflow-adapter.js';
import { schemaHash } from './workflow-xml.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup(authority: FormAuthority = { mode: 'human' }) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-forms-')); dirs.push(dir); const file = join(dir, 'run.json');
  const schema = { schemaId: 'role-result', schemaVersion: 1, schemaHash: schemaHash(SERIAL_RESULT_SCHEMA) };
  createSerialRun(file, { id: 'run', workspaceId: 'workspace', beadIds: ['bead'], authority, template: { id: 'template', version: 1, items: [{ id: 'implement', label: 'Implement', role: 'impl', messageType: 'work', prompt: 'Work', fresh: false, schema, resultSchema: SERIAL_RESULT_SCHEMA, outcomes: { complete: { action: 'advance' }, blocked: { action: 'needs_attention' }, waiting: { action: 'wait' } } }] } }, 'create');
  const mutate = (command: Parameters<typeof mutateSerialRun>[3]) => mutateSerialRun(file, readSerialRun(file).version, `command:${readSerialRun(file).version}`, command);
  mutate({ type: 'start', dispatchId: 'dispatch', transport: { owner: 'workflow:run', sessionId: 'impl', messageType: 'work', prompt: 'Work', fresh: false, freshSession: null, executorConfig: { executor: 'CODEX' } } });
  mutate({ type: 'accept', dispatchId: 'dispatch', processId: 'original-process' });
  mutate({ type: 'result', schema, sourceProcessId: 'original-process', result: { run_id: 'run', item_id: 'implement', revision: 1, dispatch_id: 'dispatch', outcome: 'waiting', details: { question: 'Can we proceed?' } } });
  const forms: SavedWorkflowForm[] = [];
  let failAttach = false;
  const store: WorkflowFormsStore = { async attach(_bead, form) { if (failAttach) { failAttach = false; throw new Error('beads offline'); } if (!forms.some(entry => entry.id === form.id)) forms.push(structuredClone(form)); }, async read() { return structuredClone(forms); } };
  const queued: string[] = [];
  let loseStartResponse = false;
  let accepted = false;
  let observed: unknown;
  const client = {
    async getSessions() { return [{ id: 'decider', executor: 'CODEX', name: 'decision_maker' }]; },
    async queueMessage(_session: string, body: { queue_id: string }) { queued.push(body.queue_id); },
    async reconcileQueuedExecution() { return accepted ? { lifecycle: 'started' } : null; },
    async startQueuedExecution() { accepted = true; if (loseStartResponse) { loseStartResponse = false; throw new Error('response lost'); } return { status: 'started', process: { id: 'decision-process' } }; },
    async getExecutionProcessFinalResponseStrict() { return observed; },
  } as unknown as SerialWorkflowTransportClient;
  return { file, mutate, forms, store, queued, client, failAttach() { failAttach = true; }, loseStartResponse() { loseStartResponse = true; }, observed(value: unknown) { observed = value; } };
}

describe('workflow form boundary', () => {
  it('retries attachment after restart without changing the durable wait and consumes only saved human responses', async () => {
    const value = setup(); value.failAttach();
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow('beads offline');
    const wait = readSerialRun(value.file).wait!;
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file).wait!.id).toBe(wait.id);
    value.forms[0]!.responses = [{ submittedBy: 'agent', submittedAt: 'now', values: { outcome: { option_0: true } } }];
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file).status).toBe('waiting');
    value.forms[0]!.responses.push({ submittedBy: 'user', submittedAt: 'later', values: { outcome: { option_0: true }, details: '{}' } });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file).status).toBe('completed');
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.queued).toEqual([]);
  });

  it('reconciles an accepted decision request after lost response under the same queue identity', async () => {
    const value = setup({ mode: 'decision_maker', sessionId: 'decider' }); value.loseStartResponse();
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow('response lost');
    const wait = readSerialRun(value.file).wait!;
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.queued).toEqual([wait.id]);
    expect(readSerialRun(value.file).wait!.decision!.processId).toBe('decision-process');
    value.observed({ process_id: 'decision-process', finished: true, final_response: JSON.stringify({ run_id: 'run', wait_id: wait.id, form_id: value.forms[0]!.id, item_id: wait.itemId, revision: wait.revision, dispatch_id: wait.dispatchId, outcome: 'complete', details: {} }) });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file).status).toBe('completed');
  });

  it('requires an explicit authority update and ignores submissions to the invalidated human form', async () => {
    const value = setup(); await syncSerialWorkflowForm(value.file, value.client, value.store);
    value.mutate({ type: 'update_authority', previousAuthority: { mode: 'human' }, authority: { mode: 'decision_maker', sessionId: 'decider' }, reason: 'Delegate', actor: 'orchestrator' });
    value.forms[0]!.responses = [{ submittedBy: 'user', submittedAt: 'late', values: { outcome: { option_0: true } } }];
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.forms).toHaveLength(2);
    expect(readSerialRun(value.file).status).toBe('waiting');
    expect(readSerialRun(value.file).wait!.decision!.processId).toBe('decision-process');
  });

  it('marks malformed terminal decisions needs-attention without fallback or resending', async () => {
    const value = setup({ mode: 'decision_maker', sessionId: 'decider' });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    value.observed({ process_id: 'decision-process', finished: true, final_response: 'approved' });
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow();
    expect(readSerialRun(value.file)).toMatchObject({ status: 'needs_attention', wait: { error: expect.any(String) } });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.queued).toHaveLength(1);
  });

  it('marks a mismatched decision process needs-attention without consuming its answer', async () => {
    const value = setup({ mode: 'decision_maker', sessionId: 'decider' });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    value.observed({ process_id: 'unrelated-process', finished: true, final_response: '{}' });
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow('Decision process identity mismatch');
    expect(readSerialRun(value.file)).toMatchObject({ status: 'needs_attention', wait: { decision: { processId: 'decision-process' }, error: 'Decision process identity mismatch' } });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.queued).toHaveLength(1);
  });

  it('does not fall back to a saved human answer when the configured decision-maker is unavailable', async () => {
    const value = setup({ mode: 'decision_maker', sessionId: 'missing-decider' });
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow('Configured decision-maker session is unavailable');
    value.forms[0]!.responses = [{ submittedBy: 'user', submittedAt: 'now', values: { outcome: { option_0: true } } }];
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file)).toMatchObject({ status: 'needs_attention', authority: { mode: 'decision_maker', sessionId: 'missing-decider' }, wait: { decision: null } });
    expect(value.queued).toEqual([]);
  });

  it('rejects an invalid saved human answer instead of advancing or dispatching a decision', async () => {
    const value = setup(); await syncSerialWorkflowForm(value.file, value.client, value.store);
    value.forms[0]!.responses = [{ submittedBy: 'user', submittedAt: 'now', values: { outcome: { option_0: true }, details: '[]' } }];
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow();
    expect(readSerialRun(value.file)).toMatchObject({ status: 'needs_attention', currentIndex: 0, wait: { error: expect.stringContaining('Saved human answer rejected') } });
    expect(value.queued).toEqual([]);
  });

  it('cannot apply a late decision observed during an authority update', async () => {
    const value = setup({ mode: 'decision_maker', sessionId: 'decider' });
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    const oldWait = readSerialRun(value.file).wait!;
    vi.spyOn(value.client, 'getExecutionProcessFinalResponseStrict').mockImplementation(async () => {
      value.mutate({ type: 'update_authority', previousAuthority: { mode: 'decision_maker', sessionId: 'decider' }, authority: { mode: 'human' }, reason: 'Human must decide', actor: 'orchestrator' });
      return { process_id: 'decision-process', finished: true, final_response: JSON.stringify({ run_id: 'run', wait_id: oldWait.id, form_id: value.forms[0]!.id, item_id: oldWait.itemId, revision: oldWait.revision, dispatch_id: oldWait.dispatchId, outcome: 'complete', details: {} }) } as Awaited<ReturnType<SerialWorkflowTransportClient['getExecutionProcessFinalResponseStrict']>>;
    });
    await expect(syncSerialWorkflowForm(value.file, value.client, value.store)).rejects.toThrow('Workflow version conflict');
    const updated = readSerialRun(value.file);
    expect(updated).toMatchObject({ status: 'waiting', authority: { mode: 'human' }, wait: { authority: { mode: 'human' }, decision: null, error: null } });
    expect(updated.wait!.id).not.toBe(oldWait.id);
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(value.forms).toHaveLength(2);
    value.forms[1]!.responses = [{ submittedBy: 'user', submittedAt: 'now', values: { outcome: { option_0: true } } }];
    await syncSerialWorkflowForm(value.file, value.client, value.store);
    expect(readSerialRun(value.file).status).toBe('completed');
    expect(value.queued).toHaveLength(1);
  });
});
