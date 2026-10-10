import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@vibe-dashboard/workflow-core': path.resolve(
        __dirname,
        'packages/workflow-core/src/index.ts',
      ),
      '@vibe-dashboard/beads-form': path.resolve(
        __dirname,
        'packages/beads-form/src/index.ts',
      ),
      '@vibe/inline-chat': path.resolve(
        __dirname,
        'vibe-kanban/packages/inline-chat/src/index.tsx',
      ),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
