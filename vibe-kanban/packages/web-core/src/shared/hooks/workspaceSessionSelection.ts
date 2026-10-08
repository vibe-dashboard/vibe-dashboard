export function resolveWorkspaceSessionId(
  sessions: ReadonlyArray<{ id: string }>,
  selectedSessionId: string | undefined,
  requestedSessionId: string | undefined
): string | undefined {
  if (
    requestedSessionId &&
    sessions.some((session) => session.id === requestedSessionId)
  ) {
    return requestedSessionId;
  }
  if (
    !requestedSessionId &&
    selectedSessionId &&
    sessions.some((session) => session.id === selectedSessionId)
  ) {
    return selectedSessionId;
  }
  return sessions[0]?.id;
}
