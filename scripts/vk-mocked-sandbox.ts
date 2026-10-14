import { createServer } from 'node:net';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

export interface SandboxPorts {
  vkBackend: number;
  vkFrontend: number;
  vkPreviewProxy: number;
  vdDashboard: number;
  vdServer: number;
  vdCaddy: number;
}

export interface SandboxPaths {
  workspaceRoot: string;
  vdRoot: string;
  vkRoot: string;
  runDir: string;
}

export interface SandboxPlan {
  ports: SandboxPorts;
  paths: SandboxPaths;
  urls: {
    vd: string;
    vkFrontend: string;
  };
  env: Record<string, string>;
  caddyfile: string;
  setupCommands: CommandSpec[];
  commands: CommandSpec[];
}

export interface CiReleaseArtifact {
  contentHash: string;
  releaseTag: string;
  artifactRoot: string;
  binaryPath: string;
}

export interface CommandSpec {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PortAllocator {
  isAvailable(port: number): Promise<boolean>;
}

const DEFAULT_PORT_START = 50_000;
const MAX_PORT = 65_535;
const SANDBOX_CADDYFILE_NAME = 'Caddyfile';
const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;
const CI_RELEASE_BACKEND_MODE = 'ci-release';
const VK_CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const DEFAULT_VK_GH_REPO = 'vibe-dashboard/vibe-kanban';
const DEFAULT_VK_GH_ARTIFACT_NAME = 'release-assets-linux-x64';
const DEFAULT_VK_GH_ARCHIVE_NAME = 'vibe-kanban-linux-x64.tar.gz';
const VIBE_DASHBOARD_CADDY_MARKER = '# Vibe Dashboard app';

const execFileAsync = promisify(execFile);

function envInt(name: string, fallback: number, env = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PORT) {
    throw new Error(`${name} must be a TCP port number, got ${raw}`);
  }
  return parsed;
}

function appendNodeOption(existingOptions: string | undefined, option: string): string {
  const trimmedOptions = existingOptions?.trim();
  if (!trimmedOptions) return option;
  if (trimmedOptions.includes(option)) return trimmedOptions;
  return `${trimmedOptions} ${option}`;
}

function requireVkContentHash(value: string, envName = 'VK_MOCKED_RELEASE_HASH'): string {
  const hash = value.trim();
  if (!VK_CONTENT_HASH_PATTERN.test(hash)) {
    throw new Error(`${envName} must be a full 64-character VK content hash, got ${value}`);
  }
  return hash.toLowerCase();
}

function isCiReleaseBackend(env: NodeJS.ProcessEnv): boolean {
  return env.VK_MOCKED_VK_BACKEND === CI_RELEASE_BACKEND_MODE;
}

function ciReleaseTag(contentHash: string): string {
  return `vk-assets-sha256-${contentHash}`;
}

function ciReleaseArtifactRoot(vdRoot: string, contentHash: string): string {
  return join(vdRoot, '.vk-mocked-sandbox', 'vk-release-assets', contentHash);
}

function caddyfileWithCiReleaseAssetRouting(caddyfile: string): string {
  const markerMatch = caddyfile.match(
    new RegExp(`^([ \\t]*)${VIBE_DASHBOARD_CADDY_MARKER}$`, 'm'),
  );
  if (!markerMatch) {
    throw new Error(
      `Cannot add CI-release VK asset routing: Caddyfile is missing marker "${VIBE_DASHBOARD_CADDY_MARKER}".`,
    );
  }

  const indent = markerMatch[1] ?? '';
  const indented = (line: string) => (line ? `${indent}${line}` : '');
  const releaseAssetRouting = [
    '# VK release binary frontend assets. Release builds embed VK local-web',
    '# with normal /assets/... URLs, so CI-release sandbox mode must send',
    '# these module/static asset requests to VK before VD/Vite can serve',
    '# its HTML fallback with text/html.',
    '@vk_release_assets {',
    '\tpath_regexp vk_release_assets ^/assets/.+\\.(js|css|wasm|mjs|map|json|png|jpe?g|svg|webp|ico|woff2?)$',
    '}',
    '',
    'handle @vk_release_assets {',
    '\tvk_rewrite',
    '\treverse_proxy localhost:{$BACKEND_PORT:3007} {',
    '\t\theader_up Host {upstream_hostport}',
    '\t\theader_up Upgrade {http.request.header.Upgrade}',
    '\t\theader_up Connection {http.request.header.Connection}',
    '\t\theader_up Accept-Encoding identity',
    '\t}',
    '}',
    '',
  ]
    .map(indented)
    .join('\n');

  return caddyfile.replace(markerMatch[0], `${releaseAssetRouting}${markerMatch[0]}`);
}

function ciReleaseArtifactFromEnv(
  vdRoot: string,
  env: NodeJS.ProcessEnv,
): CiReleaseArtifact | undefined {
  if (!isCiReleaseBackend(env)) return undefined;

  const contentHash = requireVkContentHash(env.VK_MOCKED_RELEASE_HASH ?? '');
  const releaseTag = env.VK_MOCKED_RELEASE_TAG?.trim() || ciReleaseTag(contentHash);

  const artifactRoot =
    env.VK_MOCKED_RELEASE_CACHE_DIR?.trim() || ciReleaseArtifactRoot(vdRoot, contentHash);
  return {
    contentHash,
    releaseTag,
    artifactRoot,
    binaryPath: join(artifactRoot, 'extracted', 'vibe-kanban'),
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function execText(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
    };
    const stderr = err.stderr?.trim();
    const stdout = err.stdout?.trim();
    throw new Error(
      [
        `${command} ${args.join(' ')} failed: ${err.message}`,
        stderr ? `stderr:\n${stderr}` : '',
        stdout ? `stdout:\n${stdout}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function resolveVkContentHash(
  vdRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const configuredHash = env.VK_MOCKED_RELEASE_HASH?.trim();
  if (configuredHash) return requireVkContentHash(configuredHash);

  return requireVkContentHash(
    await execText('.github/scripts/vk-content-hash.sh', [], { cwd: vdRoot }),
    '.github/scripts/vk-content-hash.sh',
  );
}

async function ensureCleanVendoredVk(vdRoot: string, vkRoot: string): Promise<void> {
  if (resolve(vkRoot) !== join(resolve(vdRoot), 'vibe-kanban')) return;
  const status = (await execText('git', ['status', '--porcelain', '--', 'vibe-kanban'], {
    cwd: vdRoot,
  })).trim();
  if (!status) return;
  throw new Error(
    [
      'Vendored VK has local changes; using source mode instead of CI-release assets.',
      'Commit or discard changes under vibe-kanban to use prebuilt VK runtime assets.',
    ].join(' '),
  );
}

async function requireCiReleaseExists(
  releaseTag: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const repo = env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO;
  await execText('gh', [
    'release',
    'view',
    releaseTag,
    '--repo',
    repo,
    '--json',
    'tagName',
  ]);
}

async function verifyManifestIfAvailable(
  manifestPath: string,
  contentHash: string,
): Promise<void> {
  if (!(await fileExists(manifestPath))) return;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    vk_content_hash?: string;
    content_hash?: string;
    vk_sha?: string;
    commit?: string;
    platforms?: Record<
      string,
      {
        assets?: Record<string, { file?: string; sha256?: string }>;
      }
    >;
  };
  const manifestHash =
    manifest.vk_content_hash ??
    manifest.content_hash ??
    (manifest.commit && VK_CONTENT_HASH_PATTERN.test(manifest.commit)
      ? manifest.commit
      : undefined);
  if (manifestHash && manifestHash !== contentHash) {
    throw new Error(
      `Release manifest content hash mismatch: expected ${contentHash}, got ${manifestHash}.`,
    );
  }
}

async function verifyCiReleaseArtifactFiles(input: {
  artifactDir: string;
  archiveName: string;
  contentHash: string;
}): Promise<void> {
  const archivePath = join(input.artifactDir, input.archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const manifestPath = join(input.artifactDir, 'manifest.json');

  if (!(await fileExists(archivePath))) {
    throw new Error(`Release artifact is missing expected archive ${archivePath}.`);
  }
  if (!(await fileExists(checksumPath))) {
    throw new Error(`Release artifact is missing checksum file ${checksumPath}.`);
  }
  await verifyManifestIfAvailable(manifestPath, input.contentHash);
  await execText('sha256sum', ['-c', `${input.archiveName}.sha256`], {
    cwd: input.artifactDir,
  });
}

export async function downloadCiReleaseArtifactFromEnv(
  vdRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<CiReleaseArtifact> {
  const contentHash = requireVkContentHash(env.VK_MOCKED_RELEASE_HASH ?? '');
  const releaseTag = env.VK_MOCKED_RELEASE_TAG?.trim() || ciReleaseTag(contentHash);
  await requireCiReleaseExists(releaseTag, env);
  const repo = env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO;
  const artifactName = env.VK_MOCKED_GH_ARTIFACT_NAME ?? DEFAULT_VK_GH_ARTIFACT_NAME;
  const archiveName = env.VK_MOCKED_GH_ARCHIVE_NAME ?? DEFAULT_VK_GH_ARCHIVE_NAME;
  const artifactRoot =
    env.VK_MOCKED_RELEASE_CACHE_DIR?.trim() ||
    ciReleaseArtifactRoot(vdRoot, contentHash);
  const artifactDir = join(artifactRoot, artifactName);
  const extractDir = join(artifactRoot, 'extracted');
  const archivePath = join(artifactDir, archiveName);
  const binaryPath = join(extractDir, 'vibe-kanban');

  if (await fileExists(binaryPath)) {
    await verifyCiReleaseArtifactFiles({ artifactDir, archiveName, contentHash });
    await chmod(binaryPath, 0o755);
    return { contentHash, releaseTag, artifactRoot, binaryPath };
  }

  await rm(artifactDir, { recursive: true, force: true });
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await mkdir(extractDir, { recursive: true });

  console.log(
    `[vk-mocked-sandbox] downloading ${archiveName} from ${repo} release ${releaseTag}`,
  );
  const downloadArgs = [
    'release',
    'download',
    releaseTag,
    '--repo',
    repo,
    '--pattern',
    'manifest.json',
    '--pattern',
    archiveName,
    '--pattern',
    `${archiveName}.sha256`,
    '--dir',
    artifactDir,
    '--clobber',
  ];
  await execText('gh', downloadArgs);

  if (!(await fileExists(archivePath))) {
    throw new Error(`Downloaded artifact is missing expected archive ${archivePath}.`);
  }
  await verifyCiReleaseArtifactFiles({ artifactDir, archiveName, contentHash });
  await execText('tar', ['-xzf', archivePath, '-C', extractDir]);

  if (!(await fileExists(binaryPath))) {
    throw new Error(`Extracted archive did not contain executable ${binaryPath}.`);
  }
  await chmod(binaryPath, 0o755);

  return { contentHash, releaseTag, artifactRoot, binaryPath };
}

async function resolveCiReleaseArtifact(
  vdRoot: string,
  vkRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<CiReleaseArtifact> {
  await ensureCleanVendoredVk(vdRoot, vkRoot);
  const contentHash = await resolveVkContentHash(vdRoot, env);
  const releaseTag = env.VK_MOCKED_RELEASE_TAG?.trim() || ciReleaseTag(contentHash);
  await requireCiReleaseExists(releaseTag, env);
  const artifactRoot = ciReleaseArtifactRoot(vdRoot, contentHash);
  return {
    contentHash,
    releaseTag,
    artifactRoot,
    binaryPath: join(artifactRoot, 'extracted', 'vibe-kanban'),
  };
}

async function tryResolveCiReleaseArtifact(
  vdRoot: string,
  vkRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<CiReleaseArtifact | undefined> {
  try {
    return await resolveCiReleaseArtifact(vdRoot, vkRoot, env);
  } catch (error) {
    console.warn(
      `[vk-mocked-sandbox] using source VK backend; prebuilt release unavailable: ${
        (error as Error).message
      }`,
    );
    return undefined;
  }
}

export async function isTcpPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolveAvailability) => {
    const server = createServer();
    server.once('error', () => resolveAvailability(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

export async function findFreePort(
  start: number,
  allocator: PortAllocator = { isAvailable: isTcpPortAvailable },
  excludedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (let port = start; port <= MAX_PORT; port += 1) {
    if (excludedPorts.has(port)) continue;
    if (await allocator.isAvailable(port)) return port;
  }
  throw new Error(`Could not find a free port at or above ${start}`);
}

export function childProcessSignalTarget(pid: number): number {
  return process.platform === 'win32' ? pid : -pid;
}

export async function allocatePorts(
  env: NodeJS.ProcessEnv = process.env,
  allocator: PortAllocator = { isAvailable: isTcpPortAvailable },
): Promise<SandboxPorts> {
  const start = envInt('VK_MOCKED_SANDBOX_PORT_START', DEFAULT_PORT_START, env);
  const selectedPorts = new Map<number, string>();
  const nextPort = async (offset: number, envName: string): Promise<number> => {
    const configured = env[envName]?.trim();
    const port = configured
      ? envInt(envName, 0, env)
      : await findFreePort(start + offset, allocator, new Set(selectedPorts.keys()));
    const existingEnvName = selectedPorts.get(port);
    if (existingEnvName) {
      throw new Error(`${envName} must not duplicate ${existingEnvName} (${port})`);
    }
    selectedPorts.set(port, envName);
    return port;
  };

  const vkBackend = await nextPort(0, 'VK_MOCKED_BACKEND_PORT');
  const vkFrontend = await nextPort(1, 'VK_MOCKED_FRONTEND_PORT');
  const vkPreviewProxy = await nextPort(2, 'VK_MOCKED_PREVIEW_PROXY_PORT');
  const vdDashboard = await nextPort(3, 'VK_MOCKED_VD_DASHBOARD_PORT');
  const vdServer = await nextPort(4, 'VK_MOCKED_VD_SERVER_PORT');
  const vdCaddy = await nextPort(5, 'VK_MOCKED_CADDY_PORT');

  return {
    vkBackend,
    vkFrontend,
    vkPreviewProxy,
    vdDashboard,
    vdServer,
    vdCaddy,
  };
}

export async function loadSandboxCaddyfile(vdRoot: string): Promise<string> {
  return await readFile(join(vdRoot, SANDBOX_CADDYFILE_NAME), 'utf8');
}

export function createSandboxPlan(input: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  ports: SandboxPorts;
  runDir?: string;
  caddyfile: string;
}): SandboxPlan {
  const env = input.env ?? process.env;
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const configuredVkCheckout = env.VK_CHECKOUT?.trim();
  const vkRoot = configuredVkCheckout
    ? resolve(workspaceRoot, configuredVkCheckout)
    : join(vdRoot, 'vibe-kanban');
  const ciReleaseArtifact = ciReleaseArtifactFromEnv(vdRoot, env);
  if (ciReleaseArtifact && env.VK_MOCKED_PREBUILD_BACKEND === '1') {
    throw new Error(
      [
        'VK_MOCKED_PREBUILD_BACKEND is not supported in ci-release mode because it would locally build VK.',
        'Unset VK_MOCKED_PREBUILD_BACKEND or use npm run dev:vk-mocked-sandbox for source mode.',
      ].join(' '),
    );
  }
  const runDir = resolve(
    input.runDir ?? join(vdRoot, '.vk-mocked-sandbox', 'current'),
  );
  const caddyfile = ciReleaseArtifact
    ? caddyfileWithCiReleaseAssetRouting(input.caddyfile)
    : input.caddyfile;
  const vdUrl = `http://localhost:${input.ports.vdCaddy}`;
  const publicOrigin = getConfiguredPublicOrigin(env);
  const browserOrigin = publicOrigin ?? vdUrl;
  const vkFrontendUrl = browserOrigin;

  const commonEnv = {
    VK_MOCKED_SANDBOX: '1',
    VK_MOCKED_SANDBOX_RUN_DIR: runDir,
    VK_MOCKED_VD_URL: browserOrigin,
    VK_MOCKED_VK_FRONTEND_URL: vkFrontendUrl,
    VK_MOCKED_BACKEND_PORT: String(input.ports.vkBackend),
    VK_MOCKED_FRONTEND_PORT: String(input.ports.vkFrontend),
    VK_MOCKED_PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
    VK_MOCKED_VD_DASHBOARD_PORT: String(input.ports.vdDashboard),
    VK_MOCKED_VD_SERVER_PORT: String(input.ports.vdServer),
    VK_MOCKED_CADDY_PORT: String(input.ports.vdCaddy),
    CADDY_PLUGINS_CADDY: join(runDir, 'plugins.caddy'),
    VK_QA_MODE: '1',
    QA_MODE: '1',
  };

  const vkAllowedOrigins = [
    vdUrl,
    ...(publicOrigin ? [publicOrigin] : []),
    `http://localhost:${input.ports.vdDashboard}`,
  ].join(',');

  const canUsePrebuiltLocalWeb =
    Boolean(ciReleaseArtifact) ||
    (env.VK_MOCKED_SKIP_LOCAL_WEB_BUILD === '1' &&
      existsSync(join(vkRoot, 'packages/local-web/dist/index.html')));
  const setupCommands: CommandSpec[] = [];
  if (ciReleaseArtifact) {
    setupCommands.push({
      name: 'vk-download-release-artifact',
      cwd: vdRoot,
      command: 'node',
      args: [
        '--experimental-strip-types',
        'scripts/vk-mocked-sandbox.ts',
        'download-ci-release',
      ],
      env: {
        ...commonEnv,
        VK_MOCKED_VK_BACKEND: CI_RELEASE_BACKEND_MODE,
        VK_MOCKED_RELEASE_HASH: ciReleaseArtifact.contentHash,
        VK_MOCKED_RELEASE_TAG: ciReleaseArtifact.releaseTag,
        VK_MOCKED_RELEASE_CACHE_DIR: ciReleaseArtifact.artifactRoot,
        VK_MOCKED_GH_REPO: env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO,
        VK_MOCKED_GH_ARTIFACT_NAME:
          env.VK_MOCKED_GH_ARTIFACT_NAME ?? DEFAULT_VK_GH_ARTIFACT_NAME,
        VK_MOCKED_GH_ARCHIVE_NAME:
          env.VK_MOCKED_GH_ARCHIVE_NAME ?? DEFAULT_VK_GH_ARCHIVE_NAME,
      },
    });
  } else if (!canUsePrebuiltLocalWeb) {
    setupCommands.push({
      name: 'vk-build-local-web',
      cwd: vkRoot,
      command: 'pnpm',
      args: [
        '--filter',
        '@vibe/local-web',
        'run',
        'build',
        '--base',
        '/vk-static/',
      ],
      env: {
        ...commonEnv,
        BACKEND_PORT: String(input.ports.vkBackend),
        FRONTEND_PORT: String(input.ports.vdCaddy),
        PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
        NODE_OPTIONS: appendNodeOption(env.NODE_OPTIONS, '--max-old-space-size=8192'),
      },
    });
  }
  if (env.VK_MOCKED_PREBUILD_BACKEND === '1') {
    setupCommands.push({
      name: 'vk-build-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['build', '--features', 'qa-mode', '--bin', 'server'],
      env: commonEnv,
    });
  }

  const vkBackendCommand: CommandSpec = ciReleaseArtifact
    ? {
        name: 'vk-backend-ci-release',
        cwd: vkRoot,
        command: ciReleaseArtifact.binaryPath,
        args: [],
        env: {
          ...commonEnv,
          HOST: '127.0.0.1',
          BACKEND_PORT: String(input.ports.vkBackend),
          PORT: String(input.ports.vkBackend),
          FRONTEND_PORT: String(input.ports.vdCaddy),
          PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
          VK_ALLOWED_ORIGINS: vkAllowedOrigins,
          DISABLE_WORKTREE_CLEANUP: '1',
          XDG_CONFIG_HOME: join(runDir, 'xdg-config'),
          XDG_DATA_HOME: join(runDir, 'xdg-data'),
          RUST_LOG: process.env.RUST_LOG ?? 'debug',
        },
      }
    : {
      name: 'vk-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['run', '--features', 'qa-mode', '--bin', 'server'],
      env: {
        ...commonEnv,
        HOST: '127.0.0.1',
        BACKEND_PORT: String(input.ports.vkBackend),
        PORT: String(input.ports.vkBackend),
        FRONTEND_PORT: String(input.ports.vdCaddy),
        PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
        VK_ALLOWED_ORIGINS: vkAllowedOrigins,
        DISABLE_WORKTREE_CLEANUP: '1',
        RUST_LOG: process.env.RUST_LOG ?? 'debug',
      },
    };

  const commands: CommandSpec[] = [
    vkBackendCommand,
    {
      name: 'vd-dashboard',
      cwd: vdRoot,
      command: 'npm',
      args: ['run', 'dev', '--', '--port', String(input.ports.vdDashboard)],
      env: {
        ...commonEnv,
        PORT: String(input.ports.vdServer),
        SERVER_PORT: String(input.ports.vdServer),
        VITE_VK_BASE_ORIGIN: vkFrontendUrl,
        CADDY_PORT: String(input.ports.vdCaddy),
      },
    },
    {
      name: 'caddy',
      cwd: vdRoot,
      command: 'caddy',
      args: ['run', '--config', join(runDir, 'Caddyfile'), '--adapter', 'caddyfile'],
      env: {
        ...commonEnv,
        XDG_CONFIG_HOME: join(runDir, 'xdg-config'),
        XDG_DATA_HOME: join(runDir, 'xdg-data'),
        CADDY_ADMIN: 'off',
        CADDY_PORT: String(input.ports.vdCaddy),
        DASHBOARD_PORT: String(input.ports.vdDashboard),
        BACKEND_PORT: String(input.ports.vkBackend),
        CODE_PORT: String(input.ports.vkPreviewProxy),
        CADDY_ACCESS_LOG: join(runDir, 'access.log'),
        CADDY_PLUGINS_CADDY: commonEnv.CADDY_PLUGINS_CADDY,
      },
    },
  ];

  return {
    ports: input.ports,
    paths: { workspaceRoot, vdRoot, vkRoot, runDir },
    urls: { vd: browserOrigin, vkFrontend: vkFrontendUrl },
    env: commonEnv,
    caddyfile,
    setupCommands,
    commands,
  };
}

function getConfiguredPublicOrigin(env: NodeJS.ProcessEnv): string | null {
  const raw = env.VK_MOCKED_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`VK_MOCKED_PUBLIC_ORIGIN must be a valid absolute URL origin, got ${raw}`);
  }
}

export async function writeSandboxFiles(plan: SandboxPlan): Promise<void> {
  await mkdir(plan.paths.runDir, { recursive: true });
  await writeFile(join(plan.paths.runDir, 'Caddyfile'), plan.caddyfile);
  await writeFile(join(plan.paths.runDir, 'plugins.caddy'), '');
  await writeFile(
    join(plan.paths.runDir, 'env.sh'),
    Object.entries(plan.env)
      .map(([key, value]) => `export ${key}=${JSON.stringify(value)}\n`)
      .join(''),
  );
  await writeFile(join(plan.paths.runDir, 'plan.json'), JSON.stringify(plan, null, 2));
}

function printPlan(plan: SandboxPlan): void {
  console.log(`VD URL: ${plan.urls.vd}`);
  console.log(`VK frontend URL: ${plan.urls.vkFrontend}`);
  console.log(`Run dir: ${plan.paths.runDir}`);
  console.log('\nSetup commands:');
  for (const spec of plan.setupCommands) {
    console.log(`- ${spec.name}: (cd ${spec.cwd} && ${spec.command} ${spec.args.join(' ')})`);
  }
  console.log('\nCommands:');
  for (const spec of plan.commands) {
    console.log(`- ${spec.name}: (cd ${spec.cwd} && ${spec.command} ${spec.args.join(' ')})`);
  }
}

function runCommandToCompletion(spec: CommandSpec): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = `[${spec.name}]`;
    child.stdout?.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
    child.stderr?.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
    child.on('error', (error) => {
      rejectCommand(new Error(`${spec.name} failed to start: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      console.log(`${prefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(`${spec.name} failed with code=${code ?? 'null'} signal=${signal ?? 'null'}`),
      );
    });
  });
}

function spawnCommand(
  spec: CommandSpec,
  onUnexpectedExit: (spec: CommandSpec, reason: string) => void,
): ChildProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const prefix = `[${spec.name}]`;
  let reportedUnexpectedExit = false;
  child.stdout?.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on('error', (error) => {
    if (reportedUnexpectedExit) return;
    reportedUnexpectedExit = true;
    console.error(`${prefix} failed to start: ${error.message}`);
    onUnexpectedExit(spec, `spawn error: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`${prefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (reportedUnexpectedExit) return;
    reportedUnexpectedExit = true;
    onUnexpectedExit(spec, `exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  return child;
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(childProcessSignalTarget(child.pid), signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    child.kill(signal);
  }
}

function isChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<'exited' | 'timeout'> {
  if (isChildExited(child)) return 'exited';
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      once(child, 'exit').then(() => 'exited' as const),
      new Promise<'timeout'>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout('timeout'), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function stopChild(
  child: ChildProcess,
  name: string,
  timeoutMs = CHILD_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const prefix = `[${name}]`;
  if (isChildExited(child)) return;

  signalChild(child, 'SIGTERM');
  if ((await waitForChildExit(child, timeoutMs)) === 'exited') return;

  console.error(`${prefix} did not exit after SIGTERM; sending SIGKILL.`);
  signalChild(child, 'SIGKILL');
  await waitForChildExit(child, timeoutMs);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'prepare';
  if (mode === 'download-ci-release') {
    const workspaceRoot = resolve(process.cwd(), '..');
    const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
    const artifact = await downloadCiReleaseArtifactFromEnv(vdRoot, process.env);
    console.log(`[vk-mocked-sandbox] VK release binary ready: ${artifact.binaryPath}`);
    return;
  }

  const ports = await allocatePorts();
  const workspaceRoot = resolve(process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const caddyfile = await loadSandboxCaddyfile(vdRoot);
  const configuredVkCheckout = process.env.VK_CHECKOUT?.trim();
  const vkRoot = configuredVkCheckout
    ? resolve(workspaceRoot, configuredVkCheckout)
    : join(vdRoot, 'vibe-kanban');
  let env = process.env;
  if (isCiReleaseBackend(process.env)) {
    const artifact = await resolveCiReleaseArtifact(vdRoot, vkRoot, process.env);
    env = {
      ...process.env,
      VK_MOCKED_VK_BACKEND: CI_RELEASE_BACKEND_MODE,
      VK_MOCKED_RELEASE_HASH: artifact.contentHash,
      VK_MOCKED_RELEASE_TAG: artifact.releaseTag,
      VK_MOCKED_RELEASE_CACHE_DIR: artifact.artifactRoot,
    };
  } else if (process.env.VK_MOCKED_VK_BACKEND !== 'source') {
    const artifact = await tryResolveCiReleaseArtifact(vdRoot, vkRoot, process.env);
    if (artifact) {
      env = {
        ...process.env,
        VK_MOCKED_VK_BACKEND: CI_RELEASE_BACKEND_MODE,
        VK_MOCKED_RELEASE_HASH: artifact.contentHash,
        VK_MOCKED_RELEASE_TAG: artifact.releaseTag,
        VK_MOCKED_RELEASE_CACHE_DIR: artifact.artifactRoot,
      };
    }
  }
  const plan = createSandboxPlan({
    workspaceRoot: process.cwd(),
    env,
    ports,
    caddyfile,
  });
  await writeSandboxFiles(plan);

  if (mode === 'prepare') {
    printPlan(plan);
    return;
  }

  if (!existsSync(plan.paths.vkRoot)) {
    throw new Error(`VK repo not found at ${plan.paths.vkRoot}`);
  }

  printPlan(plan);
  if (mode === 'setup') {
    for (const spec of plan.setupCommands) {
      await runCommandToCompletion(spec);
    }
    return;
  }

  if (mode !== 'start') {
    throw new Error(`Unknown mode ${mode}. Usage: vk-mocked-sandbox.ts [prepare|setup|start]`);
  }

  if (process.env.VK_MOCKED_SKIP_SETUP_COMMANDS !== '1') {
    for (const spec of plan.setupCommands) {
      await runCommandToCompletion(spec);
    }
  }
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const children: { spec: CommandSpec; child: ChildProcess }[] = [];
  const pidPath = join(plan.paths.runDir, 'sandbox.pid');
  await writeFile(pidPath, `${process.pid}\n`);
  const stop = (exitCode?: number): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (exitCode !== undefined) process.exitCode = exitCode;
    stopPromise = Promise.all(
      children.map(({ spec, child }) => stopChild(child, spec.name)),
    ).then(async () => {
      await rm(pidPath, { force: true });
    });
    return stopPromise;
  };
  for (const spec of plan.commands) {
    const child = spawnCommand(spec, (exitedSpec, reason) => {
      if (stopping) return;
      console.error(`${exitedSpec.name} exited unexpectedly (${reason}); stopping sandbox.`);
      void stop(1).then(() => process.exit(1));
    });
    children.push({ spec, child });
  }
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(process.exitCode ?? 0));
  });
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(process.exitCode ?? 0));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
