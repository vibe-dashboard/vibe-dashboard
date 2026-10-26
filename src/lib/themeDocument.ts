import {
  getTheme,
  resolveThemePreferences,
  themes,
  type ThemePreferences,
} from './themes';

export function applyTheme(
  root: HTMLElement,
  stored: Partial<ThemePreferences>,
) {
  const preferences = resolveThemePreferences(stored);
  const theme = getTheme(preferences.themeId);
  root.classList.remove('light', 'dark', ...themes.map((entry) => entry.id));
  root.classList.add(theme.mode, theme.id);
  root.dataset.theme = theme.id;
  root.dataset.uiFont = preferences.uiFont;
  root.style.colorScheme = theme.mode;
}
