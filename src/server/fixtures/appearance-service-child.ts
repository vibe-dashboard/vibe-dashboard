import { writeFile, access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { AppearanceRevisionService } from "../../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../../theme/skins/defaultAppearanceSnapshot";
import { FileAppearanceRevisionStore } from "../appearance-revision-store.node";

async function main(): Promise<void> {
  const [path, ready, go, actor, mode = "race"] = process.argv.slice(2);
  if (!path || !ready || !go || !actor) throw new Error("missing child fixture arguments");
  const service = await AppearanceRevisionService.open({ store: new FileAppearanceRevisionStore(path), genesisSnapshot: createDefaultAppearanceSnapshot() });
  const head = service.inspect().head!;
  await writeFile(ready, "ready");
  for (;;) { try { await access(go); break; } catch { await delay(5); } }
  const observed = mode === "observe-retry" ? (await service.inspectFresh()).head! : head;
  const snapshot = JSON.parse(observed.snapshot); snapshot.provenance.generator = actor;
  const result = await service.apply({ expectedCurrentRevisionId: observed.revisionId, snapshot: JSON.stringify(snapshot), actor: { id: actor, kind: "cli" }, source: "cli", summary: actor });
  process.stdout.write(JSON.stringify({ result, observedHead: observed.revisionId, head: service.inspect().head?.revisionId }));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
