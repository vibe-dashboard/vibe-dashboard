#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client as defaultClient } from '../core/client.js';
import type { AutoNudgeProcessWindowQuery, AutoNudgeStatusRequest, AutoNudgeStatusResponse, AutoNudgeStatusSession, AutoNudgeStatusWorkspace, ConversationEntry, ExecutionProcess, ExecutionProcessFinalResponse, SendMessageBody, Session, Workspace } from '../types.js';
import { conversationEntryText, conversationEntryType, decideNudgeForProcess, isActiveProcess } from './criteria.js';
import { callbacksForTrigger, DEFAULT_CALLBACK_REGISTRY_PATH, type CallbackRecord } from './callback-registry.js';
import {
  appendResponseRoute,
  bindResponseRouteProcess,
  DEFAULT_RESPONSE_ROUTES_PATH,
  snapshotPendingResponseRoutes,
  updateResponseRoute,
} from './response-routes.js';
import {
  claimNextQueuedSendWhere,
  DEFAULT_SEND_QUEUE_PATH,
  enqueueSend,
  markQueuedSendAccepted,
  markQueuedSendFailed,
  markStaleSendingIndeterminate,
  queuedSendBody,
} from './send-queue.js';
import { DEFAULT_HANDLER_LOG_PATH, runWorkflowHandler } from './workflow-handlers.js';
import { DEFAULT_WORKFLOW_CONFIG_PATH, loadWorkflowConfig, type WorkflowConfig, type WorkflowMessageTypeConfig } from './workflow-config.js';
import { parseWorkflowResultXml, validateWorkflowActions, type WorkflowAction } from './workflow-xml.js';

const DEFAULT_STATE_PATH = '/var/lib/vd/auto-nudge/state.json';
const DEFAULT_LOCK_PATH = '/var/lib/vd/auto-nudge/owner.lock';
export const DEFAULT_WORKSPACE_REGISTRY_PATH = '/var/lib/vd/auto-nudge/workspaces.json';
export const DEFAULT_NUDGE_CONFIG_PATH = '/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/nudge_config.json';
const DEFAULT_POLL_MS = 5 * 60_000;
const RESPONSE_ROUTE_INTENT_STALE_MS = 5 * 60_000;
const GLOBAL_RECOVERY_RECENT_MS = 24 * 60 * 60_000;
const GLOBAL_RECOVERY_WORKSPACES_PER_CYCLE = 25;
const GLOBAL_RECOVERY_SESSIONS_PER_CYCLE = 250;
export const DEFAULT_OVERSEER_PROMPT = `- If all milestones are complete, end your response with "DONE".
- If the next milestone-completion step needs user input, create a beads-form for the user and end your response with "CREATED FORM".
- If you have just completed a milestone, make sure it gets reviewed by the appropriate agents.
- If you approve the review, continue to the next milestone.

Use vibe-agent send ... when a teammate response is needed. Use --fire-and-forget only for notifications that do not require a reply.`;
export const DEFAULT_END_CONDITIONS = ['DONE', 'CREATED FORM'] as const;

export function isAutoNudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.VD_AUTO_NUDGE_ENABLED ?? '').toLowerCase());
}

export interface AutoNudgeConfig {
  version: 1;
  discord?: { enabled: boolean };
  workspaces?: Array<{ workspaceId: string; overseerSessionId: string | null }>;
}
export interface NudgeRuntimeConfig { version: 1; overseerPrompt: string; endConditions: string[] }
export interface NudgeRuntimeConfigLoadResult { config: NudgeRuntimeConfig; error: string | null }
export interface AutoNudgeWorkspaceCriteria { goal?: string; beads?: string[]; beadsDir?: string }
export interface AutoNudgeWorkspaceRegistration { workspaceId: string; overseerSessionId: string; registeredAt: string; registeredBySessionId: string; criteria?: AutoNudgeWorkspaceCriteria }
export interface AutoNudgeWorkspaceRegistry { version: 1; workspaces: Record<string, AutoNudgeWorkspaceRegistration> }
export type TriggerStatus = 'observed' | 'checkpoint-sent' | 'checkpoint-indeterminate' | 'done' | 'delegated' | 'waiting-callback' | 'rate-limited' | 'retryable-failure';
export interface TriggerState { processId: string; workspaceId: string; sessionId: string; observedAt: string; status: TriggerStatus; checkpointProcessId: string | null; baselineProcessIds?: string[]; updatedAt: string; error: string | null }
export interface OutboxItem { id: string; workspaceId: string; content: string; createdAt: string; deliveredAt: string | null; attempts: number }
export interface AutoNudgeState { version: 1; nudgedProcessIds: string[]; triggers: Record<string, TriggerState>; outbox: Record<string, OutboxItem>; globalCursor?: string | null }
export interface AutoNudgeClient {
  getAllWorkspaces?(): Promise<Workspace[]>;
  getSessions(workspaceId: string): Promise<Session[]>;
  getSession(sessionId: string): Promise<Session>;
  getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]>;
  getExecutionProcess(processId: string): Promise<ExecutionProcess>;
  getExecutionProcessFinalResponse(processId: string): Promise<ExecutionProcessFinalResponse>;
  getAutoNudgeStatus(request: AutoNudgeStatusRequest, signal?: AbortSignal): Promise<AutoNudgeStatusResponse>;
  fetchConversation(processId: string, timeoutMs?: number): Promise<ConversationEntry[]>;
  sendMessage(sessionId: string, body: SendMessageBody): Promise<ExecutionProcess>;
}
export interface AutoNudgeOptions {
  config: AutoNudgeConfig; statePath: string; callbackRegistryPath: string; responseRoutesPath?: string; workspaceRegistryPath?: string;
  nudgeConfigPath?: string;
  workflowConfigPath?: string;
  sendQueuePath?: string;
  handlerLogPath?: string;
  now: () => Date; unacknowledgedAfterMs: number; operationTimeoutMs: number; responseTimeoutMs: number;
  concurrency: number; dryRun: boolean; discordWebhookUrl?: string;
  deliverDiscord?: (url: string, content: string) => Promise<void>;
  signal?: AbortSignal;
  checkpointPollMs?: number;
}
export interface AutoNudgeCycleResult {
  workspaces: number; teammateNudges: number; checkpoints: number; responseRoutes: number; discordDeliveries: number; errors: string[];
  registeredWorkspaces: number; globalWorkspacesScanned: number; sessionsScanned: number; processesConsidered: number; pagesFetched: number; truncated: boolean; nextCursor: string | null;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}
export function defaultNudgeRuntimeConfig(): NudgeRuntimeConfig {
  return { version: 1, overseerPrompt: DEFAULT_OVERSEER_PROMPT, endConditions: [...DEFAULT_END_CONDITIONS] };
}
function parseNudgeRuntimeConfig(value: unknown): NudgeRuntimeConfig {
  const input = value as Partial<NudgeRuntimeConfig>;
  if (input.version !== 1) throw new Error('nudge config version must be 1');
  const defaults = defaultNudgeRuntimeConfig();
  const overseerPrompt = input.overseerPrompt == null ? defaults.overseerPrompt : requiredString(input.overseerPrompt, 'overseerPrompt');
  if (input.endConditions != null && !Array.isArray(input.endConditions)) throw new Error('endConditions must be an array');
  const endConditions = (input.endConditions ?? defaults.endConditions)
    .map((item, index) => requiredString(item, `endConditions[${index}]`));
  if (endConditions.length === 0) throw new Error('endConditions must not be empty');
  return { version: 1, overseerPrompt, endConditions };
}
export function loadNudgeRuntimeConfig(filePath = DEFAULT_NUDGE_CONFIG_PATH): NudgeRuntimeConfigLoadResult {
  try {
    return { config: parseNudgeRuntimeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8'))), error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: defaultNudgeRuntimeConfig(), error: null };
    return { config: defaultNudgeRuntimeConfig(), error: `Invalid nudge config at ${filePath}: ${(error as Error).message}` };
  }
}
export function responseMatchesEndCondition(response: string | null | undefined, endConditions: readonly string[]): boolean {
  if (!response) return false;
  const trimmed = response.trimEnd();
  return endConditions.some(marker => trimmed === marker || trimmed.endsWith(`\n${marker}`));
}
export function formatWorkspaceCriteriaBlock(criteria?: AutoNudgeWorkspaceCriteria): string {
  const lines: string[] = [];
  const goal = criteria?.goal?.trim();
  if (goal) lines.push(`Goal: ${goal}`);
  const beads = criteria?.beads?.filter(Boolean) ?? [];
  if (beads.length) {
    lines.push('Beads:');
    for (const bead of beads) lines.push(`- ${bead}`);
  }
  if (!lines.length) return '';
  return `Workspace completion criteria:\n${lines.join('\n')}`;
}
function overseerPromptWithCriteria(prompt: string, criteria?: AutoNudgeWorkspaceCriteria): string {
  const block = formatWorkspaceCriteriaBlock(criteria);
  return block ? `${prompt.trimEnd()}\n\n${block}` : prompt;
}
export function loadAutoNudgeConfig(filePath: string): AutoNudgeConfig {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AutoNudgeConfig>;
  if (value.version !== 1) throw new Error('config.version must be 1');
  if (value.workspaces != null && !Array.isArray(value.workspaces)) throw new Error('config.workspaces must be an array');
  const seen = new Set<string>();
  const workspaces = (value.workspaces ?? []).map((item, index) => {
    const workspaceId = requiredString(item?.workspaceId, `workspaces[${index}].workspaceId`);
    const overseerSessionId = requiredString(item?.overseerSessionId, `workspaces[${index}].overseerSessionId`);
    if (seen.has(workspaceId)) throw new Error(`duplicate workspaceId: ${workspaceId}`);
    seen.add(workspaceId); return { workspaceId, overseerSessionId };
  });
  return { version: 1, discord: { enabled: value.discord?.enabled === true }, workspaces };
}
function workspaceRegistryLockPath(filePath: string): string { return `${filePath}.lock`; }
function withWorkspaceRegistryLock<T>(filePath: string, task: () => T, timeoutMs = 5_000): T {
  const lockPath = workspaceRegistryLockPath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const expiresAt = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number.parseInt(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8'), 10);
        if (Number.isInteger(owner)) process.kill(owner, 0);
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH' || (ownerError as NodeJS.ErrnoException).code === 'ENOENT') {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() >= expiresAt) throw new Error(`Timed out waiting for auto-nudge workspace registry lock ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return task(); }
  finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
}
export function readAutoNudgeWorkspaceRegistry(filePath: string): AutoNudgeWorkspaceRegistry {
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, workspaces: {} };
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) {
    throw new Error(`Invalid auto-nudge workspace registry JSON at ${filePath}: ${(error as Error).message}`);
  }
  const registry = value as Partial<AutoNudgeWorkspaceRegistry>;
  const validRegistration = (item: unknown): item is AutoNudgeWorkspaceRegistration => Boolean(item && typeof item === 'object'
    && typeof (item as AutoNudgeWorkspaceRegistration).workspaceId === 'string'
    && typeof (item as AutoNudgeWorkspaceRegistration).overseerSessionId === 'string'
    && typeof (item as AutoNudgeWorkspaceRegistration).registeredAt === 'string'
    && typeof (item as AutoNudgeWorkspaceRegistration).registeredBySessionId === 'string'
    && (!('criteria' in (item as AutoNudgeWorkspaceRegistration)) || (item as AutoNudgeWorkspaceRegistration).criteria == null || (
      typeof (item as AutoNudgeWorkspaceRegistration).criteria === 'object'
      && (!('goal' in ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria)) || ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).goal == null || typeof ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).goal === 'string')
      && (!('beads' in ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria)) || Array.isArray(((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).beads) && (((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).beads as unknown[]).every(bead => typeof bead === 'string'))
      && (!('beadsDir' in ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria)) || ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).beadsDir == null || typeof ((item as AutoNudgeWorkspaceRegistration).criteria as AutoNudgeWorkspaceCriteria).beadsDir === 'string')
    )));
  if (registry.version !== 1 || !registry.workspaces || typeof registry.workspaces !== 'object'
    || !Object.entries(registry.workspaces).every(([workspaceId, item]) => validRegistration(item) && item.workspaceId === workspaceId)) {
    throw new Error(`Invalid auto-nudge workspace registry schema at ${filePath}`);
  }
  return registry as AutoNudgeWorkspaceRegistry;
}
export function writeAutoNudgeWorkspaceRegistry(filePath: string, registry: AutoNudgeWorkspaceRegistry): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
export function enableAutoNudgeWorkspace(filePath: string, workspaceId: string, overseerSessionId: string, now = new Date(), criteria?: AutoNudgeWorkspaceCriteria): AutoNudgeWorkspaceRegistration {
  return withWorkspaceRegistryLock(filePath, () => {
    const registry = readAutoNudgeWorkspaceRegistry(filePath);
    const item = { workspaceId, overseerSessionId, registeredAt: now.toISOString(), registeredBySessionId: overseerSessionId, ...(criteria ? { criteria } : {}) };
    registry.workspaces[workspaceId] = item;
    writeAutoNudgeWorkspaceRegistry(filePath, registry);
    return item;
  });
}
export function disableAutoNudgeWorkspace(filePath: string, workspaceId: string): boolean {
  return withWorkspaceRegistryLock(filePath, () => {
    const registry = readAutoNudgeWorkspaceRegistry(filePath);
    const existed = Object.prototype.hasOwnProperty.call(registry.workspaces, workspaceId);
    delete registry.workspaces[workspaceId];
    writeAutoNudgeWorkspaceRegistry(filePath, registry);
    return existed;
  });
}
export function readAutoNudgeState(filePath: string): AutoNudgeState {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, nudgedProcessIds: [], triggers: {}, outbox: {}, globalCursor: null };
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new Error(`Invalid auto-nudge state JSON at ${filePath}: ${(error as Error).message}`); }
  const state = value as Partial<AutoNudgeState>;
  const validTrigger = (item: unknown): item is TriggerState => Boolean(item && typeof item === 'object'
    && typeof (item as TriggerState).processId === 'string' && typeof (item as TriggerState).workspaceId === 'string'
    && typeof (item as TriggerState).sessionId === 'string' && typeof (item as TriggerState).observedAt === 'string'
    && typeof (item as TriggerState).updatedAt === 'string'
    && ['observed', 'checkpoint-sent', 'checkpoint-indeterminate', 'done', 'delegated', 'waiting-callback', 'rate-limited', 'retryable-failure'].includes((item as TriggerState).status)
    && ((item as TriggerState).checkpointProcessId == null || typeof (item as TriggerState).checkpointProcessId === 'string')
    && ((item as TriggerState).baselineProcessIds == null || (Array.isArray((item as TriggerState).baselineProcessIds) && (item as TriggerState).baselineProcessIds!.every(id => typeof id === 'string')))
    && ((item as TriggerState).error == null || typeof (item as TriggerState).error === 'string'));
  const validOutbox = (item: unknown): item is OutboxItem => Boolean(item && typeof item === 'object'
    && typeof (item as OutboxItem).id === 'string' && typeof (item as OutboxItem).workspaceId === 'string'
    && typeof (item as OutboxItem).content === 'string' && typeof (item as OutboxItem).createdAt === 'string'
    && ((item as OutboxItem).deliveredAt == null || typeof (item as OutboxItem).deliveredAt === 'string')
    && Number.isSafeInteger((item as OutboxItem).attempts) && (item as OutboxItem).attempts >= 0);
  if (state.version !== 1 || !Array.isArray(state.nudgedProcessIds) || !state.nudgedProcessIds.every(item => typeof item === 'string')
    || !state.triggers || typeof state.triggers !== 'object' || !Object.values(state.triggers).every(validTrigger)
    || !state.outbox || typeof state.outbox !== 'object' || !Object.values(state.outbox).every(validOutbox)
    || (state.globalCursor != null && typeof state.globalCursor !== 'string')) {
    throw new Error(`Invalid auto-nudge state schema at ${filePath}`);
  }
  return { ...state, globalCursor: state.globalCursor ?? null } as AutoNudgeState;
}
export function writeAutoNudgeState(filePath: string, state: AutoNudgeState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
function body(prompt: string, session: Session): SendMessageBody { return { prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null }; }
function finalMessage(entries: ConversationEntry[]): string | null {
  const messages = entries.filter(entry => conversationEntryType(entry) === 'assistant_message').map(conversationEntryText).map(text => text.trim()).filter(Boolean);
  return messages.at(-1) ?? null;
}
function respondMessage(role: string, response: string): string {
  return `Response from ${role}:\n\n${response}`;
}
function terminalTime(process: ExecutionProcess): number { return new Date(process.completed_at ?? process.updated_at ?? process.created_at).getTime(); }
async function deadline<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    if (signal?.aborted) throw new Error('Cancelled');
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        abort = () => reject(new Error('Cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  }
  finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
async function defaultDiscordDelivery(url: string, content: string): Promise<void> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}
async function processOutbox(options: AutoNudgeOptions, state: AutoNudgeState, result: AutoNudgeCycleResult): Promise<void> {
  if (options.dryRun) return;
  if (!options.config.discord?.enabled) return;
  if (!options.discordWebhookUrl) throw new Error('DISCORD_WEBHOOK_URL is required when Discord is enabled');
  for (const item of Object.values(state.outbox).filter(item => !item.deliveredAt)) {
    item.attempts += 1; writeAutoNudgeState(options.statePath, state);
    try {
      await deadline((options.deliverDiscord ?? defaultDiscordDelivery)(options.discordWebhookUrl, item.content), options.operationTimeoutMs, 'Discord delivery', options.signal);
      item.deliveredAt = options.now().toISOString(); writeAutoNudgeState(options.statePath, state); result.discordDeliveries++;
    } catch (error) { result.errors.push(`Discord event ${item.id}: ${(error as Error).message}`); writeAutoNudgeState(options.statePath, state); }
  }
}

function activeSessionIdsFromStatus(status: AutoNudgeStatusResponse): Set<string> {
  return new Set(status.workspaces
    .flatMap(workspace => workspace.sessions)
    .filter(session => session.has_active_codingagent)
    .map(session => session.id));
}

async function processResponseRoutes(
  client: AutoNudgeClient,
  options: AutoNudgeOptions,
  result: AutoNudgeCycleResult,
  sentSessionIds: Set<string>,
  activeSessionIds: Set<string>,
): Promise<void> {
  if (options.dryRun) return;
  const responseRoutesPath = options.responseRoutesPath ?? DEFAULT_RESPONSE_ROUTES_PATH;
  const pendingRoutes = snapshotPendingResponseRoutes(responseRoutesPath);
  const windowQueries: AutoNudgeProcessWindowQuery[] = pendingRoutes
    .filter(route => !route.processId)
    .map(route => {
      const startedAt = new Date(route.sendStartedAt ?? route.createdAt).getTime();
      const finishedAt = route.sendFinishedAt ? new Date(route.sendFinishedAt).getTime() : null;
      const candidateWindowEnd = finishedAt ?? startedAt + RESPONSE_ROUTE_INTENT_STALE_MS;
      return {
        id: route.id,
        session_id: route.targetSessionId,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(candidateWindowEnd).toISOString(),
      };
    });
  const windowResults = new Map<string, string[]>();
  if (windowQueries.length) {
    const status = await fetchAutoNudgeStatus(client, options, [], { processWindowQueries: windowQueries, includeGlobalRecent: false });
    for (const item of status.process_window_results) windowResults.set(item.id, item.process_ids);
  }
  for (const route of pendingRoutes) {
    try {
      let processId = route.processId;
      if (!processId) {
        const startedAt = new Date(route.sendStartedAt ?? route.createdAt).getTime();
        const finishedAt = route.sendFinishedAt ? new Date(route.sendFinishedAt).getTime() : null;
        const candidateWindowEnd = finishedAt ?? startedAt + RESPONSE_ROUTE_INTENT_STALE_MS;
        const candidates = windowResults.get(route.id) ?? [];
        if (candidates.length === 0 && options.now().getTime() > candidateWindowEnd + RESPONSE_ROUTE_INTENT_STALE_MS) {
          updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending'
            ? { ...current, status: 'failed', updatedAt: options.now().toISOString(), error: 'stale response route intent did not reconcile to an accepted process' }
            : current);
          continue;
        }
        if (candidates.length === 0) continue;
        if (candidates.length > 1) {
          updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending'
            ? { ...current, status: 'failed', updatedAt: options.now().toISOString(), error: `ambiguous response route intent matched ${candidates.length} processes` }
            : current);
          continue;
        }
        const candidate = candidates[0];
        if (!candidate) continue;
        processId = candidate;
        const bound = bindResponseRouteProcess(responseRoutesPath, route.id, processId, options.now().toISOString());
        if (!bound || bound.status !== 'pending' || bound.processId !== processId) continue;
      }
      const routedProcessId = await currentResponseRouteProcess(responseRoutesPath, route.id, processId, client, options);
      if (!routedProcessId) continue;
      processId = routedProcessId;
      const final = await deadline(client.getExecutionProcessFinalResponse(processId), options.operationTimeoutMs, 'get final response', options.signal);
      if (!final.finished) continue;
      if (!final.final_response) {
        updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending' && current.processId === processId
          ? {
            ...current,
            status: 'terminal-no-response',
            updatedAt: options.now().toISOString(),
            error: final.terminal_no_response ? 'target process ended without a final assistant response' : null,
          }
          : current);
        continue;
      }
      if (activeSessionIds.has(route.replySessionId) || sentSessionIds.has(route.replySessionId)) continue;
      const replySession = await deadline(client.getSession(route.replySessionId), options.operationTimeoutMs, 'get reply session', options.signal);
      const delivered = await deadline(
        client.sendMessage(route.replySessionId, {
          prompt: respondMessage(route.targetRole, final.final_response),
          executor_config: { executor: replySession.executor },
          retry_process_id: null,
          force_when_dirty: null,
          perform_git_reset: null,
        }),
        options.operationTimeoutMs,
        'deliver response route',
        options.signal,
      );
      const updated = updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending' && current.processId === processId
        ? { ...current, status: 'delivered', deliveredProcessId: delivered.id, updatedAt: options.now().toISOString(), error: null }
        : current);
      if (updated?.status === 'delivered') {
        sentSessionIds.add(route.replySessionId);
        activeSessionIds.add(route.replySessionId);
        result.responseRoutes++;
      }
    } catch (error) {
      updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending'
        ? { ...current, error: (error as Error).message, updatedAt: options.now().toISOString() }
        : current);
      result.errors.push(`response route ${route.id}: ${(error as Error).message}`);
    }
  }
}

async function processSendQueue(client: AutoNudgeClient, options: AutoNudgeOptions, result: AutoNudgeCycleResult, status: AutoNudgeStatusResponse, sentSessionIds: Set<string>): Promise<void> {
  if (options.dryRun) return;
  const queuePath = options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH;
  const staleBefore = new Date(options.now().getTime() - Math.max(options.operationTimeoutMs * 2, 60_000));
  for (const send of markStaleSendingIndeterminate(queuePath, staleBefore, options.now())) {
    result.errors.push(`queued send ${send.id}: ${send.error}`);
  }
  const activeSessions = activeSessionIdsFromStatus(status);
  while (!options.signal?.aborted) {
    const queued = claimNextQueuedSendWhere(queuePath, send => !activeSessions.has(send.targetSessionId) && !sentSessionIds.has(send.targetSessionId), options.now());
    if (!queued) return;
    try {
      const sent = await deadline(client.sendMessage(queued.targetSessionId, queuedSendBody(queued)), options.operationTimeoutMs, 'send queued message', options.signal);
      sentSessionIds.add(queued.targetSessionId);
      activeSessions.add(queued.targetSessionId);
      if (queued.replySessionId) {
        appendResponseRoute(options.responseRoutesPath ?? DEFAULT_RESPONSE_ROUTES_PATH, {
          processId: sent.id,
          replySessionId: queued.replySessionId,
          targetRole: queued.targetRole,
          targetSessionId: queued.targetSessionId,
          createdAt: queued.createdAt,
          updatedAt: options.now().toISOString(),
          sendStartedAt: queued.updatedAt,
          sendFinishedAt: options.now().toISOString(),
        });
      }
      markQueuedSendAccepted(queuePath, queued.id, sent.id, options.now());
    } catch (error) {
      markQueuedSendFailed(queuePath, queued.id, (error as Error).message, options.now());
      result.errors.push(`queued send ${queued.id}: ${(error as Error).message}`);
    }
  }
}

async function currentResponseRouteProcess(
  responseRoutesPath: string,
  routeId: string,
  initialProcessId: string,
  client: AutoNudgeClient,
  options: AutoNudgeOptions,
): Promise<string | null> {
  let processId = initialProcessId;
  for (let depth = 0; depth < 8; depth++) {
    const callbacks = callbacksForTrigger(options.callbackRegistryPath, processId, options.now());
    if (callbacks.some(item => item.status === 'running')) return null;
    const completion = latestFinishedCallbackWithProcess(callbacks);
    if (completion?.completionProcessId && completion.completionProcessId !== processId) {
      const nextProcessId = completion.completionProcessId;
      const updated = updateResponseRoute(responseRoutesPath, routeId, route => {
        if (route.status !== 'pending' || route.processId !== processId) return route;
        return { ...route, processId: nextProcessId, updatedAt: options.now().toISOString(), error: null };
      });
      if (!updated || updated.status !== 'pending' || updated.processId !== nextProcessId) return null;
      processId = nextProcessId;
      continue;
    }
    const final = await deadline(client.getExecutionProcessFinalResponse(processId), options.operationTimeoutMs, 'get final response', options.signal);
    return final.finished ? processId : null;
  }
  updateResponseRoute(responseRoutesPath, routeId, route => route.status === 'pending'
    ? { ...route, status: 'failed', updatedAt: options.now().toISOString(), error: 'response route callback chain exceeded 8 processes' }
    : route);
  return null;
}

function latestFinishedCallbackWithProcess(callbacks: CallbackRecord[]): CallbackRecord | null {
  return callbacks
    .filter(item => item.status !== 'running' && item.completionProcessId)
    .sort((left, right) => (right.finishedAt ?? '').localeCompare(left.finishedAt ?? '') || right.id.localeCompare(left.id))[0] ?? null;
}

async function executeWorkflowActions(
  actions: WorkflowAction[],
  config: WorkflowConfig,
  client: AutoNudgeClient,
  options: AutoNudgeOptions,
  context: { workspaceId: string; triggerProcessId: string; sessions: Session[]; replySessionId: string },
): Promise<void> {
  const queuePath = options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH;
  const sendActions: Array<{ action: WorkflowAction; messageType: WorkflowMessageTypeConfig; prompt: string; target: Session }> = [];
  for (const action of actions) {
    if (action.type === 'wait') continue;
    if (action.type === 'send_message') {
      const messageType = action.messageType ? config.messageTypes[action.messageType] : null;
      if (!messageType) throw new Error(`Unknown message_type ${action.messageType ?? '(missing)'}`);
      const prompt = config.prompts[messageType.promptId]?.text;
      if (!prompt) throw new Error(`Prompt ${messageType.promptId} was not found`);
      const target = context.sessions.find(session => session.name === action.role);
      if (!target) throw new Error(`No current session found for role ${action.role}`);
      sendActions.push({ action, messageType, prompt, target });
      continue;
    }
    if (action.type === 'run_handler') {
      const handler = action.handlerId ? config.handlers[action.handlerId] : null;
      if (!handler) throw new Error(`Unknown handler ${action.handlerId ?? '(missing)'}`);
      const handlerResult = await runWorkflowHandler(handler, {
        idempotencyKey: `${context.triggerProcessId}:handler:${action.handlerId}`,
        action,
        workspaceId: context.workspaceId,
        triggerProcessId: context.triggerProcessId,
        dryRun: options.dryRun,
      }, { logPath: options.handlerLogPath ?? DEFAULT_HANDLER_LOG_PATH, timeoutMs: handler.timeoutMs });
      if (handlerResult.status === 'failed') throw new Error(`handler ${action.handlerId} failed: ${handlerResult.error ?? `exit ${handlerResult.exitCode}`}`);
    }
  }
  for (const { action, messageType, prompt, target } of sendActions) {
    if (!options.dryRun) {
      enqueueSend(queuePath, {
        targetRole: action.role ?? messageType.toRole,
        targetSessionId: target.id,
        executor: target.executor,
        prompt: workflowPromptWithContext(prompt, action),
        replySessionId: context.replySessionId,
        now: options.now(),
        id: `${context.triggerProcessId}:${action.type}:${action.role ?? ''}:${action.messageType ?? ''}`,
      });
    }
  }
}

function workflowPromptWithContext(prompt: string, action: WorkflowAction): string {
  const lines = [prompt.trimEnd()];
  if (action.beadIds.length) lines.push('', `Beads: ${action.beadIds.join(', ')}`);
  if (action.formIds.length) lines.push(`Forms: ${action.formIds.join(', ')}`);
  return lines.join('\n');
}
async function mapLimit<T>(values: T[], limit: number, task: (value: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      if (signal?.aborted) throw new Error('Cancelled');
      const value = values[index++];
      if (value !== undefined) await task(value);
    }
  }));
}

function registeredWorkspacesForCycle(options: AutoNudgeOptions): Array<{ workspaceId: string; overseerSessionId: string; criteria?: AutoNudgeWorkspaceCriteria }> {
  const registered = options.workspaceRegistryPath
    ? Object.values(readAutoNudgeWorkspaceRegistry(options.workspaceRegistryPath).workspaces)
    : options.config.workspaces ?? [];
  return registered
    .map(item => {
      const criteria = (item as AutoNudgeWorkspaceRegistration).criteria;
      return { workspaceId: item.workspaceId, overseerSessionId: item.overseerSessionId ?? '', ...(criteria ? { criteria } : {}) };
    })
    .filter(item => item.workspaceId && item.overseerSessionId)
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

async function fetchAutoNudgeStatus(
  client: AutoNudgeClient,
  options: AutoNudgeOptions,
  registeredWorkspaceIds: string[],
  extra: { processWindowQueries?: AutoNudgeProcessWindowQuery[]; includeGlobalRecent?: boolean } = {},
): Promise<AutoNudgeStatusResponse> {
  const request: AutoNudgeStatusRequest = {
    registered_workspace_ids: registeredWorkspaceIds,
    include_global_recent: extra.includeGlobalRecent ?? true,
    global_cursor: options.dryRun ? null : readAutoNudgeState(options.statePath).globalCursor ?? null,
    updated_after: new Date(options.now().getTime() - GLOBAL_RECOVERY_RECENT_MS).toISOString(),
    limit_workspaces: GLOBAL_RECOVERY_WORKSPACES_PER_CYCLE,
    limit_sessions: GLOBAL_RECOVERY_SESSIONS_PER_CYCLE,
    process_window_queries: extra.processWindowQueries ?? [],
  };
  try {
    return await deadline(client.getAutoNudgeStatus(request, options.signal), options.operationTimeoutMs, 'auto-nudge aggregate status', options.signal);
  } catch (error) {
    throw new Error(`auto-nudge aggregate status endpoint is required and must not fall back to WebSockets: ${(error as Error).message}`);
  }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Cancelled')); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function waitForTerminalProcess(client: AutoNudgeClient, processId: string, options: AutoNudgeOptions): Promise<ExecutionProcess> {
  const expiresAt = Date.now() + options.responseTimeoutMs;
  while (true) {
    if (options.signal?.aborted) throw new Error('Cancelled');
    const process = await deadline(client.getExecutionProcess(processId), options.operationTimeoutMs, 'get checkpoint process', options.signal);
    if (!isActiveProcess(process)) return process;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) throw new Error(`checkpoint response timed out after ${options.responseTimeoutMs}ms`);
    await abortableDelay(Math.min(options.checkpointPollMs ?? 1_000, remaining), options.signal);
  }
}

function sessionFromStatus(session: AutoNudgeStatusSession): Session {
  return {
    id: session.id,
    workspace_id: session.workspace_id,
    executor: session.executor,
    name: session.name,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function finalFromAggregate(process: ExecutionProcess): ExecutionProcessFinalResponse {
  const aggregate = process as ExecutionProcess & { final_response?: string | null; terminal_no_response?: boolean | null };
  return {
    process_id: process.id,
    status: process.status,
    finished: process.status !== 'running',
    final_response: aggregate.final_response ?? null,
    terminal_no_response: aggregate.terminal_no_response ?? (process.status !== 'running' && process.status !== 'completed'),
  };
}

function latestProcessForSession(session: AutoNudgeStatusSession): ExecutionProcess[] {
  return session.latest_codingagent_process ? [session.latest_codingagent_process] : [];
}

export async function runAutoNudgeCycle(client: AutoNudgeClient, options: AutoNudgeOptions): Promise<AutoNudgeCycleResult> {
  const state = readAutoNudgeState(options.statePath);
  const result: AutoNudgeCycleResult = {
    workspaces: 0, teammateNudges: 0, checkpoints: 0, responseRoutes: 0, discordDeliveries: 0, errors: [],
    registeredWorkspaces: 0, globalWorkspacesScanned: 0, sessionsScanned: 0, processesConsidered: 0, pagesFetched: 0, truncated: false, nextCursor: null,
  };
  const nudgeConfig = loadNudgeRuntimeConfig(options.nudgeConfigPath ?? DEFAULT_NUDGE_CONFIG_PATH);
  const workflowConfig = loadWorkflowConfig(options.workflowConfigPath ?? DEFAULT_WORKFLOW_CONFIG_PATH);
  if (nudgeConfig.error) result.errors.push(nudgeConfig.error);
  const registered = registeredWorkspacesForCycle(options);
  const registeredByWorkspace = new Map(registered.map(item => [item.workspaceId, item]));
  const status = await fetchAutoNudgeStatus(client, options, registered.map(item => item.workspaceId));
  const sentSessionIds = new Set<string>();
  const activeSessionIds = activeSessionIdsFromStatus(status);
  await processResponseRoutes(client, options, result, sentSessionIds, activeSessionIds);
  result.registeredWorkspaces = status.counts.registered_workspaces;
  result.globalWorkspacesScanned = status.counts.global_workspaces;
  result.sessionsScanned += status.counts.sessions;
  result.processesConsidered += status.counts.processes;
  result.pagesFetched += status.counts.pages;
  result.truncated = status.truncated;
  result.nextCursor = status.next_cursor;
  if (!options.dryRun && state.globalCursor !== status.next_cursor) {
    state.globalCursor = status.next_cursor;
    writeAutoNudgeState(options.statePath, state);
  }
  const workspaces = status.workspaces
    .slice()
    .sort((left, right) => Number(!registeredByWorkspace.has(left.workspace_id)) - Number(!registeredByWorkspace.has(right.workspace_id)) || left.workspace_id.localeCompare(right.workspace_id));
  await mapLimit(workspaces, options.concurrency, async snapshot => {
    const configured = registeredByWorkspace.get(snapshot.workspace_id) ?? { workspaceId: snapshot.workspace_id, overseerSessionId: null as string | null, criteria: undefined };
    result.workspaces++;
    try {
      const sessions = snapshot.sessions.map(sessionFromStatus);
      const overseer = configured.overseerSessionId ? sessions.find(item => item.id === configured.overseerSessionId) : null;
      if (configured.overseerSessionId && !overseer) throw new Error(`configured overseer session ${configured.overseerSessionId} was not found`);
      const processMap = new Map<string, ExecutionProcess[]>();
      for (const session of snapshot.sessions) processMap.set(session.id, latestProcessForSession(session));
      const relevantProcesses = [...processMap.values()].flat().filter(item => item.run_reason === 'codingagent' && !item.dropped);
      const teammateProcesses = sessions.filter(item => item.id !== overseer?.id)
        .flatMap(item => processMap.get(item.id) ?? [])
        .filter(item => item.run_reason === 'codingagent' && !item.dropped);
      if (!overseer) {
        if (relevantProcesses.some(isActiveProcess)) return;
        const teammates = sessions.sort((left, right) => {
          const leftLatest = Math.max(...(processMap.get(left.id) ?? []).map(terminalTime), 0);
          const rightLatest = Math.max(...(processMap.get(right.id) ?? []).map(terminalTime), 0);
          return rightLatest - leftLatest || left.id.localeCompare(right.id);
        });
        for (const teammate of teammates) {
          const processes = (processMap.get(teammate.id) ?? []).filter(item => item.run_reason === 'codingagent' && !item.dropped).sort((a, b) => terminalTime(b) - terminalTime(a));
          if (processes.some(isActiveProcess)) continue;
          const latest = processes[0]; if (!latest) continue;
          const final = finalFromAggregate(latest);
          const decision = final.terminal_no_response && latest.status !== 'completed'
            ? { shouldNudge: true }
            : decideNudgeForProcess(latest, final.final_response ? [{ content: { entry_type: { type: 'assistant_message' }, content: final.final_response } }] : [], { enableActiveStaleNudge: false, now: options.now() });
          if (decision.shouldNudge && !state.nudgedProcessIds.includes(latest.id)) {
            if (!options.dryRun) {
              await deadline(client.sendMessage(teammate.id, body('Please continue', teammate)), options.operationTimeoutMs, 'send teammate nudge', options.signal);
              sentSessionIds.add(teammate.id);
            }
            if (!options.dryRun) { state.nudgedProcessIds.push(latest.id); writeAutoNudgeState(options.statePath, state); }
            result.teammateNudges++; return;
          }
        }
        return;
      }
      const orphanedCheckpoint = Object.values(state.triggers)
        .find(trigger => trigger.workspaceId === configured.workspaceId
          && trigger.status === 'checkpoint-sent' && trigger.checkpointProcessId === null);
      if (orphanedCheckpoint) {
        if (!options.dryRun) {
          orphanedCheckpoint.status = 'checkpoint-indeterminate';
          orphanedCheckpoint.error = 'checkpoint delivery outcome is indeterminate; automatic resend is disabled and manual recovery is required';
          orphanedCheckpoint.updatedAt = options.now().toISOString();
          writeAutoNudgeState(options.statePath, state);
        }
        result.errors.push(`workspace ${configured.workspaceId}: checkpoint delivery outcome is indeterminate; automatic resend is disabled and manual recovery is required`);
        return;
      }
      const indeterminateCheckpoint = Object.values(state.triggers)
        .find(trigger => trigger.workspaceId === configured.workspaceId && trigger.status === 'checkpoint-indeterminate');
      if (indeterminateCheckpoint) {
        result.errors.push(`workspace ${configured.workspaceId}: ${indeterminateCheckpoint.error ?? 'checkpoint delivery outcome is indeterminate; manual recovery is required'}`);
        return;
      }
      const reconcileCheckpoint = async (trigger: TriggerState): Promise<void> => {
        if (!trigger.checkpointProcessId) return;
        const baselineIds = new Set(trigger.baselineProcessIds ?? []);
        try {
          const checkpoint = await waitForTerminalProcess(client, trigger.checkpointProcessId, options);
          const final = await deadline(client.getExecutionProcessFinalResponse(checkpoint.id), options.operationTimeoutMs, 'fetch checkpoint final response', options.signal);
          const response = final.final_response;
          trigger.error = null;
          const workflowResult = response ? parseWorkflowResultXml(response) : null;
          if (workflowResult) {
            validateWorkflowActions(workflowResult, workflowConfig, 'overseer');
            await executeWorkflowActions(workflowResult.actions, workflowConfig, client, options, {
              workspaceId: configured.workspaceId,
              triggerProcessId: trigger.processId,
              sessions,
              replySessionId: overseer?.id ?? configured.overseerSessionId,
            });
            trigger.status = 'delegated';
          } else if (responseMatchesEndCondition(response, nudgeConfig.config.endConditions)) {
            trigger.status = 'done';
          } else {
            const refreshedStatus = await fetchAutoNudgeStatus(client, options, [configured.workspaceId], { includeGlobalRecent: false });
            const refreshed = refreshedStatus.workspaces.flatMap(item => item.sessions.flatMap(latestProcessForSession));
            result.sessionsScanned += refreshedStatus.counts.sessions;
            result.processesConsidered += refreshedStatus.counts.processes;
            result.pagesFetched += refreshedStatus.counts.pages;
            const delegated = refreshed.some(item => item.run_reason === 'codingagent' && !item.dropped && !baselineIds.has(item.id));
            const callbackRegistered = callbacksForTrigger(options.callbackRegistryPath, checkpoint.id, options.now())
              .some(item => item.status === 'running' || item.status === 'completed');
            if (delegated || callbackRegistered) trigger.status = 'delegated';
            else if (checkpoint.status === 'completed') { trigger.status = 'observed'; trigger.checkpointProcessId = null; }
            else {
              trigger.status = 'retryable-failure';
              trigger.error = `checkpoint ${checkpoint.id} ended ${checkpoint.status} without a final response`;
              trigger.checkpointProcessId = null;
            }
          }
          trigger.updatedAt = options.now().toISOString(); result.checkpoints++;
        } catch (error) {
          trigger.status = 'checkpoint-sent'; trigger.error = (error as Error).message; trigger.updatedAt = options.now().toISOString();
        }
        writeAutoNudgeState(options.statePath, state);
      };
      const persistedCheckpoint = Object.values(state.triggers)
        .filter(trigger => trigger.workspaceId === configured.workspaceId && trigger.status === 'checkpoint-sent' && trigger.checkpointProcessId)
        .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.processId.localeCompare(right.processId))[0];
      if (persistedCheckpoint) { if (!options.dryRun) await reconcileCheckpoint(persistedCheckpoint); return; }
      if (relevantProcesses.some(isActiveProcess)) return;
      const teammates = sessions.filter(item => item.id !== overseer.id).sort((left, right) => {
        const leftLatest = Math.max(...(processMap.get(left.id) ?? []).map(terminalTime), 0);
        const rightLatest = Math.max(...(processMap.get(right.id) ?? []).map(terminalTime), 0);
        return rightLatest - leftLatest || left.id.localeCompare(right.id);
      });
      for (const teammate of teammates) {
        const processes = (processMap.get(teammate.id) ?? []).filter(item => item.run_reason === 'codingagent' && !item.dropped).sort((a, b) => terminalTime(b) - terminalTime(a));
        if (processes.some(isActiveProcess)) continue;
        const latest = processes[0]; if (!latest) continue;
        const final = latest.status === 'completed'
          ? await deadline(client.getExecutionProcessFinalResponse(latest.id), options.operationTimeoutMs, 'fetch final response', options.signal)
          : finalFromAggregate(latest);
        const decision = final.terminal_no_response && latest.status !== 'completed'
          ? { shouldNudge: true }
          : decideNudgeForProcess(latest, final.final_response ? [{ content: { entry_type: { type: 'assistant_message' }, content: final.final_response } }] : [], { enableActiveStaleNudge: false, now: options.now() });
        if (decision.shouldNudge && !state.nudgedProcessIds.includes(latest.id)) {
          if (!options.dryRun) {
            await deadline(client.sendMessage(teammate.id, body('Please continue', teammate)), options.operationTimeoutMs, 'send teammate nudge', options.signal);
            sentSessionIds.add(teammate.id);
          }
          if (!options.dryRun) { state.nudgedProcessIds.push(latest.id); writeAutoNudgeState(options.statePath, state); }
          result.teammateNudges++; return;
        }
        if (latest.status !== 'completed' || !final.final_response) continue;
        const age = options.now().getTime() - terminalTime(latest); if (age < options.unacknowledgedAfterMs) continue;
        const now = options.now().toISOString();
        const trigger = state.triggers[latest.id] ?? { processId: latest.id, workspaceId: configured.workspaceId, sessionId: teammate.id, observedAt: now, status: 'observed' as const, checkpointProcessId: null, baselineProcessIds: [], updatedAt: now, error: null };
        state.triggers[latest.id] = trigger;
        if (['done', 'delegated', 'rate-limited'].includes(trigger.status)) continue;
        const laterProgress = teammateProcesses.some(item => item.id !== latest.id && new Date(item.created_at).getTime() > terminalTime(latest));
        if (laterProgress) {
          trigger.status = 'delegated'; trigger.updatedAt = now;
          if (!options.dryRun) writeAutoNudgeState(options.statePath, state);
          continue;
        }
        const callbacks = callbacksForTrigger(options.callbackRegistryPath, latest.id, options.now(), !options.dryRun);
        if (callbacks.some(item => item.status === 'running')) {
          trigger.status = 'waiting-callback'; trigger.updatedAt = now;
          if (!options.dryRun) writeAutoNudgeState(options.statePath, state);
          return;
        }
        if (options.dryRun) { result.checkpoints++; return; }
        const baselineIds = new Set(trigger.baselineProcessIds?.length ? trigger.baselineProcessIds : teammateProcesses.map(item => item.id));
        try {
          if (!trigger.checkpointProcessId) {
            trigger.status = 'checkpoint-sent'; trigger.baselineProcessIds = [...baselineIds]; trigger.updatedAt = now;
            writeAutoNudgeState(options.statePath, state);
            const sent = await deadline(client.sendMessage(overseer.id, body(overseerPromptWithCriteria(nudgeConfig.config.overseerPrompt, configured.criteria), overseer)), options.operationTimeoutMs, 'send checkpoint', options.signal);
            sentSessionIds.add(overseer.id);
            trigger.checkpointProcessId = sent.id; trigger.updatedAt = options.now().toISOString();
            writeAutoNudgeState(options.statePath, state);
          }
          await reconcileCheckpoint(trigger);
        } catch (error) {
          trigger.status = trigger.checkpointProcessId ? 'checkpoint-sent' : 'retryable-failure';
          trigger.error = (error as Error).message; trigger.updatedAt = options.now().toISOString();
          writeAutoNudgeState(options.statePath, state);
        }
        return;
      }
    } catch (error) { result.errors.push(`workspace ${configured.workspaceId}: ${(error as Error).message}`); }
  }, options.signal);
  await processSendQueue(client, options, result, status, sentSessionIds);
  await processOutbox(options, state, result);
  return result;
}

function parseArgs(args: string[]): { registryPath: string; statePath: string; once: boolean; dryRun: boolean } {
  let registryPath = process.env.VD_AUTO_NUDGE_REGISTRY_PATH ?? DEFAULT_WORKSPACE_REGISTRY_PATH;
  let statePath = DEFAULT_STATE_PATH, once = false, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--registry') registryPath = args[++index] ?? '';
    else if (args[index] === '--config') throw new Error('--config is no longer supported; use vibe-agent auto-nudge enable to register workspaces');
    else if (args[index] === '--state') statePath = args[++index] ?? '';
    else if (args[index] === '--once') once = true;
    else if (args[index] === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!registryPath) throw new Error('--registry <path> is required');
  return { registryPath, statePath, once, dryRun };
}
export function acquireLock(lockPath = DEFAULT_LOCK_PATH): () => void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try { fs.mkdirSync(lockPath); } catch {
    const owner = Number.parseInt(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8'), 10);
    try { process.kill(owner, 0); throw new Error(`another auto-nudge owner (${owner}) holds ${lockPath}`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      fs.rmSync(lockPath, { recursive: true, force: true });
      fs.mkdirSync(lockPath);
    }
  }
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
  return () => fs.rmSync(lockPath, { recursive: true, force: true });
}
export async function runWithOwnerLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const release = acquireLock(lockPath);
  try { return await task(); }
  finally { release(); }
}
type VibeClientAdapterSource = Pick<typeof defaultClient, 'getAllWorkspaces' | 'getSessions' | 'getSession' | 'getSessionProcesses' | 'fetchConversation' | 'sendMessage' | 'getExecutionProcess' | 'getExecutionProcessFinalResponse' | 'getExecutionProcessFinalResponseStrict' | 'getAutoNudgeStatus'>;

export function createAutoNudgeClient(source: VibeClientAdapterSource): AutoNudgeClient {
  return {
    getAllWorkspaces: () => source.getAllWorkspaces(),
    getSessions: id => source.getSessions(id), getSessionProcesses: id => source.getSessionProcesses(id),
    getSession: id => source.getSession(id),
    getExecutionProcess: id => source.getExecutionProcess(id),
    getExecutionProcessFinalResponse: id => source.getExecutionProcessFinalResponseStrict(id),
    getAutoNudgeStatus: (request, signal) => source.getAutoNudgeStatus(request, signal),
    fetchConversation: (id, timeout) => source.fetchConversation(id, timeout), sendMessage: (id, request) => source.sendMessage(id, request),
  };
}
export function makeClient(): AutoNudgeClient { return createAutoNudgeClient(defaultClient); }
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)); const config = { version: 1 as const, discord: { enabled: false }, workspaces: [] };
  if (!isAutoNudgeEnabled()) {
    console.log('vibe-agent auto-nudge daemon disabled; set VD_AUTO_NUDGE_ENABLED=true to enable response routing and nudges');
    return;
  }
  let stopping = false;
  await runWithOwnerLock(process.env.VD_AUTO_NUDGE_LOCK_PATH ?? DEFAULT_LOCK_PATH, async () => {
    const abortController = new AbortController();
    const stop = () => { stopping = true; abortController.abort(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const options: AutoNudgeOptions = { config, statePath: args.statePath, callbackRegistryPath: process.env.VD_CALLBACK_REGISTRY_PATH ?? DEFAULT_CALLBACK_REGISTRY_PATH, responseRoutesPath: process.env.VD_RESPONSE_ROUTES_PATH ?? DEFAULT_RESPONSE_ROUTES_PATH, workspaceRegistryPath: args.registryPath, nudgeConfigPath: process.env.VD_AUTO_NUDGE_CONFIG_PATH ?? DEFAULT_NUDGE_CONFIG_PATH, workflowConfigPath: process.env.VD_AUTO_NUDGE_WORKFLOW_CONFIG_PATH ?? DEFAULT_WORKFLOW_CONFIG_PATH, sendQueuePath: process.env.VD_SEND_QUEUE_PATH ?? DEFAULT_SEND_QUEUE_PATH, handlerLogPath: process.env.VD_HANDLER_LOG_PATH ?? DEFAULT_HANDLER_LOG_PATH, now: () => new Date(), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 15_000, responseTimeoutMs: 30 * 60_000, concurrency: 4, dryRun: args.dryRun, discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL, signal: abortController.signal };
    do { const result = await runAutoNudgeCycle(makeClient(), options); console.log(JSON.stringify({ type: 'auto-nudge-cycle', at: new Date().toISOString(), ...result })); if (!args.once && !stopping) { try { await abortableDelay(DEFAULT_POLL_MS, abortController.signal); } catch { /* Shutdown aborts the poll delay. */ } } } while (!args.once && !stopping);
  });
  if (stopping || args.once) process.exit(0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main().catch(error => { console.error(`auto-nudge failed: ${(error as Error).message}`); process.exitCode = 1; });
