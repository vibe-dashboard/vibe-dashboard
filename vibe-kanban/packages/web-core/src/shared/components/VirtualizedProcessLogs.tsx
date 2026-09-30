import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useVirtualizer,
  measureElement as defaultMeasureElement,
} from '@tanstack/react-virtual';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/ssr';
import RawLogText from '@/shared/components/RawLogText';
import type { PatchType } from 'shared/types';

export type LogEntry = Extract<
  PatchType,
  { type: 'STDOUT' } | { type: 'STDERR' }
>;

export interface VirtualizedProcessLogsProps {
  logs: LogEntry[];
  error: string | null;
  searchQuery: string;
  matchIndices: number[];
  currentMatchIndex: number;
}

type LogEntryWithKey = LogEntry & { key: string; originalIndex: number };

const ESTIMATED_LOG_ROW_HEIGHT = 24;
const OVERSCAN = 12;
const NEAR_BOTTOM_THRESHOLD_PX = 24;

export function VirtualizedProcessLogs({
  logs,
  error,
  searchQuery,
  matchIndices,
  currentMatchIndex,
}: VirtualizedProcessLogsProps) {
  const { t } = useTranslation('tasks');
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const previousLogLengthRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const prevCurrentMatchRef = useRef<number | undefined>(undefined);

  const logsWithKeys = useMemo<LogEntryWithKey[]>(
    () =>
      logs.map((entry, index) => ({
        ...entry,
        key: `log-${index}`,
        originalIndex: index,
      })),
    [logs]
  );

  const virtualizer = useVirtualizer({
    count: logsWithKeys.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ESTIMATED_LOG_ROW_HEIGHT,
    getItemKey: (index) => logsWithKeys[index]?.key ?? index,
    overscan: OVERSCAN,
    measureElement: defaultMeasureElement,
    useAnimationFrameWithResizeObserver: true,
  });

  const syncIsAtBottom = useCallback(() => {
    const element = scrollParentRef.current;
    if (!element) {
      isAtBottomRef.current = true;
      return;
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const element = scrollParentRef.current;
    if (!element) return;

    syncIsAtBottom();

    const handleScroll = () => {
      syncIsAtBottom();
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, [syncIsAtBottom]);

  useEffect(() => {
    if (logsWithKeys.length === 0) {
      previousLogLengthRef.current = 0;
      hasInitializedRef.current = false;
      return;
    }

    const previousLength = previousLogLengthRef.current;
    const shouldScrollToBottom =
      !hasInitializedRef.current ||
      (logsWithKeys.length > previousLength && isAtBottomRef.current);

    previousLogLengthRef.current = logsWithKeys.length;

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
    }

    if (!shouldScrollToBottom) return;

    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(logsWithKeys.length - 1, {
        align: 'end',
        behavior: 'auto',
      });
    });
  }, [logsWithKeys, virtualizer]);

  useEffect(() => {
    if (
      matchIndices.length === 0 ||
      currentMatchIndex < 0 ||
      currentMatchIndex === prevCurrentMatchRef.current
    ) {
      return;
    }

    const logIndex = matchIndices[currentMatchIndex];
    if (logIndex == null) return;

    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(logIndex, {
        align: 'center',
        behavior: 'smooth',
      });
    });

    prevCurrentMatchRef.current = currentMatchIndex;
  }, [currentMatchIndex, matchIndices, virtualizer]);

  if (logs.length === 0 && !error) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-center text-muted-foreground text-sm">
          {t('processes.noLogsAvailable')}
        </p>
      </div>
    );
  }

  if (error && logs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-center text-destructive text-sm">
          <WarningCircleIcon className="size-icon-base inline mr-2" />
          {error}
        </p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={scrollParentRef} className="h-full overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const logEntry = logsWithKeys[virtualItem.index];
          if (!logEntry) return null;

          const isMatch = matchIndices.includes(logEntry.originalIndex);
          const isCurrentMatch =
            matchIndices[currentMatchIndex] === logEntry.originalIndex;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <RawLogText
                content={logEntry.content}
                channel={logEntry.type === 'STDERR' ? 'stderr' : 'stdout'}
                className="text-sm px-4 py-1"
                linkifyUrls
                searchQuery={isMatch ? searchQuery : undefined}
                isCurrentMatch={isCurrentMatch}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
