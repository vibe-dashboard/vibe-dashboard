import { describe, expect, it } from 'vitest';
import {
  getHistoricReplayRetryDelayMs,
  updateHistoricReplayFailures,
} from './historyReplayState';

describe('updateHistoricReplayFailures', () => {
  it('ignores stale-scope updates', () => {
    const previous = new Set(['process-1']);

    const next = updateHistoricReplayFailures(previous, {
      isCurrentScope: false,
      processId: 'process-2',
      failed: true,
    });

    expect(next).toBe(previous);
    expect([...next]).toEqual(['process-1']);
  });

  it('adds and clears failures for the current scope', () => {
    const withFailure = updateHistoricReplayFailures(new Set<string>(), {
      isCurrentScope: true,
      processId: 'process-1',
      failed: true,
    });

    expect([...withFailure]).toEqual(['process-1']);

    const cleared = updateHistoricReplayFailures(withFailure, {
      isCurrentScope: true,
      processId: 'process-1',
      failed: false,
    });

    expect([...cleared]).toEqual([]);
  });

  it('uses bounded exponential backoff with deterministic jitter', () => {
    const firstAttempt = getHistoricReplayRetryDelayMs('process-1', 1);
    const secondAttempt = getHistoricReplayRetryDelayMs('process-1', 2);
    const fifthAttempt = getHistoricReplayRetryDelayMs('process-1', 5);

    expect(firstAttempt).toBeGreaterThanOrEqual(1000);
    expect(firstAttempt).toBeLessThan(1250);
    expect(secondAttempt).toBeGreaterThanOrEqual(2000);
    expect(secondAttempt).toBeLessThan(2250);
    expect(fifthAttempt).toBeGreaterThanOrEqual(8000);
    expect(fifthAttempt).toBeLessThan(8250);
  });
});
