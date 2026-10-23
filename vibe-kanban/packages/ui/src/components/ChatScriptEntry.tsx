import { useTranslation } from 'react-i18next';
import { TerminalIcon, WrenchIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { ToolStatusDot, type ToolStatusLike } from './ToolStatusDot';

interface ChatScriptEntryProps {
  title: string;
  command?: string;
  processId: string;
  exitCode?: number | null;
  className?: string;
  status: ToolStatusLike;
  onViewProcess: (processId: string) => void;
  onFix?: () => void;
}

export function ChatScriptEntry({
  title,
  command,
  processId,
  exitCode,
  className,
  status,
  onViewProcess,
  onFix,
}: ChatScriptEntryProps) {
  const { t } = useTranslation('tasks');
  const isRunning = status.status === 'created';
  const isSuccess = status.status === 'success';
  const isFailed = status.status === 'failed';

  const handleFixClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFix?.();
  };

  const handleClick = () => {
    onViewProcess(processId);
  };

  const getSubtitle = () => {
    if (isRunning) {
      return t('conversation.script.running');
    }
    if (isFailed && exitCode !== null && exitCode !== undefined) {
      return t('conversation.script.exitCode', { code: exitCode });
    }
    if (isSuccess) {
      return t('conversation.script.completedSuccessfully');
    }
    return t('conversation.script.clickToViewLogs');
  };

  return (
    <div
      className={cn(
        'flex items-start gap-base text-sm cursor-pointer hover:bg-content1/50 rounded-md -mx-half px-half py-half transition-colors',
        className
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <span className="relative shrink-0 pt-0.5">
        <TerminalIcon className="size-icon-base text-default-500" />
        <ToolStatusDot
          status={status}
          className="absolute -bottom-0.5 -left-0.5"
        />
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-foreground font-medium">{title}</span>
        {command && (
          <code className="text-default-500 text-xs font-mono truncate block">
            {command}
          </code>
        )}
        <span className="text-default-500 text-xs">{getSubtitle()}</span>
      </div>
      {isFailed && onFix && (
        <button
          type="button"
          onClick={handleFixClick}
          className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-primary hover:text-primary/80 hover:bg-content1 rounded transition-colors"
          title={t('scriptFixer.fixScript')}
        >
          <WrenchIcon className="size-icon-xs" />
          <span>{t('scriptFixer.fixScript')}</span>
        </button>
      )}
    </div>
  );
}
