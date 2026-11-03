import { defineConfig } from 'playwright/test';
import config from './playwright.config';
export default defineConfig({
  ...config,
  projects: config.projects?.map((project) => ({
    ...project,
    use: { ...project.use, launchOptions: { executablePath: '/usr/bin/google-chrome' } },
  })),
});
