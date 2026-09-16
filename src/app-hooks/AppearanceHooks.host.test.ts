// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { createProductionAppearanceModule } from "./AppearanceHooks.host";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("production appearance AppHooks", () => {
  it("keeps module and hook identities stable while loading the persisted projection", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn(async () => response({ head: { revisionId: "rev-1", snapshot: canonical }, revisions: [] }));
    const host = createProductionAppearanceModule({ fetcher });
    const firstHook = host.module.useSkinEditor;
    const rendered = renderHook(() => host.module.useSkinEditor());
    expect(rendered.result.current).toMatchObject({ available: true, value: { loading: true } });
    await waitFor(() => expect(rendered.result.current.available && rendered.result.current.value.loading).toBe(false));
    expect(host.module.useSkinEditor).toBe(firstHook);
    expect(rendered.result.current).toMatchObject({ available: true, value: { headRevisionId: "rev-1", snapshot: { schemaVersion: 1 } } });
    expect(host.getProjection()).toMatchObject({ activeGlobalSkinId: "myne-default-dark", safeMode: false });
  });

  it("saves through expected-head history and replaces state only after success", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-1", snapshot: canonical }, revisions: [] }))
      .mockResolvedValueOnce(response({ ok: true, revision: { revisionId: "rev-2", snapshot: canonical } }, 201))
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-2", snapshot: canonical }, revisions: [] }));
    const host = createProductionAppearanceModule({ fetcher });
    const rendered = renderHook(() => host.module.useSkinEditor());
    await waitFor(() => expect(rendered.result.current.available && rendered.result.current.value.loading).toBe(false));
    await act(async () => {
      expect(await host.module.saveAppearance({ snapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin } })).toEqual({ ok: true });
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ type: "apply", expectedCurrentRevisionId: "rev-1" });
    expect(rendered.result.current).toMatchObject({ available: true, value: { headRevisionId: "rev-2" } });
  });

  it("enters safe mode with last-known-good state on stale, persistence, and corrupt responses", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-1", snapshot: canonical }, revisions: [] }))
      .mockResolvedValueOnce(response({ ok: false, diagnostic: { code: "stale-revision", message: "refresh" } }, 409))
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-1", snapshot: "corrupt" }, revisions: [] }));
    const host = createProductionAppearanceModule({ fetcher });
    const rendered = renderHook(() => host.module.useSkinEditor());
    await waitFor(() => expect(rendered.result.current.available && rendered.result.current.value.loading).toBe(false));
    const before = rendered.result.current;
    await act(async () => {
      const result = await host.module.saveAppearance({ snapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin } });
      expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "stale-revision" }] });
      await host.reload();
    });
    expect(rendered.result.current).toMatchObject({ available: true, value: { safeMode: true, error: expect.stringContaining("invalid") } });
    expect(rendered.result.current.available && rendered.result.current.value.snapshot).toEqual(before.available && before.value.snapshot);
  });

  it("isolates independent production hosts", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const make = (id: string) => createProductionAppearanceModule({ fetcher: async () => response({ head: { revisionId: id, snapshot: canonical }, revisions: [] }) });
    const first = make("one"); const second = make("two");
    const one = renderHook(() => first.module.useSkinEditor());
    const two = renderHook(() => second.module.useSkinEditor());
    await waitFor(() => expect(one.result.current.available && one.result.current.value.headRevisionId).toBe("one"));
    await waitFor(() => expect(two.result.current.available && two.result.current.value.headRevisionId).toBe("two"));
  });

  it("rejects unsafe custom CSS before history persistence", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn(async () => response({ head: { revisionId: "rev-1", snapshot: canonical }, revisions: [] }));
    const host = createProductionAppearanceModule({ fetcher });
    const rendered = renderHook(() => host.module.useSkinEditor());
    await waitFor(() => expect(rendered.result.current.available && rendered.result.current.value.loading).toBe(false));
    const base = JSON.parse(canonical).skin;
    const custom = { ...JSON.parse(JSON.stringify(base)), activeGlobalSkinId: "myne-user-unsafe", userSkins: [{ ...JSON.parse(JSON.stringify((await import("../theme/skins/builtin")).defaultDarkSkin)), id: "myne-user-unsafe", name: "Unsafe", rawCss: [{ id: "myne.attack", css: "body { background: url(javascript:alert(1)) }" }] }] };
    const result = await host.module.saveAppearance({ snapshot: { schemaVersion: 1, value: custom } });
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ severity: "error" })]) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("routes imports through host-owned import provenance", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-1", snapshot: canonical }, revisions: [] }))
      .mockResolvedValueOnce(response({ ok: true, revision: { revisionId: "rev-2" } }, 201))
      .mockResolvedValueOnce(response({ head: { revisionId: "rev-2", snapshot: canonical }, revisions: [] }));
    const host = createProductionAppearanceModule({ fetcher });
    const rendered = renderHook(() => host.module.useSkinEditor());
    await waitFor(() => expect(rendered.result.current.available && rendered.result.current.value.loading).toBe(false));
    await host.module.saveAppearance({ snapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin }, source: "import" });
    expect(fetcher.mock.calls[1]?.[0]).toBe("/dashboard/api/appearance/import-commands");
  });
});
