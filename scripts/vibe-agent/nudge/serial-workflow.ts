import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import Ajv2020Module from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { schemaHash, type WorkflowSchemaIdentity } from './workflow-xml.js';

export type OutcomeTransition = { action: 'advance' | 'wait' | 'needs_attention' } | { action: 'reset'; resetsTo: string };
export interface SerialItem {
  id: string;
  label: string;
  role: string;
  prompt: string;
  schema: WorkflowSchemaIdentity;
  resultSchema: Record<string, unknown>;
  outcomes: Record<string, OutcomeTransition>;
}
export interface SerialTemplate { id: string; version: number; items: SerialItem[] }
export type RunStatus = 'queued' | 'active' | 'waiting' | 'needs_attention' | 'cancelled' | 'completed';
export type DeliveryStatus = 'intent' | 'submitting' | 'accepted' | 'proven_unaccepted' | 'uncertain';
export interface WorkflowDispatch {
  id: string;
  itemId: string;
  revision: number;
  attempt: number;
  sessionId: string;
  status: DeliveryStatus;
  processId: string | null;
}
export interface SerialResult {
  run_id: string;
  item_id: string;
  revision: number;
  dispatch_id: string;
  outcome: string;
  details: Record<string, unknown>;
}
export interface WorkflowEvent { sequence: number; type: string; itemId: string | null; revision: number; at: string; details: Record<string, unknown> }
export interface MutationReceipt { runId: string; version: number; status: RunStatus; revision: number; currentItemId: string | null; dispatchId: string | null }
export type FormAuthority = { mode: 'human' } | { mode: 'decision_maker'; sessionId: string };
const Ajv2020 = (Ajv2020Module.default ?? Ajv2020Module) as unknown as new () => { compile(schema: object): ValidateFunction };
export const SERIAL_RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['run_id', 'item_id', 'revision', 'dispatch_id', 'outcome', 'details'],
  properties: {
    run_id: { type: 'string', minLength: 1 }, item_id: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 }, dispatch_id: { type: 'string', minLength: 1 },
    outcome: { type: 'string', minLength: 1 }, details: { type: 'object' },
  },
};
export interface SerialRun {
  formatVersion: 1;
  id: string;
  workspaceId: string;
  beadIds: string[];
  template: SerialTemplate;
  templateHash: string;
  authority: FormAuthority;
  version: number;
  revision: number;
  currentIndex: number;
  status: RunStatus;
  cancelRequested: boolean;
  items: Array<{ id: string; status: 'pending' | 'active' | 'waiting' | 'needs_attention' | 'completed'; revision: number; dispatchId: string | null; result: SerialResult | null }>;
  dispatches: WorkflowDispatch[];
  history: WorkflowEvent[];
  receipts: Record<string, { commandHash: string; result: MutationReceipt }>;
}
export type WorkflowCommand =
  | { type: 'start'; sessionId: string }
  | { type: 'submitting'; dispatchId: string }
  | { type: 'accept'; dispatchId: string; processId: string }
  | { type: 'delivery_failed'; dispatchId: string; disposition: 'proven_unaccepted' | 'uncertain'; reason: string }
  | { type: 'result'; schema: WorkflowSchemaIdentity; sourceProcessId: string; result: SerialResult }
  | { type: 'missing_result'; dispatchId: string; sourceProcessId: string }
  | { type: 'retry' }
  | { type: 'cancel'; reason: string };

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error(`${name} has missing or unknown fields`);
}
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty`);
}
function withWorkflowLock<T>(file: string, operation: () => T): T {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 5_000;
  while (true) {
    try { fs.mkdirSync(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Serialize stale-owner reaping. A missing PID may be a live owner still
      // initializing; never delete that lock or guess from its age.
      const reaper = `${lock}.reaping`;
      let claimed = false;
      try {
        fs.mkdirSync(reaper); claimed = true;
        const owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        if (Number.isSafeInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (ownerError) { if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH') fs.rmSync(lock, { recursive: true, force: true }); }
        }
      } catch (reapError) {
        if (!['EEXIST', 'ENOENT'].includes((reapError as NodeJS.ErrnoException).code ?? '')) throw reapError;
      } finally { if (claimed) fs.rmSync(reaper, { recursive: true, force: true }); }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for workflow mutation lock; unresolved owner needs attention');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      continue;
    }
    try { fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { flag: 'wx' }); }
    catch (error) { fs.rmSync(lock, { recursive: true, force: true }); throw error; }
    try { return operation(); }
    finally { fs.rmSync(lock, { recursive: true, force: true }); }
  }
}
function positive(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
}
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('Workflow value exceeds JSON depth limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  if (typeof value === 'object' && value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const item of Object.values(value)) jsonValue(item, depth + 1);
    return;
  }
  throw new Error('Workflow values must be plain JSON');
}
export function validateSchemaIdentity(value: unknown): asserts value is WorkflowSchemaIdentity {
  const schema = record(value, 'schema');
  exact(schema, ['schemaId', 'schemaVersion', 'schemaHash'], 'schema');
  text(schema.schemaId, 'schemaId'); positive(schema.schemaVersion, 'schemaVersion');
  if (typeof schema.schemaHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(schema.schemaHash)) throw new Error('Invalid schemaHash');
}
export function validateSerialTemplate(value: unknown): asserts value is SerialTemplate {
  const template = record(value, 'template');
  exact(template, ['id', 'version', 'items'], 'template');
  text(template.id, 'template.id'); positive(template.version, 'template.version');
  if (!Array.isArray(template.items) || !template.items.length) throw new Error('Template requires items');
  const seen = new Set<string>();
  for (const raw of template.items) {
    const item = record(raw, 'item');
    exact(item, ['id', 'label', 'role', 'prompt', 'schema', 'resultSchema', 'outcomes'], 'item');
    for (const key of ['id', 'label', 'role', 'prompt']) text(item[key], `item.${key}`);
    const id = item.id as string;
    if (seen.has(id)) throw new Error(`Duplicate item ${id}`);
    validateSchemaIdentity(item.schema);
    record(item.resultSchema, 'result schema');
    if (item.schema.schemaHash !== schemaHash(item.resultSchema)) throw new Error('Result schema snapshot hash mismatch');
    new Ajv2020().compile(item.resultSchema as object);
    const outcomes = record(item.outcomes, 'outcomes');
    if (!Object.keys(outcomes).length) throw new Error('Item requires outcomes');
    for (const [outcome, rawTransition] of Object.entries(outcomes)) {
      text(outcome, 'outcome');
      const transition = record(rawTransition, 'transition');
      if (transition.action === 'reset') {
        exact(transition, ['action', 'resetsTo'], 'reset');
        if (typeof transition.resetsTo !== 'string' || !seen.has(transition.resetsTo)) throw new Error('Reset target must be an earlier item');
      } else {
        exact(transition, ['action'], 'transition');
        if (!['advance', 'wait', 'needs_attention'].includes(String(transition.action))) throw new Error('Unknown transition action');
      }
    }
    seen.add(id);
  }
}
function validateAuthority(value: unknown): asserts value is FormAuthority {
  const authority = record(value, 'authority');
  if (authority.mode === 'human') exact(authority, ['mode'], 'authority');
  else if (authority.mode === 'decision_maker') { exact(authority, ['mode', 'sessionId'], 'authority'); text(authority.sessionId, 'authority.sessionId'); }
  else throw new Error('Unknown form authority');
}
function receipt(run: SerialRun): MutationReceipt {
  const item = run.items[run.currentIndex];
  return { runId: run.id, version: run.version, status: run.status, revision: run.revision, currentItemId: item?.id ?? null, dispatchId: item?.dispatchId ?? null };
}
function appendEvent(run: SerialRun, type: string, details: Record<string, unknown>, now: Date): void {
  run.version++;
  run.history.push({ sequence: run.version, type, itemId: run.items[run.currentIndex]?.id ?? null, revision: run.revision, at: now.toISOString(), details: structuredClone(details) });
}
function dispatchFor(run: SerialRun, id: string): WorkflowDispatch {
  const item = run.items[run.currentIndex];
  const dispatch = run.dispatches.find(entry => entry.id === id);
  if (!dispatch || item?.dispatchId !== id || dispatch.itemId !== item.id || dispatch.revision !== run.revision) throw new Error('Stale dispatch');
  return dispatch;
}
function apply(run: SerialRun, command: WorkflowCommand): void {
  const fields: Record<WorkflowCommand['type'], string[]> = {
    start: ['type', 'sessionId'], submitting: ['type', 'dispatchId'], accept: ['type', 'dispatchId', 'processId'],
    delivery_failed: ['type', 'dispatchId', 'disposition', 'reason'], result: ['type', 'schema', 'sourceProcessId', 'result'],
    missing_result: ['type', 'dispatchId', 'sourceProcessId'], retry: ['type'], cancel: ['type', 'reason'],
  };
  if (!Object.hasOwn(fields, command.type)) throw new Error('Unknown workflow command');
  exact(record(command, 'command'), fields[command.type], 'command');
  if (run.status === 'completed' || run.status === 'cancelled' || run.cancelRequested) throw new Error('Run is terminal or cancellation is pending');
  const item = run.items[run.currentIndex]!;
  if (command.type === 'start') {
    text(command.sessionId, 'sessionId');
    if (run.status !== 'queued' || item.status !== 'pending' || item.dispatchId !== null) throw new Error('Current item cannot start');
    const dispatch: WorkflowDispatch = { id: randomUUID(), itemId: item.id, revision: run.revision, attempt: run.dispatches.filter(entry => entry.itemId === item.id && entry.revision === run.revision).length + 1, sessionId: command.sessionId, status: 'intent', processId: null };
    run.dispatches.push(dispatch); item.dispatchId = dispatch.id; item.status = 'active'; run.status = 'active';
  } else if (command.type === 'submitting') {
    const dispatch = dispatchFor(run, command.dispatchId);
    if (dispatch.status !== 'intent') throw new Error('Dispatch is not an unsubmitted intent');
    dispatch.status = 'submitting';
  } else if (command.type === 'accept') {
    text(command.processId, 'processId');
    const dispatch = dispatchFor(run, command.dispatchId);
    if (!['submitting', 'uncertain'].includes(dispatch.status)) throw new Error('Dispatch cannot be accepted');
    if (run.dispatches.some(entry => entry.processId === command.processId)) throw new Error('Process already bound to a dispatch');
    dispatch.status = 'accepted'; dispatch.processId = command.processId; item.status = 'active'; run.status = 'active';
  } else if (command.type === 'delivery_failed') {
    text(command.reason, 'reason');
    if (!['proven_unaccepted', 'uncertain'].includes(command.disposition)) throw new Error('Unknown delivery disposition');
    const dispatch = dispatchFor(run, command.dispatchId);
    if (!['intent', 'submitting'].includes(dispatch.status)) throw new Error('Cannot reclassify an accepted or uncertain dispatch');
    dispatch.status = command.disposition; item.status = 'needs_attention'; run.status = 'needs_attention';
  } else if (command.type === 'retry') {
    const dispatch = item.dispatchId && dispatchFor(run, item.dispatchId);
    if (run.status !== 'needs_attention' || !dispatch || dispatch.status !== 'proven_unaccepted') throw new Error('Retry requires proven pre-admission failure');
    item.dispatchId = null; item.result = null; item.status = 'pending'; run.status = 'queued';
  } else if (command.type === 'result') {
    const payload = record(command.result, 'result');
    exact(payload, ['run_id', 'item_id', 'revision', 'dispatch_id', 'outcome', 'details'], 'result');
    validateSchemaIdentity(command.schema);
    const expected = run.template.items[run.currentIndex]!.schema;
    if (schemaHash(command.schema) !== schemaHash(expected)) throw new Error('Result schema identity mismatch');
    if (!new Ajv2020().compile(run.template.items[run.currentIndex]!.resultSchema)(payload)) throw new Error('Result violates authoritative schema');
    text(command.sourceProcessId, 'sourceProcessId');
    const dispatch = dispatchFor(run, command.result.dispatch_id);
    if (run.status !== 'active' || dispatch.status !== 'accepted' || dispatch.processId !== command.sourceProcessId) throw new Error('Result must come from current accepted process');
    if (payload.run_id !== run.id || payload.item_id !== item.id || payload.revision !== run.revision) throw new Error('Stale result correlation');
    record(payload.details, 'details'); text(payload.outcome, 'outcome');
    const transition = Object.hasOwn(run.template.items[run.currentIndex]!.outcomes, payload.outcome)
      ? run.template.items[run.currentIndex]!.outcomes[payload.outcome] : undefined;
    if (!transition) throw new Error('Outcome is not allowed for this item');
    item.result = structuredClone(command.result);
    if (transition.action === 'advance') {
      item.status = 'completed'; run.currentIndex++;
      run.status = run.currentIndex === run.items.length ? 'completed' : 'queued';
    } else if (transition.action === 'reset') {
      run.revision++;
      run.currentIndex = run.items.findIndex(entry => entry.id === transition.resetsTo);
      for (const reset of run.items.slice(run.currentIndex)) { reset.status = 'pending'; reset.revision = run.revision; reset.dispatchId = null; reset.result = null; }
      run.status = 'queued';
    } else { item.status = transition.action === 'wait' ? 'waiting' : 'needs_attention'; run.status = item.status; }
  } else if (command.type === 'missing_result') {
    const dispatch = dispatchFor(run, command.dispatchId);
    if (dispatch.status !== 'accepted' || dispatch.processId !== command.sourceProcessId || run.status !== 'active') throw new Error('Missing-result signal must identify current accepted process');
    item.status = 'needs_attention'; run.status = 'needs_attention';
  } else if (command.type === 'cancel') {
    text(command.reason, 'reason');
    const dispatch = item.dispatchId && dispatchFor(run, item.dispatchId);
    run.cancelRequested = true;
    run.status = dispatch && !['intent', 'proven_unaccepted'].includes(dispatch.status) ? 'needs_attention' : 'cancelled';
  } else throw new Error('Unknown workflow command');
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp.${randomUUID()}`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, data); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  try { fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function save(file: string, run: SerialRun): void {
  atomicWrite(file, `${JSON.stringify({ hash: schemaHash(run), run })}\n`);
}
export function readSerialRun(file: string): SerialRun {
  const envelope = record(JSON.parse(fs.readFileSync(file, 'utf8')), 'snapshot');
  exact(envelope, ['hash', 'run'], 'snapshot');
  const run = record(envelope.run, 'run') as unknown as SerialRun;
  exact(run as unknown as Record<string, unknown>, ['formatVersion', 'id', 'workspaceId', 'beadIds', 'template', 'templateHash', 'authority', 'version', 'revision', 'currentIndex', 'status', 'cancelRequested', 'items', 'dispatches', 'history', 'receipts'], 'run');
  if (envelope.hash !== schemaHash(run)) throw new Error('Workflow snapshot integrity mismatch');
  if (run.formatVersion !== 1) throw new Error('Unsupported workflow snapshot version');
  validateSerialTemplate(run.template); validateAuthority(run.authority);
  text(run.id, 'run.id'); text(run.workspaceId, 'workspaceId');
  positive(run.version, 'version'); positive(run.revision, 'revision');
  if (run.templateHash !== schemaHash(run.template) || !Array.isArray(run.beadIds) || run.beadIds.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid template snapshot or bead grouping');
  if (!Array.isArray(run.items) || run.items.length !== run.template.items.length || !Number.isInteger(run.currentIndex) || run.currentIndex < 0 || run.currentIndex > run.items.length) throw new Error('Invalid workflow current item');
  if (!['queued', 'active', 'waiting', 'needs_attention', 'completed', 'cancelled'].includes(run.status) || typeof run.cancelRequested !== 'boolean') throw new Error('Invalid workflow state');
  if ((run.currentIndex === run.items.length) !== (run.status === 'completed')) throw new Error('Invalid completion state');
  if (!Array.isArray(run.history) || run.history.length !== run.version || run.history.some((event, index) => !event || event.sequence !== index + 1 || typeof event.type !== 'string' || !Number.isFinite(Date.parse(event.at)))) throw new Error('Invalid workflow history');
  if (!Array.isArray(run.dispatches) || new Set(run.dispatches.map(dispatch => dispatch.id)).size !== run.dispatches.length) throw new Error('Invalid workflow dispatches');
  for (const dispatch of run.dispatches) {
    text(dispatch.id, 'dispatch.id'); text(dispatch.sessionId, 'dispatch.sessionId'); positive(dispatch.attempt, 'attempt'); positive(dispatch.revision, 'dispatch.revision');
    if (!run.items.some(item => item.id === dispatch.itemId) || !['intent', 'submitting', 'accepted', 'proven_unaccepted', 'uncertain'].includes(dispatch.status) || (dispatch.status === 'accepted' ? typeof dispatch.processId !== 'string' || !dispatch.processId : dispatch.processId !== null)) throw new Error('Invalid dispatch state');
  }
  for (const [index, item] of run.items.entries()) {
    if (item.id !== run.template.items[index]!.id || !['pending', 'active', 'waiting', 'needs_attention', 'completed'].includes(item.status) || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > run.revision) throw new Error('Invalid workflow item');
    if (index < run.currentIndex && item.status !== 'completed') throw new Error('Invalid completed prefix');
    if (index > run.currentIndex && (item.status !== 'pending' || item.dispatchId !== null || item.result !== null)) throw new Error('Invalid pending suffix');
    if (item.dispatchId !== null && !run.dispatches.some(dispatch => dispatch.id === item.dispatchId && dispatch.itemId === item.id && dispatch.revision === item.revision)) throw new Error('Invalid item dispatch binding');
  }
  const current = run.items[run.currentIndex];
  if (current && !run.cancelRequested && current.status !== ({ queued: 'pending', active: 'active', waiting: 'waiting', needs_attention: 'needs_attention' } as Record<string, string>)[run.status]) throw new Error('Run and current item state disagree');
  if (current?.status === 'pending' && (current.dispatchId !== null || current.result !== null)) throw new Error('Pending item has prior effects');
  if (new Set(run.dispatches.filter(dispatch => dispatch.processId !== null).map(dispatch => dispatch.processId)).size !== run.dispatches.filter(dispatch => dispatch.processId !== null).length) throw new Error('Process bound to multiple dispatches');
  for (const entry of Object.values(record(run.receipts, 'receipts'))) {
    const stored = record(entry, 'receipt'); exact(stored, ['commandHash', 'result'], 'receipt');
    if (typeof stored.commandHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(stored.commandHash)) throw new Error('Invalid receipt hash');
    const result = record(stored.result, 'receipt result');
    exact(result, ['runId', 'version', 'status', 'revision', 'currentItemId', 'dispatchId'], 'receipt result');
    if (result.runId !== run.id || !Number.isSafeInteger(result.version) || Number(result.version) < 1 || Number(result.version) > run.version || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1 || Number(result.revision) > run.revision) throw new Error('Invalid receipt result');
  }
  return run;
}
function reconcileJournal(file: string, run: SerialRun): void {
  const journal = `${file}.events.jsonl`;
  let raw = '';
  try { raw = fs.readFileSync(journal, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const expected = run.history.map(event => `${JSON.stringify(event)}\n`);
  const lines = raw.split('\n');
  const partial = lines.pop()!;
  if (lines.length > expected.length || lines.some((line, index) => `${line}\n` !== expected[index])) throw new Error('Conflicting workflow journal');
  if (partial && (!expected[lines.length] || !expected[lines.length]!.startsWith(partial))) throw new Error('Conflicting workflow journal suffix');
  // Preserve the existing complete prefix and replace only its missing/torn suffix.
  if (raw !== expected.join('')) atomicWrite(journal, expected.join(''));
}
export function recoverSerialRun(file: string): SerialRun {
  return withWorkflowLock(file, () => { const run = readSerialRun(file); reconcileJournal(file, run); return run; });
}
export interface CreateSerialRunInput { id: string; workspaceId: string; beadIds: string[]; template: SerialTemplate; authority: FormAuthority }
export function createSerialRun(file: string, input: CreateSerialRunInput, key: string, now = new Date()): MutationReceipt {
  jsonValue(input); exact(record(input, 'create input'), ['id', 'workspaceId', 'beadIds', 'template', 'authority'], 'create input');
  text(key, 'idempotency key'); text(input.id, 'run.id'); text(input.workspaceId, 'workspaceId');
  validateSerialTemplate(input.template); validateAuthority(input.authority);
  if (!Array.isArray(input.beadIds) || input.beadIds.some(id => typeof id !== 'string' || !id) || new Set(input.beadIds).size !== input.beadIds.length) throw new Error('Invalid bead grouping');
  const commandHash = schemaHash({ type: 'create', input });
  return withWorkflowLock(file, () => {
    if (fs.existsSync(file)) {
      const existing = readSerialRun(file); reconcileJournal(file, existing);
      const previous = Object.hasOwn(existing.receipts, key) ? existing.receipts[key] : undefined;
      if (previous?.commandHash !== commandHash) throw new Error('Run exists or idempotency key conflicts');
      return structuredClone(previous.result);
    }
    const run: SerialRun = { formatVersion: 1, ...structuredClone(input), templateHash: schemaHash(input.template), version: 0, revision: 1, currentIndex: 0, status: 'queued', cancelRequested: false, items: input.template.items.map(item => ({ id: item.id, status: 'pending', revision: 1, dispatchId: null, result: null })), dispatches: [], history: [], receipts: {} };
    appendEvent(run, 'created', { templateHash: run.templateHash, beadIds: run.beadIds }, now);
    const result = receipt(run);
    Object.defineProperty(run.receipts, key, { value: { commandHash, result }, enumerable: true, configurable: true, writable: true });
    save(file, run); reconcileJournal(file, run);
    return structuredClone(result);
  });
}
export function mutateSerialRun(file: string, expectedVersion: number, key: string, command: WorkflowCommand, now = new Date()): MutationReceipt {
  jsonValue(command);
  text(key, 'idempotency key'); positive(expectedVersion, 'expectedVersion');
  const commandHash = schemaHash(command);
  return withWorkflowLock(file, () => {
    const run = readSerialRun(file); reconcileJournal(file, run);
    const previous = Object.hasOwn(run.receipts, key) ? run.receipts[key] : undefined;
    if (previous) {
      if (previous.commandHash !== commandHash) throw new Error('Idempotency key conflicts with original command');
      return structuredClone(previous.result);
    }
    if (run.version !== expectedVersion) throw new Error(`Workflow version conflict: expected ${expectedVersion}, actual ${run.version}`);
    apply(run, command);
    appendEvent(run, command.type, command as unknown as Record<string, unknown>, now);
    const result = receipt(run);
    Object.defineProperty(run.receipts, key, { value: { commandHash, result }, enumerable: true, configurable: true, writable: true });
    save(file, run); reconcileJournal(file, run);
    return structuredClone(result);
  });
}
