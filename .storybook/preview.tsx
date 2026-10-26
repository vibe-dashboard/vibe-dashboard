import type { Decorator, Preview } from '@storybook/react-vite';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLayoutEffect, useState } from 'react';
import '../src/styles';
import { applyTheme } from '../src/lib/themeDocument';
import { isThemeId, themes, type UIFont } from '../src/lib/themes';
import { getTheme } from '../src/lib/themes';
import { ThemeModeContext } from '../src/hooks/useThemeMode';

if (typeof document !== 'undefined') {
  applyTheme(document.documentElement, {
    themeId: 'neutral-dark',
    uiFont: 'ibm-plex-mono',
  });
}

function StorybookAppProviders({
  children,
  themeId,
  uiFont,
}: {
  children: ReactNode;
  themeId: string;
  uiFont: UIFont;
}) {
  useLayoutEffect(() => {
    applyTheme(document.documentElement, {
      themeId: isThemeId(themeId) ? themeId : 'neutral-dark',
      uiFont,
    });
  }, [themeId, uiFont]);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HeroUIProvider>
        <div
          className="min-h-screen bg-background text-foreground font-sans"
          style={{ minHeight: '100vh' }}
        >
          <ThemeModeContext.Provider
            value={getTheme(isThemeId(themeId) ? themeId : 'neutral-dark').mode}
          >
            {children}
          </ThemeModeContext.Provider>
        </div>
      </HeroUIProvider>
    </QueryClientProvider>
  );
}

const withAppProviders: Decorator = (Story, context) => {
  return (
    <StorybookAppProviders
      themeId={context.globals.theme ?? 'neutral-dark'}
      uiFont={context.globals.uiFont ?? 'ibm-plex-mono'}
    >
      <Story />
    </StorybookAppProviders>
  );
};

const preview: Preview = {
  decorators: [withAppProviders],
  globalTypes: {
    theme: {
      description: 'HeroUI theme preset',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: themes.map((theme) => ({ value: theme.id, title: theme.name })),
        dynamicTitle: true,
      },
    },
    uiFont: {
      description: 'Interface font',
      toolbar: {
        title: 'Font',
        items: [
          { value: 'ibm-plex-mono', title: 'IBM Plex Mono' },
          { value: 'system', title: 'System UI' },
        ],
        dynamicTitle: true,
      },
    },
    iframeRenderMode: {
      description:
        'Controls external iframe rendering in Storybook stories that support iframe safety.',
      defaultValue: 'placeholder',
      toolbar: {
        title: 'Iframes',
        icon: 'browser',
        items: [
          { value: 'placeholder', title: 'Placeholder' },
          { value: 'disabled', title: 'Disabled' },
          { value: 'real', title: 'Real iframes' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
