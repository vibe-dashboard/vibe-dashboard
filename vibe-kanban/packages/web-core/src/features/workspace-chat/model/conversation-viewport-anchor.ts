import type {
  DisplayEntry,
  AggregatedDiffGroup,
  AggregatedPatchGroup,
  AggregatedThinkingGroup,
} from '@/shared/hooks/useConversationHistory/types';

import type { ConversationRow } from './conversation-row-model';

export type PendingViewportAnchor =
  | {
      mode: 'bottom';
      distanceFromBottom: number;
    }
  | {
      mode: 'row';
      patchKeys: string[];
      top: number;
    };

function isAggregatedEntry(
  entry: DisplayEntry
): entry is
  | AggregatedPatchGroup
  | AggregatedDiffGroup
  | AggregatedThinkingGroup {
  return (
    entry.type === 'AGGREGATED_GROUP' ||
    entry.type === 'AGGREGATED_DIFF_GROUP' ||
    entry.type === 'AGGREGATED_THINKING_GROUP'
  );
}

export function getViewportAnchorPatchKeys(entry: DisplayEntry): string[] {
  if (isAggregatedEntry(entry)) {
    return entry.entries.map((groupedEntry) => groupedEntry.patchKey);
  }

  return [entry.patchKey];
}

export function entryMatchesViewportAnchor(
  entry: DisplayEntry,
  patchKeys: readonly string[]
): boolean {
  if (patchKeys.length === 0) return false;
  const patchKeySet = new Set(patchKeys);

  if (isAggregatedEntry(entry)) {
    return entry.entries.some((groupedEntry) =>
      patchKeySet.has(groupedEntry.patchKey)
    );
  }

  return patchKeySet.has(entry.patchKey);
}

export function findRowIndexForViewportAnchor(
  rows: ConversationRow[],
  anchor: PendingViewportAnchor
): number {
  if (anchor.mode !== 'row') return -1;

  return rows.findIndex((row) =>
    entryMatchesViewportAnchor(row.entry, anchor.patchKeys)
  );
}
