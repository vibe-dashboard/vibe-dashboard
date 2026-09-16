import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { AppearanceRevisionService } from "../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { acquireAppearanceFileLock, FileAppearanceRevisionStore } from "./appearance-revision-store.node";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("file appearance revision store", () => {
  it("converges the losing service process on the independently committed winner", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-service-child-")); roots.push(root);
    const real = join(root, "real"); await mkdir(real); const alias = join(root, "alias"); await symlink(real, alias, "dir");
    await build({ configFile: false, logLevel: "silent", ssr: { noExternal: true }, build: { ssr: true, outDir: join(root, "bundle"), emptyOutDir: true, lib: { entry: join(process.cwd(), "src/server/fixtures/appearance-service-child.ts"), formats: ["es"], fileName: () => "worker.mjs" } } });
    const go = join(root, "go");
    const run = (path: string, id: string) => new Promise<{ result: { ok: boolean }; head: string }>((resolve, reject) => {
      const ready = join(root, `${id}.ready`); const child = spawn(process.execPath, [join(root, "bundle/appearance-service-child.js"), path, ready, go, id]); let output = ""; let errors = "";
      child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { errors += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`child exited ${code}: ${errors}`)));
    });
    const first = run(join(real, "history.json"), "one"); const second = run(join(alias, "history.json"), "two");
    for (const id of ["one", "two"]) for (;;) { try { await access(join(root, `${id}.ready`)); break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); } }
    await writeFile(go, "go"); const results = await Promise.all([first, second]);
    expect(results.filter(({ result }) => result.ok)).toHaveLength(1); expect(results[0]!.head).toBe(results[1]!.head);
  }, 15_000);
  it("reports actionable lock timeouts and never releases a replacement owner's lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-lock-")); roots.push(root);
    const path = join(root, "history.json");
    const release = await acquireAppearanceFileLock(path);
    await expect(acquireAppearanceFileLock(path, { timeoutMs: 25 })).rejects.toThrow("appearance-history-lock-timeout");
    await rm(`${path}.lock`, { recursive: true }); await mkdir(`${path}.lock`); await writeFile(join(`${path}.lock`, "owner"), `${process.pid}:replacement\n`);
    await release();
    expect(await readFile(join(`${path}.lock`, "owner"), "utf8")).toContain("replacement");
  });
  it("permits exactly one independent process through canonical and alias paths and recovers a dead owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-child-")); roots.push(root);
    const real = join(root, "real"); await mkdir(real);
    const alias = join(root, "alias"); await symlink(real, alias, "dir");
    const path = join(real, "history.json");
    const store = new FileAppearanceRevisionStore(path);
    const initial = { version: 1 as const, headRevisionId: "head", revisions: [{ revisionId: "head", snapshot: "{}", actor: { id: "system", kind: "system" as const }, source: "genesis" as const, committedAt: new Date().toISOString(), summary: "initial" }] };
    expect(await store.compareAndSwap(undefined, initial)).toBe("saved");
    const run = (candidatePath: string, id: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", join(process.cwd(), "src/server/fixtures/appearance-cas-child.mjs"), candidatePath, "head", JSON.stringify({ ...initial, headRevisionId: id })]);
      let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`child exited ${code}`)));
    });
    const results = await Promise.all([run(path, "one"), run(join(alias, "history.json"), "two")]);
    expect(results.sort()).toEqual(["saved", "stale"]);
    await mkdir(`${path}.lock`); await writeFile(join(`${path}.lock`, "owner"), "99999999:crashed\n");
    expect(await store.compareAndSwap((await store.load() as { headRevisionId: string }).headRevisionId, { ...initial, headRevisionId: "restart" })).toBe("saved");
  });
  it("persists atomically across restart and serializes independent clients", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-")); roots.push(root);
    const path = join(root, "history.json");
    const first = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const second = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(join(root, ".", "history.json")), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const head = first.inspect().head!;
    const next = JSON.parse(head.snapshot); next.provenance.generator = "file-store";
    const commands = [first, second].map((service, index) => service.apply({ expectedCurrentRevisionId: head.revisionId, snapshot: JSON.stringify(next), actor: { id: `cli-${index}`, kind: "cli" }, source: "cli", summary: "race" }));
    expect((await Promise.all(commands)).filter((result) => result.ok)).toHaveLength(1);
    expect(first.inspect().head?.revisionId).toBe(second.inspect().head?.revisionId);
    const restarted = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    expect(restarted.inspect().revisions).toHaveLength(2);
    const persisted = await readFile(path, "utf8");
    expect(() => JSON.parse(persisted)).not.toThrow();
  });

  it("recovers the last-known-good aggregate after corrupt primary storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-recovery-")); roots.push(root);
    const path = join(root, "history.json");
    const store = new FileAppearanceRevisionStore(path);
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot() });
    const head = service.inspect().head!;
    const changed = JSON.parse(head.snapshot); changed.provenance.generator = "known-good";
    await service.apply({ expectedCurrentRevisionId: head.revisionId, snapshot: JSON.stringify(changed), actor: { id: "u", kind: "user" }, source: "user", summary: "known good" });
    await writeFile(path, "{corrupt", "utf8");
    await store.recoverLastKnownGood();
    const recovered = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot() });
    expect(recovered.inspect().head?.revisionId).toBe(head.revisionId);
  });
});
