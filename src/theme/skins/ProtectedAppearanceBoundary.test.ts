// @vitest-environment jsdom
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedAppearanceBoundary } from "./ProtectedAppearanceBoundary.view";
import { installProtectedAppearanceRecovery } from "./scopedCss";

afterEach(cleanup);

describe("protected appearance controls", () => {
  it("renders outside package scope with semantic recovery and state distinctions", () => {
    const { container, getByRole } = render(createElement(ProtectedAppearanceBoundary, { status: "warning", children: "Recover appearance" }));
    const region = getByRole("region", { name: "Appearance safety controls" });
    expect(region.getAttribute("data-myne-protected")).toBe("appearance-controls");
    expect(region.hasAttribute("data-myne-package-scope")).toBe(false);
    expect(region.getAttribute("data-myne-protected-status")).toBe("warning");
    expect(container.querySelector("#myne-appearance-recovery")).toBe(region);
  });

  it("focuses recovery from the reserved keyboard shortcut and cleans up", () => {
    const { getByRole } = render(createElement(ProtectedAppearanceBoundary, { children: "Recover" }));
    const region = getByRole("region", { name: "Appearance safety controls" });
    const cleanup = installProtectedAppearanceRecovery(document);
    fireEvent.keyDown(document, { key: "R", altKey: true, shiftKey: true });
    expect(document.activeElement).toBe(region);
    cleanup();
    const focus = vi.spyOn(region, "focus");
    fireEvent.keyDown(document, { key: "R", altKey: true, shiftKey: true });
    expect(focus).not.toHaveBeenCalled();
  });

  it("keeps protected states, forced colors, focus, and reduced motion host-owned", () => {
    const css = readFileSync(`${process.cwd()}/src/theme/skins/myne.css`, "utf8");
    for (const state of ["error", "destructive", "warning", "confirmation", "disabled"]) expect(css).toContain(`data-myne-protected-status="${state}"`);
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".myne-protected-appearance-controls:focus-visible");
    expect(css).toContain("pointer-events: auto");
  });
});
