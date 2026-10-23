import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildBeadsFormsSummary, compileBeadsForm, type CompiledBeadsForm } from '../../../packages/beads-form/src/index.js';
import { mutateSerialRun, readSerialRun, workflowFormId, type SerialRun } from './serial-workflow.js';
import type { SerialWorkflowTransportClient } from './serial-workflow-adapter.js';
import { schemaHash } from './workflow-xml.js';

const execute = promisify(execFile);
export interface SavedWorkflowForm extends CompiledBeadsForm {
  responses?: Array<{ submittedBy: string; submittedAt: string; values: Record<string, unknown> }>;
}
export interface WorkflowFormsStore {
  read(beadId: string): Promise<SavedWorkflowForm[]>;
  attach(beadId: string, form: CompiledBeadsForm): Promise<void>;
}

export function beadsWorkflowFormsStore(cwd = process.env.VD_BEADS_DIR ?? process.cwd()): WorkflowFormsStore {
  const metadata = async (beadId: string): Promise<Record<string, unknown>> => {
    const { stdout } = await execute('bd', ['show', beadId, '--json', '--long'], { cwd, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
    const beads = JSON.parse(stdout) as Array<{ id: string; metadata?: Record<string, unknown> }>;
    const bead = beads.find(bead => bead.id === beadId);
    if (!bead) throw new Error(`Workflow bead not found: ${beadId}`);
    return bead.metadata ?? {};
  };
  const forms = (metadata: Record<string, unknown>): SavedWorkflowForm[] => {
    const namespace = metadata.beadForms as { forms?: SavedWorkflowForm[] } | undefined;
    return namespace?.forms ?? [];
  };
  return {
    async read(beadId) { return forms(await metadata(beadId)); },
    async attach(beadId, form) {
      const current = await metadata(beadId);
      const existing = forms(current);
      const found = existing.find(entry => entry.id === form.id);
      if (found) {
        const { responses: _responses, ...definition } = found;
        if (schemaHash(definition) !== schemaHash(form)) throw new Error('Workflow form identity conflicts with persisted definition');
        return;
      }
      const next: SavedWorkflowForm[] = [...existing, form];
      const pending = next.filter(entry => !entry.responses?.length).map(entry => entry.id);
      await execute('bd', ['update', beadId,
        '--set-metadata', `beadForms=${JSON.stringify({ ...(current.beadForms as object ?? {}), forms: next })}`,
        '--set-metadata', `beadFormsSummary=${JSON.stringify({ ...buildBeadsFormsSummary(next), hasPendingAnswer: pending.length > 0, pendingResponseCount: pending.length, pendingFormIds: pending })}`,
      ], { cwd, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
    },
  };
}

export function serialDecisionForm(run: SerialRun): CompiledBeadsForm {
  const wait = run.wait;
  if (!wait) throw new Error('No workflow form wait');
  const item = run.template.items[run.currentIndex]!;
  const outcomes = Object.entries(item.outcomes).filter(([, transition]) => transition.action !== 'wait');
  if (!outcomes.length) throw new Error('Waiting item has no decision outcome');
  return compileBeadsForm({
    format: 'standard', id: workflowFormId(wait), title: `${item.label}: decision`, allowCodeFileChanges: false,
    description: `Run ${run.id}; item ${wait.itemId}; revision ${wait.revision}; dispatch ${wait.dispatchId}; wait ${wait.id}.\n\n${JSON.stringify(run.items[run.currentIndex]!.result?.details ?? {})}`,
    questions: [
      { id: 'outcome', type: 'choices', title: 'Workflow outcome', description: 'Choose exactly one outcome for this item.', required: true, choices: outcomes.map(([outcome], index) => ({ id: `option_${index}`, label: outcome })) },
      { id: 'details', type: 'textarea', title: 'Result details (JSON object)', description: 'Optional structured result details matching the item contract. Leave empty for {}.' },
    ],
  });
}

/** Only persisted human submissions or the exact accepted decision process enter
 * the reducer. No CLI --actor or caller-supplied result JSON is accepted here. */
export async function syncSerialWorkflowForm(
  file: string,
  client: SerialWorkflowTransportClient,
  store: WorkflowFormsStore = beadsWorkflowFormsStore(),
): Promise<void> {
  let run = readSerialRun(file);
  if (run.status !== 'waiting' || run.cancelRequested) return;
  if (!run.wait) {
    mutateSerialRun(file, run.version, `form:open:${run.revision}:${run.items[run.currentIndex]!.dispatchId}`, { type: 'open_form' });
    run = readSerialRun(file);
  }
  const wait = run.wait!;
  const form = serialDecisionForm(run);
  await store.attach(wait.beadId, form);
  if (wait.authority.mode === 'human') {
    const saved = (await store.read(wait.beadId)).find(entry => entry.id === form.id);
    const response = saved?.responses?.filter(entry => entry.submittedBy === 'user').at(-1);
    if (!response) return;
    try {
    const chosen = response.values.outcome;
    const selected = chosen && typeof chosen === 'object' && !Array.isArray(chosen)
      ? Object.entries(chosen).filter(([, value]) => value === true).map(([key]) => key) : [];
    const options = Object.entries(run.template.items[run.currentIndex]!.outcomes).filter(([, transition]) => transition.action !== 'wait');
    if (selected.length !== 1 || !/^option_\d+$/.test(selected[0]!) || !options[Number(selected[0]!.slice(7))]) throw new Error('Form response requires exactly one known outcome');
    const raw = response.values.details;
    const details = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
    const submissionId = schemaHash(response);
    mutateSerialRun(file, run.version, `form:answer:${wait.id}:${submissionId}`, {
      type: 'form_answer', waitId: wait.id, formId: form.id, revision: wait.revision, dispatchId: wait.dispatchId,
      submissionId, actor: { mode: 'human' }, sourceProcessId: null, outcome: options[Number(selected[0]!.slice(7))]![0], details,
    });
    } catch (error) {
      mutateSerialRun(file, run.version, `form:error:${wait.id}:${schemaHash(response)}`, { type: 'form_error', waitId: wait.id, reason: `Saved human answer rejected: ${(error as Error).message}` });
      throw error;
    }
    return;
  }
  let needsAttention = false;
  try {
    if (!wait.decision) {
      const authoritySession = wait.authority.sessionId;
      const session = (await client.getSessions(run.workspaceId)).find(entry => entry.id === authoritySession);
      if (!session?.executor) { needsAttention = true; throw new Error('Configured decision-maker session is unavailable'); }
      const item = run.template.items[run.currentIndex]!;
      const outcomes = Object.entries(item.outcomes).filter(([, value]) => value.action !== 'wait').map(([key]) => key);
      const prompt = [
        'Decide this workflow form. Return exactly one JSON object with the eight fields shown below; no prose, XML, or markdown fences.',
        'Keep all eight fields in your response. Copy correlation values exactly; choose an allowed outcome and populate details according to the item result schema. The example outcome and details are illustrative.',
        `Decision response example: ${JSON.stringify({ run_id: run.id, wait_id: wait.id, form_id: form.id, item_id: wait.itemId, revision: wait.revision, dispatch_id: wait.dispatchId, outcome: outcomes[0], details: {} })}`,
        'The orchestrator validates your decision by projecting it into the ordinary role result. Remove only wait_id and form_id to obtain the six-field projection validated by the item result schema below; do not remove them from your response. Authority and source process are verified separately by the orchestrator, not declared in your JSON.',
        `Item result schema identity: ${JSON.stringify(item.schema)}`,
        `Item result schema (six-field projection): ${JSON.stringify(item.resultSchema)}`,
        `Allowed outcomes and effects: ${JSON.stringify(Object.fromEntries(Object.entries(item.outcomes).filter(([, value]) => value.action !== 'wait')))}`,
        `Form: ${JSON.stringify(form)}`,
      ].join('\n');
      mutateSerialRun(file, run.version, `form:intent:${wait.id}`, { type: 'decision_intent', waitId: wait.id, transport: { owner: `workflow:${run.id}:form`, sessionId: session.id, messageType: 'workflow_form_decision', fresh: false, freshSession: null, executorConfig: { executor: session.executor }, prompt } });
      run = readSerialRun(file);
    }
    const decision = run.wait!.decision!;
    if (!decision.processId) {
      const transport = decision.transport;
      const body = { owner: transport.owner, message: transport.prompt, executor_config: transport.executorConfig as Parameters<SerialWorkflowTransportClient['queueMessage']>[1]['executor_config'] };
      const effect = await client.reconcileQueuedExecution(transport.sessionId, wait.id);
      if (!effect) await client.queueMessage(transport.sessionId, { ...body, queue_id: wait.id });
      const result = await client.startQueuedExecution(transport.sessionId, wait.id, body);
      if (result.status === 'failed_before_start' || result.status === 'indeterminate') { needsAttention = true; throw new Error(result.message ?? `Decision start is ${result.status}`); }
      if (result.status !== 'started' || !result.process) return;
      mutateSerialRun(file, run.version, `form:accepted:${wait.id}`, { type: 'decision_accept', waitId: wait.id, processId: result.process.id });
      return;
    }
    const observed = await client.getExecutionProcessFinalResponseStrict(decision.processId);
    if (observed.process_id !== decision.processId) { needsAttention = true; throw new Error('Decision process identity mismatch'); }
    if (!observed.finished) return;
    needsAttention = true;
    if (!observed.final_response) throw new Error('Decision-maker returned no final result');
    const result = JSON.parse(observed.final_response) as Record<string, unknown>;
    const keys = ['run_id', 'wait_id', 'form_id', 'item_id', 'revision', 'dispatch_id', 'outcome', 'details'];
    if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)) || result.run_id !== run.id || result.wait_id !== wait.id || result.form_id !== form.id || result.item_id !== wait.itemId || result.revision !== wait.revision || result.dispatch_id !== wait.dispatchId) throw new Error('Stale or malformed decision result');
    mutateSerialRun(file, run.version, `form:answer:${wait.id}:${decision.processId}`, { type: 'form_answer', waitId: wait.id, formId: form.id, revision: wait.revision, dispatchId: wait.dispatchId, submissionId: decision.processId, actor: wait.authority, sourceProcessId: decision.processId, outcome: result.outcome as string, details: result.details as Record<string, unknown> });
  } catch (error) {
    // Network/queue errors keep the durable intent for same-ID reconciliation.
    // Only an observed terminal result or unavailable authority needs attention.
    if (needsAttention) {
      mutateSerialRun(file, run.version, `form:error:${wait.id}:${schemaHash(String(error))}`, { type: 'form_error', waitId: wait.id, reason: (error as Error).message });
    }
    throw error;
  }
}
