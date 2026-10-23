import { useLayoutEffect, type PropsWithChildren } from 'react';
import { useModule } from '../hooks/useModule';
import { applyTheme } from '../lib/themeDocument';
import { getTheme, resolveThemePreferences } from '../lib/themes';
import { ThemeModeContext } from '../hooks/useThemeMode';

export function ThemeProvider({ children }: PropsWithChildren) {
  const stored = useModule('Themes').states.preferences.useState();
  useLayoutEffect(() => {
    applyTheme(document.documentElement, stored);
  }, [stored]);
  const mode = getTheme(resolveThemePreferences(stored).themeId).mode;
  return (
    <ThemeModeContext.Provider value={mode}>
      {children}
    </ThemeModeContext.Provider>
  );
}
