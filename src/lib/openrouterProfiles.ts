export interface OpenRouterModelSummary {
  id: string;
  name: string;
}

export type VkProfiles = {
  executors: Record<string, Record<string, Record<string, unknown>>>;
};

export interface OpenRouterProfileMergeResult {
  profiles: VkProfiles;
  addedVariantKeys: string[];
  existingVariantKeys: string[];
}

const OPENCODE_EXECUTOR = 'OPENCODE';
const OPENROUTER_PROVIDER_PREFIX = 'openrouter/';

export function parseProfilesContent(content: string): VkProfiles {
  const parsed = JSON.parse(content) as Partial<VkProfiles>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Profiles JSON must be an object.');
  }
  if (!parsed.executors || typeof parsed.executors !== 'object') {
    return { executors: {} };
  }
  return { executors: parsed.executors };
}

export function stringifyProfiles(profiles: VkProfiles): string {
  return JSON.stringify(profiles, null, 2);
}

export function createOpenRouterVariantKey(modelId: string): string {
  const normalized = modelId
    .trim()
    .replace(/^openrouter\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return `OPENROUTER_${normalized || 'MODEL'}`;
}

export function getOpenRouterModelForVariant(
  profiles: VkProfiles,
  variantKey: string,
): string | null {
  const config = profiles.executors.OPENCODE?.[variantKey]?.OPENCODE;
  if (!config || typeof config !== 'object') return null;
  const model = (config as { model?: unknown }).model;
  return typeof model === 'string' ? model : null;
}

export function mergeOpenRouterModelsIntoProfiles(
  profiles: VkProfiles,
  models: OpenRouterModelSummary[],
): OpenRouterProfileMergeResult {
  const next: VkProfiles = {
    ...profiles,
    executors: { ...profiles.executors },
  };
  const opencodeConfigs = {
    ...(next.executors[OPENCODE_EXECUTOR] || {}),
  };

  const addedVariantKeys: string[] = [];
  const existingVariantKeys: string[] = [];

  for (const model of models) {
    const variantKey = createOpenRouterVariantKey(model.id);
    if (opencodeConfigs[variantKey]) {
      existingVariantKeys.push(variantKey);
      continue;
    }

    opencodeConfigs[variantKey] = {
      [OPENCODE_EXECUTOR]: {
        model: `${OPENROUTER_PROVIDER_PREFIX}${stripOpenRouterPrefix(model.id)}`,
        auto_approve: true,
      },
    };
    addedVariantKeys.push(variantKey);
  }

  next.executors[OPENCODE_EXECUTOR] = opencodeConfigs;

  return { profiles: next, addedVariantKeys, existingVariantKeys };
}

export function buildOpenRouterSettingsPath(variantKey: string): string {
  const params = new URLSearchParams({
    settingsSection: 'agents',
    settingsExecutor: OPENCODE_EXECUTOR,
    settingsVariant: variantKey,
  });
  return `/workspaces?${params.toString()}`;
}

function stripOpenRouterPrefix(modelId: string): string {
  return modelId.trim().replace(/^openrouter\//i, '');
}
