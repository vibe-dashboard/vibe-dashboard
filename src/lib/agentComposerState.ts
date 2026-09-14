import type { Executor, ExecutorConfig, Session } from './vk-client';

export const SUPPORTED_EXECUTORS: Executor[] = [
  'CODEX',
  'CLAUDE_CODE',
  'GEMINI',
  'AMP',
  'CURSOR_AGENT',
  'COPILOT',
  'DROID',
  'OPENCODE',
  'QWEN_CODE',
];

export function resolveExecutor(session: Session | undefined): Executor {
  const value = session?.executor;
  return SUPPORTED_EXECUTORS.includes(value as Executor)
    ? (value as Executor)
    : 'CODEX';
}

export function normalizeExecutorConfig(
  config: ExecutorConfig | undefined,
  fallbackSession?: Session,
): ExecutorConfig {
  return {
    ...config,
    executor: SUPPORTED_EXECUTORS.includes(config?.executor as Executor)
      ? (config!.executor as Executor)
      : resolveExecutor(fallbackSession),
  };
}

export function createExecutorConfig(input: {
  executor: Executor;
  variant: string;
  modelId: string;
  reasoningId: string;
  permissionPolicy: string;
}): ExecutorConfig {
  return {
    executor: input.executor,
    variant: input.variant.trim() || null,
    model_id: input.modelId.trim() || null,
    reasoning_id: input.reasoningId.trim() || null,
    permission_policy: input.permissionPolicy.trim() || null,
  };
}

export function agentDraftStorageKey(workspaceId: string, sessionId: string) {
  return `vk:scratch-draft:DRAFT_FOLLOW_UP:${workspaceId}:${sessionId}`;
}

export function serializeAgentDraft(message: string, config: ExecutorConfig) {
  return JSON.stringify({ message, executorConfig: config });
}

export function parseAgentDraft(value: string | null): {
  message: string;
  executorConfig?: ExecutorConfig;
} | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as {
      message?: unknown;
      executorConfig?: ExecutorConfig;
    };
    return typeof parsed.message === 'string'
      ? { message: parsed.message, executorConfig: parsed.executorConfig }
      : null;
  } catch {
    return { message: value };
  }
}
