import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();
const vk = path.join(root, 'vibe-kanban');

export default defineConfig({
  root: path.join(root, 'tests/browser/inline-chat'),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inline-harness-executor-schemas',
      resolveId(id) {
        return id === 'virtual:executor-schemas' ? '\0executor-schemas' : null;
      },
      load(id) {
        if (id !== '\0executor-schemas') return;
        const dir = path.join(vk, 'shared/schemas');
        const schemas = Object.fromEntries(
          fs
            .readdirSync(dir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => [
              name.replace('.json', '').toUpperCase(),
              JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
            ]),
        );
        return `export const schemas = ${JSON.stringify(schemas)}; export default schemas;`;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.join(vk, 'packages/web-core/src'),
      '@web': path.join(vk, 'packages/local-web/src'),
      '@vibe/ui': path.join(vk, 'packages/ui/src'),
      '@vibe/inline-chat': path.join(vk, 'packages/inline-chat/src/index.tsx'),
      shared: path.join(vk, 'shared'),
    },
    dedupe: ['react', 'react-dom'],
  },
  define: {
    __APP_VERSION__: '"test"',
    'process.env.DEBUG_LOG_PERFORMANCE': '""',
  },
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
    fs: { allow: [root] },
  },
});
