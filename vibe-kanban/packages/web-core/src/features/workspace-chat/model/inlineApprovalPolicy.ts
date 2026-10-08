export type PendingApprovalPlacement =
  | 'question-hidden'
  | 'question-inline'
  | 'approval-card'
  | 'approval-inline';

export function getPendingApprovalPlacement(
  action: string,
  inlineControls: boolean
): PendingApprovalPlacement {
  if (action === 'ask_user_question') {
    return inlineControls ? 'question-inline' : 'question-hidden';
  }
  return inlineControls ? 'approval-inline' : 'approval-card';
}
