import { client } from './client.js';
import { resolveSendProfile } from './executor-profile.js';
import { resolveSendReasoning, type ReasoningSource } from './reasoning.js';
import type { ExecutorProfiles, SendMessageBody, Session } from '../types.js';

export interface MessagePolicySource extends ReasoningSource {
  getExecutorProfiles(): Promise<ExecutorProfiles>;
}

// Self-directed messages must resume the actual target, even if the deployment
// default selects a different executor. Preset names do not cross executors.
export async function resolvePinnedExecutorConfig(
  session: Session,
  source: MessagePolicySource = client,
): Promise<NonNullable<SendMessageBody['executor_config']>> {
  if (!session.executor) throw new Error(`Session ${session.id} has no executor`);
  const profiles = await source.getExecutorProfiles();
  const configured = resolveSendProfile(profiles);
  const profile = configured.executor === session.executor
    ? configured
    : { ...resolveSendProfile(profiles, { executor: session.executor, variant: 'Default' }), reasoning: configured.reasoning };
  return {
    executor: profile.executor,
    variant: profile.variant,
    ...await resolveSendReasoning(profiles, profile, session, source),
  };
}

export function buildSendPrompt(message: string, newSession = false): string {
  return newSession
    ? `${message}\n\nUse \`vibe-agent full_summary\` as a standalone command to catch up.`
    : message;
}
