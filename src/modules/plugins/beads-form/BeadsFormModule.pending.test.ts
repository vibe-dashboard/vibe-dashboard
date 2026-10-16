import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm pending queue UI source', () => {
  it('keeps default pending page focused on forms, not diagnostics or manual refresh chrome', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Use Refresh after agents attach new forms');
    expect(source).not.toContain('Update strategy');
    expect(source).not.toContain('Skipped repos');
    expect(source).not.toContain('Refreshing in the background… cached results remain visible.');
    expect(source).not.toContain('>Refresh<');
    expect(source).toContain('Checking for updates…');
    expect(source).toContain('Loading pending BeadsForms');
  });

  it('uses a submitted success state with selected-format handoff fallback instead of showing the active form', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('copySubmittedResultHandoff(navigator.clipboard, handoffFormat, values, handoffMetadata)');
    expect(source).toContain('pendingSubmittedResultHandoff(handoffFormat, values, handoffMetadata)');
    expect(source).toContain('submittedAt: result.submittedAt');
    expect(source).toContain('submittedBy: result.submittedBy');
    expect(source).toContain('Copying BeadsForm {formatLabel} handoff…');
    expect(source).toContain('BeadsForm {formatLabel} handoff');
    expect(source).toContain('Use the manual ${formatLabel} handoff field below.');
    expect(source).toContain('loaded?.selectedForm && !submitResult');
    expect(source).toContain("form && status.status !== 'success'");
    expect(source).toContain('selectedForm && submitResult');
    expect(source).not.toContain('Normalized submitted response JSON');
  });

  it('wires bead-backed submissions to exact-session follow-up while leaving folder preview local', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('notifySession: (sessionId, message) => vkClient().sendFollowUp(sessionId, message, {');
    expect(source).toContain('timeoutMs: BEADS_FORM_NOTIFICATION_TIMEOUT_MS');
    expect(source).toContain('const result = await nodeClient().submitForm(input);');
    expect(source).not.toMatch(/submitPreviewForm[\s\S]{0,1500}sendFollowUp/);
    expect(source).toContain('if (submitInFlightRef.current) return;');
    expect(source).toContain('const optimisticSubmissionId = submissionIdRef.current ??= createSubmissionId();');
    expect(source.match(/const submissionIdRef = useRef<string \| null>\(null\);/g)).toHaveLength(2);
  });

  it('initializes Markdown textarea previews through the shared selected-form paths', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('initializeMarkdownTextareaEditors(host);');
    expect(source).toContain('refreshMarkdownTextareaEditors(host);');
    expect(source).toContain('initializeMarkdownTextareaEditors(element);');
    expect(source).toContain('refreshMarkdownTextareaEditors(element);');
  });

  it('rewrites bead-backed attachment refs before sanitizing selected and aggregate forms', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('rewriteBeadBackedAttachmentRefs(form.html, item.beadRepoDir ?? item.ref.dir)');
    expect(source).toContain('rewriteBeadBackedAttachmentRefs(loaded.selected.selectedForm.html, loaded.selected.beadRepoDir)');
  });

  it('sets aggregate success before awaiting clipboard completion', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('await copySubmittedResultHandoff(');
    expect(source).toContain('clipboardStatus: pendingCopy.status');
    expect(source).toContain('submittedAt: status.submittedAt');
    expect(source).toContain('submittedBy: status.submittedBy');
    expect(source).toContain('void copySubmittedResultHandoff(navigator.clipboard, handoffFormat, values, handoffMetadata).then((copyResult) => {');
  });

  it('prefers direct selected-bead loading when URL has both workspace and dir', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const shouldUseDirectSelectedLoad = !!dir && !!beadId;');
    expect(source).toContain('shouldUseDirectSelectedLoad\n          ? await directResult(actions.loadBeadForms)\n          : await (await actions.loadWorkspaceForms(workspaceInput))');
    expect(source).toContain('shouldUseDirectSelectedLoad\n            ? await directResult(actions.refreshBeadForms)\n            : await (await actions.refreshWorkspaceForms(workspaceInput))');
  });

  it('uses a pending queue sentinel to refresh cached inbox results without blocking initial render', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('pendingQueueSentinel: initialPendingQueueSentinel');
    expect(source).toContain('markPendingQueueDirtyForRepo(states.pendingQueueSentinel, input.dir)');
    expect(source).toContain('shouldRefreshPendingQueueForSentinel({');
    expect(source).toContain('const fresh = await (await actions.refreshPendingForms(input));');
    expect(source).toContain('if (!pendingRef.current) return;');
  });

  it('renders pending Forms tab entries as compact semantic inbox rows', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain('aria-label="Pending BeadsForms inbox"');
    expect(source).toContain('className="beadsform-pending-card-main"');
    expect(source).toContain('className="beadsform-pending-title"');
    expect(source).toContain('className="beadsform-pending-meta"');
    expect(source).toContain('className="beadsform-pending-action"');
    expect(source).toContain('<dt>Bead</dt>');
    expect(source).toContain('<dt>Repo</dt>');
    expect(source).toContain('Inbox clear');
    expect(source).not.toContain('workspaceId}</p>');
  });

  it('labels typed forms across direct, pending, aggregate, and batch browsing', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from './beadsFormType'");
    expect(source).toContain('<BeadsFormTypeBadge form={entry.form} />');
    expect(source).toContain('<BeadsFormTypeBadge form={form} />');
    expect(source).toContain('<AggregateBeadsFormTypeCue form={form} compiledFormMounted={compiledFormMounted} />');
    expect(source).toContain('formType: resolveBeadsFormType(snapshot.form)');
    expect(source).toContain('formType: resolveBeadsFormType(');
  });

  it('blocks invalidated selected and aggregate forms instead of rendering answerable forms', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');
    expect(source).toContain('InvalidatedBeadsFormNotice');
    expect(source).toContain('isBeadsFormInvalidated(selectedForm)');
    expect(source).toContain('isBeadsFormInvalidated(form)');
    expect(source).toContain('invalidatedBeadsFormMessage(form)');
  });

  it('offers aggregate batch submit with selected-format handoff and invalid-source blocking', async () => {
    const source = await readFile(new URL('./module.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Submit selected forms together');
    expect(source).toContain('copySubmittedBatchResultHandoff(navigator.clipboard, handoffFormat, optimisticHandoffInput)');
    expect(source).toContain('pendingSubmittedBatchResultHandoff(handoffFormat, optimisticHandoffInput)');
    expect(source).toContain('batchSubmissionIdsRef.current');
    expect(source).toContain('Invalidated or unavailable forms block the batch');
    expect(source).toContain('Combined BeadsForm {displayedBatchFormat.toUpperCase()} handoff');
    expect(source).toContain('withDeclaredCodeFileChangeIntent(form, normalizeFormData(new FormData(element)), allowCodeFileChanges)');
    expect(source).not.toContain('[ALLOW_CODE_FILE_CHANGES_FIELD]: allowCodeFileChanges');
  });
});
