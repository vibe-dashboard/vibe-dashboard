/**
 * Scroll Command Executor
 *
 * Bridges the declarative scroll-intent model (conversation-scroll-commands.ts)
 * to TanStack Virtual's imperative scrollToIndex API.
 *
 * Lifecycle:
 * 1. Entry data arrives → `onEntriesChanged` resolves intent via `resolveScrollIntent`
 * 2. Intent is stored as pending in `ScrollState`
 * 3. React re-renders, TanStack Virtual measures new items
 * 4. `useLayoutEffect` reads the pending intent and dispatches the scroll command
 * 5. `markIntentApplied` clears the pending intent
 *
 * No setTimeout chains. All sequencing is via React lifecycle.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { Virtualizer } from '@tanstack/react-virtual';

import type { AddEntryType } from '@/shared/hooks/useConversationHistory/types';

// TanStack Virtual only accepts 'auto' | 'smooth', not DOM's full ScrollBehavior
type TanStackScrollBehavior = 'auto' | 'smooth';
type TanStackScrollAlign = 'start' | 'center' | 'end';

const INITIAL_BOTTOM_SETTLE_FRAME_COUNT = 4;

function toTanStackBehavior(behavior: ScrollBehavior): TanStackScrollBehavior {
  return behavior === 'instant' ? 'auto' : behavior;
}

import {
  type ScrollIntent,
  type ScrollState,
  createInitialScrollState,
  markIntentApplied,
  resolveScrollIntent,
  setPendingIntent,
} from './conversation-scroll-commands';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollCommandExecutorOptions {
  /** The TanStack Virtual virtualizer instance. */
  virtualizer: Virtualizer<HTMLDivElement, Element>;

  /** Current number of items in the list. */
  itemCount: number;

  dataVersion: number;

  /** Point-in-time DOM check for isAtBottom (avoids stale React state). */
  checkIsAtBottom: () => boolean;

  scrollToBottom: (behavior?: TanStackScrollBehavior) => void;

  scrollToAbsoluteIndex?: (
    index: number,
    align?: TanStackScrollAlign,
    behavior?: TanStackScrollBehavior
  ) => boolean;
}

export interface ScrollCommandExecutorResult {
  /**
   * Call when entries are updated. Resolves the appropriate scroll intent
   * based on addType, initial load state, and isAtBottom.
   */
  onEntriesChanged: (addType: AddEntryType, isInitialLoad: boolean) => void;

  /**
   * Imperatively request a jump-to-bottom (e.g., from the scroll-to-bottom button).
   */
  requestJumpToBottom: (behavior?: ScrollBehavior) => void;

  /**
   * Imperatively request scrolling to a specific index.
   */
  requestJumpToIndex: (
    index: number,
    align?: 'start' | 'center' | 'end',
    behavior?: ScrollBehavior
  ) => void;

  /**
   * Read-only access to the current pending intent (for debugging/testing).
   */
  pendingIntent: ScrollIntent | null;
}

export function getBottomScrollSettleFrameCount(intent: ScrollIntent): number {
  return intent.type === 'initial-bottom'
    ? INITIAL_BOTTOM_SETTLE_FRAME_COUNT
    : 0;
}

interface BottomScrollSettlingOptions {
  frameCount: number;
  scrollToBottom: (behavior?: TanStackScrollBehavior) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

export function scheduleBottomScrollSettling({
  frameCount,
  scrollToBottom,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
}: BottomScrollSettlingOptions): () => void {
  if (frameCount <= 0 || typeof requestFrame !== 'function') {
    return () => {};
  }

  let remainingFrames = frameCount;
  let frameHandle: number | null = null;
  let cancelled = false;

  const tick: FrameRequestCallback = () => {
    frameHandle = null;
    if (cancelled || remainingFrames <= 0) return;

    remainingFrames -= 1;
    scrollToBottom('auto');

    if (remainingFrames > 0) {
      frameHandle = requestFrame(tick);
    }
  };

  frameHandle = requestFrame(tick);

  return () => {
    cancelled = true;
    if (frameHandle !== null && typeof cancelFrame === 'function') {
      cancelFrame(frameHandle);
    }
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScrollCommandExecutor({
  virtualizer,
  itemCount,
  dataVersion,
  checkIsAtBottom,
  scrollToBottom,
  scrollToAbsoluteIndex,
}: ScrollCommandExecutorOptions): ScrollCommandExecutorResult {
  const stateRef = useRef<ScrollState>(createInitialScrollState());
  const prevDataVersionRef = useRef(dataVersion);
  const cancelBottomScrollSettlingRef = useRef<(() => void) | null>(null);

  const cancelBottomScrollSettling = useCallback(() => {
    cancelBottomScrollSettlingRef.current?.();
    cancelBottomScrollSettlingRef.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Intent resolution (called by the container when entries update)
  // -------------------------------------------------------------------------

  const onEntriesChanged = useCallback(
    (addType: AddEntryType, isInitialLoad: boolean) => {
      const intent = resolveScrollIntent(
        addType,
        isInitialLoad,
        checkIsAtBottom()
      );
      stateRef.current = setPendingIntent(stateRef.current, intent);
    },
    [checkIsAtBottom]
  );

  // -------------------------------------------------------------------------
  // Imperative intent setters (for UI buttons)
  // -------------------------------------------------------------------------

  const requestJumpToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      cancelBottomScrollSettling();
      const intent: ScrollIntent = {
        type: 'jump-to-bottom',
        behavior,
      };
      stateRef.current = setPendingIntent(stateRef.current, intent);
      executeIntent(
        virtualizer,
        intent,
        itemCount,
        scrollToBottom,
        scrollToAbsoluteIndex
      );
      stateRef.current = markIntentApplied(stateRef.current);
    },
    [
      cancelBottomScrollSettling,
      itemCount,
      scrollToAbsoluteIndex,
      scrollToBottom,
      virtualizer,
    ]
  );

  const requestJumpToIndex = useCallback(
    (
      index: number,
      align: 'start' | 'center' | 'end' = 'start',
      behavior: ScrollBehavior = 'smooth'
    ) => {
      cancelBottomScrollSettling();
      const intent: ScrollIntent = {
        type: 'jump-to-index',
        index,
        align,
        behavior,
      };
      stateRef.current = setPendingIntent(stateRef.current, intent);
      executeIntent(
        virtualizer,
        intent,
        itemCount,
        scrollToBottom,
        scrollToAbsoluteIndex
      );
      stateRef.current = markIntentApplied(stateRef.current);
    },
    [
      cancelBottomScrollSettling,
      itemCount,
      scrollToAbsoluteIndex,
      scrollToBottom,
      virtualizer,
    ]
  );

  useEffect(() => {
    return cancelBottomScrollSettling;
  }, [cancelBottomScrollSettling]);

  // -------------------------------------------------------------------------
  // Intent execution — runs after React commit + TanStack measurement
  //
  // useLayoutEffect fires synchronously after DOM mutations but before paint,
  // ensuring the virtualizer has measured new items before we scroll.
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const state = stateRef.current;
    const intent = state.pendingIntent;
    if (!intent) return;

    const isImperativeIntent =
      intent.type === 'jump-to-bottom' || intent.type === 'jump-to-index';
    if (!isImperativeIntent && dataVersion === prevDataVersionRef.current) {
      return;
    }

    executeIntent(
      virtualizer,
      intent,
      itemCount,
      scrollToBottom,
      scrollToAbsoluteIndex
    );
    cancelBottomScrollSettling();
    const settleFrameCount = getBottomScrollSettleFrameCount(intent);
    if (itemCount > 0 && settleFrameCount > 0) {
      cancelBottomScrollSettlingRef.current = scheduleBottomScrollSettling({
        frameCount: settleFrameCount,
        scrollToBottom,
      });
    }
    stateRef.current = markIntentApplied(stateRef.current);
    prevDataVersionRef.current = dataVersion;
  }, [
    cancelBottomScrollSettling,
    dataVersion,
    itemCount,
    scrollToAbsoluteIndex,
    scrollToBottom,
    virtualizer,
  ]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    onEntriesChanged,
    requestJumpToBottom,
    requestJumpToIndex,
    pendingIntent: stateRef.current.pendingIntent,
  };
}

// ---------------------------------------------------------------------------
// Intent Dispatch (pure function, no hooks)
// ---------------------------------------------------------------------------

/**
 * Execute a scroll intent against the TanStack Virtual virtualizer.
 *
 * Each intent type maps to a specific scrollToIndex configuration:
 *
 * | Intent          | scrollToIndex call                                    |
 * |-----------------|-------------------------------------------------------|
 * | initial-bottom  | last index, align: 'end' (instant, purge sizes)       |
 * | follow-bottom   | last index, align: 'end', behavior from intent        |
 * | preserve-anchor | no-op (shouldAdjustScrollPositionOnItemSizeChange)     |
 * | plan-reveal     | last index, align: 'start'                            |
 * | jump-to-bottom  | last index, align: 'end', behavior from intent        |
 * | jump-to-index   | intent.index, intent.align, intent.behavior           |
 */
function executeIntent(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  intent: ScrollIntent,
  itemCount: number,
  scrollToBottom: (behavior?: TanStackScrollBehavior) => void,
  scrollToAbsoluteIndex?: (
    index: number,
    align?: TanStackScrollAlign,
    behavior?: TanStackScrollBehavior
  ) => boolean
): void {
  if (itemCount === 0) return;

  const lastIndex = itemCount - 1;
  const virtualizedCount = virtualizer.options.count;

  switch (intent.type) {
    case 'initial-bottom': {
      scrollToBottom('auto');
      break;
    }

    case 'follow-bottom': {
      scrollToBottom(toTanStackBehavior(intent.behavior));
      break;
    }

    case 'preserve-anchor': {
      break;
    }

    case 'plan-reveal': {
      if (virtualizedCount === 0 || lastIndex >= virtualizedCount) {
        if (scrollToAbsoluteIndex?.(lastIndex, 'start', 'auto')) {
          break;
        }
        scrollToBottom('auto');
        break;
      }

      virtualizer.scrollToIndex(lastIndex, {
        align: 'start',
        behavior: 'auto',
      });
      break;
    }

    case 'jump-to-bottom': {
      scrollToBottom(toTanStackBehavior(intent.behavior));
      break;
    }

    case 'jump-to-index': {
      if (virtualizedCount === 0) {
        if (
          scrollToAbsoluteIndex?.(
            intent.index,
            intent.align,
            toTanStackBehavior(intent.behavior)
          )
        ) {
          break;
        }
        scrollToBottom(toTanStackBehavior(intent.behavior));
        break;
      }

      if (intent.index >= virtualizedCount) {
        if (
          scrollToAbsoluteIndex?.(
            intent.index,
            intent.align,
            toTanStackBehavior(intent.behavior)
          )
        ) {
          break;
        }
        scrollToBottom(toTanStackBehavior(intent.behavior));
        break;
      }

      virtualizer.scrollToIndex(intent.index, {
        align: intent.align,
        behavior: toTanStackBehavior(intent.behavior),
      });
      break;
    }
  }
}
