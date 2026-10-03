import { afterEach, describe, expect, it } from 'vitest';
import { ScratchType } from 'shared/types';
import {
  acknowledgeStoredScratchDraft,
  readStoredScratchDraft,
  writeStoredScratchDraft,
} from './scratchDraftStore';

describe('scratchDraftStore', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('clears the dirty bit only when the authoritative value matches', () => {
    writeStoredScratchDraft(
      ScratchType.WORKSPACE_NOTES,
      'workspace-1',
      { content: 'draft text' },
      true
    );

    expect(
      acknowledgeStoredScratchDraft(
        ScratchType.WORKSPACE_NOTES,
        'workspace-1',
        {
          content: 'other text',
        }
      )
    ).toBe(false);
    expect(
      readStoredScratchDraft<{ content: string }>(
        ScratchType.WORKSPACE_NOTES,
        'workspace-1'
      )?.dirty
    ).toBe(true);

    expect(
      acknowledgeStoredScratchDraft(
        ScratchType.WORKSPACE_NOTES,
        'workspace-1',
        {
          content: 'draft text',
        }
      )
    ).toBe(true);
    expect(
      readStoredScratchDraft<{ content: string }>(
        ScratchType.WORKSPACE_NOTES,
        'workspace-1'
      )
    ).toMatchObject({
      value: { content: 'draft text' },
      dirty: false,
    });
  });
});
