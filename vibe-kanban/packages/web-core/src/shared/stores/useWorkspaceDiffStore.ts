import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from 'react';
import { create, useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Diff, DiffStats, UnifiedPrComment } from 'shared/types';
import type { NormalizedGitHubComment } from '@/shared/hooks/useWorkspaceContext';

// ---------------------------------------------------------------------------
// Zustand store for workspace diff data (diffs, stats, GitHub comments).
// Populated by WorkspaceProvider via setWorkspaceDiffData(); consumers can
// subscribe to individual slices with the exported atomic selectors below.
// ---------------------------------------------------------------------------

const EMPTY_DIFFS: Diff[] = [];
const EMPTY_DIFF_PATHS: Set<string> = new Set();
const EMPTY_DIFF_STATS: DiffStats = {
  files_changed: 0,
  lines_added: 0,
  lines_removed: 0,
};
const EMPTY_COMMENTS: UnifiedPrComment[] = [];
const EMPTY_NORMALIZED: NormalizedGitHubComment[] = [];
const EMPTY_FILES: string[] = [];

const noopGetCommentsForFile = () => EMPTY_NORMALIZED;
const noopGetCommentCountForFile = () => 0;
const noopGetFilesWithComments = () => EMPTY_FILES;
const noopGetFirstCommentLine = () => null;
const noopSetShowGitHubComments = () => {};

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface WorkspaceDiffData {
  diffs: Diff[];
  diffPaths: Set<string>;
  diffStats: DiffStats;
  gitHubComments: UnifiedPrComment[];
  isGitHubCommentsLoading: boolean;
  showGitHubComments: boolean;
  setShowGitHubComments: (show: boolean) => void;
  getGitHubCommentsForFile: (filePath: string) => NormalizedGitHubComment[];
  getGitHubCommentCountForFile: (filePath: string) => number;
  getFilesWithGitHubComments: () => string[];
  getFirstCommentLineForFile: (filePath: string) => number | null;
}

export interface WorkspaceDiffState extends WorkspaceDiffData {
  /** Batch-update all diff data fields. Called by WorkspaceProvider. */
  setWorkspaceDiffData: (data: WorkspaceDiffData) => void;
  /** Reset to defaults. Called on workspace switch / unmount. */
  clearWorkspaceDiffData: () => void;
}

const DEFAULT_DATA: WorkspaceDiffData = {
  diffs: EMPTY_DIFFS,
  diffPaths: EMPTY_DIFF_PATHS,
  diffStats: EMPTY_DIFF_STATS,
  gitHubComments: EMPTY_COMMENTS,
  isGitHubCommentsLoading: false,
  showGitHubComments: false,
  setShowGitHubComments: noopSetShowGitHubComments,
  getGitHubCommentsForFile: noopGetCommentsForFile,
  getGitHubCommentCountForFile: noopGetCommentCountForFile,
  getFilesWithGitHubComments: noopGetFilesWithComments,
  getFirstCommentLineForFile: noopGetFirstCommentLine,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function createWorkspaceDiffState(
  set: StoreApi<WorkspaceDiffState>['setState'],
  initialData?: Partial<WorkspaceDiffData>
): WorkspaceDiffState {
  return {
    ...DEFAULT_DATA,
    ...initialData,
    setWorkspaceDiffData: (data) => set(data),
    clearWorkspaceDiffData: () => set(DEFAULT_DATA),
  };
}

export function createWorkspaceDiffStore(
  initialData?: Partial<WorkspaceDiffData>
): StoreApi<WorkspaceDiffState> {
  return createStore<WorkspaceDiffState>()((set) =>
    createWorkspaceDiffState(set, initialData)
  );
}

// Standalone VK keeps its historical process-wide store. Embedded surfaces
// install a provider below so every mounted Agent owns its diff lifecycle.
export const useWorkspaceDiffStore = create<WorkspaceDiffState>()((set) =>
  createWorkspaceDiffState(set)
);

const WorkspaceDiffStoreContext =
  createContext<StoreApi<WorkspaceDiffState> | null>(null);

export function WorkspaceDiffStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: StoreApi<WorkspaceDiffState>;
}) {
  const storeRef = useRef<StoreApi<WorkspaceDiffState> | null>(null);
  if (!storeRef.current) storeRef.current = createWorkspaceDiffStore();

  return createElement(
    WorkspaceDiffStoreContext.Provider,
    { value: store ?? storeRef.current },
    children
  );
}

export function useWorkspaceDiffStoreApi(): StoreApi<WorkspaceDiffState> {
  return useContext(WorkspaceDiffStoreContext) ?? useWorkspaceDiffStore;
}

function useWorkspaceDiffSelector<T>(
  selector: (state: WorkspaceDiffState) => T
): T {
  return useStore(useWorkspaceDiffStoreApi(), selector);
}

// ---------------------------------------------------------------------------
// Atomic selectors — each subscribes to a single field to minimise rerenders
// ---------------------------------------------------------------------------

export const useDiffs = () => useWorkspaceDiffSelector((s) => s.diffs);

export const useDiffPaths = () =>
  useWorkspaceDiffSelector((s) => s.diffPaths);

export const useDiffStats = () =>
  useWorkspaceDiffSelector((s) => s.diffStats);

export const useStoreDiffGitHubComments = () =>
  useWorkspaceDiffSelector((s) => s.gitHubComments);

export const useIsGitHubCommentsLoading = () =>
  useWorkspaceDiffSelector((s) => s.isGitHubCommentsLoading);

export const useShowGitHubComments = () =>
  useWorkspaceDiffSelector((s) => s.showGitHubComments);

export const useSetShowGitHubComments = () =>
  useWorkspaceDiffSelector((s) => s.setShowGitHubComments);

export const useGetGitHubCommentsForFile = () =>
  useWorkspaceDiffSelector((s) => s.getGitHubCommentsForFile);

export const useGetGitHubCommentCountForFile = () =>
  useWorkspaceDiffSelector((s) => s.getGitHubCommentCountForFile);

export const useGetFilesWithGitHubComments = () =>
  useWorkspaceDiffSelector((s) => s.getFilesWithGitHubComments);

export const useGetFirstCommentLineForFile = () =>
  useWorkspaceDiffSelector((s) => s.getFirstCommentLineForFile);
