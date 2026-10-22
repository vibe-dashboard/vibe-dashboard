import type { Executor } from '../config.js';
import type { ExecutorProfiles } from '../types.js';

export const DEFAULT_SEND_PROFILE = 'OpenCode,Default,medium';

export type SendProfile = { executor: Executor; variant: string; reasoning?: string };

// Match friendly UI names against saved keys, retaining VK's canonical keys.
function normalizeProfileName(value: string): string {
  return value.replace(/[\s_-]/g, '').toLowerCase();
}

export function resolveSendProfile(
  profiles: ExecutorProfiles,
  selection = process.env.VIBE_AGENT_EXECUTOR_PROFILE,
): SendProfile {
  const value = selection?.trim() || DEFAULT_SEND_PROFILE;
  const parts = value.split(',').map(part => part.trim());
  if ((parts.length !== 2 && parts.length !== 3) || parts.some(part => !part)) {
    throw new Error(`VIBE_AGENT_EXECUTOR_PROFILE must be "<agent>,<configuration>[,<reasoning>]", for example "${DEFAULT_SEND_PROFILE}"`);
  }

  const executors = Object.keys(profiles).filter(key => normalizeProfileName(key) === normalizeProfileName(parts[0]!));
  if (executors.length !== 1) {
    throw new Error(`Unknown or ambiguous agent "${parts[0]}" in VIBE_AGENT_EXECUTOR_PROFILE. Available agents: ${Object.keys(profiles).join(', ')}`);
  }
  const executor = executors[0] as Executor;
  const configurations = Object.keys(profiles[executor]!).filter(key => key !== 'recently_used_models');
  const variants = configurations.filter(key => normalizeProfileName(key) === normalizeProfileName(parts[1]!));
  if (variants.length !== 1) {
    throw new Error(`Unknown or ambiguous configuration "${parts[1]}" for ${executor}. Available configurations: ${configurations.join(', ')}`);
  }
  return { executor, variant: variants[0]!, ...(parts[2] ? { reasoning: parts[2] } : {}) };
}
