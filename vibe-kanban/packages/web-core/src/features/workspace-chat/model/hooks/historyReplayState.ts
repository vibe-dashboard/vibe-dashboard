export function updateHistoricReplayFailures(
  previous: Set<string>,
  options: {
    isCurrentScope: boolean;
    processId: string;
    failed: boolean;
  }
): Set<string> {
  if (!options.isCurrentScope) {
    return previous;
  }

  const alreadyFailed = previous.has(options.processId);
  if (options.failed === alreadyFailed) {
    return previous;
  }

  const next = new Set(previous);
  if (options.failed) {
    next.add(options.processId);
  } else {
    next.delete(options.processId);
  }

  return next;
}

export function getHistoricReplayRetryDelayMs(
  processId: string,
  attempt: number
): number {
  const cappedAttempt = Math.max(1, attempt);
  const baseDelayMs = Math.min(8000, 1000 * 2 ** (cappedAttempt - 1));
  const jitterMs =
    [...processId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 250;

  return baseDelayMs + jitterMs;
}
