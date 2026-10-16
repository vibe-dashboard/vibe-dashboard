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
  format: BeadsFormHandoffFormat;
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
  if (format === 'xml') return submittedBatchResultHandoffXml(input);
  const forms = input.forms.map((form) => {
    if (!form.beadId || !form.formId) {
      throw new Error('Batch JSON handoff requires beadId and formId for every source response.');
    }
    return {
      beadId: form.beadId,
      formId: form.formId,
      values: form.values,
    };
  });
  return JSON.stringify({
    forms,
    ...(input.nextInstruction?.trim() ? { next_instruction: input.nextInstruction } : {}),
  }, null, 2);
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
  return { status: 'pending', format, text: submittedBatchResultHandoff(format, input) };
}

export async function copySubmittedBatchResultHandoff(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  format: BeadsFormHandoffFormat,
  input: BeadsFormBatchSubmissionHandoffInput,
): Promise<ClipboardCopyResult> {
  const text = submittedBatchResultHandoff(format, input);
  if (!clipboard) return { status: 'unavailable', format, text, warning: unavailableWarning(format) };
  try {
    await clipboard.writeText(text);
    return { status: 'copied', format, text };
  } catch (error) {
    return { status: 'failed', format, text, warning: failedWarning(format, error) };
  }
}

export function pendingSubmittedResultHandoff(
  format: BeadsFormHandoffFormat,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): ClipboardCopyResult {
  return { status: 'pending', format, text: submittedResultHandoff(format, values, metadata) };
}

export async function copySubmittedResultHandoff(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  format: BeadsFormHandoffFormat,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): Promise<ClipboardCopyResult> {
  const text = submittedResultHandoff(format, values, metadata);
  if (!clipboard) return { status: 'unavailable', format, text, warning: unavailableWarning(format) };
  try {
    await clipboard.writeText(text);
    return { status: 'copied', format, text };
  } catch (error) {
    return { status: 'failed', format, text, warning: failedWarning(format, error) };
  }
}

export function pendingSubmittedBatchResultHandoffCopy(input: BeadsFormBatchSubmissionHandoffInput): ClipboardCopyResult {
  return pendingSubmittedBatchResultHandoff('xml', input);
}

export async function copySubmittedBatchResultHandoffXml(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  input: BeadsFormBatchSubmissionHandoffInput,
): Promise<ClipboardCopyResult> {
  return copySubmittedBatchResultHandoff(clipboard, 'xml', input);
}

export function pendingSubmittedResultHandoffCopy(
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): ClipboardCopyResult {
  return pendingSubmittedResultHandoff('xml', values, metadata);
}

export async function copySubmittedResultHandoffXml(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): Promise<ClipboardCopyResult> {
  return copySubmittedResultHandoff(clipboard, 'xml', values, metadata);
}
