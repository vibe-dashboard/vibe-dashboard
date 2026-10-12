import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionProcessFinalResponse } from '../types.js';
import { waitForFinalResponseWithCallbacks } from './vk.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempRegistry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vk-sync-'));
  dirs.push(dir);
  return join(dir, 'callbacks.json');
}

function final(processId: string, response: string | null, finished = true): ExecutionProcessFinalResponse {
  return { process_id: processId, status: finished ? 'completed' : 'running', finished, final_response: response, terminal_no_response: finished && response == null };
}

describe('vk send --sync callback-aware wait', () => {
  it('follows a completed callback completion process before returning final response', async () => {
    const registry = tempRegistry();
    writeFileSync(registry, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'impl', command: 'ci', status: 'completed', startedAt: '2026-10-06T00:00:00.000Z',
      timeoutMs: null, finishedAt: '2026-10-06T00:01:00.000Z', completionProcessId: 'completion',
      runnerPid: null, sourceProcessId: 'original', triggerProcessId: 'original', error: null,
    }] }));
    const service = { async getExecutionProcessFinalResponse(id: string) { return final(id, id === 'completion' ? 'post-callback' : 'stale'); } };
    await expect(waitForFinalResponseWithCallbacks(service, 'original', 1_000, { callbackRegistryPath: registry })).resolves.toEqual({
      processId: 'completion',
      final: final('completion', 'post-callback'),
    });
  });

  it('waits through a running callback instead of returning the pre-callback response', async () => {
    const registry = tempRegistry();
    writeFileSync(registry, JSON.stringify({ version: 2, callbacks: [{
      id: 'cb', sessionId: 'impl', command: 'ci', status: 'running', startedAt: '2026-10-06T00:00:00.000Z',
      timeoutMs: null, finishedAt: null, completionProcessId: null,
      runnerPid: process.pid, sourceProcessId: 'original', triggerProcessId: 'original', error: null,
    }] }));
    const service = { async getExecutionProcessFinalResponse(id: string) { return final(id, 'stale'); } };
    await expect(waitForFinalResponseWithCallbacks(service, 'original', 5, { callbackRegistryPath: registry, sleep: async () => {} })).rejects.toThrow(/Timed out/);
  });
});
