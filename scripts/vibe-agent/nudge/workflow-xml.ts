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
  for (const match of value.matchAll(/([a-zA-Z_:-]+)="([^"]*)"/g)) {
    result[match[1]!] = xmlUnescape(match[2]!);
  }
  return result;
}

function xmlUnescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function childIds(body: string, tag: 'bead' | 'form'): string[] {
  return [...body.matchAll(new RegExp(`<${tag}\\s+id="([^"]+)"\\s*/>`, 'g'))]
    .map(match => xmlUnescape(match[1]!));
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
  if ((attrs(rootMatch[1] ?? '').version ?? '1') !== '1') throw new Error('Unsupported auto-nudge-result version');
  const actionsMatch = (rootMatch[2] ?? '').match(/<actions>([\s\S]*)<\/actions>/);
  if (!actionsMatch) throw new Error('auto-nudge-result requires actions');
  const actionsBody = actionsMatch[1] ?? '';
  const actions: WorkflowAction[] = [];
  const actionPattern = /<action\b([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/g;
  for (const match of actionsBody.matchAll(actionPattern)) {
    const actionAttrs = attrs(match[1] ?? '');
    const type = actionAttrs.type as WorkflowActionType | undefined;
    if (!type || !['send_message', 'wait', 'run_handler'].includes(type)) throw new Error(`Unknown XML action type: ${type ?? '(missing)'}`);
    const body = match[2] ?? '';
    actions.push({
      type,
      role: actionAttrs.role,
      messageType: actionAttrs.message_type,
      handlerId: actionAttrs.handler_id,
      mode: actionAttrs.mode,
      beadIds: childIds(body, 'bead'),
      formIds: childIds(body, 'form'),
    });
  }
  if (!actions.length) throw new Error('auto-nudge-result requires at least one action');
  return { actions };
}

export function validateWorkflowActions(result: WorkflowResult, config: WorkflowConfig, emitterRole: string): void {
  const emitter = config.roles[emitterRole];
  if (!emitter) throw new Error(`Workflow emitter role ${emitterRole} is not configured`);
  for (const item of result.actions) {
    if (!emitter.canEmitActions.includes(item.type)) throw new Error(`Role ${emitterRole} may not emit ${item.type}`);
    if (item.type === 'send_message') {
      if (!item.role) throw new Error('send_message action requires role');
      if (!item.messageType) throw new Error('send_message action requires message_type');
      const message = config.messageTypes[item.messageType];
      if (!message) throw new Error(`Unknown message_type ${item.messageType}`);
      if (message.fromRole !== emitterRole) throw new Error(`message_type ${item.messageType} may only be sent by ${message.fromRole}`);
      if (message.toRole !== item.role) throw new Error(`message_type ${item.messageType} targets ${message.toRole}, not ${item.role}`);
      if (!message.allowedActions.includes('wait') && result.actions.some(action => action.type === 'wait')) {
        throw new Error(`message_type ${item.messageType} does not allow wait`);
      }
    }
    if (item.type === 'run_handler') {
      if (!item.handlerId) throw new Error('run_handler action requires handler_id');
      const handler = config.handlers[item.handlerId];
      if (!handler?.enabled) throw new Error(`Handler ${item.handlerId} is not enabled`);
    }
  }
}
