import { useState } from 'react';
import { Select, SelectItem } from '@heroui/react';
import { useModule } from '../hooks/useModule';
import {
  resolveThemePreferences,
  themes,
  type ThemePreferences,
} from '../lib/themes';

export function ThemeSelector() {
  const module = useModule('Themes');
  const preferences = resolveThemePreferences(
    module.states.preferences.useState(),
  );
  return (
    <ThemeSelectorControls
      preferences={preferences}
      setTheme={(themeId) => module.actions.setTheme({ themeId })}
      setUIFont={(uiFont) => module.actions.setUIFont({ uiFont })}
    />
  );
}

export function ThemeSelectorControls({
  preferences,
  setTheme,
  setUIFont,
}: {
  preferences: ThemePreferences;
  setTheme: (themeId: string) => unknown;
  setUIFont: (uiFont: string) => unknown;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(action: () => unknown) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch {
      setError('Could not save appearance. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-label="Appearance"
      className="space-y-2 border-t border-divider/30 p-2"
    >
      <Select
        label="Theme"
        size="sm"
        selectedKeys={[preferences.themeId]}
        isDisabled={pending}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const themeId = Array.from(keys)[0];
          if (typeof themeId === 'string') void save(() => setTheme(themeId));
        }}
      >
        {themes.map((theme) => (
          <SelectItem key={theme.id} textValue={theme.name}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex overflow-hidden rounded border border-divider/30"
              >
                {[theme.background, theme.primary, theme.secondary].map(
                  (color) => (
                    <span
                      key={color}
                      className="h-3 w-2"
                      style={{ background: color }}
                    />
                  ),
                )}
              </span>
              {theme.name}
            </span>
          </SelectItem>
        ))}
      </Select>
      <Select
        label="Interface font"
        size="sm"
        selectedKeys={[preferences.uiFont]}
        isDisabled={pending}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const uiFont = Array.from(keys)[0];
          if (typeof uiFont === 'string') void save(() => setUIFont(uiFont));
        }}
      >
        <SelectItem key="ibm-plex-mono">IBM Plex Mono</SelectItem>
        <SelectItem key="system">System UI</SelectItem>
      </Select>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
