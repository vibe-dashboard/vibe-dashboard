import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

function executorSchemasPlugin() {
  const virtualId = 'virtual:executor-schemas';
  const resolvedVirtualId = `\0${virtualId}`;

  return {
    name: 'vk-executor-schemas-test',
    resolveId(id: string) {
      return id === virtualId ? resolvedVirtualId : null;
    },
    load(id: string) {
      if (id !== resolvedVirtualId) return null;
      const schemasDir = path.resolve(__dirname, 'vibe-kanban/shared/schemas');
      const files = fs.existsSync(schemasDir)
        ? fs.readdirSync(schemasDir).filter((file) => file.endsWith('.json'))
        : [];
      const imports: string[] = [];
      const entries: string[] = [];
      files.forEach((file, index) => {
        const variableName = `__schema_${index}`;
        const key = file.replace(/\.json$/, '').toUpperCase();
        imports.push(`import ${variableName} from ${JSON.stringify(`shared/schemas/${file}`)};`);
        entries.push(`  ${JSON.stringify(key)}: ${variableName}`);
      });
      return `${imports.join('\n')}\n\nexport const schemas = {\n${entries.join(',\n')}\n};\n\nexport default schemas;\n`;
    },
  };
}

export default defineConfig({
  plugins: [executorSchemasPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'vibe-kanban/packages/web-core/src'),
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
      '@vibe/ui': path.resolve(__dirname, 'vibe-kanban/packages/ui/src'),
      '@vibe/web-core': path.resolve(__dirname, 'vibe-kanban/packages/web-core/src'),
      '@web': path.resolve(__dirname, 'vibe-kanban/packages/local-web/src'),
      shared: path.resolve(__dirname, 'vibe-kanban/shared'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
