import type { Executor } from '../config.js';
import type { ExecutorProfiles } from '../types.js';
import { parseExecutorProfileSelection, readRuntimeExecutorProfile } from './runtime-config.js';

export type SendProfile = { executor: Executor; variant: string; reasoning?: string };

// Match friendly UI names against saved keys, retaining VK's canonical keys.
function normalizeProfileName(value: string): string {
  return value.replace(/[\s_-]/g, '').toLowerCase();
}

export function resolveSendProfile(
  profiles: ExecutorProfiles,
  selection: unknown = readRuntimeExecutorProfile(),
): SendProfile {
  const configured = parseExecutorProfileSelection(selection);

  const executors = Object.keys(profiles).filter(key => normalizeProfileName(key) === normalizeProfileName(configured.executor));
  if (executors.length !== 1) {
    throw new Error(`Unknown or ambiguous executorProfile.executor "${configured.executor}". Available agents: ${Object.keys(profiles).join(', ')}`);
  }
  const executor = executors[0] as Executor;
  const configurations = Object.keys(profiles[executor]!).filter(key => key !== 'recently_used_models');
  const variants = configurations.filter(key => normalizeProfileName(key) === normalizeProfileName(configured.variant));
  if (variants.length !== 1) {
    throw new Error(`Unknown or ambiguous configuration "${configured.variant}" in executorProfile.variant for ${executor}. Available configurations: ${configurations.join(', ')}`);
  }
  return { executor, variant: variants[0]!, ...(configured.reasoning ? { reasoning: configured.reasoning } : {}) };
}
