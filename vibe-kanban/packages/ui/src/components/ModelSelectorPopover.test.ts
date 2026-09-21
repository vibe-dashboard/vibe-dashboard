import { describe, expect, it } from 'vitest';
import {
  getProviderFilterState,
  orderModelsForDisplay,
  providerMatchesSearch,
} from './ModelSelectorPopover';
import { modelMatchesSearch, type ModelListModel } from './ModelList';

const openRouterModel: ModelListModel = {
  id: 'anthropic/claude-future',
  name: 'Claude Future',
  provider_id: 'openrouter',
  reasoning_options: [],
};

describe('model selector filtering', () => {
  it('matches provider-prefixed model IDs for discovered OpenRouter models', () => {
    expect(
      modelMatchesSearch(openRouterModel, 'openrouter/anthropic/claude')
    ).toBe(true);
  });

  it('matches provider names and IDs', () => {
    expect(
      providerMatchesSearch(
        { id: 'openrouter', name: 'OpenRouter' },
        'openrouter'
      )
    ).toBe(true);
  });

  it('auto-expands the first provider matching the active search', () => {
    const state = getProviderFilterState(
      {
        providers: [
          { id: 'anthropic', name: 'Anthropic' },
          { id: 'openrouter', name: 'OpenRouter' },
        ],
        models: [
          {
            id: 'opus',
            name: 'Opus',
            provider_id: 'anthropic',
            reasoning_options: [],
          },
          openRouterModel,
        ],
      },
      'claude future',
      'anthropic'
    );

    expect(state.visibleProviderIds).toEqual(['openrouter']);
    expect(state.activeProviderId).toBe('openrouter');
  });

  it('keeps canonical provider ids visible for explicit OpenRouter models', () => {
    const state = getProviderFilterState(
      {
        providers: [{ id: 'openrouter', name: 'OpenRouter' }],
        models: [
          {
            ...openRouterModel,
            provider_id: 'openrouter',
          },
        ],
      },
      'openrouter/anthropic/claude',
      ''
    );

    expect(state.visibleProviderIds).toEqual(['openrouter']);
    expect(state.activeProviderId).toBe('openrouter');
  });

  it('uses model_order metadata before alphabetical fallback', () => {
    const models: ModelListModel[] = [
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        reasoning_options: [],
      },
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        reasoning_options: [],
      },
      {
        id: 'gpt-5.6',
        name: 'GPT-5.6',
        reasoning_options: [],
      },
      {
        id: 'custom-future',
        name: 'Custom Future',
        reasoning_options: [],
      },
    ];

    expect(
      orderModelsForDisplay(models, ['gpt-5.6', 'gpt-5.6-sol']).map(
        (model) => model.id
      )
    ).toEqual(['gpt-5.6', 'gpt-5.6-sol', 'custom-future', 'gpt-5.2']);
  });

  it('keeps alphabetical ordering when model_order metadata is absent', () => {
    const models: ModelListModel[] = [
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        reasoning_options: [],
      },
      {
        id: 'gpt-5.6',
        name: 'GPT-5.6',
        reasoning_options: [],
      },
      {
        id: 'custom-future',
        name: 'Custom Future',
        reasoning_options: [],
      },
    ];

    expect(orderModelsForDisplay(models).map((model) => model.id)).toEqual([
      'custom-future',
      'gpt-5.2',
      'gpt-5.6',
    ]);
  });
});
