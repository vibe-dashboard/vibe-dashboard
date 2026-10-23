import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { parseWorkflowConfig, parseWorkflowConfigDocument, type WorkflowConfig } from './workflow-config.js';
import { schemaHash } from './workflow-xml.js';
import { validateSerialTemplate, type OutcomeTransition, type SerialTemplate } from './serial-workflow.js';

export interface SerialWorkflowConfig { version: 3; messaging: WorkflowConfig; templates: Record<string, SerialTemplate> }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error(`${name} has missing or unknown fields`);
}
function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty`);
  return value;
}

// Explicit entry point: the running daemon continues using strict v2 until its
// orchestration adapter is migrated. Reuse the same YAML safety and references.
export function parseSerialWorkflowConfig(
  raw: string,
  source: string,
  readSchema: (file: string) => unknown = file => JSON.parse(fs.readFileSync(file, 'utf8')),
): SerialWorkflowConfig {
  const root = parseWorkflowConfigDocument(raw, source);
  if (root.version !== 3) throw new Error('Serial workflow config version must be 3');
  const { templates: rawTemplates, ...base } = root;
  const messaging = parseWorkflowConfig(stringify({ ...base, version: 2 }), source);
  const templates: Record<string, SerialTemplate> = Object.create(null);
  for (const [id, rawTemplate] of Object.entries(object(rawTemplates, 'templates'))) {
    nonempty(id, 'template id');
    const template = object(rawTemplate, `templates.${id}`);
    exact(template, ['version', 'items'], `templates.${id}`);
    if (!Number.isSafeInteger(template.version) || Number(template.version) < 1) throw new Error('Template version must be a positive integer');
    if (!Array.isArray(template.items)) throw new Error('Template items must be an array');
    const normalized: SerialTemplate = {
      id, version: Number(template.version),
      items: template.items.map(rawItem => {
        const item = object(rawItem, 'item');
        exact(item, ['id', 'label', 'message_type', 'outcomes'], 'item');
        const messageType = nonempty(item.message_type, 'message_type');
        const message = Object.hasOwn(messaging.messageTypes, messageType) ? messaging.messageTypes[messageType] : undefined;
        if (!message?.responseSchemaId) throw new Error(`Workflow item requires a known message type with response schema: ${messageType}`);
        const schema = messaging.responseSchemas[message.responseSchemaId]!;
        const schemaFile = path.resolve(path.dirname(source), schema.schemaFile);
        const resultSchema = object(readSchema(schemaFile), 'result schema');
        const outcomes: Record<string, OutcomeTransition> = Object.create(null);
        for (const [outcome, rawTransition] of Object.entries(object(item.outcomes, 'outcomes'))) {
          const transition = object(rawTransition, 'transition');
          if (transition.action === 'reset') {
            exact(transition, ['action', 'resets_to'], 'reset');
            outcomes[outcome] = { action: 'reset', resetsTo: nonempty(transition.resets_to, 'resets_to') };
          } else {
            exact(transition, ['action'], 'transition');
            if (!['advance', 'wait', 'needs_attention'].includes(String(transition.action))) throw new Error('Unknown transition action');
            outcomes[outcome] = { action: transition.action as 'advance' | 'wait' | 'needs_attention' };
          }
        }
        return {
          id: nonempty(item.id, 'item.id'), label: nonempty(item.label, 'item.label'), role: message.toRole,
          prompt: messaging.prompts[message.promptId]!.text,
          schema: { schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, schemaHash: schemaHash(resultSchema) },
          resultSchema,
          outcomes,
        };
      }),
    };
    validateSerialTemplate(normalized);
    templates[id] = normalized;
  }
  return { version: 3, messaging, templates };
}
