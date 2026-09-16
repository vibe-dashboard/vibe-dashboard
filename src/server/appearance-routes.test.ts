import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AppearanceRevisionService, MemoryAppearanceRevisionStore } from "../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { registerAppearanceRoutes } from "./appearance-routes";

async function fixture() {
  const service = await AppearanceRevisionService.open({
    store: new MemoryAppearanceRevisionStore(),
    genesisSnapshot: createDefaultAppearanceSnapshot(),
  });
  const app = new Hono();
  registerAppearanceRoutes(app, { getService: async () => service });
  return { app, service };
}

describe("appearance history API", () => {
  it("uses one command service for inspect, snapshot, mutation, diff, and undo", async () => {
    const { app, service } = await fixture();
    const genesis = service.inspect().head!;
    const inspect = await app.request("/dashboard/api/appearance");
    expect(inspect.status).toBe(200);
    expect((await inspect.json()).head.revisionId).toBe(genesis.revisionId);

    const changed = JSON.parse(genesis.snapshot);
    changed.provenance.generator = "route-test";
    const apply = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "apply", expectedCurrentRevisionId: genesis.revisionId, snapshot: JSON.stringify(changed), actor: { id: "cli-test", kind: "cli" }, source: "cli", summary: "CLI mutation" }),
    });
    expect(apply.status).toBe(201);
    const applied = await apply.json();
    const diff = await app.request(`/dashboard/api/appearance/diff?from=${genesis.revisionId}&to=${applied.revision.revisionId}`);
    expect(diff.status).toBe(200);
    expect((await diff.json()).changes).toContainEqual(expect.objectContaining({ path: "provenance.generator" }));

    const undo = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "undo", expectedCurrentRevisionId: applied.revision.revisionId, actor: { id: "user-test", kind: "user" }, summary: "Undo" }),
    });
    expect(undo.status).toBe(201);
    expect(service.inspect().head?.snapshot).toBe(genesis.snapshot);
  });

  it("rejects malformed, unauthorized, unknown-target, and stale commands atomically", async () => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    for (const body of [
      { type: "apply", expectedCurrentRevisionId: head.revisionId, snapshot: head.snapshot, actor: { id: "remote", kind: "marketplace" }, source: "user", summary: "spoof" },
      { type: "restore", expectedCurrentRevisionId: head.revisionId, targetRevisionId: "missing", actor: { id: "u", kind: "user" }, summary: "missing" },
      { type: "undo", expectedCurrentRevisionId: "stale", actor: { id: "u", kind: "user" }, summary: "stale" },
      { type: "unknown" },
    ]) {
      const response = await app.request("/dashboard/api/appearance/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(service.inspect().revisions).toHaveLength(1);
  });
});
