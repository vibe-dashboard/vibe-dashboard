const STORAGE_PREFIX = 'vd:inline-vk-chat:v1';

export type SurfaceChatViewMode = 'full' | 'mostly-zen' | 'zen';

export function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function surfaceSessionStorageKey(
  workspaceId: string,
  surfaceId: string
): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(surfaceId)}:selected-session`;
}

function surfaceChatViewModeStorageKey(
  workspaceId: string,
  surfaceId: string
): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(surfaceId)}:chat-view-mode`;
}

export function readSurfaceSessionId(
  storage: Storage | null,
  workspaceId: string,
  surfaceId: string
): string | null {
  if (!storage || !workspaceId || !surfaceId) return null;
  try {
    return storage.getItem(surfaceSessionStorageKey(workspaceId, surfaceId));
  } catch {
    return null;
  }
}

export function writeSurfaceSessionId(
  storage: Storage | null,
  workspaceId: string,
  surfaceId: string,
  sessionId: string
): void {
  if (!storage || !workspaceId || !surfaceId || !sessionId) return;
  try {
    storage.setItem(
      surfaceSessionStorageKey(workspaceId, surfaceId),
      sessionId
    );
  } catch {
    // Storage can be blocked or full. The live surface remains usable.
  }
}

export function readSurfaceChatViewMode(
  storage: Storage | null,
  workspaceId: string,
  surfaceId: string
): SurfaceChatViewMode | null {
  if (!storage || !workspaceId || !surfaceId) return null;
  try {
    const mode = storage.getItem(
      surfaceChatViewModeStorageKey(workspaceId, surfaceId)
    );
    return mode === 'full' || mode === 'mostly-zen' || mode === 'zen' ? mode : null;
  } catch {
    return null;
  }
}

export function writeSurfaceChatViewMode(
  storage: Storage | null,
  workspaceId: string,
  surfaceId: string,
  mode: SurfaceChatViewMode
): void {
  if (!storage || !workspaceId || !surfaceId) return;
  try {
    storage.setItem(
      surfaceChatViewModeStorageKey(workspaceId, surfaceId),
      mode
    );
  } catch {
    // Storage can be blocked or full. The live surface remains usable.
  }
}
