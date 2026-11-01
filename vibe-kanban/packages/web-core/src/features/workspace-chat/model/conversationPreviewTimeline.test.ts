import { describe, expect, it } from 'vitest';
import type { ConversationPreview } from 'shared/types';

import { deriveConversationEntries } from './deriveConversationEntries';
import { conversationPreviewToExecutionProcessState } from './conversationPreviewTimeline';

describe('conversationPreviewToExecutionProcessState', () => {
  it('converts preview messages into immediately renderable conversation entries', () => {
    const processId = '11111111-1111-4111-8111-111111111111';
    const preview: ConversationPreview = {
      workspace_id: '22222222-2222-4222-8222-222222222222',
      session_id: '33333333-3333-4333-8333-333333333333',
      has_running_turn: false,
      source: 'cache',
      warmed_at: '2026-07-22T00:00:00.000Z',
      messages: [
        {
          role: 'user',
          content: 'What changed?',
          execution_process_id: processId,
          created_at: '2026-07-22T00:00:01.000Z',
        },
        {
          role: 'assistant',
          content: 'The backend preview cache changed.',
          execution_process_id: processId,
          created_at: '2026-07-22T00:00:02.000Z',
        },
      ],
    };

    const state = conversationPreviewToExecutionProcessState(preview);
    const derived = deriveConversationEntries({
      source: {
        executionProcessState: state,
        liveExecutionProcesses: [],
      },
      scriptOutputCache: new Map(),
    });

    expect(
      derived.entries
        .filter((entry) => entry.type === 'NORMALIZED_ENTRY')
        .filter((entry) =>
          entry.type === 'NORMALIZED_ENTRY'
            ? entry.content.entry_type.type !== 'next_action'
            : true
        )
        .map((entry) =>
          entry.type === 'NORMALIZED_ENTRY' ? entry.content.content : ''
        )
    ).toEqual(['What changed?', 'The backend preview cache changed.']);
  });
});
