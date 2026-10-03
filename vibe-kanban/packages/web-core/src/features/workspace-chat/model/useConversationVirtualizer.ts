/**
 * Conversation Virtualizer Hook
 *
 * Shared TanStack Virtual configuration for the conversation list.
 * Owns the virtualizer instance, measurement, and imperative scroll helpers.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  useVirtualizer,
  measureElement as defaultMeasureElement,
} from '@tanstack/react-virtual';
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual';

import {
  type ConversationRow,
  SIZE_ESTIMATE_PX,
  estimateSizeForRow,
  findPreviousUserMessageIndex,
} from './conversation-row-model';
import { NEAR_BOTTOM_THRESHOLD_PX } from './conversation-scroll-commands';

// TanStack Virtual's ScrollBehavior ('auto' | 'smooth' | 'instant') shadows
// the DOM ScrollBehavior. Use a narrow type to avoid TS2322 mismatches.
type ScrollToOptionsBehavior = 'auto' | 'smooth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of items to render beyond the visible area in each direction. */
const OVERSCAN = 8;

export interface ConversationSizeAdjustmentInput {
  /** End offset of the measured virtual item. */
  itemEnd: number;
  /** Current scroll offset of the virtualizer. */
  scrollOffset: number;
  /** Whether the reader is currently at the end of the chat. */
  isAtEnd: boolean;
}

/**
 * Preserve the reader's viewport when content that is already fully above the
 * viewport changes size. This is intentionally narrow: TanStack owns normal
 * chat anchoring/follow behavior, and we only opt into compensation for the
 * eager historic-replay case where measured rows above the reader settle after
 * render.
 */
export function shouldAdjustConversationScrollPositionOnItemSizeChange({
  itemEnd,
  scrollOffset,
  isAtEnd,
}: ConversationSizeAdjustmentInput): boolean {
  if (isAtEnd) return false;
  return itemEnd <= scrollOffset;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationVirtualizerOptions {
  /** The semantic row model driving the list. */
  rows: ConversationRow[];

  /** Ref to the scrollable container element. */
  scrollContainerRef: RefObject<HTMLDivElement | null>;

  /**
   * Called when the at-bottom state changes. Shells use this to show/hide
   * the scroll-to-bottom affordance.
   */
  onAtBottomChange?: (atBottom: boolean) => void;
}

export interface ConversationVirtualizerResult {
  /** The TanStack Virtual virtualizer instance. */
  virtualizer: Virtualizer<HTMLDivElement, Element>;

  /** Virtual items currently in the render window (including overscan). */
  virtualItems: VirtualItem[];

  /** Total pixel size of all items (for the scroll spacer). */
  totalSize: number;

  /**
   * Ref callback for row DOM elements. Attach to each rendered row's
   * container element alongside `data-index={virtualItem.index}`.
   * TanStack Virtual uses this to measure real DOM heights and attach
   * a ResizeObserver for automatic re-measurement on size changes.
   */
  measureElement: (node: Element | null) => void;

  /** Scroll to the absolute bottom of the list. */
  scrollToBottom: (behavior?: ScrollToOptionsBehavior) => void;

  /** Scroll to a specific row index. */
  scrollToIndex: (
    index: number,
    options?: {
      align?: 'start' | 'center' | 'end';
      behavior?: ScrollToOptionsBehavior;
    }
  ) => void;

  /**
   * Scroll to the previous user message relative to the first visible item.
   * Returns true if a target was found and scrolled to, false otherwise.
   */
  scrollToPreviousUserMessage: () => boolean;

  /**
   * Whether the scroll container is currently near the bottom.
   * Reactive — updates via scroll event listener, not just point-in-time.
   */
  isAtBottom: boolean;

  /** Point-in-time check (non-reactive). Reads DOM directly. */
  checkIsAtBottom: () => boolean;

  /**
   * Compatibility no-op retained while call sites are simplified.
   */
  releaseBottomLock: () => void;

  /**
   * Look up the ConversationRow index for a given virtual item.
   * Since our virtualizer uses identity mapping (no lane reordering),
   * this is simply `virtualItem.index`.
   */
  rowIndexForVirtualItem: (item: VirtualItem) => number;

  /**
   * Look up the ConversationRow for a given virtual item.
   * Returns undefined if the index is out of bounds.
   */
  rowForVirtualItem: (item: VirtualItem) => ConversationRow | undefined;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Configure and return a TanStack Virtual virtualizer for the conversation list.
 *
 * This hook is the single source of virtualizer configuration. It is consumed
 * by `ConversationListContainer` and must not be duplicated across shells.
 */
export function useConversationVirtualizer({
  rows,
  scrollContainerRef,
  onAtBottomChange,
}: ConversationVirtualizerOptions): ConversationVirtualizerResult {
  // -------------------------------------------------------------------------
  // Virtualizer instance
  // -------------------------------------------------------------------------

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return SIZE_ESTIMATE_PX.medium;
      const containerWidth = scrollContainerRef.current?.clientWidth ?? null;
      return estimateSizeForRow(row, containerWidth);
    },
    getItemKey: (index) => {
      const row = rows[index];
      return row ? row.semanticKey : index;
    },
    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: NEAR_BOTTOM_THRESHOLD_PX,
    overscan: OVERSCAN,
    measureElement: defaultMeasureElement,
    useAnimationFrameWithResizeObserver: false,
  });

  // -------------------------------------------------------------------------
  // Historic replay preservation
  // -------------------------------------------------------------------------

  useEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _delta,
      instance
    ) =>
      shouldAdjustConversationScrollPositionOnItemSizeChange({
        itemEnd: item.end,
        scrollOffset: instance.scrollOffset ?? 0,
        isAtEnd: instance.isAtEnd(NEAR_BOTTOM_THRESHOLD_PX),
      });

    return () => {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [virtualizer]);

  // -------------------------------------------------------------------------
  // Reactive isAtBottom state
  // -------------------------------------------------------------------------

  const [isAtBottomState, setIsAtBottomState] = useState(true);
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  onAtBottomChangeRef.current = onAtBottomChange;
  const lastAtBottomRef = useRef(true);

  const syncIsAtBottom = useCallback(() => {
    const nextValue = virtualizer.isAtEnd(NEAR_BOTTOM_THRESHOLD_PX);

    if (nextValue !== lastAtBottomRef.current) {
      lastAtBottomRef.current = nextValue;
      setIsAtBottomState(nextValue);
      onAtBottomChangeRef.current?.(nextValue);
      return;
    }

    setIsAtBottomState((current) =>
      current === nextValue ? current : nextValue
    );
  }, [scrollContainerRef, virtualizer]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      syncIsAtBottom();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [scrollContainerRef, syncIsAtBottom]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    syncIsAtBottom();
  }, [rows.length, totalSize, syncIsAtBottom]);

  // -------------------------------------------------------------------------
  // Imperative helpers
  // -------------------------------------------------------------------------

  const scrollToBottom = useCallback(
    (behavior: ScrollToOptionsBehavior = 'smooth') => {
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer]
  );

  const scrollToIndex = useCallback(
    (
      index: number,
      options?: {
        align?: 'start' | 'center' | 'end';
        behavior?: ScrollToOptionsBehavior;
      }
    ) => {
      virtualizer.scrollToIndex(index, {
        align: options?.align ?? 'start',
        behavior: options?.behavior ?? 'smooth',
      });
    },
    [virtualizer]
  );

  const scrollToPreviousUserMessage = useCallback((): boolean => {
    const scrollEl = scrollContainerRef.current;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0 || rows.length === 0 || !scrollEl) return false;

    const firstVisibleIndex =
      virtualizer.getVirtualItemForOffset(scrollEl.scrollTop)?.index ??
      items[0].index;
    const targetIndex = findPreviousUserMessageIndex(rows, firstVisibleIndex);

    if (targetIndex < 0) return false;

    virtualizer.scrollToIndex(targetIndex, {
      align: 'start',
      behavior: 'smooth',
    });
    return true;
  }, [scrollContainerRef, virtualizer, rows]);

  const checkIsAtBottom = useCallback((): boolean => {
    return virtualizer.isAtEnd(NEAR_BOTTOM_THRESHOLD_PX);
  }, [virtualizer]);

  const releaseBottomLock = useCallback(() => {}, []);

  // -------------------------------------------------------------------------
  // Row ↔ VirtualItem mapping
  // -------------------------------------------------------------------------

  const rowIndexForVirtualItem = useCallback(
    (item: VirtualItem): number => item.index,
    []
  );

  const rowForVirtualItem = useCallback(
    (item: VirtualItem): ConversationRow | undefined => rows[item.index],
    [rows]
  );

  const measureElement = useCallback(
    (node: Element | null) => {
      virtualizer.measureElement(node);
    },
    [virtualizer]
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    virtualizer,
    virtualItems,
    totalSize,
    measureElement,
    scrollToBottom,
    scrollToIndex,
    scrollToPreviousUserMessage,
    isAtBottom: isAtBottomState,
    checkIsAtBottom,
    releaseBottomLock,
    rowIndexForVirtualItem,
    rowForVirtualItem,
  };
}
