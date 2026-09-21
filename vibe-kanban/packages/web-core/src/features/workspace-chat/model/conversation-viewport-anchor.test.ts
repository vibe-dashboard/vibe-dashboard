import { describe, expect, it } from 'vitest';

import type {
  AggregatedPatchGroup,
  DisplayEntry,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';

import type { ConversationRow } from './conversation-row-model';
import {
  entryMatchesViewportAnchor,
  findRowIndexForViewportAnchor,
  getViewportAnchorPatchKeys,
  type PendingViewportAnchor,
} from './conversation-viewport-anchor';

function makeEntry(patchKey: string): PatchTypeWithKey {
  return {
    type: 'STDOUT',
    content: patchKey,
    patchKey,
    executionProcessId: 'proc-1',
  };
}

function makeGroup(
  patchKey: string,
  entryPatchKeys: string[]
): AggregatedPatchGroup {
  return {
    type: 'AGGREGATED_GROUP',
    aggregationType: 'search',
    entries: entryPatchKeys.map(makeEntry),
    patchKey,
    executionProcessId: 'proc-1',
  };
}

function makeRow(entry: DisplayEntry): ConversationRow {
  return {
    semanticKey: `conv-${entry.patchKey}`,
    rowFamily: 'tool_summary',
    processId: 'proc-1',
    estimationHint: 'compact',
    isUserMessage: false,
    entry,
  };
}

describe('conversation-viewport-anchor', () => {
  it('captures all grouped patch keys so regrouping can still be matched', () => {
    const visibleGroup = makeGroup('agg:a', ['a', 'b']);
    const anchor = getViewportAnchorPatchKeys(visibleGroup);

    expect(anchor).toEqual(['a', 'b']);

    const regroupedEntry = makeGroup('agg:x', ['x', 'a', 'b']);
    expect(entryMatchesViewportAnchor(regroupedEntry, anchor)).toBe(true);
  });

  it('matches a previously single visible entry after it becomes aggregated', () => {
    const originallyVisibleEntry = makeEntry('b');
    const anchor = getViewportAnchorPatchKeys(originallyVisibleEntry);
    const regroupedEntry = makeGroup('agg:a', ['a', 'b']);

    expect(entryMatchesViewportAnchor(regroupedEntry, anchor)).toBe(true);
  });

  it('finds the regrouped row index for a preserved row anchor', () => {
    const anchor: PendingViewportAnchor = {
      mode: 'row',
      patchKeys: ['b'],
      top: 120,
    };
    const rows = [
      makeRow(makeEntry('z')),
      makeRow(makeGroup('agg:a', ['a', 'b', 'c'])),
      makeRow(makeEntry('tail')),
    ];

    expect(findRowIndexForViewportAnchor(rows, anchor)).toBe(1);
  });
});
