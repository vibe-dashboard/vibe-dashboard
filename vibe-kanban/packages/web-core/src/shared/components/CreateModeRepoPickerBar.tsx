import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClockCounterClockwiseIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Repo } from 'shared/types';
import type { BranchItem, RepoItem } from '@/shared/types/selectionItems';
import { repoApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { useCreateMode } from '@/features/create-mode/model/useCreateMode';
import { FolderPickerDialog } from '@/shared/dialogs/shared/FolderPickerDialog';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { Checkbox } from '@vibe/ui/components/Checkbox';
import { CreateRepoDialog } from '@vibe/ui/components/CreateRepoDialog';
import {
  SelectionDialog,
  type SelectionPage,
} from '@/shared/dialogs/command-bar/SelectionDialog';
import {
  buildRepoSelectionPages,
  type RepoSelectionResult,
} from '@/shared/dialogs/command-bar/selections/repoSelection';
import {
  buildBranchSelectionPages,
  type BranchSelectionResult,
} from '@/shared/dialogs/command-bar/selections/branchSelection';

function toRepoItem(repo: Repo): RepoItem {
  return {
    id: repo.id,
    display_name: repo.display_name || repo.name,
  };
}

function toBranchItem(branch: {
  name: string;
  is_current: boolean;
}): BranchItem {
  return {
    name: branch.name,
    isCurrent: branch.is_current,
  };
}

function chooseDefaultTargetBranch(
  branches: Array<{ name: string }>,
  repo: Repo
) {
  if (
    repo.default_target_branch &&
    branches.some((b) => b.name === repo.default_target_branch)
  ) {
    return repo.default_target_branch;
  }
  if (branches.some((b) => b.name === 'origin/main')) {
    return 'origin/main';
  }
  if (branches.some((b) => b.name === 'main')) {
    return 'main';
  }
  return branches[0]?.name ?? null;
}

function safeLocalCheckoutBranches(
  branches: Array<{ name: string; is_current: boolean; is_remote?: boolean }>,
  targetBranch: string | null
) {
  const targetIsRemote = branches.some(
    (branch) => branch.name === targetBranch && branch.is_remote
  );

  return branches.filter(
    (branch) =>
      !branch.is_remote &&
      !branch.is_current &&
      (!targetBranch ||
        !isSelfTargetingBranch(branch.name, targetBranch, targetIsRemote))
  );
}

function isSelfTargetingBranch(
  sourceBranch: string,
  targetBranch: string,
  targetIsRemote: boolean
) {
  return (
    sourceBranch === targetBranch ||
    (targetIsRemote &&
      targetBranch.split('/').slice(1).join('/') === sourceBranch)
  );
}

type PickedBranch = {
  name: string;
  isRemote: boolean;
};

function getRepoDisplayName(repo: Repo): string {
  return repo.display_name || repo.name;
}

type PendingAction = 'choose' | 'browse' | 'create' | 'branch' | null;

const inlineControlButtonClassName =
  'inline-flex items-center gap-half rounded-sm px-half py-half text-sm text-normal ' +
  'hover:text-high disabled:cursor-not-allowed disabled:opacity-50';

const recentInlineControlButtonClassName =
  'inline-flex items-center gap-half rounded-sm px-half py-half text-sm ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const repoRowButtonClassName =
  'inline-flex items-center gap-half text-sm text-low hover:text-high ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

interface CreateModeRepoPickerBarProps {
  onContinueToPrompt: () => void;
}

export function CreateModeRepoPickerBar({
  onContinueToPrompt,
}: CreateModeRepoPickerBarProps) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const {
    repos,
    targetBranches,
    checkoutBranches,
    createBranchByRepo,
    addRepo,
    removeRepo,
    setTargetBranch,
    setCheckoutBranch,
    setCreateBranch,
  } = useCreateMode();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [branchRepoId, setBranchRepoId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [setupHintDismissed, setSetupHintDismissed] = useState(false);
  const isBusy = pendingAction !== null;

  const hasUnconfiguredRepo = useMemo(
    () => repos.some((repo) => !repo.setup_script),
    [repos]
  );
  const showSetupHint = hasUnconfiguredRepo && !setupHintDismissed;

  const selectedRepoIds = useMemo(
    () => new Set(repos.map((repo) => repo.id)),
    [repos]
  );
  const allReposHaveRequiredBranches = useMemo(
    () =>
      repos.every((repo) => {
        const targetBranch = targetBranches[repo.id] ?? null;
        const checkoutBranch = checkoutBranches[repo.id] ?? null;
        const createBranch = createBranchByRepo[repo.id] ?? true;

        if (!targetBranch) return false;
        if (createBranch) return true;
        return !!checkoutBranch && checkoutBranch !== targetBranch;
      }),
    [checkoutBranches, createBranchByRepo, repos, targetBranches]
  );

  const pickBranchForRepo = useCallback(
    async (
      repo: Repo,
      options?: { checkoutOnly?: boolean; targetBranch?: string | null }
    ) => {
      const branches = await repoApi.getBranches(repo.id);
      const selectableBranches = options?.checkoutOnly
        ? safeLocalCheckoutBranches(branches, options.targetBranch ?? null)
        : branches;
      const branchItems = selectableBranches.map(toBranchItem);
      const branchResult = (await SelectionDialog.show({
        initialPageId: 'selectBranch',
        pages: buildBranchSelectionPages(
          branchItems,
          getRepoDisplayName(repo)
        ) as Record<string, SelectionPage>,
      })) as BranchSelectionResult | undefined;

      const branchName = branchResult?.branch;
      if (!branchName) return null;

      const selectedBranch = selectableBranches.find(
        (branch) => branch.name === branchName
      );

      return {
        name: branchName,
        isRemote: selectedBranch?.is_remote ?? false,
      } satisfies PickedBranch;
    },
    []
  );

  const runPickerAction = useCallback(
    async (
      action: Exclude<PendingAction, null>,
      run: () => Promise<void>,
      fallbackError: string
    ) => {
      setPickerError(null);
      setPendingAction(action);

      try {
        await run();
      } catch (error) {
        setPickerError(error instanceof Error ? error.message : fallbackError);
      } finally {
        setPendingAction(null);
        if (action === 'branch') {
          setBranchRepoId(null);
        }
      }
    },
    []
  );

  const addRepoWithBranchSelection = useCallback(
    async (repo: Repo) => {
      if (selectedRepoIds.has(repo.id)) {
        setPickerError('Repository is already selected');
        return false;
      }

      const branches = await repoApi.getBranches(repo.id);
      const selectedBranch = chooseDefaultTargetBranch(branches, repo);
      if (!selectedBranch) return false;

      addRepo(repo);
      setTargetBranch(repo.id, selectedBranch);
      return true;
    },
    [addRepo, selectedRepoIds, setTargetBranch]
  );

  const handleChooseRepo = useCallback(async () => {
    await runPickerAction(
      'choose',
      async () => {
        const allRepos = await repoApi.listRecent();
        const availableRepos = allRepos.filter(
          (repo) => !selectedRepoIds.has(repo.id)
        );

        if (availableRepos.length === 0) {
          setPickerError(
            'No recently used repositories found, please browse repositories instead'
          );
          return;
        }

        const repoResult = (await SelectionDialog.show({
          initialPageId: 'selectRepo',
          pages: buildRepoSelectionPages(
            availableRepos.map(toRepoItem)
          ) as Record<string, SelectionPage>,
        })) as RepoSelectionResult | undefined;

        if (!repoResult?.repoId) return;

        const selectedRepo = availableRepos.find(
          (repo) => repo.id === repoResult.repoId
        );
        if (!selectedRepo) return;

        await addRepoWithBranchSelection(selectedRepo);
      },
      'Failed to load repositories or branches'
    );
  }, [addRepoWithBranchSelection, runPickerAction, selectedRepoIds]);

  const handleBrowseRepo = useCallback(async () => {
    await runPickerAction(
      'browse',
      async () => {
        const selectedPath = await FolderPickerDialog.show({
          title: t('dialogs.selectGitRepository'),
          description: t('dialogs.chooseExistingRepo'),
        });
        if (!selectedPath) return;

        const repo = await repoApi.register({ path: selectedPath });
        queryClient.invalidateQueries({ queryKey: ['repos'] });
        await addRepoWithBranchSelection(repo);
      },
      'Failed to register repository'
    );
  }, [addRepoWithBranchSelection, runPickerAction, t]);

  const handleCreateRepo = useCallback(async () => {
    await runPickerAction(
      'create',
      async () => {
        await CreateRepoDialog.show({
          onBrowseForPath: async (currentPath) =>
            FolderPickerDialog.show({
              title: t('git.createRepo.browseDialog.title'),
              description: t('git.createRepo.browseDialog.description'),
              value: currentPath,
            }),
          onCreateRepo: async ({ parentPath, folderName }) => {
            const repo = await repoApi.init({
              parent_path: parentPath,
              folder_name: folderName,
            });
            queryClient.invalidateQueries({ queryKey: ['repos'] });
            await addRepoWithBranchSelection(repo);
          },
        });
      },
      'Failed to create repository'
    );
  }, [addRepoWithBranchSelection, runPickerAction, t]);

  const handleChangeBranch = useCallback(
    async (repo: Repo) => {
      setBranchRepoId(repo.id);
      await runPickerAction(
        'branch',
        async () => {
          const selectedBranch = await pickBranchForRepo(repo);
          if (!selectedBranch) return;
          setTargetBranch(repo.id, selectedBranch.name);
          const checkoutBranch = checkoutBranches[repo.id];
          if (
            checkoutBranch &&
            isSelfTargetingBranch(
              checkoutBranch,
              selectedBranch.name,
              selectedBranch.isRemote
            )
          ) {
            setCheckoutBranch(repo.id, null);
          }
        },
        'Failed to load branches'
      );
    },
    [
      checkoutBranches,
      pickBranchForRepo,
      runPickerAction,
      setCheckoutBranch,
      setTargetBranch,
    ]
  );

  const handleChangeCheckoutBranch = useCallback(
    async (repo: Repo) => {
      setBranchRepoId(repo.id);
      await runPickerAction(
        'branch',
        async () => {
          const selectedBranch = await pickBranchForRepo(repo, {
            checkoutOnly: true,
            targetBranch: targetBranches[repo.id] ?? null,
          });
          if (!selectedBranch) return;
          setCheckoutBranch(repo.id, selectedBranch.name);

          for (const otherRepo of repos) {
            if (otherRepo.id === repo.id) continue;
            if ((createBranchByRepo[otherRepo.id] ?? true) !== false) continue;
            const branches = await repoApi.getBranches(otherRepo.id);
            const safeMatch = safeLocalCheckoutBranches(
              branches,
              targetBranches[otherRepo.id] ?? null
            ).some((branch) => branch.name === selectedBranch.name);
            setCheckoutBranch(
              otherRepo.id,
              safeMatch ? selectedBranch.name : null
            );
          }
        },
        'Failed to load branches'
      );
    },
    [
      createBranchByRepo,
      pickBranchForRepo,
      repos,
      runPickerAction,
      setCheckoutBranch,
      targetBranches,
    ]
  );

  const handleToggleCreateBranch = useCallback(
    async (repo: Repo, checked: boolean | string) => {
      const createBranch = checked === true;
      setCreateBranch(repo.id, createBranch);
      if (createBranch) {
        setCheckoutBranch(repo.id, null);
        return;
      }

      const existingDirectBranch = repos
        .filter(
          (r) =>
            r.id !== repo.id && (createBranchByRepo[r.id] ?? true) === false
        )
        .map((r) => checkoutBranches[r.id])
        .find((branch): branch is string => !!branch);

      if (!existingDirectBranch) return;

      const branches = await repoApi.getBranches(repo.id);
      const safeMatch = safeLocalCheckoutBranches(
        branches,
        targetBranches[repo.id] ?? null
      ).some((branch) => branch.name === existingDirectBranch);
      setCheckoutBranch(repo.id, safeMatch ? existingDirectBranch : null);
    },
    [
      checkoutBranches,
      createBranchByRepo,
      repos,
      setCheckoutBranch,
      setCreateBranch,
      targetBranches,
    ]
  );

  return (
    <div className="w-chat max-w-full">
      <div className="px-plusfifty py-base">
        {repos.length > 0 && (
          <div>
            <div className="rounded-sm border border-border/60">
              {repos.map((repo, index) => {
                const repoDisplayName = getRepoDisplayName(repo);
                const createBranch = createBranchByRepo[repo.id] ?? true;
                const targetBranch = targetBranches[repo.id] ?? null;
                const checkoutBranch = checkoutBranches[repo.id] ?? null;
                const branch = createBranch
                  ? (targetBranch ?? 'Select target')
                  : (checkoutBranch ?? 'Select branch');
                const isChangingBranch =
                  pendingAction === 'branch' && branchRepoId === repo.id;

                return (
                  <div
                    key={repo.id}
                    className={cn(
                      'flex min-w-0 items-center gap-half px-base py-half',
                      index > 0 && 'border-t border-border/60'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-normal">
                      {repoDisplayName}
                    </span>
                    <span className="h-3 w-px shrink-0 bg-border/70" />
                    <button
                      type="button"
                      onClick={() =>
                        createBranch
                          ? handleChangeBranch(repo)
                          : handleChangeCheckoutBranch(repo)
                      }
                      disabled={isBusy}
                      className={repoRowButtonClassName}
                      title={
                        createBranch
                          ? 'Change target/base branch'
                          : 'Change checkout branch'
                      }
                    >
                      {isChangingBranch ? (
                        <SpinnerIcon className="size-icon-xs animate-spin" />
                      ) : (
                        <GitBranchIcon className="size-icon-xs" weight="bold" />
                      )}
                      <span className="max-w-[200px] truncate">{branch}</span>
                    </button>
                    <span className="h-3 w-px shrink-0 bg-border/70" />
                    <label
                      className={cn(
                        repoRowButtonClassName,
                        'cursor-pointer select-none'
                      )}
                      title={
                        createBranch
                          ? 'Create a new workspace branch from the selected branch'
                          : 'Use the selected branch directly for this workspace'
                      }
                    >
                      <Checkbox
                        checked={createBranch}
                        disabled={isBusy}
                        onCheckedChange={(checked) => {
                          void handleToggleCreateBranch(repo, checked);
                        }}
                        className="size-icon-xs"
                      />
                      <span>Create new branch</span>
                    </label>
                    {!createBranch && (
                      <>
                        <span className="h-3 w-px shrink-0 bg-border/70" />
                        <button
                          type="button"
                          onClick={() => handleChangeBranch(repo)}
                          disabled={isBusy}
                          className={repoRowButtonClassName}
                          title="Change target/base branch"
                        >
                          <GitBranchIcon
                            className="size-icon-xs"
                            weight="bold"
                          />
                          <span className="max-w-[200px] truncate">
                            Base: {targetBranch ?? 'Select target'}
                          </span>
                        </button>
                      </>
                    )}
                    <span className="h-3 w-px shrink-0 bg-border/70" />
                    <button
                      type="button"
                      onClick={() => removeRepo(repo.id)}
                      disabled={isBusy}
                      aria-label={`Remove ${repoDisplayName}`}
                      title={`Remove ${repoDisplayName}`}
                      className={cn(repoRowButtonClassName, 'hover:text-error')}
                    >
                      <XIcon className="size-icon-xs" weight="bold" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-base flex flex-wrap items-center gap-half">
          <button
            type="button"
            onClick={handleChooseRepo}
            disabled={isBusy}
            className={cn(
              recentInlineControlButtonClassName,
              repos.length > 0
                ? 'text-normal hover:text-high'
                : 'text-brand hover:text-brand-hover'
            )}
          >
            {pendingAction === 'choose' ? (
              <SpinnerIcon className="size-icon-xs animate-spin" />
            ) : (
              <ClockCounterClockwiseIcon
                className="size-icon-xs"
                weight="bold"
              />
            )}
            <span>{t('createMode.repoPicker.actions.recent')}</span>
          </button>
          <button
            type="button"
            onClick={handleBrowseRepo}
            disabled={isBusy}
            className={inlineControlButtonClassName}
          >
            {pendingAction === 'browse' ? (
              <SpinnerIcon className="size-icon-xs animate-spin" />
            ) : (
              <MagnifyingGlassIcon className="size-icon-xs" weight="bold" />
            )}
            <span>{t('createMode.repoPicker.actions.browse')}</span>
          </button>
          <button
            type="button"
            onClick={handleCreateRepo}
            disabled={isBusy}
            className={inlineControlButtonClassName}
          >
            {pendingAction === 'create' ? (
              <SpinnerIcon className="size-icon-xs animate-spin" />
            ) : (
              <PlusIcon className="size-icon-xs" weight="bold" />
            )}
            <span>{t('createMode.repoPicker.actions.create')}</span>
          </button>

          <div className="ml-auto">
            <PrimaryButton
              variant="default"
              value="Continue"
              onClick={onContinueToPrompt}
              disabled={
                isBusy || repos.length === 0 || !allReposHaveRequiredBranches
              }
            />
          </div>
        </div>
      </div>
      {showSetupHint && (
        <div className="mx-plusfifty mt-half flex items-start gap-half rounded-sm border border-brand/20 bg-brand/5 px-base py-base">
          <div className="flex-1">
            <p className="text-sm font-medium text-normal">
              {t('createMode.repoPicker.setupHintTitle')}
            </p>
            <p className="mt-quarter text-sm text-low">
              {t('createMode.repoPicker.setupHint')}
            </p>
            <button
              type="button"
              className="mt-quarter cursor-pointer text-sm font-medium text-brand underline hover:text-brand/80"
              onClick={() => {
                const unconfiguredRepo = repos.find(
                  (repo) => !repo.setup_script
                );
                SettingsDialog.show({
                  initialSection: 'repos',
                  initialState: { repoId: unconfiguredRepo?.id },
                });
              }}
            >
              {t('createMode.repoPicker.setupHintLink')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSetupHintDismissed(true)}
            className="shrink-0 text-low hover:text-normal"
            aria-label={t('createMode.repoPicker.setupHintDismiss')}
          >
            <XIcon className="size-icon-2xs" weight="bold" />
          </button>
        </div>
      )}
      {pickerError && (
        <div className="mt-half rounded-sm border border-error/30 bg-error/10 px-base py-half">
          <p className="text-xs text-error">{pickerError}</p>
        </div>
      )}
    </div>
  );
}
