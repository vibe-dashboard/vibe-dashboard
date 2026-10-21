import { describe, expect, it } from 'vitest';

import { queueMutationState } from './useSessionQueueInteraction';

describe('queueMutationState', () => {
  it('allows mutation only while a message is queued', () => {
    expect(queueMutationState('queued')).toEqual({
      isQueued: true,
      isConsuming: false,
    });
    expect(queueMutationState('consuming')).toEqual({
      isQueued: false,
      isConsuming: true,
    });
    expect(queueMutationState('empty')).toEqual({
      isQueued: false,
      isConsuming: false,
    });
  });
});
