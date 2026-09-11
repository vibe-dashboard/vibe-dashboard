import { describe, expect, it, vi } from "vitest";
import {
  APP_HOOKS_V1_REQUIREMENTS,
  assertAppHooksV1Compatible,
  createFakeAppHooksV1,
  unavailableAppearanceHooksV1,
  unavailableSpacesHooksV1,
} from "./AppHooks";

describe("AppHooksV1", () => {
  it("accepts independently versioned required capabilities", () => {
    const appHooks = createFakeAppHooksV1();
    expect(() => assertAppHooksV1Compatible(appHooks, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).not.toThrow();
    expect(() => assertAppHooksV1Compatible(appHooks, APP_HOOKS_V1_REQUIREMENTS.skinEditor)).not.toThrow();
  });

  it("rejects unavailable or unsupported capabilities before mounting", () => {
    expect(() => assertAppHooksV1Compatible({
      contractVersion: 1,
      capabilities: {
        appearance: unavailableAppearanceHooksV1,
        spaces: unavailableSpacesHooksV1,
      },
    }, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).toThrow(/myne\.spaces.*unavailable/);

    const appHooks = createFakeAppHooksV1();
    expect(() => assertAppHooksV1Compatible({
      ...appHooks,
      capabilities: {
        ...appHooks.capabilities,
        spaces: { ...appHooks.capabilities.spaces, version: 2 as 1 },
      },
    }, APP_HOOKS_V1_REQUIREMENTS.spacesOverview)).toThrow(/version 1.*received 2/);
  });

  it("allows a declared optional capability to be unavailable", () => {
    const appHooks = createFakeAppHooksV1();
    expect(() => assertAppHooksV1Compatible({
      ...appHooks,
      capabilities: {
        ...appHooks.capabilities,
        appearance: unavailableAppearanceHooksV1,
      },
    }, [{
      key: "appearance",
      id: "myne.appearance",
      version: 1,
      required: false,
    }])).not.toThrow();
  });

  it("provides stable hook-safe unavailable adapters", () => {
    expect(unavailableSpacesHooksV1.useSpacesOverview()).toBe(
      unavailableSpacesHooksV1.useSpacesOverview(),
    );
    expect(unavailableAppearanceHooksV1.useSkinEditor()).toBe(
      unavailableAppearanceHooksV1.useSkinEditor(),
    );
  });

  it("validates operations when they execute and delegates only valid calls", async () => {
    const stop = vi.fn(async () => undefined);
    const appHooks = createFakeAppHooksV1({ stopWorkspaceExecution: stop });

    expect(stop).not.toHaveBeenCalled();
    await expect(appHooks.capabilities.spaces.stopWorkspaceExecution(" ")).rejects.toThrow(/workspaceId/);
    expect(stop).not.toHaveBeenCalled();
    await appHooks.capabilities.spaces.stopWorkspaceExecution("workspace-1");
    expect(stop).toHaveBeenCalledWith("workspace-1");
  });
});
