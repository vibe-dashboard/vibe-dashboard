import type { Session } from './vk-client';

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortAgentSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (left, right) =>
      timestamp(right.updated_at) - timestamp(left.updated_at) ||
      timestamp(right.created_at) - timestamp(left.created_at) ||
      left.id.localeCompare(right.id),
  );
}

export function resolveInitialAgentSessionId(
  sessions: Session[],
  requestedSessionId: string | null,
): string | null {
  if (
    requestedSessionId &&
    sessions.some(({ id }) => id === requestedSessionId)
  ) {
    return requestedSessionId;
  }
  return sortAgentSessions(sessions)[0]?.id ?? null;
}

export function buildAgentSessionUrl(
  agentUrl: string,
  sessionId: string | null,
): string {
  const url = new URL(agentUrl, 'https://workspace.local');
  if (sessionId) url.searchParams.set('session_id', sessionId);
  else url.searchParams.delete('session_id');

  if (/^[a-z][a-z\d+.-]*:/i.test(agentUrl) || agentUrl.startsWith('//')) {
    return url.href;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
