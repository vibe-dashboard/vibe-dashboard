import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '4173';
const stateDir = path.resolve('.e2e');
const dbPath = path.join(stateDir, `kv-${port}.db`);

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, `git-${port}.config`), '[user]\n  name = E2E Test User\n  email = e2e@example.invalid\n');
for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
  fs.rmSync(file, { force: true });
}
