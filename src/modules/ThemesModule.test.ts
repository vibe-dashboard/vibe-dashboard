import { describe, expect, it, vi } from 'vitest';
import type { ModuleAPI } from 'springboard';
import {
  defaultThemePreferences,
  resolveThemePreferences,
  type ThemePreferences,
} from '../lib/themes';

vi.mock('springboard', () => ({ default: { registerModule: vi.fn() } }));
import { createThemesModule } from './ThemesModule';

function persistentAPI(storage: Map<string, ThemePreferences>) {
  const createPersistentState = vi.fn(
    async (key: string, initial: ThemePreferences) => {
      if (!storage.has(key)) storage.set(key, structuredClone(initial));
      return {
        getState: () => storage.get(key)!,
        setStateImmer: (update: (draft: ThemePreferences) => void) => {
          const next = structuredClone(storage.get(key)!);
          update(next);
          storage.set(key, next);
        },
      };
    },
  );
  const api = {
    statesAPI: { createPersistentState },
    createActions: <T>(actions: T) => actions,
  } as unknown as ModuleAPI;
  return { api, createPersistentState };
}

describe('Themes persistent preferences', () => {
  it('creates fresh state, shares writes, and restores them on re-registration', async () => {
    const storage = new Map<string, ThemePreferences>();
    const firstAPI = persistentAPI(storage);
    const first = await createThemesModule(firstAPI.api);
    const second = await createThemesModule(persistentAPI(storage).api);
    expect(firstAPI.createPersistentState).toHaveBeenCalledWith(
      'preferences',
      defaultThemePreferences,
    );
    expect(first.states.preferences.getState()).toEqual({
      themeId: 'neutral-dark',
      uiFont: 'ibm-plex-mono',
    });
    await first.actions.setTheme({ themeId: 'sand' });
    expect(second.states.preferences.getState().themeId).toBe('sand');
    await second.actions.setUIFont({ uiFont: 'system' });
    const restarted = await createThemesModule(persistentAPI(storage).api);
    expect(restarted.states.preferences.getState()).toEqual({
      themeId: 'sand',
      uiFont: 'system',
    });
    expect([...storage.keys()]).toEqual(['preferences']);
  });

  it('rejects unknown IDs without changing the other preference', async () => {
    const { api } = persistentAPI(new Map());
    const module = await createThemesModule(api);
    await module.actions.setTheme({ themeId: 'plum' });
    expect(() => module.actions.setTheme({ themeId: '__proto__' })).toThrow(
      'Unknown theme',
    );
    expect(() =>
      module.actions.setUIFont({ uiFont: 'remote-font-url' }),
    ).toThrow('Unknown interface font');
    expect(module.states.preferences.getState()).toEqual({
      themeId: 'plum',
      uiFont: 'ibm-plex-mono',
    });
  });

  it('resolves invalid saved selections for rendering without rewriting storage', () => {
    const stored = { themeId: 'removed-preset', uiFont: 'system' };
    expect(resolveThemePreferences(stored as ThemePreferences)).toEqual({
      themeId: 'neutral-dark',
      uiFont: 'system',
    });
    expect(stored.themeId).toBe('removed-preset');
    expect(resolveThemePreferences(null)).toEqual(defaultThemePreferences);
  });
});
