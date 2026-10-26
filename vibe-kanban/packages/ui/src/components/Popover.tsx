import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';
import { cn } from '../lib/cn';
import {
  ComposerSheetOwner,
  ComposerSheetBackdrop,
  ComposerSheetHeader,
  useComposerOverlayState,
  useComposerSheet,
} from './ComposerSheet';

function Popover(
  props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>
) {
  const state = useComposerOverlayState(props);
  const sheet = useComposerSheet();
  return (
    <ComposerSheetOwner {...state}>
      <PopoverPrimitive.Root
        {...props}
        {...state}
        modal={sheet.mobile || props.modal}
      />
    </ComposerSheetOwner>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    { className, children, style, align = 'center', sideOffset = 4, ...props },
    ref
  ) => {
    const sheet = useComposerSheet();
    return (
      <PopoverPrimitive.Portal>
        <div style={{ display: 'contents' }}>
          <ComposerSheetBackdrop />
          <PopoverPrimitive.Content
            ref={ref}
            data-composer-sheet={sheet.mobile ? '' : undefined}
            style={{ ...style, ...(sheet.mobile ? sheet.style : {}) }}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              'z-[10000] w-72 overflow-hidden',
              'bg-content1 text-foreground border border-divider rounded-sm p-base shadow-md',
              'data-[state=open]:animate-in',
              'data-[state=open]:fade-in-0',
              'data-[state=open]:zoom-in-95',
              'data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0',
              'data-[state=closed]:zoom-out-95',
              'data-[side=bottom]:slide-in-from-top-2',
              'data-[side=left]:slide-in-from-right-2',
              'data-[side=right]:slide-in-from-left-2',
              'data-[side=top]:slide-in-from-bottom-2',
              'origin-[--radix-popover-content-transform-origin]',
              className
            )}
            {...props}
            onOpenAutoFocus={sheet.mobile ? undefined : props.onOpenAutoFocus}
          >
            <ComposerSheetHeader />
            {children}
          </PopoverPrimitive.Content>
        </div>
      </PopoverPrimitive.Portal>
    );
  }
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
