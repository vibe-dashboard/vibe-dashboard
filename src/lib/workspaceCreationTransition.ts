export interface WorkspaceCreationOrigin {
  workspaceId: string;
  sourceTabGroupId: string;
  spaceId: string;
  sessionId: string;
}

export interface WorkspaceCreationTransition<T> {
  open: () => Promise<T>;
  waitUntilReady: (destination: T) => Promise<void>;
  isSourceSelected: () => boolean;
  focus: (destination: T) => void;
  closeSource: (destination: T) => Promise<unknown>;
}

export async function completeWorkspaceCreation<T>(
  transition: WorkspaceCreationTransition<T>,
): Promise<void> {
  const destination = await transition.open();
  await transition.waitUntilReady(destination);
  if (transition.isSourceSelected()) transition.focus(destination);
  await transition.closeSource(destination);
}
