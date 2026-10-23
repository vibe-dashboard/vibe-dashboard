import { cn } from '../lib/cn';
import type { Icon } from '@phosphor-icons/react';

interface IconButtonProps {
  icon: Icon;
  iconClassName?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'tertiary';
  'aria-label': string;
  title?: string;
  className?: string;
}

export function IconButton({
  icon: IconComponent,
  iconClassName,
  onClick,
  disabled,
  variant = 'default',
  'aria-label': ariaLabel,
  title,
  className,
}: IconButtonProps) {
  const variantStyles = disabled
    ? 'opacity-40 cursor-not-allowed'
    : variant === 'default'
      ? 'text-default-500 hover:text-foreground hover:bg-content2/50'
      : 'bg-content1 hover:bg-content2 text-foreground';

  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center p-half rounded-sm transition-colors',
        variantStyles,
        className,
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      <IconComponent
        className={cn('size-icon-sm', iconClassName)}
        weight="bold"
      />
    </button>
  );
}
