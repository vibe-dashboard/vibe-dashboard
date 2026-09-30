import type { ExecutorActionType } from 'shared/types';

type SessionCommandAction = Extract<
  ExecutorActionType,
  { type: 'CodingAgentSessionCommandRequest' }
>;

export function getSessionCommandPrompt(action: SessionCommandAction): string {
  const prompt =
    typeof action.prompt === 'string' ? action.prompt.trim() : undefined;
  if (prompt) {
    return prompt;
  }

  if (action.command.type === 'clear') {
    return '/clear';
  }

  const instructions = action.command.instructions?.trim();
  return instructions ? `/compact ${instructions}` : '/compact';
}

export function getSessionCommandType(
  action: ExecutorActionType
): 'clear' | 'compact' | null {
  return action.type === 'CodingAgentSessionCommandRequest'
    ? action.command.type
    : null;
}
