import { describe, expect, it } from 'vitest';
import { buildBeadsFormSessionNotification, isValidBeadsFormSessionId } from './beadsFormSessionNotification';

describe('BeadsForm creating-session notifications', () => {
  it('accepts UUID session ids and rejects unsafe or malformed metadata', () => {
    expect(isValidBeadsFormSessionId('2e56418d-2829-4e2f-aab7-105c5aab41dc')).toBe(true);
    expect(isValidBeadsFormSessionId('session-1')).toBe(false);
    expect(isValidBeadsFormSessionId('2e56418d-2829-4e2f-aab7-105c5aab41dc; rm -rf /')).toBe(false);
    expect(isValidBeadsFormSessionId('')).toBe(false);
  });

  it('sends exactly the normalized response JSON and nothing else', () => {
    const message = buildBeadsFormSessionNotification({
      form: {
        format: 'standard',
        type: 'code-review',
        id: 'review',
        goal: 'Review the plan.',
        title: 'Review',
        nextInstructionPresets: [{ label: 'Discuss unknowns', value: 'Create another form to discuss additional unknowns in detail' }],
        questions: [{
          type: 'textarea',
          id: 'comment',
          title: 'Comment',
          description: 'Share feedback.',
        }],
        html: '<form>generated</form>',
        controls: [{ id: 'comment', name: 'comment', type: 'textarea' }],
        responses: [{ submittedBy: 'old', submittedAt: '2026-01-01T00:00:00Z', values: { comment: 'old' } }],
      } as never,
      values: {
        comment: '# Approved',
        next_instruction: '## Next\n\nImplement follow-up & report.',
        allow_code_file_changes: false,
      },
    });

    expect(message).toBe(JSON.stringify({
      comment: '# Approved',
      next_instruction: '## Next\n\nImplement follow-up & report.',
      allow_code_file_changes: false,
    }, null, 2));
    expect(message).not.toContain('code-review');
    expect(message).not.toContain('Discuss unknowns');
    expect(JSON.parse(message)).toEqual({
      comment: '# Approved',
      next_instruction: '## Next\n\nImplement follow-up & report.',
      allow_code_file_changes: false,
    });
  });

  it('rejects an oversized handoff before calling a messaging transport', () => {
    expect(() => buildBeadsFormSessionNotification({
      form: {
        format: 'standard',
        id: 'review',
        goal: 'Review the plan.',
        title: 'Review',
        questions: [{ type: 'textarea', id: 'comment', title: 'Comment' }],
      } as never,
      values: { comment: 'large response' },
      maxBytes: 32,
    })).toThrow('notification exceeds the 32-byte safety limit');
  });
});
