/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { buildViteDevServerOptions } from './src/lib/beadsFormDevServer';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const vkWebCoreSrc = path.resolve(dirname, 'vibe-kanban/packages/web-core/src');
const vkLocalWebSrc = path.resolve(dirname, 'vibe-kanban/packages/local-web/src');
const vkUiSrc = path.resolve(dirname, 'vibe-kanban/packages/ui/src');
const vkSharedSrc = path.resolve(dirname, 'vibe-kanban/shared');
const vkPublicDir = path.resolve(dirname, 'vibe-kanban/packages/public');

function vkPublicIconAssets(): Plugin {
  const iconDirectories = ['agents', 'ide'];

  return {
    name: 'vk-public-icon-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const relativePath = pathname.replace(/^\//, '');
        if (!iconDirectories.some((directory) => relativePath.startsWith(`${directory}/`))) {
          next();
          return;
        }

        const assetPath = path.resolve(vkPublicDir, relativePath);
        if (
          !assetPath.startsWith(`${vkPublicDir}${path.sep}`) ||
          !fs.existsSync(assetPath) ||
          !fs.statSync(assetPath).isFile()
        ) {
          next();
          return;
        }

        response.setHeader('Content-Type', 'image/svg+xml');
        response.end(fs.readFileSync(assetPath));
      });
    },
    generateBundle() {
      for (const directory of iconDirectories) {
        const directoryPath = path.join(vkPublicDir, directory);
        for (const fileName of fs.readdirSync(directoryPath)) {
          this.emitFile({
            type: 'asset',
            fileName: `${directory}/${fileName}`,
            source: fs.readFileSync(path.join(directoryPath, fileName)),
          });
        }
      }
    },
  };
}

function vkSourceAliases(): Plugin {
  const vkSourceRoots = [
    path.resolve(dirname, 'vibe-kanban/packages/inline-chat/src'),
    vkWebCoreSrc,
    vkLocalWebSrc,
    vkUiSrc,
  ];

  return {
    name: 'vk-source-aliases',
    enforce: 'pre' as const,
    async resolveId(source: string, importer?: string) {
      if (!importer) return null;
      const importerPath = importer.split('?')[0] ?? importer;
      const fromVkSource = vkSourceRoots.some((root) =>
        importerPath.startsWith(root),
      );
      if (!fromVkSource) return null;

      if (source === '@' || source.startsWith('@/')) {
        const target = source === '@'
          ? vkWebCoreSrc
          : path.join(vkWebCoreSrc, source.slice(2));
        return this.resolve(target, importer, { skipSelf: true });
      }

      if (source === '@web' || source.startsWith('@web/')) {
        const target = source === '@web'
          ? vkLocalWebSrc
          : path.join(vkLocalWebSrc, source.slice(5));
        return this.resolve(target, importer, { skipSelf: true });
      }

      if (source === 'shared' || source.startsWith('shared/')) {
        const target = source === 'shared'
          ? vkSharedSrc
          : path.join(vkSharedSrc, source.slice(7));
        return this.resolve(target, importer, { skipSelf: true });
      }

      return null;
    },
  };
}

function executorSchemasPlugin(): Plugin {
  const virtualId = 'virtual:executor-schemas';
  const resolvedVirtualId = `\0${virtualId}`;

  return {
    name: 'vk-executor-schemas',
    resolveId(id) {
      return id === virtualId ? resolvedVirtualId : null;
    },
    load(id) {
      if (id !== resolvedVirtualId) return null;

      const schemasDir = path.resolve(dirname, 'vibe-kanban/shared/schemas');
      const files = fs.existsSync(schemasDir)
        ? fs.readdirSync(schemasDir).filter((file) => file.endsWith('.json'))
        : [];
      const imports: string[] = [];
      const entries: string[] = [];

      files.forEach((file, index) => {
        const variableName = `__schema_${index}`;
        const importPath = `shared/schemas/${file}`;
        const key = file.replace(/\.json$/, '').toUpperCase();
        imports.push(`import ${variableName} from ${JSON.stringify(importPath)};`);
        entries.push(`  ${JSON.stringify(key)}: ${variableName}`);
      });

      return `${imports.join('\n')}\n\nexport const schemas = {\n${entries.join(',\n')}\n};\n\nexport default schemas;\n`;
    },
  };
}

let serverPort = 3005;
if (process.env.SERVER_PORT || process.env.PORT) {
  serverPort = parseInt(process.env.SERVER_PORT || process.env.PORT!);
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
const platformVariant = process.env.SPRINGBOARD_PLATFORM || '';
let platforms: ('browser' | 'node')[] = ['browser', 'node'];
if (platformVariant === 'node') {
  platforms = ['node'];
} else if (platformVariant === 'browser') {
  platforms = ['browser'];
}
export default defineConfig({
  plugins: [vkPublicIconAssets(), vkSourceAliases(), executorSchemasPlugin(), react(), tailwindcss(), springboard({
    entry: './src/index.tsx',
    platforms,
    documentMeta: {
      title: 'Vibe Kanban Workspace',
      description: 'Workspace shell for code-server and vibe-kanban'
    },
    nodeServerPort: serverPort,
  })],
  resolve: {
    alias: {
      '@': vkWebCoreSrc,
      '@vibe-dashboard/workflow-core': path.resolve(__dirname, 'packages/workflow-core/src/index.ts'),
      '@vibe-dashboard/beads-form': path.resolve(__dirname, 'packages/beads-form/src/index.ts'),
      '@vibe/ui': vkUiSrc,
      '@vibe/web-core': vkWebCoreSrc,
      '@web': vkLocalWebSrc,
      shared: vkSharedSrc,
      '@vibe/inline-chat': path.resolve(__dirname, 'vibe-kanban/packages/inline-chat/src/index.tsx')
    },
    dedupe: ['react', 'react-dom']
  },
  define: {
    'process.env.DEBUG_LOG_PERFORMANCE': '""',
    'process.env.CADDY_PORT': JSON.stringify(process.env.CADDY_PORT || ''),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0')
  },
  server: buildViteDevServerOptions(),
  test: {
    projects: [{
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        },
        setupFiles: ['.storybook/vitest.setup.ts']
      }
    }]
  }
});
