import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  useUiPreferencesStore,
  RIGHT_MAIN_PANEL_MODES,
} from '@/shared/stores/useUiPreferencesStore';
import { useDiffPaths } from '@/shared/stores/useWorkspaceDiffStore';
import {
  ChangesViewContext,
  ChangesViewActionsContext,
  type ScrollToFileCallback,
} from '@/shared/hooks/useChangesView';
import { useFileInViewStore } from '@/shared/stores/useFileInViewStore';

interface ChangesViewProviderProps {
  workspaceId?: string;
  children: React.ReactNode;
}

interface SelectedScrollRequest {
  path: string;
  lineNumber?: number;
  key: string;
}

function getSelectedScrollRequestKey(
  path: string,
  lineNumber?: number
): string {
  return `${path}\u0000${lineNumber ?? ''}`;
}

export function ChangesViewProvider({
  workspaceId,
  children,
}: ChangesViewProviderProps) {
  const diffPaths = useDiffPaths();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedLineNumber, setSelectedLineNumber] = useState<number | null>(
    null
  );
  const setRightMainPanelMode = useUiPreferencesStore(
    (s) => s.setRightMainPanelMode
  );

  const scrollToFileCallbackRef = useRef<ScrollToFileCallback | null>(null);
  const selectedScrollRequestRef = useRef<SelectedScrollRequest | null>(null);
  const replayedScrollRequestKeyRef = useRef<string | null>(null);
  const isActiveRef = useRef(true);
  const diffPathsRef = useRef(diffPaths);
  diffPathsRef.current = diffPaths;

  useEffect(() => {
    isActiveRef.current = true;

    return () => {
      isActiveRef.current = false;
      scrollToFileCallbackRef.current = null;
      selectedScrollRequestRef.current = null;
      replayedScrollRequestKeyRef.current = null;
      useFileInViewStore.getState().setFileInView(null);
    };
  }, []);

  const rememberSelectedFile = useCallback(
    (path: string, lineNumber?: number) => {
      if (!isActiveRef.current) return;

      selectedScrollRequestRef.current = {
        path,
        lineNumber,
        key: getSelectedScrollRequestKey(path, lineNumber),
      };
      replayedScrollRequestKeyRef.current = null;
      setSelectedFilePath(path);
      setSelectedLineNumber(lineNumber ?? null);
      useFileInViewStore.getState().setFileInView(path);
    },
    []
  );

  const registerScrollToFile = useCallback(
    (callback: ScrollToFileCallback | null) => {
      if (!isActiveRef.current) return;

      scrollToFileCallbackRef.current = callback;

      if (!callback) return;

      const request = selectedScrollRequestRef.current;
      if (!request || replayedScrollRequestKeyRef.current === request.key) {
        return;
      }

      replayedScrollRequestKeyRef.current = request.key;
      callback(request.path, request.lineNumber);
    },
    []
  );

  const selectFile = useCallback(
    (path: string, lineNumber?: number) => {
      rememberSelectedFile(path, lineNumber);
    },
    [rememberSelectedFile]
  );

  const scrollToFile = useCallback(
    (path: string, lineNumber?: number) => {
      if (!isActiveRef.current) return;

      rememberSelectedFile(path, lineNumber);

      if (scrollToFileCallbackRef.current) {
        const request = selectedScrollRequestRef.current;
        if (request) {
          replayedScrollRequestKeyRef.current = request.key;
        }
        scrollToFileCallbackRef.current(path, lineNumber);
      }
    },
    [rememberSelectedFile]
  );

  const viewFileInChanges = useCallback(
    (filePath: string) => {
      if (!isActiveRef.current) return;

      rememberSelectedFile(filePath);
      if (workspaceId) {
        setRightMainPanelMode(RIGHT_MAIN_PANEL_MODES.CHANGES, workspaceId);
      }

      if (scrollToFileCallbackRef.current) {
        const request = selectedScrollRequestRef.current;
        if (request) {
          replayedScrollRequestKeyRef.current = request.key;
        }
        scrollToFileCallbackRef.current(filePath);
      }
    },
    [rememberSelectedFile, setRightMainPanelMode, workspaceId]
  );

  const findMatchingDiffPath = useCallback((text: string): string | null => {
    const currentDiffPaths = diffPathsRef.current;
    if (currentDiffPaths.has(text)) return text;
    for (const fullPath of currentDiffPaths) {
      if (fullPath.endsWith('/' + text)) {
        return fullPath;
      }
    }
    return null;
  }, []);

  const hasDiffPath = useCallback((path: string): boolean => {
    return diffPathsRef.current.has(path);
  }, []);

  const actionsValue = useMemo(
    () => ({ viewFileInChanges, findMatchingDiffPath, hasDiffPath }),
    [viewFileInChanges, findMatchingDiffPath, hasDiffPath]
  );

  const value = useMemo(
    () => ({
      selectedFilePath,
      selectedLineNumber,
      selectFile,
      scrollToFile,
      viewFileInChanges,
      diffPaths,
      findMatchingDiffPath,
      registerScrollToFile,
    }),
    [
      selectedFilePath,
      selectedLineNumber,
      selectFile,
      scrollToFile,
      viewFileInChanges,
      diffPaths,
      findMatchingDiffPath,
      registerScrollToFile,
    ]
  );

  return (
    <ChangesViewActionsContext.Provider value={actionsValue}>
      <ChangesViewContext.Provider value={value}>
        {children}
      </ChangesViewContext.Provider>
    </ChangesViewActionsContext.Provider>
  );
}
