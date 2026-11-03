import { createContext, useContext, type ReactNode } from 'react';

const WorkspaceChatSurfaceContext = createContext<string | null>(null);

export function WorkspaceChatSurfaceProvider({
  surfaceId,
  children,
}: {
  surfaceId: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceChatSurfaceContext.Provider value={surfaceId}>
      {children}
    </WorkspaceChatSurfaceContext.Provider>
  );
}

export function useWorkspaceChatSurfaceId(): string | null {
  return useContext(WorkspaceChatSurfaceContext);
}

export function scopeWorkspaceChatStateKey(
  key: string,
  surfaceId: string | null
): string {
  return surfaceId ? `surface:${surfaceId}:${key}` : key;
}
