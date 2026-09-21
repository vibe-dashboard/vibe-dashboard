export interface WsRetryState {
  retryAttempts: number;
  hasReceivedPayload: boolean;
}

export interface WsRetryDecision {
  attempt: number;
  shouldRetry: boolean;
}

export function markWsStreamHealthy(state: WsRetryState): WsRetryState {
  if (state.retryAttempts === 0 && state.hasReceivedPayload) {
    return state;
  }

  return {
    retryAttempts: 0,
    hasReceivedPayload: true,
  };
}

export function getWsRetryDecision(
  state: WsRetryState,
  maxRetries: number
): WsRetryDecision {
  const attempt = state.retryAttempts + 1;
  return {
    attempt,
    shouldRetry: attempt <= maxRetries,
  };
}
