import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceRevisionService } from "../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { FileAppearanceRevisionStore } from "./appearance-revision-store.node";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("file appearance revision store", () => {
  it("persists atomically across restart and serializes independent clients", async () => {
    const root = await mkdtemp(join(tmpdir(), "myne-appearance-")); roots.push(root);
    const path = join(root, "history.json");
    const first = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const second = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const head = first.inspect().head!;
    const next = JSON.parse(head.snapshot); next.provenance.generator = "file-store";
    const commands = [first, second].map((service, index) => service.apply({ expectedCurrentRevisionId: head.revisionId, snapshot: JSON.stringify(next), actor: { id: `cli-${index}`, kind: "cli" }, source: "cli", summary: "race" }));
    expect((await Promise.all(commands)).filter((result) => result.ok)).toHaveLength(1);
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
