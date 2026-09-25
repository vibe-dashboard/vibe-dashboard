// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAppHooksV1 } from "../app-hooks/AppHooks";
import { createDefaultAppearanceSnapshot } from "../theme/skins/defaultAppearanceSnapshot";
import { AppearanceSettings } from "./AppearanceSettings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("production Appearance settings", () => {
  it("keeps protected controls outside package scope and opens the real editor", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ head: { revisionId: "r1", snapshot: canonical }, revisions: [{ revisionId: "r1", summary: "Initial", committedAt: "2026-09-16T00:00:00Z", source: "genesis", actor: { id: "system", kind: "system" }, snapshot: canonical }] }), { status: 200 }));
    const { container } = render(React.createElement(AppearanceSettings, { appHooks: createFakeAppHooksV1({ appearanceSnapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin } }), fetcher }));
    const safety = screen.getByRole("region", { name: "Appearance safety controls" });
    expect(safety.closest("[data-myne-package-scope]")).toBeNull();
    await waitFor(() => expect(screen.getByText(/saved revision r1/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /open skin editor/i }));
    expect(container.querySelector('[data-myne-surface="skin-editor"]')).toBeTruthy();
  });

  it("opens the skin editor before revision history so the action has visible feedback", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const revisions = Array.from({ length: 12 }, (_, index) => ({
      revisionId: `r${index + 1}`,
      summary: `Revision ${index + 1}`,
      committedAt: `2026-09-16T00:${String(index).padStart(2, "0")}:00Z`,
      source: "user",
      snapshot: canonical,
    }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ head: revisions.at(-1), revisions }), { status: 200 }));
    const { container } = render(React.createElement(AppearanceSettings, { appHooks: createFakeAppHooksV1({ appearanceSnapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin } }), fetcher }));

    await waitFor(() => expect(screen.getByText(/saved revision r12/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /open skin editor/i }));

    const editor = container.querySelector('[data-myne-surface="skin-editor"]');
    const history = container.querySelector("#appearance-history-heading");
    expect(editor).toBeTruthy();
    expect(history).toBeTruthy();
    expect(Boolean(editor!.compareDocumentPosition(history!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("requires confirmation and routes undo through history before reloading", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ head: { revisionId: "r2", snapshot: canonical }, revisions: [{ revisionId: "r1", summary: "Initial", committedAt: "2026-09-16T00:00:00Z", source: "genesis", actor: { id: "system", kind: "system" }, snapshot: canonical }, { revisionId: "r2", summary: "Light", committedAt: "2026-09-16T00:01:00Z", source: "user", actor: { id: "local-user", kind: "user" }, snapshot: canonical }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: { revisionId: "r3" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ head: { revisionId: "r3", snapshot: canonical }, revisions: [] }), { status: 200 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AppearanceSettings, { appHooks: createFakeAppHooksV1(), fetcher, onHistoryChanged: vi.fn() }));
    await waitFor(() => expect(screen.getByRole("button", { name: /undo latest/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /undo latest/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ type: "undo", expectedCurrentRevisionId: "r2" });
  });

  it("persists only registered compatible view-pack manifests", async () => {
    const canonical = createDefaultAppearanceSnapshot();
    const history = { head: { revisionId: "r1", snapshot: canonical }, revisions: [] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(history), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: { revisionId: "r2" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(history), { status: 200 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(React.createElement(AppearanceSettings, { appHooks: createFakeAppHooksV1({ appearanceState: { snapshot: { schemaVersion: 1, value: JSON.parse(canonical).skin }, viewPacks: { "spaces-overview": "myne.spaces.view-pack.default", "skin-editor": "myne.appearance.view-pack.default" } } }), fetcher, onHistoryChanged: vi.fn() }));
    const select = await screen.findByRole("combobox", { name: /spaces layout/i });
    fireEvent.change(select, { target: { value: "myne.spaces.view-pack.dense-workspace-list" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const saved = JSON.parse(body.snapshot);
    expect(saved.surfaces.find((surface: { surface: string }) => surface.surface === "spaces-overview")).toMatchObject({ viewPackId: "myne.spaces.view-pack.dense-workspace-list", slots: expect.arrayContaining([expect.objectContaining({ id: "workspaceList", componentId: "myne.spaces.workspace-list.dense" })]) });
  });
});
