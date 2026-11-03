import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FileDiff } from '@pierre/diffs/react';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  OnDiffLineClickProps,
} from '@pierre/diffs';
import { IconFileDiff, IconFileMinus, IconFilePlus } from '@tabler/icons-react';
import { Button, Textarea } from '@heroui/react';
import { useModule } from '../hooks/useModule';
import { useThemeMode } from '../hooks/useThemeMode';
import { PIERRE_DIFFS_THEME_CSS } from '@vibe/ui/styles/pierreDiffTheme';
import { hasRenderableDiff, parseRepoPatch } from '../lib/diffPatch';
import {
  formatReviewCommentsMarkdown,
  isCommentForComparison,
  type DiffCommentMarkdownInput,
} from '../lib/diffComments';

type DiffRepo = {
  name: string;
  path: string;
  relativePath: string;
  branch: string | null;
  targetBranch: string | null;
  baseRef: string | null;
  headRef: string;
  compareMode: DiffCompareMode;
  commits: Array<{
    sha: string;
    subject: string;
    createdAt: string;
    linesAdded: number;
    linesRemoved: number;
  }>;
  files: Array<{ path: string; status: string }>;
  patch: string;
  error?: string;
};

type DiffCompareMode =
  | { type: 'branch' }
  | { type: 'commit'; headRef: string }
  | { type: 'range'; baseRef: string; headRef?: string };

type DiffResponse = {
  workspaceDir: string;
  repos: DiffRepo[];
};

type DraftComment = DiffCommentMarkdownInput & {
  lineNumber: string;
};

interface DiffViewProps {
  workspaceId: string;
  workspaceDir: string;
}

export function createDiffLoadGuard() {
  let latestRequestId = 0;
  return {
    nextRequestId: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate: () => {
      latestRequestId += 1;
    },
    isCurrent: (requestId: number) => requestId === latestRequestId,
  };
}

export function DiffView(props: DiffViewProps) {
  return (
    <WorkspaceDiffView
      key={JSON.stringify([props.workspaceId, props.workspaceDir])}
      {...props}
    />
  );
}

function WorkspaceDiffView({ workspaceId, workspaceDir }: DiffViewProps) {
  const gitDiffModule = useModule('GitDiff');
  const loadGuardRef = useRef<ReturnType<typeof createDiffLoadGuard> | null>(
    null,
  );
  if (!loadGuardRef.current) {
    loadGuardRef.current = createDiffLoadGuard();
  }
  const loadGuard = loadGuardRef.current;
  const [data, setData] = useState<DiffResponse | null>(null);
  const [selectedRepoRelativePath, setSelectedRepoRelativePath] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [draftComment, setDraftComment] = useState<DraftComment | null>(null);
  const [queuedComments, setQueuedComments] = useState<DraftComment[]>([]);
  const [compareModes, setCompareModes] = useState<
    Record<string, DiffCompareMode>
  >({});
  const [commitMenuSha, setCommitMenuSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualCopyMarkdown, setManualCopyMarkdown] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const requestId = loadGuard.nextRequestId();
    setLoading(true);
    setError(null);
    try {
      const diffData = await gitDiffModule.actions.loadDiff({
        workspaceId,
        workspaceDir,
        compareModes,
      });
      if (!loadGuard.isCurrent(requestId)) return;
      setData(diffData);
      const firstRepoWithPatch = diffData.repos.find((repo) => repo.patch);
      setSelectedRepoRelativePath(
        (current) =>
          current ||
          firstRepoWithPatch?.relativePath ||
          diffData.repos[0]?.relativePath ||
          '',
      );
      setSelectedFilePath(
        (current) => current || firstRepoWithPatch?.files[0]?.path || '',
      );
    } catch (err) {
      if (!loadGuard.isCurrent(requestId)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (loadGuard.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [
    compareModes,
    gitDiffModule.actions,
    loadGuard,
    workspaceDir,
    workspaceId,
  ]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGuard.invalidate();
    };
  }, [loadGuard, refresh]);

  const selectedRepo = useMemo(
    () =>
      data?.repos.find(
        (repo) => repo.relativePath === selectedRepoRelativePath,
      ) ?? data?.repos[0],
    [data?.repos, selectedRepoRelativePath],
  );

  const selectedRepoFiles = selectedRepo?.files ?? [];
  const selectedCompareMode = selectedRepo
    ? (compareModes[selectedRepo.relativePath] ?? ({ type: 'branch' } as const))
    : ({ type: 'branch' } as const);
  const parsedRepoPatch = useMemo(
    () =>
      selectedRepo?.patch
        ? parseRepoPatch(selectedRepo.patch, selectedRepo.relativePath)
        : { files: [], error: null },
    [selectedRepo?.patch, selectedRepo?.relativePath],
  );

  useEffect(() => {
    if (!selectedRepo) return;
    if (
      selectedFilePath &&
      selectedRepoFiles.some((file) => file.path === selectedFilePath)
    )
      return;
    setSelectedFilePath(selectedRepoFiles[0]?.path || '');
  }, [selectedFilePath, selectedRepo, selectedRepoFiles]);

  const setRepoCompareMode = useCallback(
    (repoRelativePath: string, mode: DiffCompareMode) => {
      setCompareModes((current) => ({ ...current, [repoRelativePath]: mode }));
      setDraftComment(null);
      setCommitMenuSha(null);
    },
    [],
  );

  const showAllBranchChanges = useCallback(() => {
    if (!selectedRepo) return;
    setRepoCompareMode(selectedRepo.relativePath, { type: 'branch' });
  }, [selectedRepo, setRepoCompareMode]);

  const selectTimelineCommit = useCallback(
    (commitSha: string) => {
      if (!selectedRepo) return;
      setRepoCompareMode(selectedRepo.relativePath, {
        type: 'commit',
        headRef: commitSha,
      });
    },
    [selectedRepo, setRepoCompareMode],
  );

  const compareWithTimelineCommit = useCallback(
    (commitSha: string) => {
      if (!selectedRepo) return;
      const currentMode =
        compareModes[selectedRepo.relativePath] ??
        ({ type: 'branch' } as const);
      setRepoCompareMode(selectedRepo.relativePath, {
        type: 'range',
        baseRef: commitSha,
        ...(currentMode.type === 'commit' || currentMode.type === 'range'
          ? { headRef: currentMode.headRef }
          : {}),
      });
    },
    [compareModes, selectedRepo, setRepoCompareMode],
  );

  const clearCompareBase = useCallback(() => {
    if (!selectedRepo || selectedCompareMode.type !== 'range') return;
    setRepoCompareMode(
      selectedRepo.relativePath,
      selectedCompareMode.headRef
        ? { type: 'commit', headRef: selectedCompareMode.headRef }
        : { type: 'branch' },
    );
  }, [selectedCompareMode, selectedRepo, setRepoCompareMode]);

  const focusFile = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
    window.setTimeout(() => {
      document
        .getElementById(diffFileElementId(filePath))
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }, []);

  const addQueuedComment = (comment: DraftComment) => {
    const body = comment.body.trim();
    if (!comment.repoRelativePath || !comment.filePath || !body) return;
    setQueuedComments((current) => [...current, { ...comment, body }]);
    setDraftComment(null);
    setSuccess(null);
    setManualCopyMarkdown(null);
  };

  const stageLineComment = useCallback(
    (fileDiff: FileDiffMetadata, line: OnDiffLineClickProps) => {
      if (!selectedRepo || loading) return;
      const nextFilePath = fileDiff.name;
      setSelectedFilePath(nextFilePath);
      setDraftComment({
        repoRelativePath: selectedRepo.relativePath,
        baseRef: selectedRepo.baseRef,
        headRef: selectedRepo.headRef,
        filePath: nextFilePath,
        lineNumber: String(line.lineNumber),
        body: '',
        codeLine: line.lineElement.textContent?.trim() || null,
        side: line.annotationSide,
      });
      setSuccess(null);
      setManualCopyMarkdown(null);
    },
    [selectedRepo, loading],
  );

  const copyCommentsToClipboard = async () => {
    if (queuedComments.length === 0) return;
    setCopying(true);
    setError(null);
    setSuccess(null);
    setManualCopyMarkdown(null);
    const commentsToCopy = queuedComments;
    const markdown = formatReviewCommentsMarkdown(commentsToCopy);
    try {
      await navigator.clipboard.writeText(markdown);
      const copiedCount = commentsToCopy.length;
      setQueuedComments((current) =>
        current.filter((comment) => !commentsToCopy.includes(comment)),
      );
      setSuccess(
        `${copiedCount} review comment${copiedCount === 1 ? '' : 's'} copied to clipboard.`,
      );
    } catch (err) {
      setManualCopyMarkdown(markdown);
      setError(
        `Clipboard copy failed. Use the manual copy box below. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setCopying(false);
    }
  };

  if (!workspaceId || !workspaceDir) {
    return (
      <DiffShell>
        <EmptyState title="Diff view is missing workspace metadata" />
      </DiffShell>
    );
  }

  return (
    <DiffShell>
      <div className="border-b border-divider bg-background/95 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Diff</h1>
            <p className="text-xs text-default-500">{workspaceDir}</p>
          </div>
          <Button
            size="sm"
            variant="flat"
            onPress={refresh}
            isLoading={loading}
          >
            Refresh
          </Button>
          <a
            href={`/workspaces/${encodeURIComponent(workspaceId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm px-2 py-1 text-xs text-primary underline underline-offset-4 hover:bg-content2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Open VK workspace
          </a>
          {selectedRepo && (
            <CompareSummary
              mode={selectedCompareMode}
              selectedRepo={selectedRepo}
              onClearCompareBase={clearCompareBase}
            />
          )}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {success && <p className="mt-2 text-xs text-success">{success}</p>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 overflow-auto border-r border-divider bg-background p-3">
          {data?.repos.map((repo) => (
            <button
              key={repo.path}
              className={`mb-2 block w-full rounded-lg border p-3 text-left text-xs transition ${
                selectedRepo?.path === repo.path
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-divider bg-content1 text-default-600 hover:border-default-400'
              }`}
              onClick={() => setSelectedRepoRelativePath(repo.relativePath)}
            >
              <div className="font-medium">{repo.relativePath}</div>
              <div className="mt-1 text-default-500">
                {repo.branch || 'unknown'} →{' '}
                {repo.targetBranch || repo.baseRef || 'base'}
              </div>
              <div className="mt-1 truncate text-default-500">
                showing{' '}
                {repo.headRef === 'HEAD' ? 'HEAD' : repo.headRef.slice(0, 8)}
              </div>
              <div className="mt-1 text-default-500">
                {repo.files.length} file{repo.files.length === 1 ? '' : 's'},{' '}
                {repo.commits.length} commit
                {repo.commits.length === 1 ? '' : 's'}
              </div>
            </button>
          ))}
          {!loading && data?.repos.length === 0 && (
            <EmptyState title="No git repositories found" />
          )}
        </aside>

        <main className="min-h-0 overflow-auto bg-background p-4">
          {loading ? (
            <EmptyState title="Loading diffs…" />
          ) : selectedRepo?.error ? (
            <EmptyState
              title="Could not load repo diff"
              detail={selectedRepo.error}
            />
          ) : selectedRepo?.patch ? (
            <RepoPatchDiff
              parsedPatch={parsedRepoPatch}
              selectedFilePath={selectedFilePath}
              queuedComments={queuedComments.filter((comment) =>
                isCommentForComparison(comment, {
                  repoRelativePath: selectedRepo.relativePath,
                  baseRef: selectedRepo.baseRef,
                  headRef: selectedRepo.headRef,
                }),
              )}
              draftComment={
                draftComment &&
                isCommentForComparison(draftComment, {
                  repoRelativePath: selectedRepo.relativePath,
                  baseRef: selectedRepo.baseRef,
                  headRef: selectedRepo.headRef,
                })
                  ? draftComment
                  : null
              }
              onDraftCommentChange={setDraftComment}
              onSubmitDraftComment={addQueuedComment}
              onCancelDraftComment={() => setDraftComment(null)}
              onRemoveQueuedComment={(comment) =>
                setQueuedComments((current) =>
                  current.filter((item) => item !== comment),
                )
              }
              onLineNumberClick={stageLineComment}
            />
          ) : (
            <EmptyState title="No committed branch changes found" />
          )}
        </main>

        <aside className="min-h-0 overflow-auto border-l border-divider bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Commit history
              </h2>
              <p className="text-xs text-default-500">
                {queuedComments.length} queued comment
                {queuedComments.length === 1 ? '' : 's'}
              </p>
            </div>
            <Button
              size="sm"
              color="primary"
              onPress={copyCommentsToClipboard}
              isLoading={copying}
              isDisabled={queuedComments.length === 0}
            >
              Copy
            </Button>
          </div>
          <FileTree
            files={selectedRepo?.files ?? []}
            parsedFiles={parsedRepoPatch.files}
            selectedFilePath={selectedFilePath}
            onSelectFile={focusFile}
          />
          {manualCopyMarkdown && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2">
              <p className="text-xs text-warning-700">
                Clipboard access failed. Select and copy this markdown manually.
              </p>
              <Textarea
                aria-label="Review comments markdown"
                className="mt-2"
                minRows={8}
                value={manualCopyMarkdown}
                readOnly
              />
            </div>
          )}
          <CommitTimeline
            commits={selectedRepo?.commits ?? []}
            selectedCompareMode={selectedCompareMode}
            menuSha={commitMenuSha}
            onToggleMenu={(sha) =>
              setCommitMenuSha((current) => (current === sha ? null : sha))
            }
            onShowAllBranchChanges={showAllBranchChanges}
            onSelectCommit={selectTimelineCommit}
            onCompareWithCommit={compareWithTimelineCommit}
          />
        </aside>
      </div>
    </DiffShell>
  );
}

function DiffShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-center">
      <div className="max-w-md px-6">
        <p className="text-sm font-medium text-default-600">{title}</p>
        {detail && <p className="mt-2 text-xs text-default-500">{detail}</p>}
      </div>
    </div>
  );
}

function RepoPatchDiff({
  parsedPatch,
  selectedFilePath,
  queuedComments,
  draftComment,
  onDraftCommentChange,
  onSubmitDraftComment,
  onCancelDraftComment,
  onRemoveQueuedComment,
  onLineNumberClick,
}: {
  parsedPatch: ReturnType<typeof parseRepoPatch>;
  selectedFilePath: string;
  queuedComments: DraftComment[];
  draftComment: DraftComment | null;
  onDraftCommentChange: (comment: DraftComment | null) => void;
  onSubmitDraftComment: (comment: DraftComment) => void;
  onCancelDraftComment: () => void;
  onRemoveQueuedComment: (comment: DraftComment) => void;
  onLineNumberClick: (
    fileDiff: FileDiffMetadata,
    line: OnDiffLineClickProps,
  ) => void;
}) {
  const themeMode = useThemeMode();
  const [openFilePaths, setOpenFilePaths] = useState<Set<string>>(
    () => new Set(selectedFilePath ? [selectedFilePath] : []),
  );

  useEffect(() => {
    if (!selectedFilePath) return;
    setOpenFilePaths((current) => {
      if (current.has(selectedFilePath)) return current;
      const next = new Set(current);
      next.add(selectedFilePath);
      return next;
    });
  }, [selectedFilePath]);

  if (parsedPatch.error) {
    return (
      <EmptyState
        title="Could not parse repo diff"
        detail={parsedPatch.error}
      />
    );
  }

  if (parsedPatch.files.length === 0) {
    return <EmptyState title="No file diffs found in patch" />;
  }

  return (
    <div className="space-y-4">
      {parsedPatch.files.map((fileDiff, index) => {
        const isOpen = openFilePaths.has(fileDiff.name);
        return (
          <details
            id={diffFileElementId(fileDiff.name)}
            key={`${fileDiff.name}-${fileDiff.prevName || ''}-${index}`}
            open={isOpen}
            onToggle={(event) => {
              const isFileOpen = event.currentTarget.open;
              setOpenFilePaths((current) => {
                if (isFileOpen === current.has(fileDiff.name)) {
                  return current;
                }
                const next = new Set(current);
                if (isFileOpen) {
                  next.add(fileDiff.name);
                } else {
                  next.delete(fileDiff.name);
                }
                return next;
              });
            }}
            className={`rounded-lg border ${
              selectedFilePath === fileDiff.name
                ? 'border-primary/70'
                : 'border-divider'
            } bg-content1/40`}
          >
            <summary className="cursor-pointer list-none px-3 py-2 font-mono text-xs text-foreground hover:bg-content2">
              <div className="flex items-center gap-2">
                <span className="text-default-500">{isOpen ? '▾' : '▸'}</span>
                <FileChangeIcon fileDiff={fileDiff} />
                <span className="min-w-0 flex-1 truncate">
                  {fileDiff.prevName && fileDiff.prevName !== fileDiff.name
                    ? `${fileDiff.prevName} → ${fileDiff.name}`
                    : fileDiff.name}
                </span>
                <FileDiffStats fileDiff={fileDiff} />
              </div>
            </summary>
            {isOpen && (
              <div className="border-t border-divider bg-content1">
                {hasRenderableDiff(fileDiff) ? (
                  <FileDiff
                    fileDiff={fileDiff}
                    lineAnnotations={lineAnnotationsForFile(
                      fileDiff,
                      queuedComments,
                      draftComment,
                    )}
                    renderAnnotation={(annotation) => {
                      const metadata = annotation.metadata;
                      if (!metadata) return null;
                      if (metadata.kind === 'draft') {
                        return (
                          <InlineCommentEditor
                            comment={metadata.comment}
                            onChange={(body) =>
                              onDraftCommentChange({
                                ...metadata.comment,
                                body,
                              })
                            }
                            onSubmit={() =>
                              onSubmitDraftComment(metadata.comment)
                            }
                            onCancel={onCancelDraftComment}
                          />
                        );
                      }
                      return (
                        <InlineQueuedComment
                          comment={metadata.comment}
                          onRemove={() =>
                            onRemoveQueuedComment(metadata.comment)
                          }
                        />
                      );
                    }}
                    options={{
                      diffStyle: 'split',
                      themeType: themeMode,
                      theme: { dark: 'github-dark', light: 'github-light' },
                      unsafeCSS: PIERRE_DIFFS_THEME_CSS,
                      overflow: 'wrap',
                      hunkSeparators: 'line-info-basic',
                      disableFileHeader: true,
                      lineHoverHighlight: 'both',
                      onLineNumberClick: (line) => {
                        onLineNumberClick(fileDiff, line);
                      },
                    }}
                  />
                ) : (
                  <NonRenderableFileDiff fileDiff={fileDiff} />
                )}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

type InlineAnnotationMetadata =
  | { kind: 'queued'; comment: DraftComment }
  | { kind: 'draft'; comment: DraftComment };

function FileChangeIcon({ fileDiff }: { fileDiff: FileDiffMetadata }) {
  if (fileDiff.type === 'new') {
    return (
      <IconFilePlus
        aria-label="Added file"
        className="h-4 w-4 shrink-0 text-success"
      />
    );
  }

  if (fileDiff.type === 'deleted') {
    return (
      <IconFileMinus
        aria-label="Deleted file"
        className="h-4 w-4 shrink-0 text-danger"
      />
    );
  }

  return (
    <IconFileDiff
      aria-label="Modified file"
      className="h-4 w-4 shrink-0 text-warning"
    />
  );
}

function FileDiffStats({ fileDiff }: { fileDiff: FileDiffMetadata }) {
  const { additions, deletions } = getFileLineStats(fileDiff);
  return (
    <span className="ml-auto flex shrink-0 gap-2 font-mono text-xs">
      <span className="text-success">+{additions}</span>
      <span className="text-danger">-{deletions}</span>
    </span>
  );
}

function getFileLineStats(fileDiff: FileDiffMetadata): {
  additions: number;
  deletions: number;
} {
  return fileDiff.hunks.reduce(
    (totals, hunk) => ({
      additions: totals.additions + hunk.additionLines,
      deletions: totals.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );
}

function lineAnnotationsForFile(
  fileDiff: FileDiffMetadata,
  queuedComments: DraftComment[],
  draftComment: DraftComment | null,
): DiffLineAnnotation<InlineAnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<InlineAnnotationMetadata>[] =
    queuedComments
      .filter((comment) => comment.filePath === fileDiff.name)
      .map((comment) => ({
        side: comment.side ?? 'additions',
        lineNumber: Number.parseInt(comment.lineNumber, 10) || 1,
        metadata: { kind: 'queued' as const, comment },
      }));

  if (draftComment?.filePath === fileDiff.name) {
    annotations.push({
      side: draftComment.side ?? 'additions',
      lineNumber: Number.parseInt(draftComment.lineNumber, 10) || 1,
      metadata: { kind: 'draft', comment: draftComment },
    });
  }

  return annotations;
}

function InlineCommentEditor({
  comment,
  onChange,
  onSubmit,
  onCancel,
}: {
  comment: DraftComment;
  onChange: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded border border-primary/40 bg-content1 p-3 text-xs">
      <div className="mb-2 font-mono text-default-500">
        {comment.filePath}:{comment.lineNumber}
      </div>
      <Textarea
        aria-label="Inline review comment"
        minRows={3}
        value={comment.body}
        onChange={(event) => onChange(event.target.value)}
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="flat" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          color="primary"
          onPress={onSubmit}
          isDisabled={!comment.body.trim()}
        >
          Add comment
        </Button>
      </div>
    </div>
  );
}

function InlineQueuedComment({
  comment,
  onRemove,
}: {
  comment: DraftComment;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
      <div>{comment.body}</div>
      <button
        className="mt-2 text-danger hover:text-danger-600"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function CompareSummary({
  mode,
  selectedRepo,
  onClearCompareBase,
}: {
  mode: DiffCompareMode;
  selectedRepo: DiffRepo;
  onClearCompareBase: () => void;
}) {
  const label =
    mode.type === 'branch'
      ? `All changes on ${selectedRepo.branch || 'branch'}`
      : mode.type === 'commit'
        ? `Commit ${shortRef(mode.headRef)} only`
        : `${shortRef(mode.headRef || selectedRepo.headRef)} vs ${shortRef(mode.baseRef)}`;

  return (
    <div className="flex items-center gap-2 rounded-full border border-divider bg-content1 px-3 py-1 text-xs text-default-600">
      <span>{label}</span>
      {mode.type === 'range' && (
        <button
          className="text-primary hover:text-primary-600"
          onClick={onClearCompareBase}
          type="button"
        >
          Clear compare
        </button>
      )}
    </div>
  );
}

function FileTree({
  files,
  parsedFiles,
  selectedFilePath,
  onSelectFile,
}: {
  files: DiffRepo['files'];
  parsedFiles: FileDiffMetadata[];
  selectedFilePath: string;
  onSelectFile: (filePath: string) => void;
}) {
  const fileEntries = parsedFiles.length
    ? parsedFiles.map((file) => ({ path: file.name, status: file.type }))
    : files;

  return (
    <div className="mt-4 rounded-lg border border-divider bg-content1 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-default-500">
        Changed files
      </h3>
      {fileEntries.length === 0 ? (
        <p className="mt-2 text-xs text-default-500">No files changed.</p>
      ) : (
        <div role="tree" className="mt-2 space-y-1 text-xs">
          {fileEntries.map((file) => (
            <button
              key={file.path}
              role="treeitem"
              className={`block w-full rounded px-2 py-1 text-left font-mono transition ${
                selectedFilePath === file.path
                  ? 'bg-primary/20 text-primary'
                  : 'text-default-600 hover:bg-content2'
              }`}
              onClick={() => onSelectFile(file.path)}
              type="button"
            >
              <span className="mr-2 text-default-500">{file.status}</span>
              {file.path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitTimeline({
  commits,
  selectedCompareMode,
  menuSha,
  onToggleMenu,
  onShowAllBranchChanges,
  onSelectCommit,
  onCompareWithCommit,
}: {
  commits: DiffRepo['commits'];
  selectedCompareMode: DiffCompareMode;
  menuSha: string | null;
  onToggleMenu: (sha: string) => void;
  onShowAllBranchChanges: () => void;
  onSelectCommit: (sha: string) => void;
  onCompareWithCommit: (sha: string) => void;
}) {
  if (commits.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-divider bg-content1 p-3 text-xs text-default-500">
        No commits found for this comparison.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <Button
        size="sm"
        variant="flat"
        className="mb-4 w-full"
        onPress={onShowAllBranchChanges}
      >
        Show all changes on this branch
      </Button>
      <ol className="space-y-0">
        {commits.map((commit, index) => {
          const isSelectedHead =
            (selectedCompareMode.type === 'commit' &&
              selectedCompareMode.headRef === commit.sha) ||
            (selectedCompareMode.type === 'range' &&
              selectedCompareMode.headRef === commit.sha);
          const isCompareBase =
            selectedCompareMode.type === 'range' &&
            selectedCompareMode.baseRef === commit.sha;

          return (
            <li
              key={commit.sha}
              className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
            >
              <div className="relative flex justify-center">
                <span
                  className={`mt-1 h-3 w-3 rounded-full border ${
                    isSelectedHead || isCompareBase
                      ? 'border-primary bg-primary/60'
                      : 'border-primary/70 bg-primary'
                  }`}
                />
                {index < commits.length - 1 && (
                  <span className="absolute top-5 bottom-0 w-px bg-divider" />
                )}
              </div>
              <article
                className={`relative min-w-0 rounded-lg border p-3 text-xs ${
                  isSelectedHead || isCompareBase
                    ? 'border-primary/70 bg-primary/10'
                    : 'border-divider bg-content1'
                }`}
              >
                <button
                  className="block min-w-0 text-left"
                  onClick={() => onSelectCommit(commit.sha)}
                  type="button"
                >
                  <div className="font-mono text-primary">
                    {commit.sha.slice(0, 8)}
                  </div>
                  <h3 className="mt-1 truncate font-medium text-foreground">
                    {commit.subject}
                  </h3>
                  <time
                    className="mt-1 block text-default-500"
                    dateTime={commit.createdAt}
                  >
                    {formatCommitTime(commit.createdAt)}
                  </time>
                  <div className="mt-2 flex gap-3 font-mono">
                    <span className="text-success">+{commit.linesAdded}</span>
                    <span className="text-danger">-{commit.linesRemoved}</span>
                  </div>
                </button>
                <button
                  aria-label={`Open actions for ${commit.sha.slice(0, 8)}`}
                  className="absolute right-2 top-2 rounded px-2 py-1 text-default-500 hover:bg-content2 hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleMenu(commit.sha);
                  }}
                  type="button"
                >
                  ⋯
                </button>
                {menuSha === commit.sha && (
                  <div className="absolute right-2 top-9 z-20 rounded-lg border border-divider bg-content1 p-1 shadow-xl">
                    <button
                      className="whitespace-nowrap rounded px-3 py-2 text-left text-xs text-foreground hover:bg-content2"
                      onClick={() => onCompareWithCommit(commit.sha)}
                      type="button"
                    >
                      Compare with this commit
                    </button>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function shortRef(ref: string): string {
  return ref === 'HEAD' ? 'HEAD' : ref.slice(0, 8);
}

function diffFileElementId(filePath: string): string {
  return `diff-file-${encodeURIComponent(filePath).replaceAll('%', '_')}`;
}

function formatCommitTime(value: string): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function NonRenderableFileDiff({
  fileDiff,
}: {
  fileDiff: { name: string; prevName?: string; type: string };
}) {
  return (
    <div className="rounded-lg border border-divider bg-content1 p-3 text-xs text-default-600">
      <div className="font-mono text-foreground">
        {fileDiff.prevName && fileDiff.prevName !== fileDiff.name
          ? `${fileDiff.prevName} → ${fileDiff.name}`
          : fileDiff.name}
      </div>
      <div className="mt-1 text-default-500">
        {fileDiff.type === 'rename-pure'
          ? 'Renamed with no textual changes.'
          : 'No textual diff is available for this file.'}
      </div>
    </div>
  );
}
