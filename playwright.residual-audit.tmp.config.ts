import { defineConfig } from 'playwright/test';
import config from './playwright.inline-chat.config';
export default defineConfig({
  ...config,
  outputDir: 'test-results/residual-audit',
  use: { ...config.use, baseURL: 'http://127.0.0.1:53282' },
  webServer: {
    command: 'pnpm exec vite --config vite.inline-chat.config.ts --port 53282',
    url: 'http://127.0.0.1:53282', reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: {
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: '/usr/bin/google-chrome' },
  } }],
});
