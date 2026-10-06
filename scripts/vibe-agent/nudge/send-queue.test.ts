import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  amendQueuedSend,
  cancelQueuedSend,
  claimNextQueuedSend,
  claimNextQueuedSendWhere,
  enqueueSend,
  markQueuedSendAccepted,
  markQueuedSendFailed,
  markStaleSendingIndeterminate,
  queuedSendBody,
  readSendQueue,
} from './send-queue.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function queuePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'send-queue-'));
  dirs.push(dir);
  return join(dir, 'queue.json');
}

function input(overrides = {}) {
  return {
    id: 'send-1',
    targetRole: 'reviewer',
    targetSessionId: 'session-reviewer',
    executor: 'CODEX' as const,
    prompt: 'review this',
    replySessionId: 'session-overseer',
    now: new Date('2026-10-06T00:00:00.000Z'),
    ...overrides,
  };
}

describe('send queue', () => {
  it('enqueues, amends, cancels, and preserves queued-only undo semantics', () => {
    const file = queuePath();
    expect(enqueueSend(file, input())).toMatchObject({ id: 'send-1', status: 'queued', prompt: 'review this' });
    expect(amendQueuedSend(file, 'send-1', 'review this carefully', new Date('2026-10-06T00:00:01.000Z'))).toMatchObject({
      status: 'queued',
      prompt: 'review this carefully',
    });
    expect(cancelQueuedSend(file, 'send-1', new Date('2026-10-06T00:00:02.000Z'))).toMatchObject({ status: 'cancelled' });
    expect(() => amendQueuedSend(file, 'send-1', 'too late')).toThrow(/only queued sends can be amended/);
    expect(() => cancelQueuedSend(file, 'send-1')).toThrow(/only queued sends can be cancelled/);
  });

  it('claims the oldest queued send and makes accepted sends immutable to undo/amend', () => {
    const file = queuePath();
    enqueueSend(file, input({ id: 'newer', now: new Date('2026-10-06T00:00:02.000Z') }));
    enqueueSend(file, input({ id: 'older', now: new Date('2026-10-06T00:00:01.000Z') }));
    expect(claimNextQueuedSend(file, new Date('2026-10-06T00:00:03.000Z'))).toMatchObject({ id: 'older', status: 'sending' });
    expect(() => amendQueuedSend(file, 'older', 'nope')).toThrow(/only queued sends can be amended/);
    expect(markQueuedSendAccepted(file, 'older', 'process-1', new Date('2026-10-06T00:00:04.000Z'))).toMatchObject({
      status: 'accepted',
      processId: 'process-1',
    });
    expect(() => cancelQueuedSend(file, 'older')).toThrow(/only queued sends can be cancelled/);
    expect(claimNextQueuedSend(file)).toMatchObject({ id: 'newer' });
  });

  it('claims the oldest queued send matching a predicate', () => {
    const file = queuePath();
    enqueueSend(file, input({ id: 'blocked', targetSessionId: 'busy', now: new Date('2026-10-06T00:00:01.000Z') }));
    enqueueSend(file, input({ id: 'ready', targetSessionId: 'idle', now: new Date('2026-10-06T00:00:02.000Z') }));
    expect(claimNextQueuedSendWhere(file, send => send.targetSessionId !== 'busy')).toMatchObject({ id: 'ready', status: 'sending' });
    expect(readSendQueue(file).sends.blocked).toMatchObject({ status: 'queued' });
  });

  it('records failed sends only from the sending state', () => {
    const file = queuePath();
    enqueueSend(file, input());
    expect(() => markQueuedSendFailed(file, 'send-1', 'offline')).toThrow(/only sending sends/);
    claimNextQueuedSend(file);
    expect(markQueuedSendFailed(file, 'send-1', 'offline')).toMatchObject({ status: 'failed', error: 'offline' });
  });

  it('fails closed stale sending entries instead of retrying duplicate-prone sends', () => {
    const file = queuePath();
    enqueueSend(file, input());
    claimNextQueuedSend(file, new Date('2026-10-06T00:00:01.000Z'));
    const changed = markStaleSendingIndeterminate(
      file,
      new Date('2026-10-06T00:01:00.000Z'),
      new Date('2026-10-06T00:02:00.000Z'),
    );
    expect(changed).toEqual([expect.objectContaining({
      id: 'send-1',
      status: 'indeterminate',
      error: expect.stringMatching(/automatic resend is disabled/),
    })]);
    expect(claimNextQueuedSend(file)).toBeNull();
  });

  it('fails closed on malformed queue state', () => {
    const file = queuePath();
    writeFileSync(file, '{nope');
    expect(() => readSendQueue(file)).toThrow(/Invalid send queue JSON/);
    writeFileSync(file, JSON.stringify({ version: 1, sends: { bad: { id: 'bad' } } }));
    expect(() => readSendQueue(file)).toThrow(/Invalid send queue schema/);
  });

  it('builds the VK send body from a queued send', () => {
    const file = queuePath();
    const send = enqueueSend(file, input({ prompt: 'literal `backticks`' }));
    expect(queuedSendBody(send)).toEqual({
      prompt: 'literal `backticks`',
      executor_config: { executor: 'CODEX' },
      retry_process_id: null,
      force_when_dirty: null,
      perform_git_reset: null,
    });
  });
});
