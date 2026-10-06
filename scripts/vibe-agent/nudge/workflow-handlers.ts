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
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (hasHandlerRun(logPath, payload.idempotencyKey)) return { status: 'completed', exitCode: 0, error: null };
  if (payload.dryRun) {
    appendHandlerRun(logPath, payload, { status: 'dry-run', exitCode: null, error: null });
    return { status: 'dry-run', exitCode: null, error: null };
  }
  if (!handler.enabled) throw new Error('handler is not enabled');
  if (!handler.command.length) throw new Error('handler command is empty');

  const result = await spawnHandler(handler.command, JSON.stringify(payload), {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? handler.timeoutMs,
  });
  appendHandlerRun(logPath, payload, result);
  return result;
}

function hasHandlerRun(filePath: string, idempotencyKey: string): boolean {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .some(line => {
        try { return JSON.parse(line).idempotencyKey === idempotencyKey; }
        catch { return false; }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function appendHandlerRun(filePath: string, payload: HandlerPayload, result: HandlerRunResult): void {
  fs.appendFileSync(filePath, `${JSON.stringify({
    at: new Date().toISOString(),
    idempotencyKey: payload.idempotencyKey,
    handlerId: payload.action.handlerId ?? null,
    result,
  })}\n`, { mode: 0o600 });
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
    child.stdin.end(stdin);
  });
}
