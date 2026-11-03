import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from './Popover';

export function ComposerDiffSummary({
  filesChanged,
  linesAdded,
  linesRemoved,
  hasConflicts,
  conflictedFilesCount,
  onResolveConflicts,
  onViewCode,
}: {
  filesChanged: number;
  linesAdded?: number;
  linesRemoved?: number;
  hasConflicts?: boolean;
  conflictedFilesCount?: number;
  onResolveConflicts?: () => void;
  onViewCode?: () => void;
}) {
  const { t } = useTranslation(['common', 'tasks']);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('common:composer.diffSummary')}
          className="flex min-h-11 min-w-0 items-center gap-half rounded-sm text-sm text-foreground"
        >
          {hasConflicts && (
            <WarningIcon className="size-icon-sm shrink-0 text-warning" />
          )}
          <span className="truncate">
            {t('common:composer.files', { count: filesChanged })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={t('common:composer.diffSummary')}>
        <h2 className="mb-base text-base font-medium">
          {t('common:composer.diffSummary')}
        </h2>
        <div className="flex flex-wrap items-center gap-base text-sm">
          <span>{t('tasks:diff.filesChanged', { count: filesChanged })}</span>
          {linesAdded !== undefined && (
            <span className="text-success">
              {t('common:composer.linesAdded', { count: linesAdded })}
            </span>
          )}
          {linesRemoved !== undefined && (
            <span className="text-danger">
              {t('common:composer.linesRemoved', { count: linesRemoved })}
            </span>
          )}
        </div>
        {hasConflicts && (
          <PopoverClose asChild>
            <button
              type="button"
              onClick={onResolveConflicts}
              className="mt-base flex items-center gap-half text-sm text-warning"
            >
              <WarningIcon className="size-icon-sm" />
              {t('tasks:conversation.approval.conflicts', {
                count: conflictedFilesCount,
              })}
            </button>
          </PopoverClose>
        )}
        {onViewCode && (
          <PopoverClose asChild>
            <button
              type="button"
              onClick={onViewCode}
              className="mt-base rounded-sm bg-content2 px-base py-half text-sm"
            >
              {t('common:composer.viewChanges')}
            </button>
          </PopoverClose>
        )}
      </PopoverContent>
    </Popover>
  );
}
