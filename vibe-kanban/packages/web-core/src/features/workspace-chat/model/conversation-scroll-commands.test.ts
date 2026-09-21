import { describe, expect, it } from 'vitest';

import {
  isNearBottom,
  resolveScrollIntent,
} from './conversation-scroll-commands';

describe('conversation-scroll-commands', () => {
  it('preserves the viewport for historic replay batches', () => {
    expect(resolveScrollIntent('historic', false, true)).toEqual({
      type: 'preserve-anchor',
    });
    expect(resolveScrollIntent('historic', false, false)).toEqual({
      type: 'preserve-anchor',
    });
  });

  it('continues following the bottom for live running updates only when already at bottom', () => {
    expect(resolveScrollIntent('running', false, true)).toEqual({
      type: 'follow-bottom',
      behavior: 'auto',
    });
    expect(resolveScrollIntent('running', false, false)).toEqual({
      type: 'preserve-anchor',
    });
  });

  it('treats small bottom gaps as still at bottom', () => {
    expect(isNearBottom(936, 500, 1500)).toBe(true);
    expect(isNearBottom(800, 500, 1500)).toBe(false);
  });
});
