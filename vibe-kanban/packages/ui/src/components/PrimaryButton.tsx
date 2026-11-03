import { SpinnerIcon, type Icon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

interface PrimaryButtonProps {
  variant?: 'default' | 'secondary' | 'tertiary';
  actionIcon?: Icon | 'spinner';
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function PrimaryButton({
  variant = 'default',
  actionIcon: ActionIcon,
  value,
  onClick,
  disabled,
  children,
  className,
}: PrimaryButtonProps) {
  const variantStyles = disabled
    ? 'cursor-not-allowed bg-content2'
    : variant === 'default'
      ? 'bg-primary hover:bg-primary/80 text-primary-foreground'
      : variant === 'secondary'
        ? 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
        : 'bg-content1 hover:bg-content2 text-foreground';

  return (
    <button
      className={cn(
        'rounded-sm px-base py-half text-cta min-h-cta flex gap-half items-center',
        variantStyles,
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {value}
      {children}
      {ActionIcon ? (
        ActionIcon === 'spinner' ? (
          <SpinnerIcon className={'size-icon-sm animate-spin'} weight="bold" />
        ) : (
          <ActionIcon className={'size-icon-xs'} weight="bold" />
        )
      ) : null}
    </button>
  );
}
