import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import type { WorkflowActionType, WorkflowConfig } from './workflow-config.js';

export interface WorkflowAction { type: WorkflowActionType; id?: string; role?: string; messageType?: string; handlerId?: string; mode?: string; beadId?: string; form?: unknown; artifact?: string; beadIds: string[]; formIds: string[]; formRefs?: string[] }
export type WorkflowOutcome = 'complete' | 'delegated' | 'waiting' | 'blocked';
export interface WorkflowResult { schemaId: string; schemaVersion: number; schemaHash: string; outcome: WorkflowOutcome; actions: WorkflowAction[]; payload: unknown }
export interface WorkflowSchemaIdentity { schemaId: string; schemaVersion: number; schemaHash: string }

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function schemaHash(schema: unknown): string { return `sha256:${createHash('sha256').update(canonical(schema)).digest('hex')}`; }
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, fields: string[], name: string): void { for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`${name} has unknown field ${key}`); }
function nonempty(value: unknown, name: string): string { if (typeof value !== 'string' || !value) throw new Error(`${name} must be a non-empty string`); return value; }
function ids(value: unknown, name: string): string[] { if (value === undefined) return []; if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) throw new Error(`${name} must be a string array`); return value; }

function parseStrictJson(raw: string): unknown {
  const value = JSON.parse(raw) as unknown;
  const duplicateCheck = parseDocument(raw, { schema: 'json', uniqueKeys: true, prettyErrors: false, strict: true });
  if (duplicateCheck.errors.length) throw new Error(`Invalid result JSON: ${duplicateCheck.errors[0]!.message}`);
  return value;
}
function parseAction(value: unknown, index: number): WorkflowAction {
  const item = object(value, `actions[${index}]`);
  const type = nonempty(item.type, `actions[${index}].type`) as WorkflowActionType;
  if (type === 'send_message') { exact(item, ['type', 'role', 'message_type', 'beads', 'forms', 'form_refs'], `actions[${index}]`); return { type, role: nonempty(item.role, `actions[${index}].role`), messageType: nonempty(item.message_type, `actions[${index}].message_type`), beadIds: ids(item.beads, `actions[${index}].beads`), formIds: ids(item.forms, `actions[${index}].forms`), formRefs: ids(item.form_refs, `actions[${index}].form_refs`) }; }
  if (type === 'wait') { exact(item, ['type', 'mode', 'form_refs'], `actions[${index}]`); if (item.mode !== 'callback-wait') throw new Error(`actions[${index}].mode must be callback-wait`); return { type, mode: 'callback-wait', beadIds: [], formIds: [], formRefs: ids(item.form_refs, `actions[${index}].form_refs`) }; }
  if (type === 'run_handler') { exact(item, ['type', 'handler_id'], `actions[${index}]`); return { type, handlerId: nonempty(item.handler_id, `actions[${index}].handler_id`), beadIds: [], formIds: [], formRefs: [] }; }
  if (type === 'create_form') {
    exact(item, ['type', 'id', 'bead', 'form', 'artifact'], `actions[${index}]`);
    if ((item.form === undefined) === (item.artifact === undefined)) throw new Error(`actions[${index}] requires exactly one of form or artifact`);
    return { type, id: nonempty(item.id, `actions[${index}].id`), beadId: nonempty(item.bead, `actions[${index}].bead`), ...(item.form !== undefined ? { form: item.form } : { artifact: nonempty(item.artifact, `actions[${index}].artifact`) }), beadIds: [], formIds: [], formRefs: [] };
  }
  throw new Error(`Unknown workflow action type: ${type}`);
}

export function parseWorkflowResultXml(response: string, validatePayload?: (payload: unknown) => void): WorkflowResult | null {
  const trimmed = response.trim();
  const roots = [...trimmed.matchAll(/<auto-nudge-result\b[\s\S]*?<\/auto-nudge-result>/g)];
  if (!roots.length) return null;
  if (roots.length !== 1) throw new Error('Expected one auto-nudge-result block');
  const root = roots[0]![0];
  if (!trimmed.endsWith(root)) throw new Error('auto-nudge-result must be the final response block');
  const match = root.match(/^<auto-nudge-result\s+schema_id="([^"]+)"\s+schema_version="([1-9]\d*)"\s+schema_hash="(sha256:[a-f0-9]{64})"\s+format="json">([\s\S]*)<\/auto-nudge-result>$/);
  if (!match) throw new Error('Malformed auto-nudge-result envelope or metadata');
  const payload = object(parseStrictJson(match[4]!.trim()), 'result');
  validatePayload?.(payload);
  exact(payload, ['outcome', 'actions'], 'result');
  if (!['complete', 'delegated', 'waiting', 'blocked'].includes(String(payload.outcome))) throw new Error('result.outcome is invalid');
  if (!Array.isArray(payload.actions)) throw new Error('result.actions must be an array');
  const actions = payload.actions.map(parseAction);
  const actionIds = actions.flatMap(action => action.id ? [action.id] : []);
  if (new Set(actionIds).size !== actionIds.length) throw new Error('create_form action IDs must be unique');
  return { schemaId: match[1]!, schemaVersion: Number(match[2]), schemaHash: match[3]!, outcome: payload.outcome as WorkflowOutcome, actions, payload };
}

export function validateWorkflowSchema(result: WorkflowResult, expected: WorkflowSchemaIdentity): void {
  if (result.schemaId !== expected.schemaId || result.schemaVersion !== expected.schemaVersion || result.schemaHash !== expected.schemaHash) throw new Error('auto-nudge-result schema identity does not match the initiating turn');
}
export function validateWorkflowActions(result: WorkflowResult, config: WorkflowConfig, emitterRole: string): void {
  const emitter = config.roles[emitterRole]; if (!emitter) throw new Error(`Workflow emitter role ${emitterRole} is not configured`);
  const sends = result.actions.filter(item => item.type === 'send_message');
  if (result.actions.some(item => item.type === 'run_handler') && !sends.length) throw new Error('run_handler requires a send_message message_type context');
  for (const item of result.actions) {
    if (!emitter.canEmitActions.includes(item.type)) throw new Error(`Role ${emitterRole} may not emit ${item.type}`);
    if (item.type === 'send_message') {
      const message = item.messageType ? config.messageTypes[item.messageType] : null; if (!message) throw new Error(`Unknown message_type ${item.messageType ?? '(missing)'}`);
      if (message.fromRole !== emitterRole) throw new Error(`message_type ${item.messageType} may only be sent by ${message.fromRole}`);
      if (message.toRole !== item.role) throw new Error(`message_type ${item.messageType} targets ${message.toRole}, not ${item.role}`);
      for (const sibling of result.actions) if (sibling.type !== 'send_message' && !message.allowedActions.includes(sibling.type)) throw new Error(`message_type ${item.messageType} does not allow ${sibling.type}`);
    }
    if (item.type === 'run_handler' && (!item.handlerId || !config.handlers[item.handlerId]?.enabled)) throw new Error(`Handler ${item.handlerId ?? '(missing)'} is not enabled`);
  }
}
