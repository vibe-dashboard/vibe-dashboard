import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  type Icon,
} from '@phosphor-icons/react';

import { cn } from '../lib/cn';

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

// Direct passthrough - inherits asChild support from Radix automatically
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

// Styled trigger button with icon/label/caret - use for default styled triggers
interface DropdownMenuTriggerButtonProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger> {
  icon?: Icon;
  label?: string;
  showCaret?: boolean;
  size?: 'default' | 'sm';
}

export const dropdownMenuTriggerButtonClassName =
  'flex items-center gap-half bg-content1 border border-divider rounded-sm px-base py-half ' +
  'focus:outline-none focus-visible:ring-1 focus-visible:ring-focus ' +
  'disabled:opacity-50 disabled:cursor-not-allowed min-w-0';

const sizeClasses = {
  default: '',
  sm: 'text-sm h-cta',
} as const;

const DropdownMenuTriggerButton = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  DropdownMenuTriggerButtonProps
>(
  (
    {
      className,
      icon: IconComponent,
      label,
      showCaret = true,
      size = 'default',
      children,
      ...props
    },
    ref
  ) => (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      className={cn(
        dropdownMenuTriggerButtonClassName,
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {IconComponent && (
        <IconComponent className="size-icon-xs text-foreground" weight="bold" />
      )}
      {label && (
        <span
          className={cn(
            'text-foreground truncate flex-1 text-left',
            size === 'default' && 'text-sm'
          )}
        >
          {label}
        </span>
      )}
      {children}
      {showCaret && (
        <CaretDownIcon
          className="size-icon-2xs text-foreground flex-shrink-0"
          weight="bold"
        />
      )}
    </DropdownMenuPrimitive.Trigger>
  )
);
DropdownMenuTriggerButton.displayName = 'DropdownMenuTriggerButton';

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-base px-base py-half mx-half rounded-sm',
      'text-sm text-foreground outline-none',
      'focus:bg-content2 data-[state=open]:bg-content2',
      '[&_svg]:pointer-events-none [&_svg]:size-icon-xs [&_svg]:shrink-0',
      className
    )}
    {...props}
  >
    {children}
    <CaretRightIcon className="ml-auto" weight="bold" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        className={cn(
          'z-[10000] min-w-[8rem] overflow-hidden',
          'bg-content1 border border-divider rounded-sm py-half shadow-md',
          'data-[state=open]:animate-in',
          'data-[state=open]:fade-in-0',
          'data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          'origin-[--radix-dropdown-menu-content-transform-origin]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-[10000] min-w-[8rem] overflow-y-auto overflow-x-hidden',
          'max-h-[var(--radix-dropdown-menu-content-available-height)]',
          'bg-content1 border border-divider rounded-sm py-half shadow-md',
          'data-[state=open]:animate-in',
          'data-[state=open]:fade-in-0',
          'data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          'origin-[--radix-dropdown-menu-content-transform-origin]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  icon?: Icon;
  badge?: React.ReactNode;
  variant?: 'default' | 'destructive';
  /** When true, prevents hover from stealing focus (useful for searchable dropdowns) */
  preventFocusOnHover?: boolean;
}

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(
  (
    {
      className,
      icon: IconComponent,
      badge,
      variant = 'default',
      preventFocusOnHover = false,
      onPointerMove,
      onPointerLeave,
      children,
      ...props
    },
    ref
  ) => (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-base',
        'px-base py-half mx-half rounded-sm outline-none transition-colors',
        'focus:bg-content2',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-icon-xs [&_svg]:shrink-0',
        variant === 'default' && 'text-foreground',
        variant === 'destructive' && 'text-danger',
        className
      )}
      onPointerMove={
        preventFocusOnHover
          ? (e) => {
              e.preventDefault();
              onPointerMove?.(e);
            }
          : onPointerMove
      }
      onPointerLeave={
        preventFocusOnHover
          ? (e) => {
              e.preventDefault();
              onPointerLeave?.(e);
            }
          : onPointerLeave
      }
      {...props}
    >
      {IconComponent && <IconComponent weight="bold" />}
      <span className="flex-1 text-sm truncate">{children}</span>
      {badge && (
        <span className="text-sm text-foreground text-right">{badge}</span>
      )}
    </DropdownMenuPrimitive.Item>
  )
);
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-base',
      'py-half px-base mx-half rounded-sm text-sm text-foreground',
      'outline-none transition-colors focus:bg-content2',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="flex-1">{children}</span>
    <DropdownMenuPrimitive.ItemIndicator>
      <CheckIcon className="size-icon-xs text-primary shrink-0" weight="bold" />
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center',
      'py-half pl-double pr-base mx-half rounded-sm text-sm text-foreground',
      'outline-none transition-colors focus:bg-content2',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-base flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <svg className="size-icon-xs fill-current" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="6" />
        </svg>
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-base py-half text-sm font-semibold text-default-500',
      className
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('h-px bg-border my-half', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        'ml-auto text-xs tracking-widest text-default-500',
        className
      )}
      {...props}
    />
  );
};
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

interface DropdownMenuSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onValueChange?: (value: string) => void;
}

const DropdownMenuSearchInput = React.forwardRef<
  HTMLInputElement,
  DropdownMenuSearchInputProps
>(({ className, onValueChange, onChange, ...props }, ref) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e);
    onValueChange?.(e.target.value);
  };

  return (
    <div className="flex items-center gap-base px-plusfifty py-base">
      <MagnifyingGlassIcon
        className="size-icon-xs text-default-500"
        weight="bold"
      />
      <input
        ref={ref}
        type="text"
        className={cn(
          'flex-1 bg-transparent text-sm text-foreground placeholder:text-default-500',
          'outline-none border-none',
          className
        )}
        onChange={handleChange}
        autoFocus
        {...props}
      />
    </div>
  );
});
DropdownMenuSearchInput.displayName = 'DropdownMenuSearchInput';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuTriggerButton,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuSearchInput,
};
