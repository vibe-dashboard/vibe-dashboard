import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPreviewResolverRoutes } from "./preview-resolver-routes";

const parts = {
  previewSlotId: "slot1",
  workspaceToken: "0123456789abcdef",
  repoSlug: "vibekanban",
  slotSlug: "web",
};

function setup() {
  const client = {
    resolvePreview: vi.fn(async () => ({
      status: "ready" as const,
      upstream: "http://127.0.0.1:4567",
    })),
    getRunConfigs: vi.fn(async () => ({
      run_configs: [],
      preview_slots: [],
      preview_url_parts: [parts],
    })),
    upsertRunConfig: vi.fn(async () => ({ id: "run1" }) as any),
    upsertPreviewSlot: vi.fn(async () => ({ id: "slot1" }) as any),
    startRunConfig: vi.fn(
      async () => ({ upstream: "http://127.0.0.1:4567" }) as any,
    ),
    startPreviewSlot: vi.fn(
      async () => ({ upstream: "http://127.0.0.1:4567" }) as any,
    ),
  };
  const app = new Hono();
  registerPreviewResolverRoutes(app, { vkClient: client });
  return { app, client };
}

describe("registerPreviewResolverRoutes", () => {
  const originalSiteOrigin = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (originalSiteOrigin === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = originalSiteOrigin;
  });

  it("proxies named preview resolution and rejects invalid tokens", async () => {
    process.env.SITE_ORIGIN = "https://mickmister.jamtools.dev";
    const { app, client } = setup();
    const payload = {
      host: "0123456789abcdef-vibekanban-web-mickmister.jamtools.dev",
      workspaceToken: parts.workspaceToken,
      repoSlug: parts.repoSlug,
      slotSlug: parts.slotSlug,
      ensure: true,
      method: "GET",
      path: "/",
    };
    const send = (body: unknown) =>
      app.request("/internal/preview/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    await expect((await send(payload)).json()).resolves.toMatchObject({
      status: "ready",
      upstream: "http://127.0.0.1:4567",
    });
    expect(client.resolvePreview).toHaveBeenCalledWith(payload);
    await expect(
      (await send({ ...payload, workspaceToken: "invalid" })).json(),
    ).resolves.toMatchObject({ status: "not_found" });
    expect(client.resolvePreview).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "https://jamtools.dev",
      "https://0123456789abcdef-vibekanban-web.jamtools.dev/",
    ],
    [
      "https://mickmister.jamtools.dev",
      "https://0123456789abcdef-vibekanban-web-mickmister.jamtools.dev/",
    ],
    [
      "http://localhost:3001",
      "http://0123456789abcdef-vibekanban-web.localhost:3001/",
    ],
  ])(
    "serves consistent list and individual URLs from %s",
    async (origin, url) => {
      process.env.SITE_ORIGIN = origin;
      const { app } = setup();
      const list = await app.request(
        "/internal/preview/workspaces/ws1/run-configs",
      );
      await expect(list.json()).resolves.toMatchObject({
        preview_urls: { slot1: url },
      });
      const single = await app.request(
        "/internal/preview/workspaces/ws1/preview-slots/slot1/url?baseDomain=override.example",
      );
      expect(single.status).toBe(200);
      await expect(single.json()).resolves.toEqual({
        ...parts,
        host: new URL(url).host,
        url,
      });
    },
  );

  it("reports missing slots and unusable origin configuration", async () => {
    const { app } = setup();
    const missing = await app.request(
      "/internal/preview/workspaces/ws1/preview-slots/missing/url",
    );
    expect(missing.status).toBe(404);
    process.env.SITE_ORIGIN = "not a URL";
    const broken = await app.request(
      "/internal/preview/workspaces/ws1/preview-slots/slot1/url",
    );
    expect(broken.status).toBe(502);
    await expect(broken.json()).resolves.toEqual({
      message:
        "Preview URL could not be generated. Check SITE_ORIGIN and the VK backend.",
    });
  });

  it("forwards configuration writes and explicit start actions", async () => {
    const { app, client } = setup();
    const run = {
      repo_id: "repo1",
      slug: "web",
      command: "npm run dev",
      name: "Web",
      kind: "long_running",
      enabled: true,
    };
    const slot = {
      repo_id: "repo1",
      run_config_id: "run1",
      slot_slug: "web",
      title: "Web",
      enabled: true,
    };
    for (const [path, body] of [
      ["run-configs", run],
      ["preview-slots", slot],
    ] as const) {
      expect(
        (
          await app.request(`/internal/preview/workspaces/ws1/${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(200);
    }
    expect(client.upsertRunConfig).toHaveBeenCalledWith("ws1", run);
    expect(client.upsertPreviewSlot).toHaveBeenCalledWith("ws1", slot);
    for (const path of ["run-configs/run1", "preview-slots/slot1"]) {
      expect(
        (
          await app.request(`/internal/preview/workspaces/ws1/${path}/start`, {
            method: "POST",
          })
        ).status,
      ).toBe(200);
    }
    expect(client.startRunConfig).toHaveBeenCalledWith("ws1", "run1");
    expect(client.startPreviewSlot).toHaveBeenCalledWith("ws1", "slot1");
  });
});
