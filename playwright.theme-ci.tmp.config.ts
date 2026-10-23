import config from './playwright.inline-chat.config';

export default {
  ...config,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5193' },
  webServer: {
    ...config.webServer,
    command: 'pnpm exec vite --config vite.inline-chat.config.ts --port 5193',
    url: 'http://127.0.0.1:5193',
  },
};
