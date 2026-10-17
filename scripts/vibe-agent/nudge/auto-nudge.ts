#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import * as Ajv2020Module from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { buildBeadsFormsSummary, compileBeadsForm, type StandardBeadsForm } from '../../../packages/beads-form/src/index.js';
import { client as defaultClient } from '../core/client.js';
import type { AutoNudgeProcessWindowQuery, AutoNudgeStatusRequest, AutoNudgeStatusResponse, AutoNudgeStatusSession, AutoNudgeStatusWorkspace, ConversationEntry, CreateSessionBody, ExecutionProcess, ExecutionProcessFinalResponse, SendMessageBody, Session, Workspace } from '../types.js';
import { conversationEntryText, conversationEntryType, isActiveProcess } from './criteria.js';
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
  deferClaimedQueuedSend,
  enqueueSend,
  enqueueSendIdempotent,
  markQueuedSendAccepted,
  markQueuedSendFailed,
  markStaleSendingIndeterminate,
  queuedSendBody,
  readSendQueue,
} from './send-queue.js';
import { DEFAULT_HANDLER_LOG_PATH, runWorkflowHandler } from './workflow-handlers.js';
import { DEFAULT_WORKFLOW_CONFIG_PATH, loadWorkflowConfig, type WorkflowConfig, type WorkflowMessageTypeConfig } from './workflow-config.js';
import { parseWorkflowResultXml, schemaHash, validateWorkflowActions, type WorkflowAction, type WorkflowSchemaIdentity } from './workflow-xml.js';

const DEFAULT_STATE_PATH = '/var/lib/vd/auto-nudge/state.json';
const DEFAULT_LOCK_PATH = '/var/lib/vd/auto-nudge/owner.lock';
export const DEFAULT_WORKSPACE_REGISTRY_PATH = '/var/lib/vd/auto-nudge/workspaces.json';
export const DEFAULT_POLL_SECONDS = 300;
export const MIN_POLL_SECONDS = 5;
export const MAX_POLL_SECONDS = 3_600;
const RESPONSE_ROUTE_INTENT_STALE_MS = 5 * 60_000;
const GLOBAL_RECOVERY_RECENT_MS = 24 * 60 * 60_000;
const GLOBAL_RECOVERY_WORKSPACES_PER_CYCLE = 25;
const GLOBAL_RECOVERY_SESSIONS_PER_CYCLE = 250;
const execFile = promisify(execFileCallback);
const Ajv2020 = (Ajv2020Module.default ?? Ajv2020Module) as unknown as new (options?: Record<string, unknown>) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors?: ValidateFunction['errors']): string;
};
export function isAutoNudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.VD_AUTO_NUDGE_ENABLED ?? '').toLowerCase());
}

export interface AutoNudgeConfig {
  version: 1;
  discord?: { enabled: boolean };
  workspaces?: Array<{ workspaceId: string; overseerSessionId: string | null }>;
}
export interface AutoNudgeWorkspaceCriteria { goal?: string; beads?: string[]; beadsDir?: string }
export interface AutoNudgeWorkspaceRegistration { workspaceId: string; overseerSessionId: string; registeredAt: string; registeredBySessionId: string; criteria?: AutoNudgeWorkspaceCriteria }
export interface AutoNudgeWorkspaceRegistry { version: 1; workspaces: Record<string, AutoNudgeWorkspaceRegistration> }
export type TriggerStatus = 'observed' | 'checkpoint-sent' | 'checkpoint-indeterminate' | 'done' | 'delegated' | 'waiting-callback' | 'rate-limited' | 'retryable-failure' | 'invalid-response';
export interface TriggerState { processId: string; workspaceId: string; sessionId: string; observedAt: string; status: TriggerStatus; checkpointProcessId: string | null; baselineProcessIds?: string[]; correctionAttempts?: number; correctionSendId?: string; updatedAt: string; error: string | null }
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
  createSession?(body: CreateSessionBody): Promise<Session>;
}
export interface AutoNudgeOptions {
  config: AutoNudgeConfig; statePath: string; callbackRegistryPath: string; responseRoutesPath?: string; workspaceRegistryPath?: string;
  workflowConfigPath?: string;
  sendQueuePath?: string;
  handlerLogPath?: string;
  now: () => Date; unacknowledgedAfterMs: number; operationTimeoutMs: number; responseTimeoutMs: number;
  concurrency: number; dryRun: boolean; discordWebhookUrl?: string;
  deliverDiscord?: (url: string, content: string) => Promise<void>;
  createForm?: (input: { beadsDir: string; beadId: string; form: ReturnType<typeof compileBeadsForm>; workspaceId: string; sessionId: string }) => Promise<void>;
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

export function pollIntervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS;
  if (raw == null || raw === '') return DEFAULT_POLL_SECONDS;
  if (!/^\d+$/.test(raw)) throw new Error('VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS must be an integer number of seconds');
  const seconds = Number(raw);
  if (seconds < MIN_POLL_SECONDS || seconds > MAX_POLL_SECONDS) throw new Error(`VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS must be between ${MIN_POLL_SECONDS} and ${MAX_POLL_SECONDS}`);
  return seconds;
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

function checkpointContract(config: WorkflowConfig, configPath: string): { prompt: string; identity: WorkflowSchemaIdentity; schemaPath: string; validate: ValidateFunction } {
  const message = config.messageTypes.overseer_checkpoint;
  if (!message || message.fromRole !== 'auto_nudge' || message.toRole !== 'overseer' || !message.responseSchemaId) throw new Error('workflow config requires reserved message_types.overseer_checkpoint with an overseer response schema');
  const prompt = config.prompts[message.promptId]?.text;
  const schema = config.responseSchemas[message.responseSchemaId];
  if (!prompt || !schema) throw new Error('overseer_checkpoint prompt or response schema is missing');
  const schemaPath = path.resolve(path.dirname(configPath), schema.schemaFile);
  const bytes = fs.readFileSync(schemaPath, 'utf8');
  const payload = JSON.parse(bytes) as object;
  let validate: ValidateFunction;
  try { validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(payload); }
  catch (error) { throw new Error(`Invalid workflow response schema ${schemaPath}: ${(error as Error).message}`); }
  return { prompt, schemaPath, validate, identity: { schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, schemaHash: schemaHash(payload) } };
}

function checkpointPrompt(contract: ReturnType<typeof checkpointContract>, criteria?: AutoNudgeWorkspaceCriteria): string {
  const example = `<auto-nudge-result schema_id="${contract.identity.schemaId}" schema_version="${contract.identity.schemaVersion}" schema_hash="${contract.identity.schemaHash}" format="json">\n{"outcome":"complete","actions":[]}\n</auto-nudge-result>`;
  return [
    overseerPromptWithCriteria(contract.prompt, criteria),
    '', 'Required final response contract:',
    `Schema ID: ${contract.identity.schemaId}`,
    `Schema version: ${contract.identity.schemaVersion}`,
    `Schema hash: ${contract.identity.schemaHash}`,
    `Authoritative schema: ${contract.schemaPath}`,
    'Human-readable Markdown may precede exactly one final envelope. Unknown fields, duplicate JSON keys, or mismatched metadata are invalid.',
    '', example,
  ].join('\n');
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
    && ['observed', 'checkpoint-sent', 'checkpoint-indeterminate', 'done', 'delegated', 'waiting-callback', 'rate-limited', 'retryable-failure', 'invalid-response'].includes((item as TriggerState).status)
    && ((item as TriggerState).checkpointProcessId == null || typeof (item as TriggerState).checkpointProcessId === 'string')
    && ((item as TriggerState).baselineProcessIds == null || (Array.isArray((item as TriggerState).baselineProcessIds) && (item as TriggerState).baselineProcessIds!.every(id => typeof id === 'string')))
    && ((item as TriggerState).correctionAttempts == null || (Number.isSafeInteger((item as TriggerState).correctionAttempts) && (item as TriggerState).correctionAttempts! >= 0))
    && ((item as TriggerState).correctionSendId == null || typeof (item as TriggerState).correctionSendId === 'string')
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

class CycleSendGuard {
  private readonly inFlightSessionIds = new Set<string>();

  constructor(
    private readonly activeSessionIds: Set<string>,
    private readonly sentSessionIds: Set<string>,
  ) {}

  canSendTo(sessionId: string): boolean {
    return !this.activeSessionIds.has(sessionId)
      && !this.sentSessionIds.has(sessionId)
      && !this.inFlightSessionIds.has(sessionId);
  }

  async send<T>(sessionId: string, send: () => Promise<T>): Promise<T | null> {
    if (!this.canSendTo(sessionId)) return null;
    this.inFlightSessionIds.add(sessionId);
    try {
      const result = await send();
      this.sentSessionIds.add(sessionId);
      this.activeSessionIds.add(sessionId);
      return result;
    } finally {
      this.inFlightSessionIds.delete(sessionId);
    }
  }
}

async function processResponseRoutes(
  client: AutoNudgeClient,
  options: AutoNudgeOptions,
  result: AutoNudgeCycleResult,
  sendGuard: CycleSendGuard,
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
      const finalResponse = final.final_response;
      const replySession = await deadline(client.getSession(route.replySessionId), options.operationTimeoutMs, 'get reply session', options.signal);
      const delivered = await sendGuard.send(route.replySessionId, () => deadline(
        client.sendMessage(route.replySessionId, {
          prompt: respondMessage(route.targetRole, finalResponse),
          executor_config: { executor: replySession.executor },
          retry_process_id: null,
          force_when_dirty: null,
          perform_git_reset: null,
        }),
        options.operationTimeoutMs,
        'deliver response route',
        options.signal,
      ));
      if (!delivered) continue;
      const updated = updateResponseRoute(responseRoutesPath, route.id, current => current.status === 'pending' && current.processId === processId
        ? { ...current, status: 'delivered', deliveredProcessId: delivered.id, updatedAt: options.now().toISOString(), error: null }
        : current);
      if (updated?.status === 'delivered') {
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

async function processSendQueue(client: AutoNudgeClient, options: AutoNudgeOptions, result: AutoNudgeCycleResult, sendGuard: CycleSendGuard): Promise<void> {
  if (options.dryRun) return;
  const queuePath = options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH;
  const staleBefore = new Date(options.now().getTime() - Math.max(options.operationTimeoutMs * 2, 60_000));
  for (const send of markStaleSendingIndeterminate(queuePath, staleBefore, options.now())) {
    result.errors.push(`queued send ${send.id}: ${send.error}`);
  }
  while (!options.signal?.aborted) {
    const queued = claimNextQueuedSendWhere(queuePath, send => sendGuard.canSendTo(send.targetSessionId), options.now());
    if (!queued) return;
    try {
      const sent = await sendGuard.send(queued.targetSessionId, () => deadline(client.sendMessage(queued.targetSessionId, queuedSendBody(queued)), options.operationTimeoutMs, 'send queued message', options.signal));
      if (!sent) {
        deferClaimedQueuedSend(queuePath, queued.id, options.now());
        continue;
      }
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
  context: { workspaceId: string; triggerProcessId: string; sessions: Session[]; replySessionId: string; beadsDir?: string },
): Promise<void> {
  const queuePath = options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH;
  const sendActions: Array<{ action: WorkflowAction; messageType: WorkflowMessageTypeConfig; prompt: string; currentTarget: Session }> = [];
  const formActions: Array<{ action: WorkflowAction; form: ReturnType<typeof compileBeadsForm> }> = [];
  const actionResults = new Map<string, string>();
  const declaredFormActions = new Set(actions.flatMap(action => action.type === 'create_form' && action.id ? [action.id] : []));
  for (const action of actions) for (const id of action.formRefs ?? []) {
    if (!declaredFormActions.has(id)) throw new Error(`${action.type} references unknown create_form action ${id}`);
  }
  for (const action of actions) {
    if (action.type === 'wait') continue;
    if (action.type === 'create_form') {
      if (!context.beadsDir) throw new Error('create_form requires workspace criteria beadsDir');
      const source = action.artifact ? readWorkflowArtifact(context.beadsDir, action.artifact) : JSON.stringify(action.form);
      const form = compileBeadsForm(JSON.parse(source) as StandardBeadsForm);
      actionResults.set(action.id!, form.id);
      formActions.push({ action, form });
      continue;
    }
    if (action.type === 'send_message') {
      const messageType = action.messageType ? config.messageTypes[action.messageType] : null;
      if (!messageType) throw new Error(`Unknown message_type ${action.messageType ?? '(missing)'}`);
      const prompt = config.prompts[messageType.promptId]?.text;
      if (!prompt) throw new Error(`Prompt ${messageType.promptId} was not found`);
      const target = context.sessions.find(session => session.name === action.role);
      if (!target) throw new Error(`No current session found for role ${action.role}`);
      sendActions.push({ action, messageType, prompt, currentTarget: target });
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
  for (const { action, form } of formActions) {
    if (!options.dryRun) await (options.createForm
      ? options.createForm({ beadsDir: context.beadsDir!, beadId: action.beadId!, form, workspaceId: context.workspaceId, sessionId: context.replySessionId })
      : attachWorkflowForm(context.beadsDir!, action.beadId!, form, context.workspaceId, context.replySessionId));
  }
  for (const { action, messageType, prompt, currentTarget } of sendActions) {
    const referencedForms = (action.formRefs ?? []).map(id => {
      const formId = actionResults.get(id);
      if (!formId) throw new Error(`send_message references unknown create_form action ${id}`);
      return formId;
    });
    const actionWithResults = { ...action, formIds: [...action.formIds, ...referencedForms] };
    if (!options.dryRun) {
      const id = `${context.triggerProcessId}:${action.type}:${action.role ?? ''}:${action.messageType ?? ''}`;
      const existing = messageType.fresh ? readSendQueue(queuePath).sends[id] : null;
      const target = existing
        ? { ...currentTarget, id: existing.targetSessionId, executor: existing.executor }
        : messageType.fresh
          ? await createFreshWorkflowSession(client, context.workspaceId, currentTarget)
          : currentTarget;
      enqueueSendIdempotent(queuePath, {
        targetRole: action.role ?? messageType.toRole,
        targetSessionId: target.id,
        executor: target.executor,
        prompt: workflowPromptWithContext(prompt, actionWithResults),
        replySessionId: context.replySessionId,
        now: options.now(),
        id,
      });
    }
  }
}

export function readWorkflowArtifact(beadsDir: string, artifact: string): string {
  if (path.isAbsolute(artifact) || artifact.includes('\0')) throw new Error('create_form artifact must be a relative path');
  const root = fs.realpathSync(path.resolve(beadsDir));
  const lexicalFile = path.resolve(root, artifact);
  if (lexicalFile !== root && !lexicalFile.startsWith(`${root}${path.sep}`)) throw new Error('create_form artifact escapes beadsDir');
  if (fs.lstatSync(lexicalFile).isSymbolicLink()) throw new Error('create_form artifact may not be a symbolic link');
  const file = fs.realpathSync(lexicalFile);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error('create_form artifact escapes beadsDir through a symbolic link');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('create_form artifact must be a file no larger than 256 KiB');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(descriptor, 'utf8'); }
  finally { fs.closeSync(descriptor); }
}

type BdExec = (file: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number }) => Promise<{ stdout: string | Buffer }>;
export async function attachWorkflowForm(beadsDir: string, beadId: string, form: ReturnType<typeof compileBeadsForm>, workspaceId: string, sessionId: string, run: BdExec = execFile): Promise<void> {
  const readMetadata = async (): Promise<Record<string, unknown>> => {
    const { stdout } = await run('bd', ['show', beadId, '--json', '--long'], { cwd: beadsDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
    const text = String(stdout); const parsed = JSON.parse(text.slice(Math.max(0, text.indexOf('[')))) as Array<{ id: string; metadata?: Record<string, unknown> }>;
    const bead = parsed.find(item => item.id === beadId); if (!bead) throw new Error(`Bead not found: ${beadId}`);
    return structuredClone(bead.metadata ?? {});
  };
  const metadata = await readMetadata();
  const namespace = metadata.beadForms && typeof metadata.beadForms === 'object' ? metadata.beadForms as { forms?: unknown[] } : {};
  const forms = Array.isArray(namespace.forms) ? namespace.forms : [];
  const existing = forms.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === form.id);
  if (existing) {
    const comparable = { ...(existing as Record<string, unknown>) }; delete comparable.responses;
    if (JSON.stringify(comparable) !== JSON.stringify(form)) throw new Error(`create_form conflicts with existing form ${form.id}`);
    return;
  }
  const nextForms = [...forms, form];
  await run('bd', [
    'update', beadId,
    '--set-metadata', `beadForms=${JSON.stringify({ ...namespace, forms: nextForms })}`,
    '--set-metadata', `beadFormsSummary=${JSON.stringify(buildBeadsFormsSummary(nextForms as Array<{ id: string; responses?: unknown[] }>))}`,
    '--set-metadata', `VK_WORKSPACE_ID=${workspaceId}`,
    '--set-metadata', `VK_SESSION_ID=${sessionId}`,
  ], { cwd: beadsDir, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
}

async function createFreshWorkflowSession(client: AutoNudgeClient, workspaceId: string, currentTarget: Session): Promise<Session> {
  if (!client.createSession) throw new Error('fresh workflow sessions require createSession support');
  return client.createSession({ workspace_id: workspaceId, executor: currentTarget.executor, name: currentTarget.name });
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
    include_global_recent: extra.includeGlobalRecent ?? false,
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
  const workflowConfigPath = options.workflowConfigPath ?? DEFAULT_WORKFLOW_CONFIG_PATH;
  const workflowConfig = loadWorkflowConfig(workflowConfigPath);
  const contract = checkpointContract(workflowConfig, workflowConfigPath);
  const registered = registeredWorkspacesForCycle(options);
  const registeredByWorkspace = new Map(registered.map(item => [item.workspaceId, item]));
  const status = await fetchAutoNudgeStatus(client, options, registered.map(item => item.workspaceId));
  const sentSessionIds = new Set<string>();
  const activeSessionIds = activeSessionIdsFromStatus(status);
  const sendGuard = new CycleSendGuard(activeSessionIds, sentSessionIds);
  await processResponseRoutes(client, options, result, sendGuard);
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
        return;
      }
      const pendingCorrection = Object.values(state.triggers)
        .find(trigger => trigger.workspaceId === configured.workspaceId && trigger.status === 'checkpoint-sent' && trigger.correctionSendId);
      if (pendingCorrection?.correctionSendId) {
        const queued = readSendQueue(options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH).sends[pendingCorrection.correctionSendId];
        if (!queued) throw new Error(`schema correction send ${pendingCorrection.correctionSendId} is missing`);
        if (queued.status === 'queued' || queued.status === 'sending') return;
        if (queued.status === 'accepted' && queued.processId) {
          pendingCorrection.checkpointProcessId = queued.processId;
          delete pendingCorrection.correctionSendId;
          pendingCorrection.updatedAt = options.now().toISOString();
          writeAutoNudgeState(options.statePath, state);
        } else {
          pendingCorrection.status = 'invalid-response';
          pendingCorrection.error = `schema correction delivery is ${queued.status}; automatic resend is disabled`;
          delete pendingCorrection.correctionSendId;
          pendingCorrection.updatedAt = options.now().toISOString();
          writeAutoNudgeState(options.statePath, state);
          return;
        }
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
        let checkpointCompleted = false;
        let responseValidated = false;
        try {
          const checkpoint = await waitForTerminalProcess(client, trigger.checkpointProcessId, options);
          checkpointCompleted = checkpoint.status === 'completed';
          const final = await deadline(client.getExecutionProcessFinalResponse(checkpoint.id), options.operationTimeoutMs, 'fetch checkpoint final response', options.signal);
          const response = final.final_response;
          trigger.error = null;
          const workflowResult = response ? parseWorkflowResultXml(response, payload => {
            if (!contract.validate(payload)) throw new Error(`checkpoint result violates authoritative schema: ${new Ajv2020().errorsText(contract.validate.errors)}`);
          }, contract.identity) : null;
          if (workflowResult) {
            validateWorkflowActions(workflowResult, workflowConfig, 'overseer');
            responseValidated = true;
            await executeOutcomeHandlers(workflowResult.outcome, workflowConfig, options, configured.workspaceId, trigger.processId);
            await executeWorkflowActions(workflowResult.actions, workflowConfig, client, options, {
              workspaceId: configured.workspaceId,
              triggerProcessId: trigger.processId,
              sessions,
              replySessionId: overseer?.id ?? configured.overseerSessionId,
              beadsDir: configured.criteria?.beadsDir,
            });
            trigger.status = workflowResult.outcome === 'complete' ? 'done' : 'delegated';
          } else {
            const refreshedStatus = await fetchAutoNudgeStatus(client, options, [configured.workspaceId], { includeGlobalRecent: false });
            const refreshed = refreshedStatus.workspaces.flatMap(item => item.sessions.flatMap(latestProcessForSession));
            result.sessionsScanned += refreshedStatus.counts.sessions;
            result.processesConsidered += refreshedStatus.counts.processes;
            result.pagesFetched += refreshedStatus.counts.pages;
            const delegated = refreshed.some(item => item.session_id !== overseer.id && item.run_reason === 'codingagent' && !item.dropped && !baselineIds.has(item.id));
            const callbackRegistered = callbacksForTrigger(options.callbackRegistryPath, checkpoint.id, options.now())
              .some(item => item.status === 'running' || item.status === 'completed');
            if (delegated || callbackRegistered) trigger.status = 'delegated';
            else if (checkpoint.status === 'completed') throw new Error('checkpoint response is missing the required auto-nudge-result envelope');
            else {
              trigger.status = 'retryable-failure';
              trigger.error = `checkpoint ${checkpoint.id} ended ${checkpoint.status} without a final response`;
              trigger.checkpointProcessId = null;
            }
          }
          trigger.updatedAt = options.now().toISOString(); result.checkpoints++;
        } catch (error) {
          const message = (error as Error).message;
          const attempts = trigger.correctionAttempts ?? 0;
          if (!checkpointCompleted || responseValidated) {
            trigger.status = 'checkpoint-sent';
            trigger.error = message;
          } else if (attempts === 0 && !options.signal?.aborted) {
            try {
              const correctionSendId = `${trigger.processId}:schema-correction`;
              enqueueSendIdempotent(options.sendQueuePath ?? DEFAULT_SEND_QUEUE_PATH, {
                id: correctionSendId,
                targetRole: overseer.name ?? 'overseer',
                targetSessionId: overseer.id,
                executor: overseer.executor,
                prompt: `Your previous response did not match the required structured response contract: ${message}\n\nReturn one corrected final envelope using this contract:\n\n${checkpointPrompt(contract, configured.criteria)}`,
                replySessionId: null,
                now: options.now(),
              });
              trigger.checkpointProcessId = null;
              trigger.correctionAttempts = 1;
              trigger.correctionSendId = correctionSendId;
              trigger.status = 'checkpoint-sent';
              trigger.error = message;
              trigger.updatedAt = options.now().toISOString();
              writeAutoNudgeState(options.statePath, state);
            } catch (correctionError) {
              trigger.status = 'invalid-response'; trigger.error = `invalid response: ${message}; correction failed: ${(correctionError as Error).message}`;
            }
          } else {
            trigger.status = 'invalid-response'; trigger.error = `invalid response after ${attempts} correction attempt(s): ${message}`;
          }
          trigger.updatedAt = options.now().toISOString();
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
        if (latest.status !== 'completed' || !final.final_response) continue;
        const age = options.now().getTime() - terminalTime(latest); if (age < options.unacknowledgedAfterMs) continue;
        const now = options.now().toISOString();
        const trigger = state.triggers[latest.id] ?? { processId: latest.id, workspaceId: configured.workspaceId, sessionId: teammate.id, observedAt: now, status: 'observed' as const, checkpointProcessId: null, baselineProcessIds: [], updatedAt: now, error: null };
        state.triggers[latest.id] = trigger;
        if (['done', 'delegated', 'rate-limited', 'invalid-response'].includes(trigger.status)) continue;
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
            if (!sendGuard.canSendTo(overseer.id)) return;
            trigger.status = 'checkpoint-sent'; trigger.baselineProcessIds = [...baselineIds]; trigger.updatedAt = now;
            writeAutoNudgeState(options.statePath, state);
            const sent = await sendGuard.send(overseer.id, () => deadline(client.sendMessage(overseer.id, body(checkpointPrompt(contract, configured.criteria), overseer)), options.operationTimeoutMs, 'send checkpoint', options.signal));
            if (!sent) {
              trigger.status = 'observed';
              trigger.error = null;
              trigger.updatedAt = options.now().toISOString();
              writeAutoNudgeState(options.statePath, state);
              return;
            }
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
  await processSendQueue(client, options, result, sendGuard);
  await processOutbox(options, state, result);
  return result;
}

async function executeOutcomeHandlers(outcome: string, config: WorkflowConfig, options: AutoNudgeOptions, workspaceId: string, triggerProcessId: string): Promise<void> {
  for (const handlerId of config.outcomeHandlers[outcome] ?? []) {
    const handler = config.handlers[handlerId]!;
    const action: WorkflowAction = { type: 'run_handler', handlerId, beadIds: [], formIds: [] };
    const result = await runWorkflowHandler(handler, { idempotencyKey: `${triggerProcessId}:outcome:${outcome}:${handlerId}`, action, workspaceId, triggerProcessId, outcome, dryRun: options.dryRun }, { logPath: options.handlerLogPath ?? DEFAULT_HANDLER_LOG_PATH, timeoutMs: handler.timeoutMs });
    if (result.status === 'failed') throw new Error(`outcome handler ${handlerId} failed: ${result.error ?? `exit ${result.exitCode}`}`);
  }
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
type VibeClientAdapterSource = Pick<typeof defaultClient, 'getAllWorkspaces' | 'getSessions' | 'getSession' | 'createSession' | 'getSessionProcesses' | 'fetchConversation' | 'sendMessage' | 'getExecutionProcess' | 'getExecutionProcessFinalResponse' | 'getExecutionProcessFinalResponseStrict' | 'getAutoNudgeStatus'>;

export function createAutoNudgeClient(source: VibeClientAdapterSource): AutoNudgeClient {
  return {
    getAllWorkspaces: () => source.getAllWorkspaces(),
    getSessions: id => source.getSessions(id), getSessionProcesses: id => source.getSessionProcesses(id),
    getSession: id => source.getSession(id),
    createSession: body => source.createSession(body),
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
  const pollMs = pollIntervalSeconds() * 1_000;
  let stopping = false;
  await runWithOwnerLock(process.env.VD_AUTO_NUDGE_LOCK_PATH ?? DEFAULT_LOCK_PATH, async () => {
    const abortController = new AbortController();
    const stop = () => { stopping = true; abortController.abort(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const options: AutoNudgeOptions = { config, statePath: args.statePath, callbackRegistryPath: process.env.VD_CALLBACK_REGISTRY_PATH ?? DEFAULT_CALLBACK_REGISTRY_PATH, responseRoutesPath: process.env.VD_RESPONSE_ROUTES_PATH ?? DEFAULT_RESPONSE_ROUTES_PATH, workspaceRegistryPath: args.registryPath, workflowConfigPath: process.env.VD_AUTO_NUDGE_WORKFLOW_CONFIG_PATH ?? DEFAULT_WORKFLOW_CONFIG_PATH, sendQueuePath: process.env.VD_SEND_QUEUE_PATH ?? DEFAULT_SEND_QUEUE_PATH, handlerLogPath: process.env.VD_HANDLER_LOG_PATH ?? DEFAULT_HANDLER_LOG_PATH, now: () => new Date(), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 15_000, responseTimeoutMs: 30 * 60_000, concurrency: 4, dryRun: args.dryRun, discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL, signal: abortController.signal };
    do { const result = await runAutoNudgeCycle(makeClient(), options); console.log(JSON.stringify({ type: 'auto-nudge-cycle', at: new Date().toISOString(), ...result })); if (!args.once && !stopping) { try { await abortableDelay(pollMs, abortController.signal); } catch { /* Shutdown aborts the poll delay. */ } } } while (!args.once && !stopping);
  });
  if (stopping || args.once) process.exit(0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main().catch(error => { console.error(`auto-nudge failed: ${(error as Error).message}`); process.exitCode = 1; });
