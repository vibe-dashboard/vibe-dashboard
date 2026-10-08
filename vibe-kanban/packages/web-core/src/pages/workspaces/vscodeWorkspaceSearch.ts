export interface VSCodeWorkspaceSearch {
  chatOnly: boolean;
  sessionId?: string;
}

export function parseVSCodeWorkspaceSearch(
  search: Record<string, unknown>
): VSCodeWorkspaceSearch {
  const rawSessionId = search.session_id;

  return {
    chatOnly: search.chat_only === true || search.chat_only === 'true',
    sessionId:
      typeof rawSessionId === 'string' && rawSessionId.length > 0
        ? rawSessionId
        : undefined,
  };
}
