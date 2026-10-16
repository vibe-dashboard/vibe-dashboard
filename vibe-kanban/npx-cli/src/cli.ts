import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { cac } from "cac";
import {
  ensureBinary,
  ensureDesktopBundle,
  BINARY_TAG,
  CACHE_DIR,
  DESKTOP_CACHE_DIR,
  LOCAL_DEV_MODE,
  LOCAL_DIST_DIR,
  R2_BASE_URL,
  getLatestVersion,
} from "./download";
import {
  getTauriPlatform,
  installAndLaunch,
  cleanOldDesktopVersions,
} from "./desktop";

const CLI_VERSION: string = require("../package.json").version;

type RootOptions = {
  desktop?: boolean;
};

type PreviewUrlOptions = {
  api?: string;
  workspace?: string;
  repo?: string;
  runConfig?: string;
  slot?: string;
  customer?: string;
  baseDomain?: string;
  slug?: string;
  name?: string;
  command?: string;
  kind?: string;
  title?: string;
};

// Resolve effective arch for our published 64-bit binaries only.
// Any ARM → arm64; anything else → x64. On macOS, handle Rosetta.
function getEffectiveArch(): "arm64" | "x64" {
  const platform = process.platform;
  const nodeArch = process.arch;

  if (platform === "darwin") {
    // If Node itself is arm64, we're natively on Apple silicon
    if (nodeArch === "arm64") return "arm64";

    // Otherwise check for Rosetta translation
    try {
      const translated = execSync("sysctl -in sysctl.proc_translated", {
        encoding: "utf8",
      }).trim();
      if (translated === "1") return "arm64";
    } catch {
      // sysctl key not present → assume true Intel
    }
    return "x64";
  }

  // Non-macOS: coerce to broad families we support
  if (/arm/i.test(nodeArch)) return "arm64";

  // On Windows with 32-bit Node (ia32), detect OS arch via env
  if (platform === "win32") {
    const pa = process.env.PROCESSOR_ARCHITECTURE || "";
    const paw = process.env.PROCESSOR_ARCHITEW6432 || "";
    if (/arm/i.test(pa) || /arm/i.test(paw)) return "arm64";
  }

  return "x64";
}

const platform = process.platform;
const arch = getEffectiveArch();

// Map to our build target names
function getPlatformDir(): string {
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "win32" && arch === "arm64") return "windows-arm64";
  if (platform === "darwin" && arch === "x64") return "macos-x64";
  if (platform === "darwin" && arch === "arm64") return "macos-arm64";

  console.error(`Unsupported platform: ${platform}-${arch}`);
  console.error("Supported platforms:");
  console.error("  - Linux x64");
  console.error("  - Linux ARM64");
  console.error("  - Windows x64");
  console.error("  - Windows ARM64");
  console.error("  - macOS x64 (Intel)");
  console.error("  - macOS ARM64 (Apple Silicon)");
  process.exit(1);
}

function getBinaryName(base: string): string {
  return platform === "win32" ? `${base}.exe` : base;
}

const platformDir = getPlatformDir();
// In local dev mode, extract directly to dist directory; otherwise use global cache
const versionCacheDir = LOCAL_DEV_MODE
  ? path.join(LOCAL_DIST_DIR, platformDir)
  : path.join(CACHE_DIR, BINARY_TAG, platformDir);

// Remove old version directories from the binary cache
function cleanOldVersions(): void {
  try {
    const entries = fs.readdirSync(CACHE_DIR, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== BINARY_TAG) {
        const oldDir = path.join(CACHE_DIR, entry.name);
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }
  } catch {
    // Ignore cleanup errors — not critical
  }
}

function showProgress(downloaded: number, total: number): void {
  const percent = total ? Math.round((downloaded / total) * 100) : 0;
  const mb = (downloaded / (1024 * 1024)).toFixed(1);
  const totalMb = total ? (total / (1024 * 1024)).toFixed(1) : "?";
  process.stderr.write(
    `\r   Downloading: ${mb}MB / ${totalMb}MB (${percent}%)`,
  );
}

function buildMcpArgs(args: string[]): string[] {
  return args.length > 0 ? args : ["--mode", "global"];
}

async function extractAndRun(
  baseName: string,
  launch: (binPath: string) => void,
): Promise<void> {
  const binName = getBinaryName(baseName);
  const binPath = path.join(versionCacheDir, binName);
  const zipPath = path.join(versionCacheDir, `${baseName}.zip`);

  // Clean old binary if exists
  try {
    if (fs.existsSync(binPath)) {
      fs.unlinkSync(binPath);
    }
  } catch (err: unknown) {
    if (process.env.VIBE_KANBAN_DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Could not delete existing binary: ${msg}`);
    }
  }

  // Download if not cached
  if (!fs.existsSync(zipPath)) {
    console.error(`Downloading ${baseName}...`);
    try {
      await ensureBinary(platformDir, baseName, showProgress);
      console.error(""); // newline after progress
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nDownload failed: ${msg}`);
      process.exit(1);
    }
  }

  // Extract
  if (!fs.existsSync(binPath)) {
    try {
      const { default: AdmZip } = await import("adm-zip");
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(versionCacheDir, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Extraction failed:", msg);
      try {
        fs.unlinkSync(zipPath);
      } catch {}
      process.exit(1);
    }
  }

  if (!fs.existsSync(binPath)) {
    console.error(`Extracted binary not found at: ${binPath}`);
    console.error(
      "This usually indicates a corrupt download. Please try again.",
    );
    process.exit(1);
  }

  // Clean up old cached versions only after current version is fully ready
  if (!LOCAL_DEV_MODE) {
    cleanOldVersions();
  }

  // Set permissions (non-Windows)
  if (platform !== "win32") {
    try {
      fs.chmodSync(binPath, 0o755);
    } catch {}
  }

  return launch(binPath);
}

function checkForUpdates(): void {
  const hasValidR2Url = !R2_BASE_URL.startsWith("__");
  if (LOCAL_DEV_MODE || !hasValidR2Url) {
    return;
  }

  getLatestVersion()
    .then((latest) => {
      if (latest && latest !== CLI_VERSION) {
        setTimeout(() => {
          console.log(`\nUpdate available: ${CLI_VERSION} -> ${latest}`);
          console.log(`Run: npx vibe-kanban@latest`);
        }, 2000);
      }
    })
    .catch(() => {});
}

async function runMcp(args: string[]): Promise<void> {
  await extractAndRun("vibe-kanban-mcp", (bin) => {
    const proc = spawn(bin, buildMcpArgs(args), {
      stdio: "inherit",
    });
    proc.on("exit", (c) => process.exit(c || 0));
    proc.on("error", (e) => {
      console.error("MCP server error:", e.message);
      process.exit(1);
    });
    process.on("SIGINT", () => {
      proc.kill("SIGINT");
    });
    process.on("SIGTERM", () => proc.kill("SIGTERM"));
  });
}

async function runReview(args: string[]): Promise<void> {
  await extractAndRun("vibe-kanban-review", (bin) => {
    const proc = spawn(bin, args, { stdio: "inherit" });
    proc.on("exit", (c) => process.exit(c || 0));
    proc.on("error", (e) => {
      console.error("Review CLI error:", e.message);
      process.exit(1);
    });
  });
}

function previewApiBaseUrl(options: PreviewUrlOptions): string {
  const configured = options.api || process.env.VIBE_API_URL || process.env.VK_API_URL || "http://localhost:3007";
  const withoutTrailingSlash = configured.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api") ? withoutTrailingSlash : `${withoutTrailingSlash}/api`;
}

function requirePreviewOption(options: PreviewUrlOptions, key: keyof PreviewUrlOptions): string {
  const value = options[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  console.error(`Missing required option: --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
  process.exit(1);
}

async function previewApiRequest<T>(
  options: PreviewUrlOptions,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${previewApiBaseUrl(options)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`VK API ${path} failed: HTTP ${response.status} ${response.statusText}\n${bodyText}`);
  }
  const envelope = JSON.parse(bodyText) as { success: boolean; data: T; message?: string | null };
  if (!envelope.success) {
    throw new Error(envelope.message || `VK API ${path} returned an unsuccessful response`);
  }
  return envelope.data;
}

async function runPreviewUrlCommand(action: string, options: PreviewUrlOptions): Promise<void> {
  const workspaceId = requirePreviewOption(options, "workspace");
  if (action === "list") {
    const data = await previewApiRequest(options, `/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (action === "upsert-run-config") {
    const repoId = requirePreviewOption(options, "repo");
    const slug = requirePreviewOption(options, "slug");
    const name = options.name || slug;
    const command = requirePreviewOption(options, "command");
    const kind = options.kind || "long_running";
    const data = await previewApiRequest(options, `/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs`, {
      method: "POST",
      body: JSON.stringify({
        repo_id: repoId,
        slug,
        name,
        command,
        kind,
        enabled: true,
      }),
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (action === "upsert-slot") {
    const repoId = requirePreviewOption(options, "repo");
    const runConfigId = requirePreviewOption(options, "runConfig");
    const slotSlug = requirePreviewOption(options, "slot");
    const title = options.title || slotSlug;
    const data = await previewApiRequest(options, `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots`, {
      method: "POST",
      body: JSON.stringify({
        repo_id: repoId,
        run_config_id: runConfigId,
        slot_slug: slotSlug,
        title,
        enabled: true,
      }),
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (action === "url") {
    const slotId = requirePreviewOption(options, "slot");
    const customerSlug = requirePreviewOption(options, "customer");
    const params = new URLSearchParams({ customerSlug });
    if (options.baseDomain) params.set("baseDomain", options.baseDomain);
    const data = await previewApiRequest<{ url: string }>(
      options,
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(slotId)}/url?${params}`,
    );
    console.log(data.url);
    return;
  }

  if (action === "start-run-config") {
    const runConfigId = requirePreviewOption(options, "runConfig");
    const data = await previewApiRequest(
      options,
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/run-configs/${encodeURIComponent(runConfigId)}/start`,
      { method: "POST", body: "{}" },
    );
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (action === "start-slot") {
    const slotId = requirePreviewOption(options, "slot");
    const data = await previewApiRequest(
      options,
      `/workspaces/${encodeURIComponent(workspaceId)}/execution/preview-slots/${encodeURIComponent(slotId)}/start`,
      { method: "POST", body: "{}" },
    );
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.error(`Unknown preview-url action: ${action}`);
  console.error("Actions: list, upsert-run-config, upsert-slot, url, start-run-config, start-slot");
  process.exit(1);
}

async function runMain(desktopMode: boolean): Promise<void> {
  checkForUpdates();

  const modeLabel = LOCAL_DEV_MODE ? " (local dev)" : "";
  const tauriPlatform = getTauriPlatform(platformDir);

  // Default: browser mode (headless server + opens browser).
  // Use --desktop to launch the desktop app instead.
  if (desktopMode && tauriPlatform) {
    try {
      console.log(
        `Starting vibe-kanban desktop v${CLI_VERSION}${modeLabel}...`,
      );
      const bundleInfo = await ensureDesktopBundle(tauriPlatform, showProgress);
      console.error(""); // newline after progress

      // Clean old desktop versions after successful download
      if (!LOCAL_DEV_MODE) {
        cleanOldDesktopVersions(DESKTOP_CACHE_DIR, BINARY_TAG);
      }

      const exitCode = await installAndLaunch(bundleInfo, platform);
      process.exit(exitCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Desktop app not available: ${msg}`);
      console.error("Falling back to browser mode...");
    }
  }

  // Browser mode (default — headless server + opens browser)
  console.log(`Starting vibe-kanban v${CLI_VERSION}${modeLabel}...`);
  await extractAndRun("vibe-kanban", (bin) => {
    execSync(`"${bin}"`, { stdio: "inherit" });
  });
}

function normalizeArgv(argv: string[]): string[] {
  const args = argv.slice(2);
  const mcpFlagIndex = args.indexOf("--mcp");
  if (mcpFlagIndex === -1) {
    return argv;
  }

  const normalizedArgs = [
    ...args.slice(0, mcpFlagIndex),
    "mcp",
    ...args.slice(mcpFlagIndex + 1),
  ];

  return [...argv.slice(0, 2), ...normalizedArgs];
}

function runOrExit(task: Promise<void>): void {
  void task.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Fatal error:", msg);
    if (process.env.VIBE_KANBAN_DEBUG && err instanceof Error) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(versionCacheDir, { recursive: true });
  const cli = cac("vibe-kanban");

  cli
    .command("[...args]", "Launch the local vibe-kanban app")
    .option("--desktop", "Launch the desktop app instead of browser mode")
    .allowUnknownOptions()
    .action((_args: string[], options: RootOptions) => {
      runOrExit(runMain(Boolean(options.desktop)));
    });

  cli
    .command("review [...args]", "Run the review CLI")
    .allowUnknownOptions()
    .action((args: string[]) => {
      runOrExit(runReview(args));
    });

  cli
    .command("mcp [...args]", "Run the MCP server")
    .allowUnknownOptions()
    .action((args: string[]) => {
      runOrExit(runMcp(args));
    });

  cli
    .command("preview-url <action>", "Manage stored Preview URL run configs and slots via the local VK API")
    .option("--api <url>", "VK API base URL (default: VIBE_API_URL, VK_API_URL, or http://localhost:3007/api)")
    .option("--workspace <id>", "Workspace ID")
    .option("--repo <id>", "Repository ID for upsert actions")
    .option("--run-config <id>", "Run config ID")
    .option("--slot <idOrSlug>", "Preview slot ID for url/start-slot, or slot slug for upsert-slot")
    .option("--customer <slug>", "Customer slug for canonical URL generation")
    .option("--base-domain <domain>", "Preview base domain for URL generation")
    .option("--slug <slug>", "Run config slug")
    .option("--name <name>", "Run config display name")
    .option("--command <command>", "Stored shell command")
    .option("--kind <kind>", "Run config kind: long_running, one_shot, or test")
    .option("--title <title>", "Preview slot display title")
    .action((action: string, options: PreviewUrlOptions) => {
      runOrExit(runPreviewUrlCommand(action, options));
    });

  cli.help();
  cli.version(CLI_VERSION);
  cli.parse(normalizeArgv(process.argv));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Fatal error:", msg);
  if (process.env.VIBE_KANBAN_DEBUG && err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
});
