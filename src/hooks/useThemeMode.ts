import { createContext, useContext } from 'react';

// Base mode for renderers that only understand light/dark. The named palette
// and preference storage remain owned by Themes/HeroUI, not these consumers.
export const ThemeModeContext = createContext<'light' | 'dark'>('dark');
export const useThemeMode = () => useContext(ThemeModeContext);
