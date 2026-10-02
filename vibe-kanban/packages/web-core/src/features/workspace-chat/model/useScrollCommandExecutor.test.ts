import { describe, expect, it, vi } from 'vitest';

import {
  getBottomScrollSettleFrameCount,
  scheduleBottomScrollSettling,
} from './useScrollCommandExecutor';

describe('useScrollCommandExecutor', () => {
  it('settles initial bottom anchoring across measurement frames', () => {
    expect(
      getBottomScrollSettleFrameCount({
        type: 'initial-bottom',
        purgeEstimatedSizes: true,
      })
    ).toBeGreaterThan(0);
  });

  it('does not settle normal follow-bottom updates', () => {
    expect(
      getBottomScrollSettleFrameCount({
        type: 'follow-bottom',
        behavior: 'auto',
      })
    ).toBe(0);
  });

  it('reissues bottom scroll once per requested settle frame', () => {
    const scrollToBottom = vi.fn();
    const callbacks: FrameRequestCallback[] = [];

    scheduleBottomScrollSettling({
      frameCount: 3,
      scrollToBottom,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    expect(scrollToBottom).not.toHaveBeenCalled();

    callbacks.shift()?.(0);
    callbacks.shift()?.(0);
    callbacks.shift()?.(0);

    expect(scrollToBottom).toHaveBeenCalledTimes(3);
    expect(scrollToBottom).toHaveBeenNthCalledWith(1, 'auto');
    expect(scrollToBottom).toHaveBeenNthCalledWith(2, 'auto');
    expect(scrollToBottom).toHaveBeenNthCalledWith(3, 'auto');
    expect(callbacks).toHaveLength(0);
  });

  it('cancels a pending bottom settle frame', () => {
    const scrollToBottom = vi.fn();
    const callbacks: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();

    const cancel = scheduleBottomScrollSettling({
      frameCount: 2,
      scrollToBottom,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame,
    });

    cancel();
    callbacks.shift()?.(0);

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
