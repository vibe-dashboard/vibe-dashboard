import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const externalBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  // These CLIs run in the image before node_modules is installed. Vite's SSR
  // defaults externalize packages even when Rollup only externalizes builtins.
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(__dirname, '../../dist/vibe-agent'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'legacy-cli/vibe-agent': resolve(__dirname, 'legacy-cli/vibe-agent.ts'),
        'cli/vk': resolve(__dirname, 'cli/vk.ts'),
        'nudge/daemon': resolve(__dirname, 'nudge/daemon.ts'),
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
