import { ChatCircleDotsIcon } from '@phosphor-icons/react';

import { cn } from '../lib/cn';

interface ChatEmptyStateProps {
  title: string;
  description?: string;
  className?: string;
}

export function ChatEmptyState({
  title,
  description,
  className,
}: ChatEmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-2 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full border border-divider/70 bg-content1 text-default-500">
        <ChatCircleDotsIcon className="size-6" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="text-sm text-default-500">{description}</p>
      ) : null}
    </div>
  );
}
