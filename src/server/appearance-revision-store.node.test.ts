import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { AppearanceRevisionService } from "../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { canonicalizeAppearanceSnapshot } from "../theme/skins/appearanceSnapshot";
import { compileAppearanceSnapshotCandidate } from "../theme/skins/appearanceCandidate";
import { defaultDarkSkin } from "../theme/skins/builtin";
import { acquireAppearanceFileLock, FileAppearanceRevisionStore } from "./appearance-revision-store.node";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("file appearance revision store", () => {
  it("recovers and migrates a same-format legacy custom-CSS last-known-good backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-legacy-recovery-")); roots.push(root);
    const path = join(root, "history.json");
    const value = JSON.parse(createDefaultAppearanceSnapshot());
    value.skin = { version: 1, activeGlobalSkinId: "myne-user-legacy", userSkins: [{ ...defaultDarkSkin, id: "myne-user-legacy", name: "Legacy", rawCss: [{ id: "legacy.css", css: ".myne-card{color:#fff}" }] }] };
    const snapshot = canonicalizeAppearanceSnapshot(value);
    const hash = async (input: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const snapshotDigest = await hash(snapshot);
    const fields = { integrityVersion: 1, sequence: 0, parentRevisionId: null, targetRevisionId: null, snapshotDigest, actor: { id: "system", kind: "system" }, source: "genesis", committedAt: "2026-09-15T00:00:00Z", summary: "Initial appearance" };
    const revisionId = `myne-rev-v1-${await hash(JSON.stringify(fields))}`;
    const legacy = { version: 1, headRevisionId: revisionId, revisions: [{ revisionId, snapshot, actor: fields.actor, source: fields.source, committedAt: fields.committedAt, summary: fields.summary, integrityVersion: 1, sequence: 0, snapshotDigest }] };
    await writeFile(`${path}.last-known-good`, JSON.stringify(legacy));
    await writeFile(path, "{corrupt");
    const store = new FileAppearanceRevisionStore(path);
    expect(await store.recoverLastKnownGood()).toBe(true);
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot(), compileActivation: async (candidateSnapshot) => {
      const candidate = await compileAppearanceSnapshotCandidate(candidateSnapshot);
      return candidate.ok ? { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null, compilerVersion: 1, policyVersion: 1 } : undefined;
    } });
    expect(service.inspect().head?.activation.artifactDigest).toMatch(/^sha256-/);
    expect((await readdir(root)).some((name) => name.startsWith("history.json.corrupt."))).toBe(true);
  });
  it("converges the losing service process on the independently committed winner", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-service-child-")); roots.push(root);
    const real = join(root, "real"); await mkdir(real); const alias = join(root, "alias"); await symlink(real, alias, "dir");
    await build({ configFile: false, logLevel: "silent", ssr: { noExternal: true }, build: { ssr: true, outDir: join(root, "bundle"), emptyOutDir: true, lib: { entry: join(process.cwd(), "src/server/fixtures/appearance-service-child.ts"), formats: ["es"], fileName: () => "worker.mjs" } } });
    const go = join(root, "go");
    const run = (path: string, id: string, ready = join(root, `${id}.ready`), gate = go, mode = "race") => new Promise<{ result: { ok: boolean }; observedHead: string; head: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "bundle/appearance-service-child.js"), path, ready, gate, id, mode]); let output = ""; let errors = "";
      child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { errors += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`child exited ${code}: ${errors}`)));
    });
    const first = run(join(real, "history.json"), "one"); const second = run(join(alias, "history.json"), "two");
    for (const id of ["one", "two"]) for (;;) { try { await access(join(root, `${id}.ready`)); break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); } }
    await writeFile(go, "go"); const results = await Promise.all([first, second]);
    expect(results.filter(({ result }) => result.ok)).toHaveLength(1); expect(results[0]!.head).toBe(results[1]!.head);

    const observerReady = join(root, "observer.ready"); const observerGo = join(root, "observer.go");
    const observer = run(join(alias, "history.json"), "observer", observerReady, observerGo, "observe-retry");
    for (;;) { try { await access(observerReady); break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); } }
    const external = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(join(real, "history.json")), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const externalHead = external.inspect().head!; const changed = JSON.parse(externalHead.snapshot); changed.provenance.generator = "delayed-winner";
    const committed = await external.apply({ expectedCurrentRevisionId: externalHead.revisionId, snapshot: JSON.stringify(changed), actor: { id: "delayed", kind: "cli" }, source: "cli", summary: "delayed" });
    expect(committed.ok).toBe(true); await writeFile(observerGo, "go");
    const observed = await observer;
    expect(observed.observedHead).toBe(committed.ok ? committed.revision.revisionId : "");
    expect(observed.result.ok).toBe(true);
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
    expect(await store.compareAndSwap(undefined, initial as unknown as import("../theme/skins/appearanceRevisions").AppearanceRevisionState)).toBe("saved");
    const run = (candidatePath: string, id: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", join(process.cwd(), "src/server/fixtures/appearance-cas-child.mjs"), candidatePath, "head", JSON.stringify({ ...initial, headRevisionId: id })]);
      let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`child exited ${code}`)));
    });
    const results = await Promise.all([run(path, "one"), run(join(alias, "history.json"), "two")]);
    expect(results.sort()).toEqual(["saved", "stale"]);
    await mkdir(`${path}.lock`); await writeFile(join(`${path}.lock`, "owner"), "99999999:crashed\n");
    expect(await store.compareAndSwap((await store.load() as { headRevisionId: string }).headRevisionId, { ...initial, headRevisionId: "restart" } as unknown as import("../theme/skins/appearanceRevisions").AppearanceRevisionState)).toBe("saved");
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

  it("refreshes long-lived readers before reads and lets a stale service retry from the winning head", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-refresh-")); roots.push(root);
    const path = join(root, "history.json");
    const first = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const stale = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const genesis = first.inspect().head!;
    const changed = JSON.parse(genesis.snapshot); changed.provenance.generator = "external-winner";
    const won = await first.apply({ expectedCurrentRevisionId: genesis.revisionId, snapshot: JSON.stringify(changed), actor: { id: "one", kind: "cli" }, source: "cli", summary: "winner" });
    expect(won.ok).toBe(true);
    const refreshed = await stale.inspectFresh();
    expect(refreshed.head?.revisionId).toBe(first.inspect().head?.revisionId);
    const retrySnapshot = JSON.parse(refreshed.head!.snapshot); retrySnapshot.provenance.generator = "retry";
    const retried = await stale.apply({ expectedCurrentRevisionId: refreshed.head!.revisionId, snapshot: JSON.stringify(retrySnapshot), actor: { id: "two", kind: "cli" }, source: "cli", summary: "retry" });
    expect(retried.ok).toBe(true);
    expect((await first.inspectFresh()).head?.revisionId).toBe(stale.inspect().head?.revisionId);
  });

  it("allows exactly one concurrent reclaimer to replace a dead-owner lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-reclaim-")); roots.push(root);
    const path = join(root, "history.json");
    const store = new FileAppearanceRevisionStore(path);
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot() });
    const head = service.inspect().head!;
    await mkdir(`${path}.lock`); await writeFile(join(`${path}.lock`, "owner"), "99999999:dead\n");
    // Both reclaimers contend through the same atomic rename protocol. The
    // payload is deliberately minimal because CAS winner selection is the
    // behavior under test, not aggregate validation in the raw store.
    const current = await store.load() as Record<string, unknown>;
    const workers = ["reclaimer-one", "reclaimer-two"].map((id) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", join(process.cwd(), "src/server/fixtures/appearance-cas-child.mjs"), path, head.revisionId, JSON.stringify({ ...current, headRevisionId: id })]);
      let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`reclaimer exited ${code}`)));
    }));
    expect((await Promise.all(workers)).sort()).toEqual(["saved", "stale"]);
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
    expect((await readdir(root)).some((name) => name.startsWith("history.json.corrupt."))).toBe(true);
    const recovered = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot() });
    expect(recovered.inspect().head?.revisionId).toBe(head.revisionId);
  });
});
