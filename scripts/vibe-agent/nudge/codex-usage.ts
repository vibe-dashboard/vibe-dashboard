import type { CodexUsageLimitEvent } from '../types.js';
import { schemaHash } from './workflow-xml.js';

export function isCodexUsageLimitEvent(value: unknown): value is CodexUsageLimitEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return event.code === 'usage_limit_exceeded'
    && typeof event.thread_id === 'string' && Boolean(event.thread_id.trim())
    && typeof event.turn_id === 'string' && Boolean(event.turn_id.trim());
}

export function codexUsageLimitEvents(value: unknown): CodexUsageLimitEvent[] {
  if (value === undefined) return []; // An older backend supplies no evidence.
  if (!Array.isArray(value) || !value.every(isCodexUsageLimitEvent)) throw new Error('Invalid structured Codex usage-limit evidence');
  return [...new Map(value.map(event => [JSON.stringify([event.thread_id, event.turn_id]), event])).values()];
}

export function codexUsageEventId(workspaceId: string, sessionId: string, processId: string, event: CodexUsageLimitEvent): string {
  return `codex-usage:${schemaHash({ version: 1, workspaceId, sessionId, processId, threadId: event.thread_id, turnId: event.turn_id })}`;
}

export function codexUsageAlertContent(origin: string | undefined, workspaceId: string, sessionId: string, processId: string): string {
  if (!origin) throw new Error('VK_ORIGIN is required for Codex usage-limit Discord alerts');
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('VK_ORIGIN must be an HTTP(S) origin without credentials');
  url.pathname = `/workspaces/${encodeURIComponent(workspaceId)}`;
  url.search = ''; url.hash = '';
  return `Codex usage limit reached.\nWorkspace: ${url.toString()}\nSession: ${sessionId}\nProcess: ${processId}`;
}
