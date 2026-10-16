import type { JsonObject } from './beadsFormCore';
import type { BeadsFormHandoffFormat } from './beadsFormHandoffPreference';
import {
  beadsFormBatchSubmissionXml,
  beadsFormSubmissionXml,
  type BeadsFormBatchSubmissionHandoffInput,
  type BeadsFormSubmissionHandoffMetadata,
} from './beadsFormSubmissionHandoff';

export type ClipboardCopyResult = {
  status: 'pending' | 'copied' | 'failed' | 'unavailable';
  text: string;
  warning?: string;
};

export function normalizedSubmittedResultJson(values: JsonObject): string {
  return JSON.stringify(values, null, 2);
}

export function submittedResultHandoffXml(
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): string {
  return beadsFormSubmissionXml({ values, ...metadata });
}

export function submittedBatchResultHandoffXml(input: BeadsFormBatchSubmissionHandoffInput): string {
  return beadsFormBatchSubmissionXml(input);
}

export function submittedResultHandoff(
  format: BeadsFormHandoffFormat,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): string {
  return format === 'json' ? normalizedSubmittedResultJson(values) : submittedResultHandoffXml(values, metadata);
}

export function submittedBatchResultHandoff(
  format: BeadsFormHandoffFormat,
  input: BeadsFormBatchSubmissionHandoffInput,
): string {
  return format === 'json' ? JSON.stringify(input, null, 2) : submittedBatchResultHandoffXml(input);
}

function unavailableWarning(format: BeadsFormHandoffFormat): string {
  return `Clipboard copy is unavailable. Use the manual ${format.toUpperCase()} handoff field below.`;
}

function failedWarning(format: BeadsFormHandoffFormat, error: unknown): string {
  return `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual ${format.toUpperCase()} handoff field below.`;
}

export function pendingSubmittedBatchResultHandoff(
  format: BeadsFormHandoffFormat,
  input: BeadsFormBatchSubmissionHandoffInput,
): ClipboardCopyResult {
  return { status: 'pending', text: submittedBatchResultHandoff(format, input) };
}

export async function copySubmittedBatchResultHandoff(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  format: BeadsFormHandoffFormat,
  input: BeadsFormBatchSubmissionHandoffInput,
): Promise<ClipboardCopyResult> {
  const text = submittedBatchResultHandoff(format, input);
  if (!clipboard) return { status: 'unavailable', text, warning: unavailableWarning(format) };
  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return { status: 'failed', text, warning: failedWarning(format, error) };
  }
}

export function pendingSubmittedResultHandoff(
  format: BeadsFormHandoffFormat,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): ClipboardCopyResult {
  return { status: 'pending', text: submittedResultHandoff(format, values, metadata) };
}

export async function copySubmittedResultHandoff(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  format: BeadsFormHandoffFormat,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): Promise<ClipboardCopyResult> {
  const text = submittedResultHandoff(format, values, metadata);
  if (!clipboard) return { status: 'unavailable', text, warning: unavailableWarning(format) };
  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return { status: 'failed', text, warning: failedWarning(format, error) };
  }
}

export function pendingSubmittedBatchResultHandoffCopy(input: BeadsFormBatchSubmissionHandoffInput): ClipboardCopyResult {
  return {
    status: 'pending',
    text: submittedBatchResultHandoffXml(input),
  };
}

export async function copySubmittedBatchResultHandoffXml(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  input: BeadsFormBatchSubmissionHandoffInput,
): Promise<ClipboardCopyResult> {
  const text = submittedBatchResultHandoffXml(input);
  if (!clipboard) {
    return {
      status: 'unavailable',
      text,
      warning: 'Clipboard copy is unavailable. Use the manual XML handoff field below.',
    };
  }
  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return {
      status: 'failed',
      text,
      warning: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual XML handoff field below.`,
    };
  }
}

export function pendingSubmittedResultHandoffCopy(
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): ClipboardCopyResult {
  return {
    status: 'pending',
    text: submittedResultHandoffXml(values, metadata),
  };
}

export async function copySubmittedResultHandoffXml(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): Promise<ClipboardCopyResult> {
  const text = submittedResultHandoffXml(values, metadata);
  if (!clipboard) {
    return {
      status: 'unavailable',
      text,
      warning: 'Clipboard copy is unavailable. Use the manual XML handoff field below.',
    };
  }

  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return {
      status: 'failed',
      text,
      warning: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual XML handoff field below.`,
    };
  }
}
