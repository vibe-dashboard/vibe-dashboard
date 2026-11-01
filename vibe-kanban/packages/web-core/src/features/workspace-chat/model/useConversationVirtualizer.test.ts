import { describe, expect, it } from 'vitest';

import {
  AUTO_FOLLOW_BOTTOM_THRESHOLD_PX,
  shouldAdjustConversationScrollPositionOnItemSizeChange,
} from './useConversationVirtualizer';
import { NEAR_BOTTOM_THRESHOLD_PX } from './conversation-scroll-commands';

describe('useConversationVirtualizer', () => {
  it('uses a stricter pinned threshold for auto-follow than for the near-bottom UI', () => {
    expect(AUTO_FOLLOW_BOTTOM_THRESHOLD_PX).toBeLessThan(
      NEAR_BOTTOM_THRESHOLD_PX
    );
  });

  it('preserves scrolled-up readers when measured content above the viewport changes size', () => {
    expect(
      shouldAdjustConversationScrollPositionOnItemSizeChange({
        itemEnd: 120,
        scrollOffset: 240,
        isAtEnd: false,
      })
    ).toBe(true);
  });

  it('does not compensate while the reader is at the end', () => {
    expect(
      shouldAdjustConversationScrollPositionOnItemSizeChange({
        itemEnd: 120,
        scrollOffset: 240,
        isAtEnd: true,
      })
    ).toBe(false);
  });

  it('does not compensate for measured content that is still visible or below the viewport', () => {
    expect(
      shouldAdjustConversationScrollPositionOnItemSizeChange({
        itemEnd: 260,
        scrollOffset: 240,
        isAtEnd: false,
      })
    ).toBe(false);
  });
});
