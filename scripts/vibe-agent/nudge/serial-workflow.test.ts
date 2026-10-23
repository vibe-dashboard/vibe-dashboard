import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORKFLOW_CONFIG_YAML, parseWorkflowConfig } from './workflow-config.js';
import { parseSerialWorkflowConfig } from './serial-workflow-config.js';
import { schemaHash } from './workflow-xml.js';
import { createSerialRun, mutateSerialRun, readSerialRun, recoverSerialRun, SERIAL_RESULT_SCHEMA, validateSerialTemplate, type SerialTemplate, type WorkflowCommand } from './serial-workflow.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const schema = { schemaId: 'vd.workflow.role-result', schemaVersion: 1, schemaHash: schemaHash(SERIAL_RESULT_SCHEMA) };
function template(): SerialTemplate {
  return { id: 'reviewed-change', version: 1, items: ['implement', 'review', 'test'].map(id => ({
    id, label: id, role: id, prompt: `Do ${id}`, schema: structuredClone(schema), resultSchema: structuredClone(SERIAL_RESULT_SCHEMA),
    outcomes: { complete: { action: 'advance' }, rejected: id === 'implement' ? { action: 'needs_attention' } : { action: 'reset', resetsTo: 'implement' }, waiting: { action: 'wait' } },
  })) };
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'serial-workflow-')); directories.push(dir);
  const file = join(dir, 'run.json');
  const input = { id: 'run-one', workspaceId: 'workspace', beadIds: ['bead-a', 'bead-b'], template: template(), authority: { mode: 'human' as const } };
  createSerialRun(file, input, 'create');
  let sequence = 0;
  const command = (value: WorkflowCommand, key = `command-${++sequence}`) => mutateSerialRun(file, readSerialRun(file).version, key, value);
  const accepted = () => {
    const started = command({ type: 'start', sessionId: 'session' });
    const dispatchId = started.dispatchId!;
    command({ type: 'submitting', dispatchId });
    const processId = `process-${sequence}`;
    command({ type: 'accept', dispatchId, processId });
    return { dispatchId, processId };
  };
  const result = (outcome = 'complete') => {
    const run = readSerialRun(file); const item = run.items[run.currentIndex]!;
    const dispatch = run.dispatches.find(entry => entry.id === item.dispatchId)!;
    return { type: 'result' as const, schema, sourceProcessId: dispatch.processId!, result: { run_id: run.id, item_id: item.id, revision: run.revision, dispatch_id: dispatch.id, outcome, details: {} } };
  };
  return { file, input, command, accepted, result };
}

describe('serial workflow transitions', { timeout: 20_000 }, () => {
  it('snapshots a grouped template and completes three accepted role turns in order', () => {
    const value = setup(); value.input.template.items[0]!.prompt = 'changed live config';
    for (const id of ['implement', 'review', 'test']) {
      expect(readSerialRun(value.file).items[readSerialRun(value.file).currentIndex]!.id).toBe(id);
      value.accepted(); value.command(value.result());
    }
    const run = recoverSerialRun(value.file);
    expect(run.status).toBe('completed');
    expect(run.template.items[0]!.prompt).toBe('Do implement');
    expect(run.beadIds).toEqual(['bead-a', 'bead-b']);
    expect(run.items.every(item => item.status === 'completed')).toBe(true);
    expect(() => value.command({ type: 'start', sessionId: 'other' })).toThrow(/terminal/);
  });

  it.each(['review', 'test'])('resets on %s rejection and refuses stale downstream approval', rejecting => {
    const value = setup(); let oldResult: ReturnType<typeof value.result> | undefined;
    for (const id of ['implement', 'review', 'test']) {
      value.accepted();
      if (id === rejecting) { oldResult = value.result(); value.command(value.result('rejected')); break; }
      value.command(value.result());
    }
    const reset = readSerialRun(value.file);
    expect(reset).toMatchObject({ currentIndex: 0, revision: 2, status: 'queued' });
    expect(reset.items.every(item => item.status === 'pending' && item.result === null && item.dispatchId === null)).toBe(true);
    expect(reset.history.some(event => (event.details.result as { outcome?: string } | undefined)?.outcome === 'rejected')).toBe(true);
    value.accepted();
    const before = readFileSync(value.file, 'utf8');
    expect(() => value.command(oldResult!)).toThrow(/Stale/);
    expect(readFileSync(value.file, 'utf8')).toBe(before);
  });

  it('carries earlier completed work forward when resetting only a later suffix', () => {
    const value = setup();
    const custom = template(); custom.items[2]!.outcomes.rejected = { action: 'reset', resetsTo: 'review' };
    const file = `${value.file}.other`;
    createSerialRun(file, { ...value.input, template: custom }, 'new');
    for (let index = 0; index < 3; index++) {
      const mutate = (command: WorkflowCommand) => mutateSerialRun(file, readSerialRun(file).version, `v${readSerialRun(file).version}`, command);
      const id = mutate({ type: 'start', sessionId: 's' }).dispatchId!;
      mutate({ type: 'submitting', dispatchId: id }); mutate({ type: 'accept', dispatchId: id, processId: `p${index}` });
      mutate({ type: 'result', schema, sourceProcessId: `p${index}`, result: { run_id: 'run-one', item_id: custom.items[index]!.id, revision: 1, dispatch_id: id, outcome: index === 2 ? 'rejected' : 'complete', details: {} } });
    }
    expect(readSerialRun(file)).toMatchObject({ revision: 2, currentIndex: 1, items: [{ status: 'completed', revision: 1 }, { status: 'pending', revision: 2 }, { status: 'pending', revision: 2 }] });
  });

  it('validates authoritative schema, trusted process and all result correlations before mutation', () => {
    const value = setup(); value.accepted();
    const valid = value.result();
    const cases: WorkflowCommand[] = [
      { ...valid, sourceProcessId: 'unrelated' },
      { ...valid, schema: { ...schema, schemaVersion: 2 } },
      ...[{ run_id: 'other' }, { item_id: 'test' }, { revision: 0 }, { outcome: 'invented' }, { extra: true }].map(change => ({ ...valid, result: { ...valid.result, ...change } })),
    ];
    const before = readFileSync(value.file, 'utf8');
    for (const command of cases) { expect(() => value.command(command)).toThrow(); expect(readFileSync(value.file, 'utf8')).toBe(before); }
  });

  it('retries only a proven pre-admission failure and assigns a new attempt identity', () => {
    const value = setup(); const first = value.command({ type: 'start', sessionId: 'session' }).dispatchId!;
    value.command({ type: 'submitting', dispatchId: first });
    value.command({ type: 'delivery_failed', dispatchId: first, disposition: 'proven_unaccepted', reason: 'VK proved no child' });
    value.command({ type: 'retry' });
    const second = value.command({ type: 'start', sessionId: 'session' }).dispatchId!;
    expect(second).not.toBe(first);
    expect(readSerialRun(value.file).dispatches.map(entry => entry.attempt)).toEqual([1, 2]);
    value.command({ type: 'submitting', dispatchId: second });
    value.command({ type: 'delivery_failed', dispatchId: second, disposition: 'uncertain', reason: 'connection dropped' });
    expect(() => value.command({ type: 'retry' })).toThrow(/proven/);
    value.command({ type: 'accept', dispatchId: second, processId: 'reconciled' });
    expect(readSerialRun(value.file).status).toBe('active');
  });

  it('marks clean missing-result completion needs-attention without resending', () => {
    const value = setup(); const accepted = value.accepted();
    value.command({ type: 'missing_result', dispatchId: accepted.dispatchId, sourceProcessId: accepted.processId });
    expect(readSerialRun(value.file).status).toBe('needs_attention');
    expect(() => value.command({ type: 'retry' })).toThrow(/proven/);
  });

  it('records waiting without allowing another role or result to advance', () => {
    const value = setup(); value.accepted(); value.command(value.result('waiting'));
    expect(readSerialRun(value.file).status).toBe('waiting');
    expect(() => value.command({ type: 'start', sessionId: 'other' })).toThrow();
    expect(() => value.command(value.result())).toThrow(/current accepted/);
  });

  it('does not claim that cancelling an accepted process terminated transport', () => {
    const value = setup(); value.accepted(); value.command({ type: 'cancel', reason: 'user requested' });
    expect(readSerialRun(value.file)).toMatchObject({ status: 'needs_attention', cancelRequested: true });
    expect(() => value.command({ type: 'start', sessionId: 'other' })).toThrow(/cancellation/);
    const unstarted = setup(); unstarted.command({ type: 'cancel', reason: 'user requested' });
    expect(readSerialRun(unstarted.file).status).toBe('cancelled');
  });
});

describe('durable mutation and journal boundaries', { timeout: 20_000 }, () => {
  it('returns the original receipt before checking a now-stale expected version', () => {
    const value = setup(); const version = readSerialRun(value.file).version;
    const command = { type: 'start' as const, sessionId: 'session' };
    const original = mutateSerialRun(value.file, version, 'same-key', command);
    value.command({ type: 'submitting', dispatchId: original.dispatchId! });
    expect(mutateSerialRun(value.file, version, 'same-key', command)).toEqual(original);
    expect(() => mutateSerialRun(value.file, version, 'same-key', { ...command, sessionId: 'different' })).toThrow(/conflict/);
    expect(() => mutateSerialRun(value.file, version, 'another-key', command)).toThrow(/version conflict/);
    expect(createSerialRun(value.file, value.input, 'create').version).toBe(1);
  });

  it('repairs a missing or torn journal suffix, but refuses conflicting/ahead history', () => {
    const value = setup(); value.accepted();
    const journal = `${value.file}.events.jsonl`; const complete = readFileSync(journal, 'utf8');
    writeFileSync(journal, complete.slice(0, complete.indexOf('\n') + 20));
    recoverSerialRun(value.file);
    expect(readFileSync(journal, 'utf8')).toBe(complete);
    writeFileSync(journal, `${complete}{"sequence":999}\n`);
    expect(() => recoverSerialRun(value.file)).toThrow(/Conflicting/);
    writeFileSync(journal, complete.replace('created', 'tampered'));
    expect(() => recoverSerialRun(value.file)).toThrow(/Conflicting/);
  });

  it('refuses corrupt snapshots rather than assuming an empty run', () => {
    const value = setup(); const raw = readFileSync(value.file, 'utf8');
    writeFileSync(value.file, raw.replace('"workspaceId":"workspace"', '"workspaceId":"tampered"'));
    expect(() => readSerialRun(value.file)).toThrow(/integrity/);
    writeFileSync(value.file, '{'); expect(() => recoverSerialRun(value.file)).toThrow();
  });

  it.each([undefined, NaN, Infinity, new Date(), () => {}, BigInt(1)])('rejects non-JSON value %s before persisting a command', invalid => {
    const value = setup(); value.accepted(); const command = value.result();
    const before = readFileSync(value.file, 'utf8');
    command.result.details = { invalid };
    expect(() => value.command(command)).toThrow(/plain JSON/);
    expect(readFileSync(value.file, 'utf8')).toBe(before);
  });

  it('rejects hash-consistent malformed state, history, attempts and receipts', () => {
    const value = setup(); value.accepted(); value.command(value.result());
    const original = readSerialRun(value.file);
    const mutations: Array<(run: typeof original) => void> = [
      run => { run.receipts.create!.result.status = 'invented' as never; },
      run => { run.receipts.create!.result.currentItemId = 'nonexistent'; },
      run => { run.receipts.create!.result.dispatchId = 'nonexistent'; },
      run => { run.items[0]!.result = null; },
      run => { run.items[0]!.result!.revision = 99; },
      run => { run.history[1]!.revision = 99; },
      run => { run.history[1]!.itemId = 'nonexistent'; },
      run => { run.history[1]!.details = { type: 'retry' }; },
      run => { run.dispatches[0]!.attempt = 2; },
      run => { run.dispatches[0]!.processId = 'unrelated'; },
    ];
    for (const mutate of mutations) {
      const run = structuredClone(original); mutate(run);
      writeFileSync(value.file, JSON.stringify({ hash: schemaHash(run), run }));
      expect(() => readSerialRun(value.file)).toThrow();
    }
  });

  it('recovers a proven dead lock owner without discarding run state', () => {
    const value = setup(); mkdirSync(`${value.file}.lock`);
    writeFileSync(`${value.file}.lock/pid`, '2147483647');
    expect(value.command({ type: 'start', sessionId: 's' }).version).toBe(2);
    expect(readSerialRun(value.file).dispatches).toHaveLength(1);
  });

  it('waits for a separate process holding the mutation lock', async () => {
    const value = setup();
    const child = spawn(process.execPath, ['-e', `const fs=require('fs'); const p=process.argv[1]; fs.mkdirSync(p); fs.writeFileSync(p+'/pid',String(process.pid)); process.stdout.write('ready'); setTimeout(()=>{fs.rmSync(p,{recursive:true});},250);`, `${value.file}.lock`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`))); });
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.stdout.once('data', () => resolve()); });
    const before = Date.now(); value.command({ type: 'start', sessionId: 's' });
    expect(Date.now() - before).toBeGreaterThanOrEqual(150);
    await exited;
    expect(readSerialRun(value.file).dispatches).toHaveLength(1);
  });

  it('allows exactly one of two real writers with the same expected version', async () => {
    const value = setup(); const version = readSerialRun(value.file).version;
    const modulePath = fileURLToPath(new URL('./serial-workflow.ts', import.meta.url));
    const script = `
      import { createServer } from 'vite';
      const server = await createServer({configFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false}});
      const runtime = await server.ssrLoadModule(process.argv[1]);
      process.stdout.write('ready\\n');
      process.stdin.once('data', async () => {
        try {
          const result = runtime.mutateSerialRun(process.argv[2], Number(process.argv[3]), process.argv[4], {type:'start',sessionId:process.argv[4]});
          process.stdout.write(JSON.stringify({ok:true,result})+'\\n');
        } catch(error) { process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\\n'); }
        await server.close();
        process.stdin.destroy();
      });
    `;
    const children = ['writer-a', 'writer-b'].map(key => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, modulePath, value.file, String(version), key], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      const ready = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.includes('ready\n')) resolve(); });
        child.once('exit', () => { if (!stdout.includes('ready\n')) reject(new Error(stderr || 'writer exited before ready')); });
      });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      const finished = new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => {
          if (code !== 0) return reject(new Error(stderr || `writer exited ${code}`));
          try { resolve(JSON.parse(stdout.split('\n').find(line => line.startsWith('{'))!)); }
          catch (error) { reject(error); }
        });
      });
      return { child, ready, finished };
    });
    try {
      await Promise.all(children.map(entry => entry.ready));
      for (const entry of children) entry.child.stdin.end('go');
      const results = await Promise.all(children.map(entry => entry.finished));
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => !result.ok)?.error).toMatch(/version conflict/);
      const run = recoverSerialRun(value.file);
      expect(run.version).toBe(version + 1);
      expect(run.dispatches).toHaveLength(1);
      expect(run.history).toHaveLength(2);
      expect(readFileSync(`${value.file}.events.jsonl`, 'utf8')).toBe(run.history.map(event => JSON.stringify(event) + '\n').join(''));
    } finally {
      for (const entry of children) if (entry.child.exitCode === null) entry.child.kill('SIGKILL');
    }
  }, 30_000);
});

describe('strict version-3 workflow templates', () => {
  function parseSerialSource() {
    // Use production v2 configuration as the messaging authority, not a second
    // set of roles/prompts. Its schema file is replaced by this fixture reader.
    const base = DEFAULT_WORKFLOW_CONFIG_YAML.replace('version: 2', 'version: 3');
    return base;
  }
  const yaml = () => `${parseSerialSource()}templates:\n  change:\n    version: 1\n    items:\n      - id: implement\n        label: Implement\n        message_type: overseer_checkpoint\n        outcomes:\n          complete: {action: advance}\n      - id: review\n        label: Review\n        message_type: overseer_checkpoint\n        outcomes:\n          approved: {action: advance}\n          rejected: {action: reset, resets_to: implement}\n`;
  it('loads v3 through an explicit parser while v2 remains strict', () => {
    const parsed = parseSerialWorkflowConfig(yaml(), '/tmp/config.yaml', () => SERIAL_RESULT_SCHEMA);
    expect(parsed.templates.change!.items[1]!.outcomes.rejected).toEqual({ action: 'reset', resetsTo: 'implement' });
    expect(parsed.templates.change!.items[0]!.schema).toMatchObject({ schemaHash: schemaHash(SERIAL_RESULT_SCHEMA) });
    expect(() => parseWorkflowConfig(yaml())).toThrow();
    expect(parseWorkflowConfig(DEFAULT_WORKFLOW_CONFIG_YAML).version).toBe(2);
  });
  it('rejects aliases, unknown fields, missing contracts and invalid reset targets', () => {
    const parse = (raw: string) => parseSerialWorkflowConfig(raw, '/tmp/config.yaml', () => SERIAL_RESULT_SCHEMA);
    expect(() => parse(yaml().replace('version: 3', 'version: 3\nextra: true'))).toThrow();
    expect(() => parse(yaml().replace('label: Review', 'label: &bad Review'))).toThrow(/anchors/);
    expect(() => parse(yaml().replace('resets_to: implement', 'resets_to: review'))).toThrow(/earlier/);
    expect(() => parse(yaml().replace('message_type: overseer_checkpoint', 'message_type: missing'))).toThrow(/message type/);
    const bad = template(); bad.items[1]!.id = 'implement'; expect(() => validateSerialTemplate(bad)).toThrow(/Duplicate/);
  });
});
