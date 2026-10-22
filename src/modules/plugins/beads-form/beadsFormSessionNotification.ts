/// <reference types="node" />

import { normalizeSubmittedValues, type BeadsFormDefinition, type JsonObject } from './beadsFormCore.ts';

export const BEADS_FORM_SESSION_NOTIFICATION_MAX_BYTES = 256 * 1024;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidBeadsFormSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function buildBeadsFormSessionNotification(args: {
  form: BeadsFormDefinition;
  values: JsonObject;
  maxBytes?: number;
}): string {
  const values = normalizeSubmittedValues(args.form, args.values);
  const message = JSON.stringify(values, null, 2);

  const maxBytes = args.maxBytes ?? BEADS_FORM_SESSION_NOTIFICATION_MAX_BYTES;
  const size = Buffer.byteLength(message, 'utf8');
  if (size > maxBytes) {
    throw new Error(`creating-session notification exceeds the ${maxBytes}-byte safety limit (${size} bytes)`);
  }
  return message;
}
