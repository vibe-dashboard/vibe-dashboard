import * as fs from 'node:fs';

export const RUNTIME_CONFIG_PATH = '/var/lib/vd/instance-config/vibe-agent.json';

export interface ExecutorProfileSelection {
  executor: string;
  variant: string;
  reasoning?: string;
}

export const DEFAULT_SEND_PROFILE: Readonly<ExecutorProfileSelection> = Object.freeze({
  executor: 'OpenCode',
  variant: 'Default',
  reasoning: 'medium',
});

export function parseExecutorProfileSelection(value: unknown): ExecutorProfileSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('executorProfile must be an object with executor, variant, and optional reasoning fields');
  }
  const profile = value as Record<string, unknown>;
  const unknownFields = Object.keys(profile).filter(key => !['executor', 'variant', 'reasoning'].includes(key));
  if (unknownFields.length) throw new Error(`Unknown executorProfile fields: ${unknownFields.join(', ')}`);
  for (const key of ['executor', 'variant', 'reasoning'] as const) {
    if (key === 'reasoning' && !Object.hasOwn(profile, key)) continue;
    if (typeof profile[key] !== 'string' || !profile[key].trim()) {
      throw new Error(`executorProfile.${key} must be a nonempty string`);
    }
  }
  return {
    executor: (profile.executor as string).trim(),
    variant: (profile.variant as string).trim(),
    ...(typeof profile.reasoning === 'string' ? { reasoning: profile.reasoning.trim() } : {}),
  };
}

// Read at dispatch time, including in long-running server/daemon processes.
// Only capability metadata is cached; configuration changes apply to the next send.
export function readRuntimeExecutorProfile(filePath = RUNTIME_CONFIG_PATH): ExecutorProfileSelection {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SEND_PROFILE };
    throw new Error(`Cannot read vibe-agent config ${filePath}: ${(error as Error).message}`);
  }
  try {
    const config: unknown = JSON.parse(contents);
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || (config as Record<string, unknown>).version !== 1) {
      throw new Error('expected an object with version: 1');
    }
    return parseExecutorProfileSelection((config as Record<string, unknown>).executorProfile);
  } catch (error) {
    throw new Error(`Invalid vibe-agent config ${filePath}: ${(error as Error).message}`);
  }
}
