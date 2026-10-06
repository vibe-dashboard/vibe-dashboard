import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_WORKFLOW_CONFIG_YAML,
  ensureWorkflowConfig,
  loadWorkflowConfig,
  parseWorkflowConfig,
} from './workflow-config.js';
import { parseWorkflowResultXml, validateWorkflowActions } from './workflow-xml.js';
import { runWorkflowHandler } from './workflow-handlers.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-'));
  dirs.push(dir);
  return join(dir, name);
}

describe('workflow YAML config', () => {
  it('auto-populates and loads the built-in YAML config', () => {
    const file = tempPath('workflow.yaml');
    ensureWorkflowConfig(file);
    expect(readFileSync(file, 'utf8')).toBe(DEFAULT_WORKFLOW_CONFIG_YAML);
    expect(loadWorkflowConfig(file).messageTypes.created_form_handoff).toMatchObject({
      fromRole: 'overseer',
      toRole: 'decision_maker',
      promptId: 'created_form_handoff',
      fresh: false,
    });
  });

  it('fails closed on malformed or unsafe handler config', () => {
    expect(() => parseWorkflowConfig('version: 2\n')).toThrow(/unsupported top-level/);
    expect(() => parseWorkflowConfig(`version: 1
roles:
  overseer:
    can_emit_actions:
      - nope
prompts: {}
message_types: {}
handlers: {}
`)).toThrow(/Unknown workflow action/);
    expect(() => parseWorkflowConfig(`version: 1
roles:
  overseer:
    can_emit_actions:
      - run_handler
prompts:
  created_form_handoff:
    text: |
      text
message_types:
  created_form_handoff:
    from_role: overseer
    to_role: decision_maker
    prompt_id: created_form_handoff
    fresh: false
    allowed_actions: []
handlers:
  post:
    enabled: true
    command: []
`)).toThrow(/command is required/);
    expect(() => parseWorkflowConfig(`version: 1
roles:
  overseer:
    can_emit_actions: []
prompts:
  p:
    text: |
      text
message_types:
handlers:
  post:
    enabled: yes
    command: []
`)).toThrow(/handlers.post.enabled must be true or false/);
    expect(() => parseWorkflowConfig(`version: 1
roles:
  overseer:
    can_emit_actions: []
prompts:
  p:
    text: |
      text
message_types:
  m:
    from_role: overseer
    to_role: decision_maker
    prompt_id: p
    fresh: true
    allowed_actions: []
handlers: {}
`)).toThrow(/fresh is not supported/);
  });
});

describe('workflow XML parser', () => {
  const xml = `Please fill out the form.
<auto-nudge-result version="1">
  <actions>
    <action type="send_message" role="decision_maker" message_type="created_form_handoff">
      <bead id="vkvw-pnhne" />
      <form id="decision-form" />
    </action>
    <action type="wait" mode="callback-wait" />
  </actions>
</auto-nudge-result>`;

  it('parses a final auto-nudge result block', () => {
    expect(parseWorkflowResultXml(xml)).toEqual({
      actions: [
        { type: 'send_message', role: 'decision_maker', messageType: 'created_form_handoff', handlerId: undefined, mode: undefined, beadIds: ['vkvw-pnhne'], formIds: ['decision-form'] },
        { type: 'wait', role: undefined, messageType: undefined, handlerId: undefined, mode: 'callback-wait', beadIds: [], formIds: [] },
      ],
    });
  });

  it('returns null for legacy marker-only responses', () => {
    expect(parseWorkflowResultXml('Please fill out the form.\nCREATED FORM')).toBeNull();
  });

  it('rejects malformed or non-final XML', () => {
    expect(() => parseWorkflowResultXml(`${xml}\nextra`)).toThrow(/final response block/);
    expect(() => parseWorkflowResultXml(`${xml}\n${xml}`)).toThrow(/one auto-nudge-result/);
    expect(() => parseWorkflowResultXml('<auto-nudge-result><actions><action type="unknown" /></actions></auto-nudge-result>')).toThrow(/Unknown XML action/);
    expect(() => parseWorkflowResultXml('<auto-nudge-result><actions><action type="wait" /><extra /></actions></auto-nudge-result>')).toThrow(/unsupported content/);
    expect(() => parseWorkflowResultXml('<auto-nudge-result><actions><action type="wait" bad="x" /></actions></auto-nudge-result>')).toThrow(/Unknown action attribute/);
    expect(() => parseWorkflowResultXml('<auto-nudge-result><actions><action type="wait">text</action></actions></auto-nudge-result>')).toThrow(/unsupported content/);
  });

  it('validates configured role permissions and message types', () => {
    const config = parseWorkflowConfig(DEFAULT_WORKFLOW_CONFIG_YAML);
    const result = parseWorkflowResultXml(xml)!;
    expect(() => validateWorkflowActions(result, config, 'overseer')).not.toThrow();
    expect(() => validateWorkflowActions(result, config, 'decision_maker')).toThrow(/may not emit/);
  });

  it('enforces message type allowed actions for handlers', () => {
    const config = parseWorkflowConfig(`version: 1
roles:
  overseer:
    can_emit_actions:
      - send_message
      - run_handler
prompts:
  p:
    text: |
      text
message_types:
  m:
    from_role: overseer
    to_role: decision_maker
    prompt_id: p
    fresh: false
    allowed_actions: []
handlers:
  post:
    enabled: true
    command:
      - echo
`);
    const result = parseWorkflowResultXml(`<auto-nudge-result>
  <actions>
    <action type="send_message" role="decision_maker" message_type="m" />
    <action type="run_handler" handler_id="post" />
  </actions>
</auto-nudge-result>`)!;
    expect(() => validateWorkflowActions(result, config, 'overseer')).toThrow(/does not allow run_handler/);
    const standalone = parseWorkflowResultXml('<auto-nudge-result><actions><action type="run_handler" handler_id="post" /></actions></auto-nudge-result>')!;
    expect(() => validateWorkflowActions(standalone, config, 'overseer')).toThrow(/requires a send_message/);
  });
});

describe('workflow handlers', () => {
  it('keeps custom handlers explicit and idempotent while dry-run stays read-only', async () => {
    const logPath = tempPath('handler-runs.jsonl');
    const action = { type: 'run_handler' as const, handlerId: 'post', beadIds: [], formIds: [] };
    const payload = { idempotencyKey: 'once', action, workspaceId: 'w1', triggerProcessId: 'p1', dryRun: true };
    const result = await runWorkflowHandler({ enabled: true, command: ['echo', 'ok'], timeoutMs: 1_000 }, payload, { logPath });
    expect(result.status).toBe('dry-run');
    expect(() => readFileSync(logPath, 'utf8')).toThrow();
    const second = await runWorkflowHandler({ enabled: true, command: ['echo', 'ok'], timeoutMs: 1_000 }, { ...payload, dryRun: false }, { logPath });
    expect(second.status).toBe('completed');
  });

  it('records nonzero handler exits', async () => {
    const logPath = tempPath('handler-runs.jsonl');
    const result = await runWorkflowHandler(
      { enabled: true, command: ['node', '-e', 'process.stderr.write("bad"); process.exit(2)'], timeoutMs: 1_000 },
      { idempotencyKey: 'fail', action: { type: 'run_handler', handlerId: 'post', beadIds: [], formIds: [] }, workspaceId: 'w1', triggerProcessId: 'p1', dryRun: false },
      { logPath },
    );
    expect(result).toMatchObject({ status: 'failed', exitCode: 2, error: 'bad' });
  });
});
