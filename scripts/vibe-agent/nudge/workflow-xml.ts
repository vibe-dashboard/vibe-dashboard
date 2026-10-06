import type { WorkflowActionType, WorkflowConfig } from './workflow-config.js';

export interface WorkflowAction {
  type: WorkflowActionType;
  role?: string;
  messageType?: string;
  handlerId?: string;
  mode?: string;
  beadIds: string[];
  formIds: string[];
}

export interface WorkflowResult {
  actions: WorkflowAction[];
}

function attrs(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  let consumed = value;
  for (const match of value.matchAll(/\s+([a-zA-Z_:-]+)="([^"]*)"/g)) {
    if (result[match[1]!]) throw new Error(`Duplicate XML attribute ${match[1]}`);
    result[match[1]!] = xmlUnescape(match[2]!);
    consumed = consumed.replace(match[0], '');
  }
  if (consumed.trim()) throw new Error(`Malformed XML attributes: ${consumed.trim()}`);
  return result;
}

function rejectUnknownAttrs(actual: Record<string, string>, allowed: string[], tag: string): void {
  for (const key of Object.keys(actual)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${tag} attribute ${key}`);
  }
}

function xmlUnescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function parseActionChildren(body: string): { beadIds: string[]; formIds: string[] } {
  const beadIds: string[] = [];
  const formIds: string[] = [];
  const childPattern = /<(bead|form)\s+id="([^"]+)"\s*\/>/g;
  let cursor = 0;
  for (const match of body.matchAll(childPattern)) {
    const prefix = body.slice(cursor, match.index);
    if (prefix.trim()) throw new Error('XML action contains unsupported content');
    const id = xmlUnescape(match[2]!);
    if (match[1] === 'bead') beadIds.push(id);
    else formIds.push(id);
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (body.slice(cursor).trim()) throw new Error('XML action contains unsupported content');
  return { beadIds, formIds };
}

export function parseWorkflowResultXml(response: string): WorkflowResult | null {
  const trimmed = response.trim();
  const roots = [...trimmed.matchAll(/<auto-nudge-result\b[\s\S]*?<\/auto-nudge-result>/g)];
  if (roots.length === 0) return null;
  if (roots.length > 1) throw new Error('Expected one auto-nudge-result block');
  const root = roots[0]![0];
  if (!trimmed.endsWith(root)) throw new Error('auto-nudge-result must be the final response block');
  const rootMatch = root.match(/^<auto-nudge-result\b([^>]*)>([\s\S]*)<\/auto-nudge-result>$/);
  if (!rootMatch) throw new Error('Malformed auto-nudge-result block');
  const rootAttrs = attrs(rootMatch[1] ?? '');
  rejectUnknownAttrs(rootAttrs, ['version'], 'auto-nudge-result');
  if ((rootAttrs.version ?? '1') !== '1') throw new Error('Unsupported auto-nudge-result version');
  const rootBody = rootMatch[2] ?? '';
  const actionsMatches = [...rootBody.matchAll(/<actions>([\s\S]*?)<\/actions>/g)];
  if (actionsMatches.length > 1) throw new Error('auto-nudge-result requires exactly one actions block');
  const actionsMatch = actionsMatches[0];
  if (!actionsMatch) throw new Error('auto-nudge-result requires actions');
  if (`${rootBody.slice(0, actionsMatch.index)}${rootBody.slice((actionsMatch.index ?? 0) + actionsMatch[0].length)}`.trim()) {
    throw new Error('auto-nudge-result contains unsupported content');
  }
  const actionsBody = actionsMatch[1] ?? '';
  const actions: WorkflowAction[] = [];
  const actionPattern = /<action\b([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/g;
  let cursor = 0;
  for (const match of actionsBody.matchAll(actionPattern)) {
    const prefix = actionsBody.slice(cursor, match.index);
    if (prefix.trim()) throw new Error('actions contains unsupported content');
    const actionAttrs = attrs(match[1] ?? '');
    rejectUnknownAttrs(actionAttrs, ['type', 'role', 'message_type', 'handler_id', 'mode'], 'action');
    const type = actionAttrs.type as WorkflowActionType | undefined;
    if (!type || !['send_message', 'wait', 'run_handler'].includes(type)) throw new Error(`Unknown XML action type: ${type ?? '(missing)'}`);
    const body = match[2] ?? '';
    const children = parseActionChildren(body);
    actions.push({
      type,
      role: actionAttrs.role,
      messageType: actionAttrs.message_type,
      handlerId: actionAttrs.handler_id,
      mode: actionAttrs.mode,
      beadIds: children.beadIds,
      formIds: children.formIds,
    });
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (actionsBody.slice(cursor).trim()) throw new Error('actions contains unsupported content');
  if (!actions.length) throw new Error('auto-nudge-result requires at least one action');
  return { actions };
}

export function validateWorkflowActions(result: WorkflowResult, config: WorkflowConfig, emitterRole: string): void {
  const emitter = config.roles[emitterRole];
  if (!emitter) throw new Error(`Workflow emitter role ${emitterRole} is not configured`);
  const sendActions = result.actions.filter(item => item.type === 'send_message');
  if (result.actions.some(item => item.type === 'run_handler') && sendActions.length === 0) {
    throw new Error('run_handler requires a send_message message_type context');
  }
  for (const item of result.actions) {
    if (!emitter.canEmitActions.includes(item.type)) throw new Error(`Role ${emitterRole} may not emit ${item.type}`);
    if (item.type === 'send_message') {
      if (!item.role) throw new Error('send_message action requires role');
      if (!item.messageType) throw new Error('send_message action requires message_type');
      const message = config.messageTypes[item.messageType];
      if (!message) throw new Error(`Unknown message_type ${item.messageType}`);
      if (message.fromRole !== emitterRole) throw new Error(`message_type ${item.messageType} may only be sent by ${message.fromRole}`);
      if (message.toRole !== item.role) throw new Error(`message_type ${item.messageType} targets ${message.toRole}, not ${item.role}`);
      for (const sibling of result.actions) {
        if (sibling.type === 'send_message') continue;
        if (!message.allowedActions.includes(sibling.type)) {
          throw new Error(`message_type ${item.messageType} does not allow ${sibling.type}`);
        }
      }
    }
    if (item.type === 'run_handler') {
      if (!item.handlerId) throw new Error('run_handler action requires handler_id');
      const handler = config.handlers[item.handlerId];
      if (!handler?.enabled) throw new Error(`Handler ${item.handlerId} is not enabled`);
    }
  }
}
