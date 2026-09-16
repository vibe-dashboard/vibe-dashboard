import { copyFile, mkdir, readFile, rename, rm, stat, writeFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AppearanceRevisionState, AppearanceRevisionStore } from "../theme/skins/appearanceRevisions";

const LOCK_STALE_MS = 30_000;

async function canonicalPath(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  return join(await realpath(dirname(path)), basename(path));
}

async function lockOwnerIsAlive(lock: string): Promise<boolean> {
  try {
    const pid = Number.parseInt((await readFile(join(lock, "owner"), "utf8")).trim(), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lock = `${await canonicalPath(path)}.lock`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, "owner"), `${process.pid}\n`, { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS && !await lockOwnerIsAlive(lock)) { await rm(lock, { recursive: true, force: true }); continue; }
      } catch (statError) { if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue; throw statError; }
      if (Date.now() >= deadline) throw new Error("appearance-history-lock-timeout");
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 20)));
    }
  }
  try { return await operation(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

export class FileAppearanceRevisionStore implements AppearanceRevisionStore {
  constructor(private readonly path: string) {}
  async load(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  compareAndSwap(expectedHeadRevisionId: string | undefined, state: AppearanceRevisionState): Promise<"saved" | "stale"> {
    return withFileLock(this.path, async () => {
      const current = await this.load() as { headRevisionId?: unknown } | undefined;
      if (current?.headRevisionId !== expectedHeadRevisionId) return "stale" as const;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
      if (current) await copyFile(this.path, `${this.path}.last-known-good`);
      await rename(temporary, this.path);
      return "saved" as const;
    });
  }
  async recoverLastKnownGood(): Promise<boolean> {
    try {
      await copyFile(`${this.path}.last-known-good`, this.path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
