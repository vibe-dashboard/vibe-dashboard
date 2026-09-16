import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AppearanceRevisionService, MemoryAppearanceRevisionStore } from "../theme/skins/appearanceRevisions";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { compileAppearanceSnapshotCandidate } from "../theme/skins/appearanceCandidate";
import { createAppearanceMutationAuthenticator, createAppearanceReadAuthenticator } from "./appearance-auth.node";
import { registerAppearanceRoutes } from "./appearance-routes";

const browserHeaders = { "Content-Type": "application/json", Origin: "http://localhost", "X-VK-Appearance-CSRF": "1" };
const cliHeaders = { "Content-Type": "application/json", Authorization: "Bearer test-cli-token-0123456789" };

async function fixture() {
  const service = await AppearanceRevisionService.open({
    store: new MemoryAppearanceRevisionStore(),
    genesisSnapshot: createDefaultAppearanceSnapshot(),
  });
  const app = new Hono();
  registerAppearanceRoutes(app, {
    getService: async () => service,
    authenticateMutation: createAppearanceMutationAuthenticator({ browserOrigin: "http://localhost", cliToken: "test-cli-token-0123456789" }),
    authenticateRead: createAppearanceReadAuthenticator({ browserOrigin: "http://localhost", cliToken: "test-cli-token-0123456789" }),
  });
  return { app, service };
}

async function candidateFor(snapshot: string) {
  const candidate = await compileAppearanceSnapshotCandidate(JSON.parse(snapshot));
  if (!candidate.ok) throw new Error("test candidate did not compile");
  return { sourceDigest: candidate.sourceDigest, artifactDigest: candidate.artifact?.digest ?? null };
}

describe("appearance history API", () => {
  it("authenticates and separately authorizes every private read", async () => {
    const { app } = await fixture();
    for (const path of ["/dashboard/api/appearance", "/dashboard/api/appearance/revisions/missing/snapshot", "/dashboard/api/appearance/diff?from=x&to=y"]) {
      expect((await app.request(path)).status).toBe(403);
      expect((await app.request(path, { headers: { ...browserHeaders, Origin: "https://evil.example" } })).status).toBe(403);
      expect((await app.request(path, { headers: { ...cliHeaders, Authorization: "Bearer invalid" } })).status).toBe(403);
    }
    const deniedService = await AppearanceRevisionService.open({ store: new MemoryAppearanceRevisionStore(), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const denied = new Hono();
    registerAppearanceRoutes(denied, {
      getService: async () => deniedService,
      authenticateMutation: createAppearanceMutationAuthenticator({ browserOrigin: "http://localhost", cliToken: "test-cli-token-0123456789" }),
      allowRead: () => false,
    });
    expect((await denied.request("/dashboard/api/appearance", { headers: browserHeaders })).status).toBe(403);
    expect((await app.request("/dashboard/api/appearance", { headers: cliHeaders })).status).toBe(200);
    expect((await app.request("/dashboard/api/appearance", { headers: { "X-VK-Appearance-CSRF": "1", "Sec-Fetch-Site": "same-origin" } })).status).toBe(200);
  });

  it("uses one command service for inspect, snapshot, mutation, diff, and undo", async () => {
    const { app, service } = await fixture();
    const genesis = service.inspect().head!;
    const inspect = await app.request("/dashboard/api/appearance", { headers: browserHeaders });
    expect(inspect.status).toBe(200);
    expect((await inspect.json()).head.revisionId).toBe(genesis.revisionId);

    const changed = JSON.parse(genesis.snapshot);
    changed.provenance.generator = "route-test";
    const apply = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: browserHeaders,
      body: JSON.stringify({ type: "apply", expectedCurrentRevisionId: genesis.revisionId, snapshot: JSON.stringify(changed), candidate: await candidateFor(JSON.stringify(changed)), summary: "Browser mutation" }),
    });
    expect(apply.status).toBe(201);
    const applied = await apply.json();
    expect(applied.revision).toMatchObject({ actor: { id: "local-user", kind: "user" }, source: "user", activation: { compilerVersion: 1, policyVersion: 1, sourceDigest: expect.stringMatching(/^sha256-/) } });
    const diff = await app.request(`/dashboard/api/appearance/diff?from=${genesis.revisionId}&to=${applied.revision.revisionId}`, { headers: browserHeaders });
    expect(diff.status).toBe(200);
    expect((await diff.json()).changes).toContainEqual(expect.objectContaining({ path: "provenance.generator" }));

    const undo = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: browserHeaders,
      body: JSON.stringify({ type: "undo", expectedCurrentRevisionId: applied.revision.revisionId, summary: "Undo" }),
    });
    expect(undo.status).toBe(201);
    expect(service.inspect().head?.snapshot).toBe(genesis.snapshot);
  });

  it("derives CLI identity and source from a host credential rather than route or caller JSON", async () => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    const changed = JSON.parse(head.snapshot); changed.provenance.generator = "cli-route";
    const response = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: cliHeaders,
      body: JSON.stringify({ type: "apply", expectedCurrentRevisionId: head.revisionId, snapshot: JSON.stringify(changed), candidate: await candidateFor(JSON.stringify(changed)), summary: "CLI" }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).revision).toMatchObject({ actor: { id: "local-cli", kind: "cli" }, source: "cli" });
  });

  it("derives import provenance from the authenticated browser operation", async () => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    const changed = JSON.parse(head.snapshot); changed.provenance.generator = "import-route";
    const response = await app.request("/dashboard/api/appearance/commands", { method: "POST", headers: browserHeaders, body: JSON.stringify({ type: "apply", operation: "import", expectedCurrentRevisionId: head.revisionId, snapshot: JSON.stringify(changed), candidate: await candidateFor(JSON.stringify(changed)), summary: "Import" }) });
    expect(response.status).toBe(201);
    expect((await response.json()).revision).toMatchObject({ actor: { id: "local-user", kind: "user" }, source: "import" });
  });

  it.each([
    ["missing browser CSRF", { Origin: "http://localhost", "Content-Type": "application/json" }],
    ["foreign browser origin", { ...browserHeaders, Origin: "https://evil.example" }],
    ["missing CLI credential", { "Content-Type": "application/json" }],
    ["invalid CLI credential", { ...cliHeaders, Authorization: "Bearer wrong" }],
  ])("rejects %s without mutating history", async (_label, headers) => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    const response = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers,
      body: JSON.stringify({ type: "undo", expectedCurrentRevisionId: head.revisionId, summary: "forged" }),
    });
    expect(response.status).toBe(403);
    expect(service.inspect().revisions).toHaveLength(1);
  });

  it("rejects caller-selected actor/source provenance and legacy provenance routes", async () => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    for (const body of [
      { type: "undo", expectedCurrentRevisionId: head.revisionId, summary: "actor", actor: { id: "admin", kind: "system" } },
      { type: "undo", expectedCurrentRevisionId: head.revisionId, summary: "source", source: "agent" },
      { type: "undo", expectedCurrentRevisionId: head.revisionId, summary: "operation", operation: "agent" },
    ]) {
      const response = await app.request("/dashboard/api/appearance/commands", { method: "POST", headers: browserHeaders, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    expect((await app.request("/dashboard/api/appearance/cli-commands", { method: "POST", headers: cliHeaders })).status).toBe(404);
    expect((await app.request("/dashboard/api/appearance/import-commands", { method: "POST", headers: browserHeaders })).status).toBe(404);
    expect(service.inspect().revisions).toHaveLength(1);
  });

  it("rejects malformed, unknown-target, and stale commands atomically", async () => {
    const { app, service } = await fixture();
    const head = service.inspect().head!;
    for (const body of [
      { type: "restore", expectedCurrentRevisionId: head.revisionId, targetRevisionId: "missing", actor: { id: "u", kind: "user" }, summary: "missing" },
      { type: "undo", expectedCurrentRevisionId: "stale", actor: { id: "u", kind: "user" }, summary: "stale" },
      { type: "apply", expectedCurrentRevisionId: head.revisionId, snapshot: head.snapshot, summary: "missing candidate" },
      { type: "apply", expectedCurrentRevisionId: head.revisionId, snapshot: head.snapshot, candidate: { sourceDigest: "sha256-stale", artifactDigest: null }, summary: "stale candidate" },
      { type: "unknown" },
    ]) {
      const response = await app.request("/dashboard/api/appearance/commands", { method: "POST", headers: browserHeaders, body: JSON.stringify(body) });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(service.inspect().revisions).toHaveLength(1);
  });

  it("checks host permissions at command execution and leaves history unchanged", async () => {
    const service = await AppearanceRevisionService.open({ store: new MemoryAppearanceRevisionStore(), genesisSnapshot: createDefaultAppearanceSnapshot() });
    const app = new Hono();
    registerAppearanceRoutes(app, {
      getService: async () => service,
      authenticateMutation: createAppearanceMutationAuthenticator({ browserOrigin: "http://localhost", cliToken: "test-cli-token-0123456789" }),
      allowMutation: () => false,
    });
    const head = service.inspect().head!;
    const response = await app.request("/dashboard/api/appearance/commands", { method: "POST", headers: browserHeaders, body: JSON.stringify({ type: "undo", expectedCurrentRevisionId: head.revisionId, summary: "no" }) });
    expect(response.status).toBe(403);
    expect(service.inspect().revisions).toHaveLength(1);
  });

  it("does not publish activation metadata when the atomic history write fails", async () => {
    const store = new MemoryAppearanceRevisionStore();
    const service = await AppearanceRevisionService.open({ store, genesisSnapshot: createDefaultAppearanceSnapshot() });
    const app = new Hono();
    registerAppearanceRoutes(app, {
      getService: async () => service,
      authenticateMutation: createAppearanceMutationAuthenticator({ browserOrigin: "http://localhost", cliToken: "test-cli-token-0123456789" }),
    });
    const before = service.inspect().head!;
    const changed = JSON.parse(before.snapshot); changed.provenance.generator = "failed-activation";
    const serialized = JSON.stringify(changed); store.failNextWrite();
    const response = await app.request("/dashboard/api/appearance/commands", {
      method: "POST", headers: browserHeaders,
      body: JSON.stringify({ type: "apply", expectedCurrentRevisionId: before.revisionId, snapshot: serialized, candidate: await candidateFor(serialized), summary: "must remain atomic" }),
    });
    expect(response.status).toBe(503);
    expect(service.inspect().head).toEqual(before);
    expect(service.inspect().revisions).toHaveLength(1);
  });
});
