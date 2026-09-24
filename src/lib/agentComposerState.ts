import type {
  DraftFollowUpData,
  Executor,
  ExecutorConfig,
  QueueStatus,
  Session,
} from './vk-client';

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

export const SUPPORTED_PERMISSION_POLICIES = [
  'AUTO',
  'SUPERVISED',
  'PLAN',
] as const;
export const PERMISSION_POLICY_VALUES = [
  '',
  ...SUPPORTED_PERMISSION_POLICIES,
] as const;
export type PermissionPolicy = (typeof SUPPORTED_PERMISSION_POLICIES)[number];

export function resolveExecutor(session: Session | undefined): Executor {
  const value = session?.executor;
  return SUPPORTED_EXECUTORS.includes(value as Executor)
    ? (value as Executor)
    : 'CODEX';
}

export function normalizeExecutorConfig(
  config: ExecutorConfig | undefined,
  fallbackSession?: Session,
): ExecutorConfig & { executor: Executor } {
  return {
    ...config,
    executor: SUPPORTED_EXECUTORS.includes(config?.executor as Executor)
      ? (config!.executor as Executor)
      : resolveExecutor(fallbackSession),
    permission_policy: normalizePermissionPolicy(config?.permission_policy),
  };
}

export function createExecutorConfig(input: {
  executor: Executor;
  variant: string;
  modelId: string;
  reasoningId: string;
  permissionPolicy: string;
}): ExecutorConfig & { executor: Executor } {
  return {
    executor: input.executor,
    variant: input.variant.trim() || null,
    model_id: input.modelId.trim() || null,
    reasoning_id: input.reasoningId.trim() || null,
    permission_policy: normalizePermissionPolicy(input.permissionPolicy),
  };
}

export function normalizePermissionPolicy(
  value: string | null | undefined,
): PermissionPolicy | null {
  return SUPPORTED_PERMISSION_POLICIES.includes(value as PermissionPolicy)
    ? (value as PermissionPolicy)
    : null;
}

export function isCodingAgentProcessRunning(process: {
  status?: string | null;
  run_reason?: string | null;
  completed_at?: string | null;
}): boolean {
  return (
    process.status === 'running' &&
    process.completed_at == null &&
    (process.run_reason == null ||
      process.run_reason === 'codingagent' ||
      process.run_reason === 'setupscript' ||
      process.run_reason === 'cleanupscript' ||
      process.run_reason === 'archivescript')
  );
}

export function draftFromQueuedMessage(
  queue: QueueStatus,
): DraftFollowUpData | null {
  return queue.status === 'queued' ? queue.message.data : null;
}

export function mergeRetainedIframeTabs<T extends { iframeKey: string }>(
  retainedTabs: T[] | undefined,
  visibleTabs: T[],
  visibleKeys: Set<string>,
): T[] {
  if (!retainedTabs) return visibleTabs;
  const visibleByKey = new Map(visibleTabs.map((tab) => [tab.iframeKey, tab]));
  const merged = retainedTabs
    .filter((tab) => visibleKeys.has(tab.iframeKey) || !visibleByKey.has(tab.iframeKey))
    .map((tab) => visibleByKey.get(tab.iframeKey) ?? tab);
  for (const visible of visibleTabs) {
    if (!merged.some((tab) => tab.iframeKey === visible.iframeKey)) {
      merged.push(visible);
    }
  }
  return merged;
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
