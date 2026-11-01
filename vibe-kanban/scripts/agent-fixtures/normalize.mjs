#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixturesRoot = path.join(
  repoRoot,
  'crates',
  'executors',
  'tests',
  'fixtures',
  'agent-cli'
);
const checkOnly = process.argv.includes('--check');

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stable(nested)])
    );
  }
  return value;
}

async function findJsonlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findJsonlFiles(fullPath);
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        return [fullPath];
      }
      return [];
    })
  );
  return files.flat();
}

function normalizeJsonl(content, filePath) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines
      .map((line, index) => {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          throw new Error(
            `${path.relative(repoRoot, filePath)}:${index + 1} is not valid JSON: ${
              error.message
            }`
          );
        }
        return JSON.stringify(stable(parsed));
      })
      .join('\n') + '\n'
  );
}

const files = await findJsonlFiles(fixturesRoot);
let changed = false;

for (const file of files) {
  const original = await fs.readFile(file, 'utf8');
  const normalized = normalizeJsonl(original, file);
  if (original !== normalized) {
    changed = true;
    const relative = path.relative(repoRoot, file);
    if (checkOnly) {
      console.error(`${relative} is not canonical; run pnpm run agent-fixtures:normalize`);
    } else {
      await fs.writeFile(file, normalized);
      console.log(`normalized ${relative}`);
    }
  }
}

if (checkOnly && changed) {
  process.exit(1);
}

if (!changed) {
  console.log(`agent fixture JSONL files already canonical (${files.length} files)`);
}
