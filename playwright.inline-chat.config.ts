import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests/browser/inline-chat',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  outputDir: 'test-results/inline-chat',
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5189', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --config vite.inline-chat.config.ts',
    url: 'http://127.0.0.1:5189',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
});
