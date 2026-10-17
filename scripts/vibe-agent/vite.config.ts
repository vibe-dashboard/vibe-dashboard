import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const externalBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  // The CLI is copied into production images without node_modules. Bundle every
  // package dependency; the Rollup external rule below still preserves Node's
  // built-in modules.
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(__dirname, '../../dist/vibe-agent'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'legacy-cli/vibe-agent': resolve(__dirname, 'legacy-cli/vibe-agent.ts'),
        'cli/vk': resolve(__dirname, 'cli/vk.ts'),
        'nudge/auto-nudge': resolve(__dirname, 'nudge/auto-nudge.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
      external: (source) => externalBuiltins.has(source),
    },
  },
});
