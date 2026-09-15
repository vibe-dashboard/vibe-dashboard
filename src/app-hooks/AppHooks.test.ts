import { describe, expect, it, vi } from "vitest";
import {
  APP_HOOKS_V1_REQUIREMENTS,
  assertAppHooksV1Compatible,
  createAppHooksV1,
  createFakeAppHooksV1Host,
  unavailableAppearanceHooksV1,
  unavailableSpacesHooksV1,
} from "./AppHooks";

describe("AppHooksV1", () => {
  it("exposes a runtime-immutable typed registry with stable identities", () => {
    const host = createFakeAppHooksV1Host();
    const { appHooks } = host;
    expect(appHooks.modules.ids()).toEqual(["myne.spaces", "myne.appearance"]);
    expect(appHooks.modules.has("myne.spaces")).toBe(true);
    expect(appHooks.modules.get("myne.spaces")).toBe(appHooks.modules.get("myne.spaces"));
    expect(Object.isFrozen(appHooks)).toBe(true);
    expect(Object.isFrozen(appHooks.modules)).toBe(true);
    expect("set" in appHooks.modules).toBe(false);
    expect("delete" in appHooks.modules).toBe(false);
  });

  it("accepts independently versioned required modules", () => {
    const { appHooks } = createFakeAppHooksV1Host();
    expect(() => assertAppHooksV1Compatible(appHooks, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).not.toThrow();
    expect(() => assertAppHooksV1Compatible(appHooks, APP_HOOKS_V1_REQUIREMENTS.skinEditor)).not.toThrow();
  });

  it("rejects unavailable, missing, or unsupported modules before mounting", () => {
    const unavailable = createAppHooksV1([unavailableSpacesHooksV1, unavailableAppearanceHooksV1]);
    expect(() => assertAppHooksV1Compatible(unavailable, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).toThrow(/myne\.spaces.*unavailable/);
    expect(() => assertAppHooksV1Compatible(createAppHooksV1([unavailableAppearanceHooksV1]), APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).toThrow(/myne\.spaces.*missing/);

    const { appHooks } = createFakeAppHooksV1Host();
    const unsupported = createAppHooksV1([
      { ...appHooks.modules.get("myne.spaces"), version: 2 },
      appHooks.modules.get("myne.appearance"),
    ]);
    expect(() => assertAppHooksV1Compatible(unsupported, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).toThrow(/version 1.*received 2/);
  });

  it("keeps optional unavailable modules hook-safe", () => {
    const appHooks = createAppHooksV1([unavailableAppearanceHooksV1]);
    expect(() => assertAppHooksV1Compatible(appHooks, [{ id: "myne.appearance", version: 1, required: false }])).not.toThrow();
    expect(unavailableAppearanceHooksV1.useSkinEditor()).toBe(unavailableAppearanceHooksV1.useSkinEditor());
    expect(unavailableSpacesHooksV1.useSpacesOverview()).toBe(unavailableSpacesHooksV1.useSpacesOverview());
  });

  it("preserves fake host identities while publishing current external-store state", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const host = createFakeAppHooksV1Host({ saveAppearance: save });
    const root = host.appHooks;
    const registry = root.modules;
    const appearance = registry.get("myne.appearance");
    const useSkinEditor = appearance.useSkinEditor;
    const saveAppearance = appearance.saveAppearance;
    host.setAppearanceSnapshot({ schemaVersion: 1, value: { activeGlobalSkinId: "next" } });
    expect(host.appHooks).toBe(root);
    expect(host.appHooks.modules).toBe(registry);
    expect(registry.get("myne.appearance")).toBe(appearance);
    expect(appearance.useSkinEditor).toBe(useSkinEditor);
    expect(appearance.saveAppearance).toBe(saveAppearance);
    expect(host.getAppearanceSnapshot()).toEqual({ schemaVersion: 1, value: { activeGlobalSkinId: "next" } });
    await saveAppearance({ snapshot: host.getAppearanceSnapshot()! });
    expect(save).toHaveBeenCalledWith({ snapshot: host.getAppearanceSnapshot() });
  });

  it("lets mounted consumers observe fake-host updates without replacing identities", () => {
    const host = createFakeAppHooksV1Host();
    const appearance = host.appHooks.modules.get("myne.appearance");
    const rendered = renderHook(() => appearance.useSkinEditor());
    act(() => host.setAppearanceSnapshot({ schemaVersion: 1, value: { activeGlobalSkinId: "changed" } }));
    expect(rendered.result.current.snapshot?.value).toEqual({ activeGlobalSkinId: "changed" });
    expect(host.appHooks.modules.get("myne.appearance")).toBe(appearance);
  });

  it("isolates fake stores and validates operations when they execute", async () => {
    const stop = vi.fn(async () => undefined);
    const first = createFakeAppHooksV1Host({ stopWorkspaceExecution: stop });
    const second = createFakeAppHooksV1Host();
    first.setSpacesValue({ workspaces: [{ id: "one", name: "One", branch: "main", pinned: false, createdAt: "", updatedAt: "", taskId: "", containerRef: null, filesChanged: null, linesAdded: null, linesRemoved: null, latestProcessStatus: null, latestProcessCompletedAt: null, hasPendingApproval: false, hasRunningDevServer: false, hasUnseenTurns: false, pullRequestStatus: null, repos: [] }] });
    expect(second.getSpacesValue().workspaces).toEqual([]);
    const spaces = first.appHooks.modules.get("myne.spaces");
    await expect(spaces.stopWorkspaceExecution(" ")).rejects.toThrow(/workspaceId/);
    expect(stop).not.toHaveBeenCalled();
    await spaces.stopWorkspaceExecution("workspace-1");
    expect(stop).toHaveBeenCalledWith("workspace-1");
  });
});
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
