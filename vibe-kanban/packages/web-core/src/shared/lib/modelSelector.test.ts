import { describe, expect, it } from 'vitest';
import type { ModelSelectorConfig } from 'shared/types';
import {
  appendExplicitModelChoices,
  getSelectedModel,
  resolveDefaultModelId,
} from './modelSelector';

function baseConfig(): ModelSelectorConfig {
  return {
    agents: [],
    default_model: 'opus',
    models: [
      {
        id: 'opus',
        name: 'Opus',
        provider_id: 'anthropic',
        reasoning_options: [],
      },
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider_id: 'openai',
        reasoning_options: [],
      },
    ],
    permissions: [],
    providers: [
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
    ],
  };
}

describe('modelSelector explicit model support', () => {
  it('keeps future provider-prefixed explicit models selectable', () => {
    const config = appendExplicitModelChoices(baseConfig(), [
      'openrouter/anthropic/claude-future',
    ]);

    expect(
      getSelectedModel(
        config?.models ?? [],
        'openrouter',
        'anthropic/claude-future'
      )
    ).toMatchObject({
      id: 'anthropic/claude-future',
      name: 'anthropic/claude-future',
      provider_id: 'openrouter',
    });
    expect(config?.providers).toContainEqual({
      id: 'openrouter',
      name: 'openrouter',
    });
  });

  it('deduplicates explicit models that discovery already returned', () => {
    const config = appendExplicitModelChoices(baseConfig(), [
      'anthropic/opus',
      'Anthropic/OPUS',
    ]);

    expect(
      config?.models.filter(
        (model) =>
          model.provider_id?.toLowerCase() === 'anthropic' &&
          model.id.toLowerCase() === 'opus'
      )
    ).toHaveLength(1);
  });

  it('canonicalizes explicit model provider casing to an existing provider', () => {
    const discoveredOpenRouterConfig: ModelSelectorConfig = {
      ...baseConfig(),
      providers: [
        ...baseConfig().providers,
        { id: 'openrouter', name: 'OpenRouter' },
      ],
    };

    const config = appendExplicitModelChoices(discoveredOpenRouterConfig, [
      'OpenRouter/anthropic/claude-future',
    ]);

    expect(
      getSelectedModel(
        config?.models ?? [],
        'openrouter',
        'anthropic/claude-future'
      )
    ).toMatchObject({
      id: 'anthropic/claude-future',
      provider_id: 'openrouter',
    });
    expect(config?.providers).toContainEqual({
      id: 'openrouter',
      name: 'OpenRouter',
    });
    expect(config?.providers).not.toContainEqual({
      id: 'OpenRouter',
      name: 'OpenRouter',
    });
  });

  it('uses curated defaults only when no explicit model choice exists', () => {
    const config = appendExplicitModelChoices(baseConfig(), [
      'openrouter/anthropic/claude-future',
    ]);

    expect(
      resolveDefaultModelId(
        config?.models ?? [],
        'anthropic',
        config?.default_model,
        true
      )
    ).toBe('opus');
    expect(
      getSelectedModel(
        config?.models ?? [],
        'openrouter',
        'anthropic/claude-future'
      )?.id
    ).toBe('anthropic/claude-future');
  });

  it('returns null unchanged during discovery fallback with no config', () => {
    expect(
      appendExplicitModelChoices(null, ['openrouter/new/model'])
    ).toBeNull();
  });
});
