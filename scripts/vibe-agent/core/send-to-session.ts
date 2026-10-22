import { client } from './client.js';
import { resolveSendProfile } from './executor-profile.js';
import { buildSendPrompt } from './message-policy.js';
import { resolveSendReasoning } from './reasoning.js';
import { getRoleForSession, registerSession } from './session-file.js';
import type { ExecutionProcess } from '../types.js';

// Explicit vk send follows the configured executor. Self-directed automation
// instead uses resolvePinnedExecutorConfig and never changes the target ID.
export async function sendToSession(
  sessionId: string,
  prompt: string,
): Promise<ExecutionProcess & { registration_error?: string }> {
  const profiles = await client.getExecutorProfiles();
  const profile = resolveSendProfile(profiles);
  const previous = await client.getSession(sessionId);
  const replacement = previous.executor !== profile.executor;
  const role = replacement ? getRoleForSession(previous.workspace_id, previous.id) : null;
  const session = replacement
    ? await client.createSession({ workspace_id: previous.workspace_id, executor: profile.executor, name: previous.name })
    : previous;
  const result = await client.sendMessage(session.id, {
    prompt: buildSendPrompt(prompt, replacement),
    executor_config: {
      executor: profile.executor,
      variant: profile.variant,
      ...await resolveSendReasoning(profiles, profile, session),
    },
    retry_process_id: null,
    force_when_dirty: null,
    perform_git_reset: null,
  });
  if (replacement && role) {
    try {
      registerSession(session.workspace_id, session.id, role);
    } catch (error) {
      const registration_error = (error as Error).message;
      console.error(`Message accepted for session ${session.id}, process ${result.id}, but role registration failed: ${registration_error}. Do not resend this message; register the accepted session as ${role}.`);
      return { ...result, registration_error };
    }
  }
  return result;
}
