import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm optimistic submit source', () => {
  it('locks and copies direct bead-backed submissions before persistence returns', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');
    const directStart = source.indexOf('const optimisticSubmissionId = submissionIdRef.current ??= createSubmissionId();');
    const directLock = source.indexOf('preserveSubmittedFormDom(formHostRef.current, values', directStart);
    const directResult = source.indexOf('setSubmitResult({', directStart);
    const directCopy = source.indexOf('void copySubmittedResultHandoff(navigator.clipboard, handoffFormat, values, handoffMetadata).then(setClipboardResult);', directStart);
    const directPersist = source.indexOf('actions.submitBeadForm({', directStart);
    const directDraftCancel = source.lastIndexOf('draftSaveQueueRef.current?.cancel();', directStart);

    for (const marker of [directStart, directLock, directResult, directCopy, directPersist, directDraftCancel]) {
      expect(marker).toBeGreaterThanOrEqual(0);
    }
    expect(directLock).toBeLessThan(directPersist);
    expect(directResult).toBeLessThan(directPersist);
    expect(directCopy).toBeLessThan(directPersist);
    expect(directDraftCancel).toBeLessThan(directPersist);
  });

  it('optimistically submits aggregate cards and rolls back editable values on failure', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');
    const aggregateStart = source.indexOf("setStatus({\n      status: 'success',\n      values,");
    const aggregateCopy = source.indexOf('void copySubmittedResultHandoff(navigator.clipboard, handoffFormat, values, handoffMetadata)', aggregateStart);
    const aggregatePersist = source.indexOf('submitBeadForm({', aggregateStart);

    for (const marker of [aggregateStart, aggregateCopy, aggregatePersist]) {
      expect(marker).toBeGreaterThanOrEqual(0);
    }
    expect(aggregateStart).toBeLessThan(aggregatePersist);
    expect(aggregateCopy).toBeLessThan(aggregatePersist);
    expect(source).toContain('setRollbackValues(values);');
    expect(source).toContain('setEditResponseVersion((version) => version + 1);');
  });

  it('optimistically submits folder preview without waiting for sidecar persistence', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');
    const previewStart = source.indexOf('setSubmitResult({\n      formId: loaded.selectedForm.id,');
    const previewCopy = source.indexOf('void copySubmittedResultHandoff(navigator.clipboard, handoffFormat, values, handoffMetadata).then(setClipboardResult);', previewStart);
    const previewPersist = source.indexOf('actions.submitPreviewForm({', previewStart);

    for (const marker of [previewStart, previewCopy, previewPersist]) {
      expect(marker).toBeGreaterThanOrEqual(0);
    }
    expect(previewStart).toBeLessThan(previewPersist);
    expect(previewCopy).toBeLessThan(previewPersist);
  });
});
