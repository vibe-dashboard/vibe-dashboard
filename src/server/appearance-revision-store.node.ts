import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppearanceRevisionState, AppearanceRevisionStore } from "../theme/skins/appearanceRevisions";

const queues = new Map<string, Promise<unknown>>();

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
    const previous = queues.get(this.path) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const current = await this.load() as { headRevisionId?: unknown } | undefined;
      if (current?.headRevisionId !== expectedHeadRevisionId) return "stale" as const;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
      if (current) await copyFile(this.path, `${this.path}.last-known-good`);
      await rename(temporary, this.path);
      return "saved" as const;
    });
    queues.set(this.path, operation.then(() => undefined, () => undefined));
    return operation;
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
