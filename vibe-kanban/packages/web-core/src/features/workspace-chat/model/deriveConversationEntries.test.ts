import { describe, expect, it } from 'vitest';
import {
  BaseCodingAgent,
  type ExecutorAction,
  type NormalizedEntry,
} from 'shared/types';

import { deriveConversationEntries } from './deriveConversationEntries';
import type {
  ConversationTimelineSource,
  ExecutionProcessState,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';

function executorAction(
  command: 'clear' | 'compact',
  prompt = `/${command}`
): ExecutorAction {
  return {
    typ: {
      type: 'CodingAgentSessionCommandRequest',
      command:
        command === 'clear'
          ? { type: 'clear' }
          : { type: 'compact', instructions: null },
      prompt,
      session_id: 'thread-1',
      executor_config: {
        executor: BaseCodingAgent.CODEX,
        variant: null,
        model_id: null,
        agent_id: null,
        reasoning_id: null,
        permission_policy: null,
      },
      working_dir: null,
    },
    next_action: null,
  };
}

function normalEntry(
  processId: string,
  entry: NormalizedEntry,
  index: number
): PatchTypeWithKey {
  return {
    type: 'NORMALIZED_ENTRY',
    content: entry,
    patchKey: `${processId}:${index}`,
    executionProcessId: processId,
  };
}

function processState(
  id: string,
  createdAt: string,
  action: ExecutorAction,
  entries: PatchTypeWithKey[]
): ExecutionProcessState {
  return {
    executionProcess: {
      id,
      created_at: createdAt,
      updated_at: createdAt,
      executor_action: action,
    },
    entries,
  };
}

function source(
  processes: ExecutionProcessState[]
): ConversationTimelineSource {
  return {
    executionProcessState: Object.fromEntries(
      processes.map((process) => [process.executionProcess.id, process])
    ),
    liveExecutionProcesses: [],
  };
}

describe('deriveConversationEntries', () => {
  it('emits /clear as a user message and resets stale token usage', () => {
    const initialProcessId = 'initial-process';
    const clearProcessId = 'clear-process';
    const result = deriveConversationEntries({
      source: source([
        processState(
          initialProcessId,
          '2026-06-17T00:00:00.000Z',
          {
            typ: {
              type: 'CodingAgentInitialRequest',
              prompt: 'Hello',
              session_id: null,
              executor_config: {
                executor: BaseCodingAgent.CODEX,
                variant: null,
                model_id: null,
                agent_id: null,
                reasoning_id: null,
                permission_policy: null,
              },
              working_dir: null,
            },
            next_action: null,
          },
          [
            normalEntry(
              initialProcessId,
              {
                entry_type: {
                  type: 'token_usage_info',
                  total_tokens: 1234,
                  model_context_window: 200_000,
                },
                content: '',
                timestamp: null,
              },
              0
            ),
          ]
        ),
        processState(
          clearProcessId,
          '2026-06-17T00:01:00.000Z',
          executorAction('clear'),
          [
            normalEntry(
              clearProcessId,
              {
                entry_type: { type: 'system_message' },
                content: 'Context cleared.',
                timestamp: null,
              },
              0
            ),
          ]
        ),
      ]),
      scriptOutputCache: new Map(),
    });

    expect(
      result.entries.some(
        (entry) =>
          entry.type === 'NORMALIZED_ENTRY' &&
          entry.content.entry_type.type === 'user_message' &&
          entry.content.content === '/clear'
      )
    ).toBe(true);
    expect(result.latestTokenUsageInfo).toEqual({
      total_tokens: 0,
      model_context_window: 200_000,
    });
  });

  it('emits the original /compact prompt and does not retain stale token usage', () => {
    const initialProcessId = 'initial-process';
    const compactProcessId = 'compact-process';
    const result = deriveConversationEntries({
      source: source([
        processState(
          initialProcessId,
          '2026-06-17T00:00:00.000Z',
          {
            typ: {
              type: 'CodingAgentInitialRequest',
              prompt: 'Hello',
              session_id: null,
              executor_config: {
                executor: BaseCodingAgent.CODEX,
                variant: null,
                model_id: null,
                agent_id: null,
                reasoning_id: null,
                permission_policy: null,
              },
              working_dir: null,
            },
            next_action: null,
          },
          [
            normalEntry(
              initialProcessId,
              {
                entry_type: {
                  type: 'token_usage_info',
                  total_tokens: 1234,
                  model_context_window: 200_000,
                },
                content: '',
                timestamp: null,
              },
              0
            ),
          ]
        ),
        processState(
          compactProcessId,
          '2026-06-17T00:01:00.000Z',
          executorAction('compact', '/compact keep imports stable'),
          [
            normalEntry(
              compactProcessId,
              {
                entry_type: { type: 'system_message' },
                content: 'Context compacted.',
                timestamp: null,
              },
              0
            ),
          ]
        ),
      ]),
      scriptOutputCache: new Map(),
    });

    expect(
      result.entries.some(
        (entry) =>
          entry.type === 'NORMALIZED_ENTRY' &&
          entry.content.entry_type.type === 'user_message' &&
          entry.content.content === '/compact keep imports stable'
      )
    ).toBe(true);
    expect(result.latestTokenUsageInfo).toBeNull();
  });
});
