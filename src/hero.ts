import { heroui } from '@heroui/react';
import { heroThemes } from './lib/themes';

const heroUIPlugin: ReturnType<typeof heroui> = heroui({
  defaultTheme: 'dark',
  themes: heroThemes,
});

export default heroUIPlugin;
