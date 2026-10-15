import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  readdir,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

type Variant = 'empty' | 'basic-seeded';

type Manifest = {
  variant: Variant;
  description: string;
  repoPath?: string;
  repoName?: string;
  voyageName?: string;
  craftTitle?: string;
  initialPrompt?: string;
  followUpPrompt?: string;
  model?: string;
  generatedBy?: string;
};

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const vkRoot = path.join(repoRoot, 'vibe-kanban');
const fixtureRoot = path.join(
  repoRoot,
  'tests/e2e/fixtures/vk-mocked-sandbox',
);
const canonicalRepoPath = '/home/vkuser/e2e/repos/basic-seeded-repo';
export function sandboxRuntimeRepoPath(root: string): string {
  return path.join(root, '.vk-mocked-sandbox/repos/basic-seeded-repo');
}
const runtimeRepoPath = sandboxRuntimeRepoPath(repoRoot);
const defaultVdDbPath = path.join(repoRoot, 'data/kv.db');
const vdDbPath = path.resolve(process.env.SQLITE_DATABASE_FILE ?? defaultVdDbPath);
const vkDevAssetsPath = path.join(vkRoot, 'dev_assets');
const vkDbPath = path.join(vkDevAssetsPath, 'db.v2.sqlite');
const vkSessionLogsPath = path.join(vkDevAssetsPath, 'sessions');
const sandboxPlanPath = path.join(
  repoRoot,
  '.vk-mocked-sandbox/current/plan.json',
);

const generatedVkDevAssetFiles = [
  'db.v2.sqlite',
  'config.json',
  'profiles.json',
  'credentials.json',
  'trusted_ed25519_public_keys.json',
  'server_ed25519_signing_key',
  'relay_host_credentials.json',
];
const fixtureVkDevAssetFiles = generatedVkDevAssetFiles.filter(
  (fileName) => fileName !== 'server_ed25519_signing_key',
);

function usage(): never {
  console.error(`Usage:
  npm run e2e:vk-mocked-sandbox:reset -- --variant empty|basic-seeded
  npm run e2e:vk-mocked-sandbox:snapshot -- --variant basic-seeded
  npm run e2e:vk-mocked-sandbox:validate -- --variant basic-seeded

Options:
  --variant <name>  Fixture variant: empty or basic-seeded
  --force          Override live-sandbox guard for reset/snapshot`);
  process.exit(1);
}

function parseArgs() {
  const [command, ...args] = process.argv.slice(2);
  const variantIndex = args.indexOf('--variant');
  const variant =
    variantIndex >= 0 ? (args[variantIndex + 1] as Variant | undefined) : undefined;
  const force = args.includes('--force');

  if (
    !['reset', 'snapshot', 'validate'].includes(command ?? '') ||
    !(variant === 'empty' || variant === 'basic-seeded')
  ) {
    usage();
  }

  return { command: command as 'reset' | 'snapshot' | 'validate', variant, force };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(targetPath: string): Promise<T> {
  return JSON.parse(await readFile(targetPath, 'utf8')) as T;
}

async function sandboxPidIsRunning(): Promise<boolean> {
  const pidPath = path.join(path.dirname(sandboxPlanPath), 'sandbox.pid');
  if (!(await exists(pidPath))) return false;
  const pid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function openHandles(targetPaths: string[]): Promise<string[]> {
  try {
    await execFileAsync('which', ['lsof']);
  } catch {
    return [];
  }

  const handles: string[] = [];
  for (const targetPath of targetPaths) {
    if (!(await exists(targetPath))) continue;
    try {
      const { stdout } = await execFileAsync('lsof', [targetPath]);
      if (stdout.trim()) handles.push(stdout.trim());
    } catch {
      // lsof exits non-zero when no handles are open.
    }
  }
  return handles;
}

async function assertSandboxStopped(force: boolean) {
  if (force) return;

  const sandboxRunning = await sandboxPidIsRunning();
  const handles = await openHandles([
    vdDbPath,
    vkDbPath,
    `${vdDbPath}-wal`,
    `${vdDbPath}-shm`,
  ]);

  if (sandboxRunning || handles.length) {
    throw new Error(
      [
        'Refusing to reset/snapshot while the VK mocked sandbox appears live.',
        sandboxRunning ? 'This worktree sandbox process is running.' : '',
        handles.length ? `Open DB handles:\n${handles.join('\n')}` : '',
        'Stop the sandbox first, then rerun. Use --force only for manual recovery.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function removeIfExists(targetPath: string) {
  await rm(targetPath, { recursive: true, force: true });
}

async function copyFileIfExists(source: string, destination: string) {
  if (!(await exists(source))) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyDirectoryWithoutGit(source: string, destination: string) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryWithoutGit(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function ensureGitRepo(repoPath: string) {
  if (await exists(path.join(repoPath, '.git'))) return;
  await execFileAsync('git', ['init', repoPath]);
  await execFileAsync('git', ['-C', repoPath, 'checkout', '-B', 'main']);
  await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Vibe Kanban']);
  await execFileAsync('git', [
    '-C',
    repoPath,
    'config',
    'user.email',
    'noreply@vibekanban.com',
  ]);
  await execFileAsync('git', ['-C', repoPath, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    repoPath,
    'commit',
    '--allow-empty',
    '-m',
    'Seed basic fixture repo',
  ]);
}

async function updateRepoPath(dbPath: string, from: string, to: string) {
  const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const { stdout } = await execFileAsync('sqlite3', [
    dbPath,
    `update repos set path=${sqlString(to)} where path=${sqlString(from)}; select changes();`,
  ]);
  if (stdout.trim() !== '1') {
    throw new Error(`Expected one VK repository path to change from ${from} to ${to}`);
  }
}

async function resetCommonState() {
  await removeIfExists(vdDbPath);
  await removeIfExists(`${vdDbPath}-wal`);
  await removeIfExists(`${vdDbPath}-shm`);
  await removeIfExists(vkDbPath);
  await removeIfExists(`${vkDbPath}-wal`);
  await removeIfExists(`${vkDbPath}-shm`);
  await removeIfExists(vkSessionLogsPath);

  for (const fileName of generatedVkDevAssetFiles.filter(
    (file) => file !== 'db.v2.sqlite',
  )) {
    await removeIfExists(path.join(vkDevAssetsPath, fileName));
  }
}

async function resetVariant(variant: Variant, force: boolean) {
  await assertSandboxStopped(force);
  await resetCommonState();
  await mkdir(path.dirname(vdDbPath), { recursive: true });
  await mkdir(vkDevAssetsPath, { recursive: true });

  const fixtureDir = path.join(fixtureRoot, variant);
  if (variant === 'basic-seeded') {
    await copyFile(path.join(fixtureDir, 'vd/kv.db'), vdDbPath);
    for (const fileName of fixtureVkDevAssetFiles) {
      await copyFileIfExists(
        path.join(fixtureDir, 'vk/dev_assets', fileName),
        path.join(vkDevAssetsPath, fileName),
      );
    }
    await updateRepoPath(vkDbPath, canonicalRepoPath, runtimeRepoPath);
    if (await exists(path.join(fixtureDir, 'vk/dev_assets/sessions'))) {
      await cp(path.join(fixtureDir, 'vk/dev_assets/sessions'), vkSessionLogsPath, {
        recursive: true,
      });
    }

    await removeIfExists(runtimeRepoPath);
    await mkdir(path.dirname(runtimeRepoPath), { recursive: true });
    await cp(path.join(fixtureDir, 'repos/basic-seeded-repo'), runtimeRepoPath, {
      recursive: true,
    });
    await ensureGitRepo(runtimeRepoPath);
  } else {
    await removeIfExists(runtimeRepoPath);
    await mkdir(path.dirname(runtimeRepoPath), { recursive: true });
  }

  console.log(`Reset VK mocked sandbox fixture: ${variant}`);
}

async function snapshotVariant(variant: Variant, force: boolean) {
  await assertSandboxStopped(force);
  const fixtureDir = path.join(fixtureRoot, variant);
  await removeIfExists(fixtureDir);
  await mkdir(path.join(fixtureDir, 'vd'), { recursive: true });
  await mkdir(path.join(fixtureDir, 'vk/dev_assets'), { recursive: true });

  const manifest: Manifest =
    variant === 'basic-seeded'
      ? {
          variant,
          description:
            'Seeded VK mocked sandbox state with a VD voyage/craft backed by a completed VK qa-mode workspace and follow-up.',
          repoPath: canonicalRepoPath,
          repoName: 'basic-seeded-repo',
          voyageName: 'Basic Seeded Voyage',
          craftTitle: 'Basic Seeded VK Craft',
          initialPrompt:
            'Use the qa-mode mocked provider to create the basic seeded acceptance workspace.',
          followUpPrompt:
            'Seeded follow-up prompt: confirm the basic seeded fixture can continue without real model tokens.',
          model: 'qa-mock',
          generatedBy:
            'npm run e2e:vk-mocked-sandbox:snapshot -- --variant basic-seeded',
        }
      : {
          variant,
          description:
            'Empty VK mocked sandbox state. Reset removes VD/VK sqlite state and the canonical seeded repo.',
          generatedBy:
            'npm run e2e:vk-mocked-sandbox:snapshot -- --variant empty',
        };

  if (variant === 'basic-seeded') {
    await copyFile(vdDbPath, path.join(fixtureDir, 'vd/kv.db'));
    for (const fileName of fixtureVkDevAssetFiles) {
      await copyFileIfExists(
        path.join(vkDevAssetsPath, fileName),
        path.join(fixtureDir, 'vk/dev_assets', fileName),
      );
    }
    await updateRepoPath(
      path.join(fixtureDir, 'vk/dev_assets/db.v2.sqlite'),
      runtimeRepoPath,
      canonicalRepoPath,
    );
    if (await exists(vkSessionLogsPath)) {
      await cp(vkSessionLogsPath, path.join(fixtureDir, 'vk/dev_assets/sessions'), {
        recursive: true,
      });
    }
    const repoFixturePath = path.join(fixtureDir, 'repos/basic-seeded-repo');
    await copyDirectoryWithoutGit(runtimeRepoPath, repoFixturePath);
    if (!(await exists(path.join(repoFixturePath, 'README.md')))) {
      await writeFile(
        path.join(repoFixturePath, 'README.md'),
        '# Basic seeded E2E repository\n',
      );
    }
  }

  await writeFile(
    path.join(fixtureDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Snapshotted VK mocked sandbox fixture: ${variant}`);
}

async function sqliteValue(dbPath: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync('sqlite3', [
    dbPath,
    `select value from kvstore where key=${JSON.stringify(key)};`,
  ]);
  return stdout;
}

async function validateVariant(variant: Variant) {
  const manifestPath = path.join(fixtureRoot, variant, 'manifest.json');
  const manifest = await readJson<Manifest>(manifestPath);
  if (manifest.variant !== variant) {
    throw new Error(`Fixture manifest variant mismatch: ${manifest.variant}`);
  }

  if (variant === 'basic-seeded') {
    if (!(await exists(path.join(fixtureRoot, variant, 'vd/kv.db')))) {
      throw new Error('Missing VD sqlite fixture.');
    }
    if (!(await exists(path.join(fixtureRoot, variant, 'vk/dev_assets/db.v2.sqlite')))) {
      throw new Error('Missing VK sqlite fixture.');
    }
    const repoFixturePath = path.join(
      fixtureRoot,
      variant,
      'repos/basic-seeded-repo',
    );
    if (!(await exists(repoFixturePath)) || !(await stat(repoFixturePath)).isDirectory()) {
      throw new Error('Missing seeded repository fixture.');
    }
    if (await exists(path.join(repoFixturePath, '.git'))) {
      throw new Error('Seeded repository fixture must not contain an embedded .git directory.');
    }

    const fixtureVdDb = path.join(fixtureRoot, variant, 'vd/kv.db');
    const workspaceState = await sqliteValue(
      fixtureVdDb,
      'engine|module|workspace|state.persistent|workspace',
    );
    const sessionsState = await sqliteValue(
      fixtureVdDb,
      'engine|module|workspace|state.persistent|workspace-sessions',
    );
    for (const expected of [manifest.voyageName, manifest.craftTitle]) {
      if (expected && !`${workspaceState}\n${sessionsState}`.includes(expected)) {
        throw new Error(`VD fixture does not contain expected value: ${expected}`);
      }
    }

    const fixtureVkDb = path.join(fixtureRoot, variant, 'vk/dev_assets/db.v2.sqlite');
    const { stdout: repoCount } = await execFileAsync('sqlite3', [
      fixtureVkDb,
      `select count(*) from repos where path=${JSON.stringify(canonicalRepoPath)};`,
    ]);
    if (repoCount.trim() !== '1') {
      throw new Error(`VK fixture does not contain repo path ${canonicalRepoPath}`);
    }
  }

  console.log(`Validated VK mocked sandbox fixture: ${variant}`);
}

async function main() {
  const { command, variant, force } = parseArgs();
  if (command === 'reset') await resetVariant(variant, force);
  if (command === 'snapshot') await snapshotVariant(variant, force);
  if (command === 'validate') await validateVariant(variant);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
