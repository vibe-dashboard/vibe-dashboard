import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Executor } from '../config.js';
import type { SendMessageBody } from '../types.js';

export const DEFAULT_SEND_QUEUE_PATH = '/home/vkuser/.local/share/vibe-dashboard-runtime/data/auto-nudge/send-queue.json';

export type QueuedSendStatus = 'queued' | 'sending' | 'accepted' | 'cancelled' | 'failed';

export interface QueuedSend {
  id: string;
  status: QueuedSendStatus;
  targetRole: string;
  targetSessionId: string;
  executor: Executor;
  prompt: string;
  replySessionId: string | null;
  createdAt: string;
  updatedAt: string;
  processId: string | null;
  error: string | null;
}

export interface SendQueueState {
  version: 1;
  sends: Record<string, QueuedSend>;
}

export interface QueueSendInput {
  targetRole: string;
  targetSessionId: string;
  executor: Executor;
  prompt: string;
  replySessionId?: string | null;
  now?: Date;
  id?: string;
}

const LOCK_TIMEOUT_MS = 5_000;

function lockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withSendQueueLock<T>(filePath: string, task: () => T, timeoutMs = LOCK_TIMEOUT_MS): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lock = lockPath(filePath);
  const expiresAt = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number.parseInt(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), 10);
        if (Number.isInteger(owner)) process.kill(owner, 0);
      } catch (ownerError) {
        const code = (ownerError as NodeJS.ErrnoException).code;
        if (code === 'ESRCH' || code === 'ENOENT') {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() >= expiresAt) throw new Error(`Timed out waiting for send queue lock ${lock}`);
      sleepSync(10);
    }
  }
  try {
    return task();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function validSend(value: unknown): value is QueuedSend {
  const send = value as QueuedSend;
  return Boolean(send && typeof send === 'object'
    && typeof send.id === 'string'
    && ['queued', 'sending', 'accepted', 'cancelled', 'failed'].includes(send.status)
    && typeof send.targetRole === 'string'
    && typeof send.targetSessionId === 'string'
    && typeof send.executor === 'string'
    && typeof send.prompt === 'string'
    && (send.replySessionId == null || typeof send.replySessionId === 'string')
    && typeof send.createdAt === 'string'
    && typeof send.updatedAt === 'string'
    && (send.processId == null || typeof send.processId === 'string')
    && (send.error == null || typeof send.error === 'string'));
}

export function readSendQueue(filePath: string): SendQueueState {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sends: {} };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid send queue JSON at ${filePath}: ${(error as Error).message}`);
  }
  const state = value as Partial<SendQueueState>;
  if (state.version !== 1 || !state.sends || typeof state.sends !== 'object'
    || !Object.entries(state.sends).every(([id, send]) => validSend(send) && send.id === id)) {
    throw new Error(`Invalid send queue schema at ${filePath}`);
  }
  return state as SendQueueState;
}

export function writeSendQueue(filePath: string, state: SendQueueState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export function enqueueSend(filePath: string, input: QueueSendInput): QueuedSend {
  return withSendQueueLock(filePath, () => {
    const state = readSendQueue(filePath);
    const now = (input.now ?? new Date()).toISOString();
    const id = input.id ?? randomUUID();
    if (state.sends[id]) throw new Error(`Queued send ${id} already exists`);
    const send: QueuedSend = {
      id,
      status: 'queued',
      targetRole: input.targetRole,
      targetSessionId: input.targetSessionId,
      executor: input.executor,
      prompt: input.prompt,
      replySessionId: input.replySessionId ?? null,
      createdAt: now,
      updatedAt: now,
      processId: null,
      error: null,
    };
    state.sends[id] = send;
    writeSendQueue(filePath, state);
    return send;
  });
}

export function amendQueuedSend(filePath: string, id: string, prompt: string, now = new Date()): QueuedSend {
  return withSendQueueLock(filePath, () => {
    const state = readSendQueue(filePath);
    const send = state.sends[id];
    if (!send) throw new Error(`Queued send ${id} not found`);
    if (send.status !== 'queued') throw new Error(`Queued send ${id} is ${send.status}; only queued sends can be amended`);
    const updated = { ...send, prompt, updatedAt: now.toISOString() };
    state.sends[id] = updated;
    writeSendQueue(filePath, state);
    return updated;
  });
}

export function cancelQueuedSend(filePath: string, id: string, now = new Date()): QueuedSend {
  return withSendQueueLock(filePath, () => {
    const state = readSendQueue(filePath);
    const send = state.sends[id];
    if (!send) throw new Error(`Queued send ${id} not found`);
    if (send.status !== 'queued') throw new Error(`Queued send ${id} is ${send.status}; only queued sends can be cancelled`);
    const updated = { ...send, status: 'cancelled' as const, updatedAt: now.toISOString() };
    state.sends[id] = updated;
    writeSendQueue(filePath, state);
    return updated;
  });
}

export function claimNextQueuedSend(filePath: string, now = new Date()): QueuedSend | null {
  return withSendQueueLock(filePath, () => {
    const state = readSendQueue(filePath);
    const next = Object.values(state.sends)
      .filter(send => send.status === 'queued')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
    if (!next) return null;
    const updated = { ...next, status: 'sending' as const, updatedAt: now.toISOString() };
    state.sends[next.id] = updated;
    writeSendQueue(filePath, state);
    return updated;
  });
}

export function markQueuedSendAccepted(filePath: string, id: string, processId: string, now = new Date()): QueuedSend {
  return updateClaimedSend(filePath, id, send => ({ ...send, status: 'accepted', processId, error: null, updatedAt: now.toISOString() }));
}

export function markQueuedSendFailed(filePath: string, id: string, error: string, now = new Date()): QueuedSend {
  return updateClaimedSend(filePath, id, send => ({ ...send, status: 'failed', error, updatedAt: now.toISOString() }));
}

function updateClaimedSend(filePath: string, id: string, update: (send: QueuedSend) => QueuedSend): QueuedSend {
  return withSendQueueLock(filePath, () => {
    const state = readSendQueue(filePath);
    const send = state.sends[id];
    if (!send) throw new Error(`Queued send ${id} not found`);
    if (send.status !== 'sending') throw new Error(`Queued send ${id} is ${send.status}; only sending sends can be completed`);
    const updated = update(send);
    state.sends[id] = updated;
    writeSendQueue(filePath, state);
    return updated;
  });
}

export function queuedSendBody(send: QueuedSend): SendMessageBody {
  return {
    prompt: send.prompt,
    executor_config: { executor: send.executor },
    retry_process_id: null,
    force_when_dirty: null,
    perform_git_reset: null,
  };
}
