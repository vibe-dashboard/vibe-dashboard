import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_WORKFLOW_CONFIG_PATH = '/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/auto_nudge_workflow.yaml';

export type WorkflowActionType = 'send_message' | 'wait' | 'run_handler';

export interface WorkflowRoleConfig {
  canEmitActions: WorkflowActionType[];
}

export interface WorkflowPromptConfig {
  text: string;
}

export interface WorkflowMessageTypeConfig {
  fromRole: string;
  toRole: string;
  promptId: string;
  fresh: boolean;
  allowedActions: WorkflowActionType[];
}

export interface WorkflowHandlerConfig {
  enabled: boolean;
  command: string[];
  timeoutMs: number;
}

export interface WorkflowConfig {
  version: 1;
  roles: Record<string, WorkflowRoleConfig>;
  prompts: Record<string, WorkflowPromptConfig>;
  messageTypes: Record<string, WorkflowMessageTypeConfig>;
  handlers: Record<string, WorkflowHandlerConfig>;
}

type WorkflowConfigSection = 'roles' | 'prompts' | 'message_types' | 'handlers';

export const DEFAULT_WORKFLOW_CONFIG_YAML = `version: 1
roles:
  overseer:
    can_emit_actions:
      - send_message
      - wait
      - run_handler
  decision_maker:
    can_emit_actions: []
prompts:
  created_form_handoff:
    text: |
      The overseer created a decision form for the next milestone.
      Please review the form and respond with the decision needed to continue.
message_types:
  created_form_handoff:
    from_role: overseer
    to_role: decision_maker
    prompt_id: created_form_handoff
    fresh: false
    allowed_actions:
      - wait
      - run_handler
handlers: {}
`;

const ACTIONS = new Set<WorkflowActionType>(['send_message', 'wait', 'run_handler']);

function action(value: string): WorkflowActionType {
  if (!ACTIONS.has(value as WorkflowActionType)) throw new Error(`Unknown workflow action: ${value}`);
  return value as WorkflowActionType;
}

function parseList(value: string): string[] | null {
  const trimmed = value.trim();
  if (trimmed === '[]') return [];
  return null;
}

function requireString(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function ensureWorkflowConfig(filePath = DEFAULT_WORKFLOW_CONFIG_PATH): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, DEFAULT_WORKFLOW_CONFIG_YAML, { mode: 0o600 });
}

export function loadWorkflowConfig(filePath = DEFAULT_WORKFLOW_CONFIG_PATH): WorkflowConfig {
  ensureWorkflowConfig(filePath);
  return parseWorkflowConfig(fs.readFileSync(filePath, 'utf8'), filePath);
}

export function parseWorkflowConfig(raw: string, source = '<memory>'): WorkflowConfig {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const config: WorkflowConfig = { version: 1, roles: {}, prompts: {}, messageTypes: {}, handlers: {} };
  let section: WorkflowConfigSection | null = null;
  let currentId: string | null = null;
  let currentList: { kind: 'role-actions' | 'message-actions' | 'handler-command'; id: string } | null = null;
  let blockText: { id: string; lines: string[] } | null = null;

  const finishBlock = () => {
    if (!blockText) return;
    config.prompts[blockText.id] = { text: blockText.lines.join('\n').replace(/\n$/, '') };
    blockText = null;
  };

  for (const line of lines) {
    if (blockText) {
      if (line.startsWith('      ')) {
        blockText.lines.push(line.slice(6));
        continue;
      }
      finishBlock();
    }
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (indent === 0) {
      currentId = null;
      currentList = null;
      const topLevelSection = parseTopLevelSection(trimmed);
      if (trimmed === 'version: 1') continue;
      if (topLevelSection) {
        section = topLevelSection;
        continue;
      }
      if (trimmed === 'handlers: {}') {
        section = 'handlers';
        config.handlers = {};
        continue;
      }
      throw new Error(`Invalid workflow config at ${source}: unsupported top-level line "${trimmed}"`);
    }

    if (!section) throw new Error(`Invalid workflow config at ${source}: nested line before section`);
    if (indent === 2 && trimmed.endsWith(':')) {
      currentId = trimmed.slice(0, -1);
      currentList = null;
      switch (section) {
        case 'roles': config.roles[currentId] = { canEmitActions: [] }; break;
        case 'prompts': config.prompts[currentId] = { text: '' }; break;
        case 'message_types': config.messageTypes[currentId] = { fromRole: '', toRole: '', promptId: '', fresh: false, allowedActions: [] }; break;
        case 'handlers': config.handlers[currentId] = { enabled: false, command: [], timeoutMs: 30_000 }; break;
      }
      continue;
    }
    if (!currentId) throw new Error(`Invalid workflow config at ${source}: key without item`);

    if (indent === 4) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      currentList = null;
      if (section === 'roles' && key === 'can_emit_actions') {
        const parsed = parseList(value);
        if (parsed) config.roles[currentId] = { canEmitActions: parsed.map(action) };
        else currentList = { kind: 'role-actions', id: currentId };
        continue;
      }
      if (section === 'prompts' && key === 'text' && value === '|') {
        blockText = { id: currentId, lines: [] };
        continue;
      }
      if (section === 'message_types') {
        const item = config.messageTypes[currentId]!;
        if (key === 'from_role') { item.fromRole = value; continue; }
        if (key === 'to_role') { item.toRole = value; continue; }
        if (key === 'prompt_id') { item.promptId = value; continue; }
        if (key === 'fresh') { item.fresh = value === 'true'; continue; }
        if (key === 'allowed_actions') {
          const parsed = parseList(value);
          if (parsed) item.allowedActions = parsed.map(action);
          else currentList = { kind: 'message-actions', id: currentId };
          continue;
        }
      }
      if (section === 'handlers') {
        const item = config.handlers[currentId]!;
        if (key === 'enabled') { item.enabled = value === 'true'; continue; }
        if (key === 'timeout_ms') { item.timeoutMs = Number.parseInt(value, 10); continue; }
        if (key === 'command') {
          const parsed = parseList(value);
          if (parsed) item.command = parsed;
          else currentList = { kind: 'handler-command', id: currentId };
          continue;
        }
      }
    }

    if (indent === 6 && currentList && trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (currentList.kind === 'role-actions') config.roles[currentList.id]!.canEmitActions.push(action(value));
      if (currentList.kind === 'message-actions') config.messageTypes[currentList.id]!.allowedActions.push(action(value));
      if (currentList.kind === 'handler-command') config.handlers[currentList.id]!.command.push(value);
      continue;
    }

    throw new Error(`Invalid workflow config at ${source}: unsupported line "${trimmed}"`);
  }
  finishBlock();

  for (const [id, message] of Object.entries(config.messageTypes)) {
    requireString(message.fromRole, `message_types.${id}.from_role`);
    requireString(message.toRole, `message_types.${id}.to_role`);
    requireString(message.promptId, `message_types.${id}.prompt_id`);
    if (!config.prompts[message.promptId]) throw new Error(`message_types.${id}.prompt_id references missing prompt ${message.promptId}`);
  }
  for (const [id, handler] of Object.entries(config.handlers)) {
    if (handler.enabled && handler.command.length === 0) throw new Error(`handlers.${id}.command is required when enabled`);
    if (!Number.isSafeInteger(handler.timeoutMs) || handler.timeoutMs <= 0) throw new Error(`handlers.${id}.timeout_ms must be positive`);
  }
  return config;
}

function parseTopLevelSection(line: string): WorkflowConfigSection | null {
  if (line === 'roles:') return 'roles';
  if (line === 'prompts:') return 'prompts';
  if (line === 'message_types:') return 'message_types';
  if (line === 'handlers:') return 'handlers';
  return null;
}
