import type { ConfigTheme } from '@heroui/react';

// One catalog for the HeroUI plugin, selector, and runtime base-mode adapter.
export const themes = [
  {
    id: 'neutral-dark',
    name: 'Neutral Dark',
    mode: 'dark',
    background: '#101114',
    surface: '#191b20',
    raised: '#25282f',
    foreground: '#eeeef2',
    muted: '#b2b6c2',
    primary: '#80b5ff',
    secondary: '#c1a0fa',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    background: '#0b1528',
    surface: '#12223c',
    raised: '#1c3453',
    foreground: '#e8f2ff',
    muted: '#a5bed8',
    primary: '#72d9ec',
    secondary: '#b4b7ff',
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    background: '#0c1b17',
    surface: '#142c24',
    raised: '#214236',
    foreground: '#e8f5ed',
    muted: '#a9c8b7',
    primary: '#86dfbd',
    secondary: '#e4c578',
  },
  {
    id: 'sand',
    name: 'Sand',
    mode: 'light',
    background: '#faf5e9',
    surface: '#fffdf6',
    raised: '#e9dfcc',
    foreground: '#302d25',
    muted: '#625c50',
    primary: '#006e65',
    secondary: '#a34430',
  },
  {
    id: 'plum',
    name: 'Plum',
    mode: 'dark',
    background: '#201226',
    surface: '#2e1c38',
    raised: '#462c51',
    foreground: '#f8edf9',
    muted: '#ccb0d1',
    primary: '#d6b2ff',
    secondary: '#f2a6c4',
  },
] as const;

export type ThemeId = (typeof themes)[number]['id'];
export type UIFont = 'system' | 'ibm-plex-mono';
export type ThemePreferences = { themeId: ThemeId; uiFont: UIFont };
export const defaultThemePreferences: ThemePreferences = {
  themeId: 'neutral-dark',
  uiFont: 'ibm-plex-mono',
};

export function isThemeId(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function isUIFont(value: unknown): value is UIFont {
  return value === 'system' || value === 'ibm-plex-mono';
}

export function resolveThemePreferences(
  value: Partial<ThemePreferences> | null | undefined,
): ThemePreferences {
  return {
    themeId: isThemeId(value?.themeId)
      ? value.themeId
      : defaultThemePreferences.themeId,
    uiFont: isUIFont(value?.uiFont)
      ? value.uiFont
      : defaultThemePreferences.uiFont,
  };
}

export function getTheme(id: ThemeId) {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}

export const heroThemes: Record<ThemeId, ConfigTheme> = Object.fromEntries(
  themes.map((theme) => {
    const dark = theme.mode === 'dark';
    const colors = {
      background: theme.background,
      foreground: theme.foreground,
      content1: { DEFAULT: theme.surface, foreground: theme.foreground },
      content2: { DEFAULT: theme.raised, foreground: theme.foreground },
      content3: { DEFAULT: theme.raised, foreground: theme.foreground },
      content4: { DEFAULT: theme.muted, foreground: theme.background },
      divider: theme.muted,
      focus: theme.primary,
      overlay: '#000000',
      // Override neutral ramps too: foreground-500 and default-* are used by
      // HeroUI inputs, menus and converted chat text, not just accent buttons.
      default: {
        50: theme.background,
        100: theme.surface,
        200: theme.raised,
        300: theme.raised,
        400: theme.muted,
        500: theme.muted,
        600: theme.muted,
        700: theme.foreground,
        800: theme.foreground,
        900: theme.foreground,
        DEFAULT: theme.raised,
        foreground: theme.foreground,
      },
      primary: { DEFAULT: theme.primary, foreground: theme.background },
      secondary: { DEFAULT: theme.secondary, foreground: theme.background },
      success: {
        DEFAULT: dark ? '#72dfa2' : '#146e3a',
        foreground: dark ? '#102219' : '#ffffff',
      },
      warning: {
        DEFAULT: dark ? '#f3ce73' : '#805000',
        foreground: dark ? '#2a2008' : '#ffffff',
      },
      danger: {
        DEFAULT: dark ? '#ff9da7' : '#b32139',
        foreground: dark ? '#2c1018' : '#ffffff',
      },
    };
    return [theme.id, { extend: theme.mode, colors }];
  }),
) as Record<ThemeId, ConfigTheme>;
