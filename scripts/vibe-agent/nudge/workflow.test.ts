import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_OVERSEER_RESULT_SCHEMA, DEFAULT_WORKFLOW_CONFIG_YAML, ensureWorkflowConfig, loadWorkflowConfig, parseWorkflowConfig } from './workflow-config.js';
import { parseWorkflowResultXml, schemaHash, validateWorkflowActions, validateWorkflowSchema } from './workflow-xml.js';
import { runWorkflowHandler } from './workflow-handlers.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function tempPath(name: string): string { const dir = mkdtempSync(join(tmpdir(), 'workflow-')); dirs.push(dir); return join(dir, name); }
const hash = schemaHash(DEFAULT_OVERSEER_RESULT_SCHEMA);
const envelope = (payload: string, attrs = `schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="${hash}" format="json"`) => `Human summary.\n<auto-nudge-result ${attrs}>${payload}</auto-nudge-result>`;

describe('workflow YAML config', () => {
  it('auto-populates the config and authoritative schema', () => {
    const file = tempPath('workflow.yaml'); ensureWorkflowConfig(file);
    expect(readFileSync(file, 'utf8')).toBe(DEFAULT_WORKFLOW_CONFIG_YAML);
    expect(loadWorkflowConfig(file).messageTypes.overseer_checkpoint.responseSchemaId).toBe('overseer_result');
    expect(JSON.parse(readFileSync(join(dirname(file), 'schemas/overseer-result.schema.json'), 'utf8'))).toEqual(DEFAULT_OVERSEER_RESULT_SCHEMA);
  });
  it.each([
    ['duplicate keys', DEFAULT_WORKFLOW_CONFIG_YAML.replace('version: 2', 'version: 2\nversion: 2'), /Map keys must be unique/],
    ['aliases', 'version: 2\nroles: &roles {}\nprompts: {}\nresponse_schemas: {}\nmessage_types: {}\nhandlers: {}\ncopy: *roles\n', /aliases and anchors/],
    ['unused anchors', 'version: 2\nroles: &unused {}\nprompts: {}\nresponse_schemas: {}\nmessage_types: {}\nhandlers: {}\noutcome_handlers: {}\n', /aliases and anchors/],
    ['custom tags', 'version: !bad 2\nroles: {}\nprompts: {}\nresponse_schemas: {}\nmessage_types: {}\nhandlers: {}\n', /custom tag/],
    ['unknown fields', `${DEFAULT_WORKFLOW_CONFIG_YAML}extra: true\n`, /unknown field extra/],
    ['wrong boolean type', DEFAULT_WORKFLOW_CONFIG_YAML.replace('fresh: false', 'fresh: "false"'), /must be true or false/],
  ])('fails closed on %s', (_name, yaml, error) => expect(() => parseWorkflowConfig(yaml)).toThrow(error));
  it('rejects multiple documents, merge keys, excessive depth, and oversized input', () => {
    expect(() => parseWorkflowConfig(`${DEFAULT_WORKFLOW_CONFIG_YAML}\n---\nversion: 2`)).toThrow();
    expect(() => parseWorkflowConfig(DEFAULT_WORKFLOW_CONFIG_YAML.replace('handlers: {}', 'handlers:\n  <<: {}'))).toThrow(/merge keys|must be an object/);
    expect(() => parseWorkflowConfig(`version: 2\nroles: ${'['.repeat(25)}x${']'.repeat(25)}\nprompts: {}\nresponse_schemas: {}\nmessage_types: {}\nhandlers: {}\noutcome_handlers: {}`)).toThrow(/depth|must be an object/);
    expect(() => parseWorkflowConfig(`#${'x'.repeat(256 * 1024)}\n`)).toThrow(/exceeds/);
  });
});

describe('role-scoped JSON result envelope', () => {
  const result = envelope(JSON.stringify({ outcome: 'waiting', actions: [
    { type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff', beads: ['task-4uf'], forms: ['decision-form'] },
    { type: 'wait', mode: 'callback-wait' },
  ] }));
  it('parses strict JSON and validates schema identity and permissions', () => {
    const parsed = parseWorkflowResultXml(result)!;
    expect(parsed).toMatchObject({ schemaId: 'vd.auto-nudge.overseer-result', schemaVersion: 1, schemaHash: hash, outcome: 'waiting' });
    validateWorkflowSchema(parsed, { schemaId: 'vd.auto-nudge.overseer-result', schemaVersion: 1, schemaHash: hash });
    expect(() => validateWorkflowActions(parsed, parseWorkflowConfig(DEFAULT_WORKFLOW_CONFIG_YAML), 'overseer')).not.toThrow();
  });
  it('rejects duplicate keys, unknown fields, mismatched identity, and legacy XML actions', () => {
    expect(() => parseWorkflowResultXml(envelope('{"outcome":"complete","outcome":"waiting","actions":[]}'))).toThrow(/unique/);
    expect(() => parseWorkflowResultXml(envelope('{"outcome":"complete","actions":[],"extra":true}'))).toThrow(/unknown field/);
    const parsed = parseWorkflowResultXml(result)!;
    expect(() => validateWorkflowSchema(parsed, { schemaId: 'other', schemaVersion: 1, schemaHash: hash })).toThrow(/does not match/);
    expect(() => parseWorkflowResultXml('<auto-nudge-result version="1"><actions /></auto-nudge-result>')).toThrow(/metadata/);
    expect(parseWorkflowResultXml('DONE')).toBeNull();
  });
  it('hashes canonical JSON independent of object key order', () => {
    expect(schemaHash({ b: 2, a: { d: 4, c: 3 } })).toBe(schemaHash({ a: { c: 3, d: 4 }, b: 2 }));
  });
  it('rejects duplicate create_form IDs and parses result references', () => {
    expect(() => parseWorkflowResultXml(envelope(JSON.stringify({ outcome: 'waiting', actions: [
      { type: 'create_form', id: 'decision', bead: 'task-1', form: {} },
      { type: 'create_form', id: 'decision', bead: 'task-2', form: {} },
    ] })))).toThrow(/IDs must be unique/);
    expect(parseWorkflowResultXml(envelope(JSON.stringify({ outcome: 'waiting', actions: [
      { type: 'send_message', role: 'decision_maker', message_type: 'created_form_handoff', form_refs: ['decision'] },
    ] })))?.actions[0]?.formRefs).toEqual(['decision']);
  });
});

describe('workflow handlers', () => {
  it('keeps dry-run read-only and real execution idempotent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-')); dirs.push(root); const logPath = join(root, 'log', 'runs.jsonl');
    const action = { type: 'run_handler' as const, handlerId: 'post', beadIds: [], formIds: [] };
    const payload = { idempotencyKey: 'once', action, workspaceId: 'w1', triggerProcessId: 'p1', dryRun: true };
    expect((await runWorkflowHandler({ enabled: true, command: ['echo', 'ok'], timeoutMs: 1_000 }, payload, { logPath })).status).toBe('dry-run');
    expect(existsSync(dirname(logPath))).toBe(false);
    expect((await runWorkflowHandler({ enabled: true, command: ['echo', 'ok'], timeoutMs: 1_000 }, { ...payload, dryRun: false }, { logPath })).status).toBe('completed');
  });
  it('does not treat failed records as completed idempotency', async () => {
    const logPath = tempPath('runs.jsonl'); const action = { type: 'run_handler' as const, handlerId: 'post', beadIds: [], formIds: [] }; const payload = { idempotencyKey: 'retry', action, workspaceId: 'w1', triggerProcessId: 'p1', dryRun: false };
    expect((await runWorkflowHandler({ enabled: true, command: ['node', '-e', 'process.exit(2)'], timeoutMs: 1_000 }, payload, { logPath })).status).toBe('failed');
    expect((await runWorkflowHandler({ enabled: true, command: ['node', '-e', 'process.exit(0)'], timeoutMs: 1_000 }, payload, { logPath })).status).toBe('completed');
  });
  it('fails an interrupted running handler closed instead of replaying it', async () => {
    const logPath = tempPath('runs.jsonl'); const marker = tempPath('marker');
    writeFileSync(logPath, `${JSON.stringify({ idempotencyKey: 'uncertain', result: { status: 'running' } })}\n`);
    const action = { type: 'run_handler' as const, handlerId: 'post', beadIds: [], formIds: [] };
    const result = await runWorkflowHandler({ enabled: true, command: ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`], timeoutMs: 1_000 }, { idempotencyKey: 'uncertain', action, workspaceId: 'w1', triggerProcessId: 'p1', dryRun: false }, { logPath });
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('indeterminate') });
    expect(existsSync(marker)).toBe(false);
  });
});
