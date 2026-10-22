import { defineConfig, devices } from 'playwright/test';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';

export default defineConfig({
  testDir: './tests/e2e/features',
  testMatch: [
    '3237-vd-mocked-model/*.spec.ts',
    'auto-nudge/*.spec.ts',
  ],
  timeout: 240_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: sandboxUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
