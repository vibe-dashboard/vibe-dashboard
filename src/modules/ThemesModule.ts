import springboard, { type ModuleAPI } from 'springboard';
import {
  defaultThemePreferences,
  isThemeId,
  isUIFont,
  type ThemePreferences,
} from '../lib/themes';

export async function createThemesModule(moduleAPI: ModuleAPI) {
  const preferences =
    await moduleAPI.statesAPI.createPersistentState<ThemePreferences>(
      'preferences',
      { ...defaultThemePreferences },
    );
  const actions = moduleAPI.createActions({
    setTheme: (args: { themeId: string }) => {
      if (!isThemeId(args.themeId)) throw new Error('Unknown theme');
      const themeId = args.themeId;
      preferences.setStateImmer((draft) => {
        draft.themeId = themeId;
      });
    },
    setUIFont: (args: { uiFont: string }) => {
      if (!isUIFont(args.uiFont)) throw new Error('Unknown interface font');
      const uiFont = args.uiFont;
      preferences.setStateImmer((draft) => {
        draft.uiFont = uiFont;
      });
    },
  });
  return { states: { preferences }, actions };
}

springboard.registerModule('Themes', { rpcMode: 'remote' }, createThemesModule);

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    Themes: Awaited<ReturnType<typeof createThemesModule>>;
  }
}
