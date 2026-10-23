import { defineConfig } from 'playwright/test';
import config from './playwright.inline-chat.config';
export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5197' },
  outputDir: 'test-results/composer-regressions',
  webServer: {
    ...config.webServer,
    command: 'pnpm exec vite --config vite.inline-chat.config.ts --port 5197',
    url: 'http://127.0.0.1:5197',
  },
  projects: config.projects?.map((project) => ({
    ...project,
    use: { ...project.use, launchOptions: { executablePath: '/usr/bin/google-chrome' } },
  })),
});
