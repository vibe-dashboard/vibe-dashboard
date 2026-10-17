import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { WorkflowAction } from './workflow-xml.js';
import type { WorkflowHandlerConfig } from './workflow-config.js';

export const DEFAULT_HANDLER_LOG_PATH = '/home/vkuser/.local/share/vibe-dashboard-runtime/data/auto-nudge/handler-runs.jsonl';

export interface HandlerPayload {
  idempotencyKey: string;
  action: WorkflowAction;
  workspaceId: string;
  triggerProcessId: string;
  outcome?: string;
  dryRun: boolean;
}

export interface HandlerRunResult {
  status: 'completed' | 'failed' | 'dry-run';
  exitCode: number | null;
  error: string | null;
}

export async function runWorkflowHandler(
  handler: WorkflowHandlerConfig,
  payload: HandlerPayload,
  options: { logPath?: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<HandlerRunResult> {
  const logPath = options.logPath ?? DEFAULT_HANDLER_LOG_PATH;
  if (payload.dryRun) {
    return { status: 'dry-run', exitCode: null, error: null };
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const prior = latestHandlerRun(logPath, payload.idempotencyKey);
  if (prior === 'completed') return { status: 'completed', exitCode: 0, error: null };
  if (prior === 'running') return { status: 'failed', exitCode: null, error: 'handler execution is indeterminate after an interrupted run; manual recovery is required' };
  if (!handler.enabled) throw new Error('handler is not enabled');
  if (!handler.command.length) throw new Error('handler command is empty');

  appendHandlerRun(logPath, payload, { status: 'running', exitCode: null, error: null });
  const result = await spawnHandler(handler.command, JSON.stringify(payload), {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? handler.timeoutMs,
  });
  appendHandlerRun(logPath, payload, result);
  return result;
}

function latestHandlerRun(filePath: string, idempotencyKey: string): HandlerRunResult['status'] | 'running' | null {
  try {
    const records = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          const record = JSON.parse(line);
          return record.idempotencyKey === idempotencyKey ? [record.result?.status] : [];
        }
        catch { return []; }
      });
    return records.at(-1) ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function appendHandlerRun(filePath: string, payload: HandlerPayload, result: HandlerRunResult | { status: 'running'; exitCode: null; error: null }): void {
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    idempotencyKey: payload.idempotencyKey,
    handlerId: payload.action.handlerId ?? null,
    result,
  })}\n`;
  const descriptor = fs.openSync(filePath, 'a', 0o600);
  try { fs.writeFileSync(descriptor, line); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function spawnHandler(command: string[], stdin: string, options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<HandlerRunResult> {
  return new Promise(resolve => {
    const [program, ...args] = command;
    if (!program) {
      resolve({ status: 'failed', exitCode: null, error: 'handler command is empty' });
      return;
    }
    const child = spawn(program, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ status: 'failed', exitCode: null, error: `handler timed out after ${options.timeoutMs}ms` });
    }, options.timeoutMs);
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: 'failed', exitCode: null, error: error.message });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0
        ? { status: 'completed', exitCode: 0, error: null }
        : { status: 'failed', exitCode: code, error: stderr.trim() || `handler exited ${code}` });
    });
    child.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE' && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'failed', exitCode: null, error: error.message });
      }
    });
    child.stdin.end(stdin);
  });
}
