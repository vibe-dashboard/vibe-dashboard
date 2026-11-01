import {
  BaseCodingAgent,
  type ConversationPreview,
  type ConversationPreviewMessage,
  type ExecutionProcess,
  type NormalizedEntry,
  type PatchType,
} from 'shared/types';

import type {
  ExecutionProcessState,
  ExecutionProcessStateStore,
  PatchTypeWithKey,
} from '@/shared/hooks/useConversationHistory/types';

function patchWithKey(
  patch: PatchType,
  executionProcessId: string,
  index: number | 'assistant'
): PatchTypeWithKey {
  return {
    ...patch,
    patchKey: `${executionProcessId}:preview:${index}`,
    executionProcessId,
  };
}

function assistantPreviewPatch(
  message: ConversationPreviewMessage,
  index: number
): PatchTypeWithKey {
  const entry: NormalizedEntry = {
    entry_type: { type: 'assistant_message' },
    content: message.content,
    timestamp: message.created_at,
  };

  return patchWithKey(
    { type: 'NORMALIZED_ENTRY', content: entry },
    message.execution_process_id,
    index
  );
}

function createPreviewProcessState(
  message: ConversationPreviewMessage
): ExecutionProcessState {
  return {
    executionProcess: {
      id: message.execution_process_id,
      created_at: message.created_at,
      updated_at: message.created_at,
      executor_action: {
        typ: {
          type: 'CodingAgentFollowUpRequest',
          prompt: '',
          session_id: 'preview',
          reset_to_message_id: null,
          executor_config: { executor: BaseCodingAgent.CODEX },
          working_dir: null,
        },
        next_action: null,
      },
    },
    entries: [],
  };
}

export function conversationPreviewToExecutionProcessState(
  preview: ConversationPreview
): ExecutionProcessStateStore {
  const state: ExecutionProcessStateStore = {};

  preview.messages.forEach((message, index) => {
    const processId = message.execution_process_id;
    const processState = state[processId] ?? createPreviewProcessState(message);
    state[processId] = processState;

    if (
      new Date(message.created_at).getTime() <
      new Date(processState.executionProcess.created_at).getTime()
    ) {
      processState.executionProcess.created_at = message.created_at;
    }
    processState.executionProcess.updated_at = message.created_at;

    if (message.role === 'user') {
      const actionType = processState.executionProcess.executor_action.typ;
      if (actionType.type === 'CodingAgentFollowUpRequest') {
        actionType.prompt = message.content;
      }
      return;
    }

    processState.entries.push(assistantPreviewPatch(message, index));
  });

  return state;
}

export function mergePreviewIntoExecutionProcessState(
  target: ExecutionProcessStateStore,
  previewState: ExecutionProcessStateStore,
  liveProcesses: ExecutionProcess[]
) {
  const liveProcessIds = new Set(liveProcesses.map((process) => process.id));

  for (const [processId, processState] of Object.entries(previewState)) {
    if (target[processId]) continue;
    if (liveProcessIds.size > 0 && !liveProcessIds.has(processId)) continue;
    target[processId] = processState;
  }
}
