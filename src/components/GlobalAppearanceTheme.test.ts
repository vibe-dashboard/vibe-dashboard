// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeAppHooksV1Host } from "../app-hooks/AppHooks";
import { lightStudioSkin } from "../theme/skins";
import { GlobalAppearanceTheme } from "./GlobalAppearanceTheme";

afterEach(() => cleanup());

describe("GlobalAppearanceTheme", () => {
  it("applies the selected Skin Editor theme to app shell children", () => {
    const host = createFakeAppHooksV1Host({
      appearanceSnapshot: {
        schemaVersion: 1,
        value: {
          version: 1,
          userSkins: [],
          activeGlobalSkinId: lightStudioSkin.id,
        },
      },
    });

    const { container } = render(
      React.createElement(
        GlobalAppearanceTheme,
        { appHooks: host.appHooks },
        React.createElement("main", null, "Dashboard"),
      ),
    );

    const root = container.querySelector(".myne-theme") as HTMLElement;
    expect(root?.getAttribute("data-myne-skin")).toBe(lightStudioSkin.id);
    expect(root?.style.getPropertyValue("--myne-color-background")).toBe(
      lightStudioSkin.tokens.colors.background,
    );
    expect(root?.style.getPropertyValue("--heroui-background")).toMatch(
      /^\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%$/,
    );
  });

  it("reacts to appearance snapshot updates through the shared app hooks path", async () => {
    const host = createFakeAppHooksV1Host();
    const { container } = render(
      React.createElement(
        GlobalAppearanceTheme,
        { appHooks: host.appHooks },
        React.createElement("main", null, "Dashboard"),
      ),
    );

    host.setAppearanceSnapshot({
      schemaVersion: 1,
      value: {
        version: 1,
        userSkins: [],
        activeGlobalSkinId: lightStudioSkin.id,
      },
    });

    await waitFor(() => {
      expect(
        container.querySelector(".myne-theme")?.getAttribute("data-myne-skin"),
      ).toBe(lightStudioSkin.id);
    });
  });
});
