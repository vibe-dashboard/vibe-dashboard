import * as fs from 'node:fs';
import * as path from 'node:path';
import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, type Node } from 'yaml';

export const DEFAULT_WORKFLOW_CONFIG_PATH = '/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/auto_nudge_workflow.yaml';
export const DEFAULT_RESPONSE_SCHEMA_FILE = 'schemas/overseer-result.schema.json';
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CONFIG_DEPTH = 20;

export type WorkflowActionType = 'send_message' | 'wait' | 'run_handler' | 'create_form';
export interface WorkflowRoleConfig { canEmitActions: WorkflowActionType[] }
export interface WorkflowPromptConfig { text: string }
export interface WorkflowMessageTypeConfig { fromRole: string; toRole: string; promptId: string; responseSchemaId?: string; fresh: boolean; allowedActions: WorkflowActionType[] }
export interface WorkflowHandlerConfig { enabled: boolean; command: string[]; timeoutMs: number }
export interface WorkflowResponseSchemaConfig { schemaId: string; schemaVersion: number; schemaFile: string }
export interface WorkflowConfig { version: 2; roles: Record<string, WorkflowRoleConfig>; prompts: Record<string, WorkflowPromptConfig>; messageTypes: Record<string, WorkflowMessageTypeConfig>; handlers: Record<string, WorkflowHandlerConfig>; responseSchemas: Record<string, WorkflowResponseSchemaConfig>; outcomeHandlers: Record<string, string[]> }

export const DEFAULT_OVERSEER_RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['outcome', 'actions'],
  properties: {
    outcome: { enum: ['complete', 'delegated', 'waiting', 'blocked'] },
    actions: { type: 'array', items: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'role', 'message_type'], properties: { type: { const: 'send_message' }, role: { type: 'string', minLength: 1 }, message_type: { type: 'string', minLength: 1 }, beads: { type: 'array', items: { type: 'string' } }, forms: { type: 'array', items: { type: 'string' } }, form_refs: { type: 'array', items: { type: 'string', minLength: 1 } } } },
      { type: 'object', additionalProperties: false, required: ['type', 'mode'], properties: { type: { const: 'wait' }, mode: { const: 'callback-wait' }, form_refs: { type: 'array', items: { type: 'string', minLength: 1 } } } },
      { type: 'object', additionalProperties: false, required: ['type', 'handler_id'], properties: { type: { const: 'run_handler' }, handler_id: { type: 'string', minLength: 1 } } },
      { type: 'object', additionalProperties: false, required: ['type', 'id', 'bead'], oneOf: [{ required: ['form'] }, { required: ['artifact'] }], properties: { type: { const: 'create_form' }, id: { type: 'string', minLength: 1 }, bead: { type: 'string', minLength: 1 }, form: { type: 'object' }, artifact: { type: 'string', minLength: 1 } } },
    ] } },
  },
} as const;

export const DEFAULT_WORKFLOW_CONFIG_YAML = `version: 2
roles:
  auto_nudge:
    can_emit_actions: [send_message]
  overseer:
    can_emit_actions: [send_message, wait, run_handler, create_form]
  decision_maker:
    can_emit_actions: []
prompts:
  overseer_checkpoint:
    text: |
      Review the completed teammate work. Continue to the next milestone, delegate review, or create a beads-form when human input is required.
      End with the required structured result envelope.
  created_form_handoff:
    text: |
      The overseer created a decision form for the next milestone.
      Please review the form and respond with the decision needed to continue.
response_schemas:
  overseer_result:
    schema_id: vd.auto-nudge.overseer-result
    schema_version: 1
    schema_file: ${DEFAULT_RESPONSE_SCHEMA_FILE}
message_types:
  overseer_checkpoint:
    from_role: auto_nudge
    to_role: overseer
    prompt_id: overseer_checkpoint
    response_schema_id: overseer_result
    fresh: false
    allowed_actions: [send_message, wait, run_handler, create_form]
  created_form_handoff:
    from_role: overseer
    to_role: decision_maker
    prompt_id: created_form_handoff
    fresh: false
    allowed_actions: [wait, run_handler, create_form]
handlers: {}
outcome_handlers: {}
`;

const ACTIONS = new Set<WorkflowActionType>(['send_message', 'wait', 'run_handler', 'create_form']);
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, allowed: string[], name: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${name} has unknown field ${key}`); }
function string(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`); return value; }
function boolean(value: unknown, name: string): boolean { if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`); return value; }
function integer(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${name} must be a positive integer`); return Number(value); }
function strings(value: unknown, name: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be a string array`); return value; }
function actions(value: unknown, name: string): WorkflowActionType[] { return strings(value, name).map(item => { if (!ACTIONS.has(item as WorkflowActionType)) throw new Error(`Unknown workflow action: ${item}`); return item as WorkflowActionType; }); }

function inspectYaml(node: Node | null, depth = 0): void {
  if (!node) return;
  if (depth > MAX_CONFIG_DEPTH) throw new Error(`workflow config exceeds maximum depth ${MAX_CONFIG_DEPTH}`);
  if ('anchor' in node && typeof node.anchor === 'string' && node.anchor) throw new Error('workflow config aliases and anchors are not allowed');
  if (isAlias(node)) throw new Error('workflow config aliases and anchors are not allowed');
  if (node.tag && !['tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq', 'tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null'].includes(node.tag)) throw new Error(`workflow config custom tag ${node.tag} is not allowed`);
  if (isMap(node) || isSeq(node)) for (const item of node.items) inspectYaml(item as Node, depth + 1);
  if (isPair(node)) { if (isScalar(node.key) && node.key.value === '<<') throw new Error('workflow config merge keys are not allowed'); inspectYaml(node.key as Node, depth + 1); inspectYaml(node.value as Node, depth + 1); }
}

export function ensureWorkflowConfig(filePath = DEFAULT_WORKFLOW_CONFIG_PATH): void {
  if (!fs.existsSync(filePath)) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, DEFAULT_WORKFLOW_CONFIG_YAML, { mode: 0o600 }); }
  const schemaPath = path.resolve(path.dirname(filePath), DEFAULT_RESPONSE_SCHEMA_FILE);
  if (!fs.existsSync(schemaPath)) { fs.mkdirSync(path.dirname(schemaPath), { recursive: true }); fs.writeFileSync(schemaPath, `${JSON.stringify(DEFAULT_OVERSEER_RESULT_SCHEMA, null, 2)}\n`, { mode: 0o600 }); }
}
export function loadWorkflowConfig(filePath = DEFAULT_WORKFLOW_CONFIG_PATH): WorkflowConfig { ensureWorkflowConfig(filePath); return parseWorkflowConfig(fs.readFileSync(filePath, 'utf8'), filePath); }

export function parseWorkflowConfigDocument(raw: string, source = '<memory>'): Record<string, unknown> {
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) throw new Error(`Invalid workflow config at ${source}: exceeds ${MAX_CONFIG_BYTES} bytes`);
  const document = parseDocument(raw, { schema: 'core', uniqueKeys: true, prettyErrors: false, strict: true });
  if (document.errors.length) throw new Error(`Invalid workflow config at ${source}: ${document.errors[0]!.message}`);
  if (!document.contents) throw new Error(`Invalid workflow config at ${source}: one non-empty document is required`);
  inspectYaml(document.contents);
  return object(document.toJS({ maxAliasCount: 0 }), 'workflow config');
}

export function parseWorkflowConfig(raw: string, source = '<memory>'): WorkflowConfig {
  const root = parseWorkflowConfigDocument(raw, source);
  exact(root, ['version', 'roles', 'prompts', 'message_types', 'handlers', 'response_schemas', 'outcome_handlers'], 'workflow config');
  if (root.version !== 2) throw new Error('workflow config version must be 2');
  const config: WorkflowConfig = { version: 2, roles: {}, prompts: {}, messageTypes: {}, handlers: {}, responseSchemas: {}, outcomeHandlers: {} };
  for (const [id, rawRole] of Object.entries(object(root.roles, 'roles'))) { const role = object(rawRole, `roles.${id}`); exact(role, ['can_emit_actions'], `roles.${id}`); config.roles[id] = { canEmitActions: actions(role.can_emit_actions, `roles.${id}.can_emit_actions`) }; }
  for (const [id, rawPrompt] of Object.entries(object(root.prompts, 'prompts'))) { const prompt = object(rawPrompt, `prompts.${id}`); exact(prompt, ['text'], `prompts.${id}`); config.prompts[id] = { text: string(prompt.text, `prompts.${id}.text`) }; }
  for (const [id, rawSchema] of Object.entries(object(root.response_schemas, 'response_schemas'))) { const schema = object(rawSchema, `response_schemas.${id}`); exact(schema, ['schema_id', 'schema_version', 'schema_file'], `response_schemas.${id}`); config.responseSchemas[id] = { schemaId: string(schema.schema_id, `response_schemas.${id}.schema_id`), schemaVersion: integer(schema.schema_version, `response_schemas.${id}.schema_version`), schemaFile: string(schema.schema_file, `response_schemas.${id}.schema_file`) }; }
  for (const [id, rawMessage] of Object.entries(object(root.message_types, 'message_types'))) { const message = object(rawMessage, `message_types.${id}`); exact(message, ['from_role', 'to_role', 'prompt_id', 'response_schema_id', 'fresh', 'allowed_actions'], `message_types.${id}`); const responseSchemaId = message.response_schema_id == null ? undefined : string(message.response_schema_id, `message_types.${id}.response_schema_id`); config.messageTypes[id] = { fromRole: string(message.from_role, `message_types.${id}.from_role`), toRole: string(message.to_role, `message_types.${id}.to_role`), promptId: string(message.prompt_id, `message_types.${id}.prompt_id`), ...(responseSchemaId ? { responseSchemaId } : {}), fresh: boolean(message.fresh, `message_types.${id}.fresh`), allowedActions: actions(message.allowed_actions, `message_types.${id}.allowed_actions`) }; }
  for (const [id, rawHandler] of Object.entries(object(root.handlers, 'handlers'))) { const handler = object(rawHandler, `handlers.${id}`); exact(handler, ['enabled', 'command', 'timeout_ms'], `handlers.${id}`); config.handlers[id] = { enabled: boolean(handler.enabled, `handlers.${id}.enabled`), command: strings(handler.command, `handlers.${id}.command`), timeoutMs: integer(handler.timeout_ms, `handlers.${id}.timeout_ms`) }; if (config.handlers[id]!.enabled && !config.handlers[id]!.command.length) throw new Error(`handlers.${id}.command is required when enabled`); }
  for (const [outcome, handlerIds] of Object.entries(object(root.outcome_handlers, 'outcome_handlers'))) { if (!['complete', 'delegated', 'waiting', 'blocked'].includes(outcome)) throw new Error(`outcome_handlers has unknown outcome ${outcome}`); config.outcomeHandlers[outcome] = strings(handlerIds, `outcome_handlers.${outcome}`); for (const id of config.outcomeHandlers[outcome]) if (!config.handlers[id]?.enabled) throw new Error(`outcome_handlers.${outcome} references disabled or missing handler ${id}`); }
  for (const [id, message] of Object.entries(config.messageTypes)) { if (!config.roles[message.fromRole] || !config.roles[message.toRole]) throw new Error(`message_types.${id} references an unknown role`); if (!config.prompts[message.promptId]) throw new Error(`message_types.${id}.prompt_id references missing prompt ${message.promptId}`); if (message.responseSchemaId && !config.responseSchemas[message.responseSchemaId]) throw new Error(`message_types.${id}.response_schema_id references missing schema ${message.responseSchemaId}`); }
  return config;
}
