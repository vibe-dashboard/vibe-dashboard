import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Item } from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import './composer-sheet.css';

const ComposerSheetContext = createContext<{
  mobile: boolean;
  style?: CSSProperties;
}>({ mobile: false });
const DismissContext = createContext({
  onOpenChange: (_open: boolean) => {},
  open: false,
  registerChild: () => () => {},
  hasOpenChild: false,
});
const mobileQuery = '(max-width: 767px)';

function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function ComposerOverlays({ children }: { children: ReactNode }) {
  const mobile = useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(mobileQuery).matches,
    () => false
  );
  const [viewport, setViewport] = useState<CSSProperties>();

  useEffect(() => {
    if (!mobile) return;
    const visible = window.visualViewport;
    const update = () =>
      setViewport({
        '--composer-sheet-height': `${visible?.height ?? window.innerHeight}px`,
        '--composer-sheet-width': `${visible?.width ?? window.innerWidth}px`,
        '--composer-sheet-top': `${visible?.offsetTop ?? 0}px`,
        '--composer-sheet-left': `${visible?.offsetLeft ?? 0}px`,
      } as CSSProperties);
    update();
    window.addEventListener('resize', update);
    visible?.addEventListener('resize', update);
    visible?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      visible?.removeEventListener('resize', update);
      visible?.removeEventListener('scroll', update);
    };
  }, [mobile]);

  return (
    <ComposerSheetContext.Provider value={{ mobile, style: viewport }}>
      {children}
    </ComposerSheetContext.Provider>
  );
}

export const useComposerSheet = () => useContext(ComposerSheetContext);

export function useComposerOverlayState({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  return {
    open: open ?? localOpen,
    onOpenChange: (next: boolean) => {
      setLocalOpen(next);
      onOpenChange?.(next);
    },
  };
}

export function ComposerSheetOwner({
  onOpenChange,
  open,
  children,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  children: ReactNode;
}) {
  const parent = useContext(DismissContext);
  const [childCount, setChildCount] = useState(0);
  const registerChild = useCallback(() => {
    setChildCount((count) => count + 1);
    return () => setChildCount((count) => count - 1);
  }, []);
  useEffect(() => {
    if (open) return parent.registerChild();
  }, [open, parent.registerChild]);
  return (
    <DismissContext.Provider
      value={{
        onOpenChange,
        open,
        registerChild,
        hasOpenChild: childCount > 0,
      }}
    >
      {children}
    </DismissContext.Provider>
  );
}

export function useComposerSheetLayer() {
  const { mobile } = useComposerSheet();
  const { hasOpenChild, onOpenChange } = useContext(DismissContext);
  return {
    hasOpenChild,
    onEscapeKeyDown: (event: KeyboardEvent) => {
      if (!mobile) return;
      event.preventDefault();
      if (!hasOpenChild) onOpenChange(false);
    },
  };
}

export function useComposerSheetToggle() {
  const { onOpenChange, open } = useContext(DismissContext);
  return () => onOpenChange(!open);
}

export function ComposerSheetBackdrop() {
  const { mobile } = useComposerSheet();
  const { onOpenChange, open } = useContext(DismissContext);
  return mobile && open ? (
    <div
      data-composer-sheet-backdrop=""
      aria-hidden="true"
      onPointerDown={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
    />
  ) : null;
}

export function ComposerSheetHeader({
  menu = false,
  handleOnly = false,
  preserveFocus = false,
}: {
  menu?: boolean;
  handleOnly?: boolean;
  preserveFocus?: boolean;
}) {
  const { mobile } = useComposerSheet();
  const { onOpenChange } = useContext(DismissContext);
  const { t } = useTranslation('common');
  if (!mobile) return null;
  const close = (
    <button
      type="button"
      aria-label={t('buttons.close')}
      onClick={() => onOpenChange(false)}
      onPointerDown={
        preserveFocus ? (event) => event.preventDefault() : undefined
      }
      className="flex size-11 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-content2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <X className="size-icon-base" aria-hidden="true" />
    </button>
  );
  return (
    <div
      data-composer-sheet-header=""
      className="sticky top-0 z-10 flex shrink-0 items-center justify-end bg-content1"
    >
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-default-500/40"
      />
      {!handleOnly && (menu ? <Item asChild>{close}</Item> : close)}
    </div>
  );
}
