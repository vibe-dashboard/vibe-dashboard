import { describe, expect, it } from 'vitest';
import { getPendingApprovalPlacement } from './inlineApprovalPolicy';

describe('pending approval placement', () => {
  it('moves question and approval controls inline only for chat-only mode', () => {
    expect(getPendingApprovalPlacement('ask_user_question', true)).toBe(
      'question-inline'
    );
    expect(getPendingApprovalPlacement('ask_user_question', false)).toBe(
      'question-hidden'
    );
    expect(getPendingApprovalPlacement('command_run', true)).toBe(
      'approval-inline'
    );
    expect(getPendingApprovalPlacement('command_run', false)).toBe(
      'approval-card'
    );
  });
});
