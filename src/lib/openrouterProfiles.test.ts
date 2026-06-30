import { describe, expect, it } from 'vitest';
import {
  buildOpenRouterSettingsPath,
  createOpenRouterVariantKey,
  mergeOpenRouterModelsIntoProfiles,
  parseProfilesContent,
} from './openrouterProfiles';

describe('openrouterProfiles', () => {
  it('creates stable VK OPENCODE variant keys from OpenRouter model ids', () => {
    expect(createOpenRouterVariantKey('anthropic/claude-sonnet-4')).toBe(
      'OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4',
    );
    expect(createOpenRouterVariantKey('openai/gpt-4.1-mini:free')).toBe(
      'OPENROUTER_OPENAI_GPT_4_1_MINI_FREE',
    );
  });

  it('merges selected OpenRouter models as OPENCODE profiles without dropping existing configs', () => {
    const profiles = parseProfilesContent(
      JSON.stringify({
        executors: {
          OPENCODE: {
            DEFAULT: { OPENCODE: { auto_approve: true } },
            CUSTOM: { OPENCODE: { model: 'openrouter/custom/model' } },
          },
        },
      }),
    );

    const result = mergeOpenRouterModelsIntoProfiles(profiles, [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'openai/gpt-4.1-mini:free', name: 'GPT 4.1 Mini Free' },
    ]);

    expect(result.addedVariantKeys).toEqual([
      'OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4',
      'OPENROUTER_OPENAI_GPT_4_1_MINI_FREE',
    ]);
    expect(result.profiles.executors.OPENCODE!.CUSTOM).toEqual({
      OPENCODE: { model: 'openrouter/custom/model' },
    });
    expect(
      result.profiles.executors.OPENCODE!
        .OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4,
    ).toEqual({
      OPENCODE: {
        model: 'openrouter/anthropic/claude-sonnet-4',
        auto_approve: true,
      },
    });
  });

  it('reports existing generated variants instead of overwriting them', () => {
    const profiles = parseProfilesContent(
      JSON.stringify({
        executors: {
          OPENCODE: {
            OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4: {
              OPENCODE: { model: 'openrouter/anthropic/claude-sonnet-4' },
            },
          },
        },
      }),
    );

    const result = mergeOpenRouterModelsIntoProfiles(profiles, [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
    ]);

    expect(result.addedVariantKeys).toEqual([]);
    expect(result.existingVariantKeys).toEqual([
      'OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4',
    ]);
  });

  it('builds a VK settings permalink for an agent variant', () => {
    expect(
      buildOpenRouterSettingsPath('OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4'),
    ).toBe(
      '/workspaces?settingsSection=agents&settingsExecutor=OPENCODE&settingsVariant=OPENROUTER_ANTHROPIC_CLAUDE_SONNET_4',
    );
  });
});
