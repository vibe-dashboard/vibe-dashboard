// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpacesOverview } from "../SpacesOverview";
import { createFakeAppHooksV1, unavailableSpacesHooksV1 } from "../../app-hooks/AppHooks";

describe("SpacesOverview appHooks boundary", () => {
  it("checks required capability compatibility before invoking injected hooks", () => {
    const useSpacesOverview = vi.fn();
    const appHooks = createFakeAppHooksV1();
    expect(() => render(React.createElement(SpacesOverview, {
      appHooks: {
        ...appHooks,
        capabilities: {
          ...appHooks.capabilities,
          spaces: { ...unavailableSpacesHooksV1, useSpacesOverview },
        },
      },
      workspace: { spaces: [], tabGroups: [] } as never,
      savedSessions: [],
      onResumeSession: vi.fn(), onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
      onStartNewSession: vi.fn(), onNavigateToTabGroup: vi.fn(),
    }))).toThrow(/myne\.spaces is unavailable/);
    expect(useSpacesOverview).not.toHaveBeenCalled();
  });
});
