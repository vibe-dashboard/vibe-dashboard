// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VD_SKIN_ID,
  SkinEditorDialog,
  SkinEditorContainer,
  type SkinEditorActions,
  SkinEditorDialogView,
  createDefaultSkinState,
  lightStudioSkin,
  type SkinEditorDialogViewProps,
  type VDSkinImportExportPackage,
  type VDSkinState,
} from "./index";
import {
  createFakeAppHooksV1,
  createFakeAppHooksV1Host,
  createAppHooksV1,
  type AppearanceModuleV1,
  type ReadonlyJsonValue,
  unavailableAppearanceHooksV1,
} from "../../app-hooks/AppHooks";

afterEach(() => {
  cleanup();
});

function renderEditor({
  onSave = vi.fn<SkinEditorActions["saveSkinState"]>(async () => ({ ok: true })),
  skinState = createDefaultSkinState(),
}: {
  onSave?: ReturnType<typeof vi.fn<SkinEditorActions["saveSkinState"]>>;
  skinState?: VDSkinState;
} = {}) {
  render(
    React.createElement(SkinEditorDialog, {
      actions: { saveSkinState: onSave },
      onClose: vi.fn(),
      open: true,
      skinState,
    }),
  );

  return { onSave };
}

describe("SkinEditorDialog controller", () => {
  it("checks required capabilities before mounting the hook-using container", () => {
    const useSkinEditor = vi.fn();
    const appHooks = createFakeAppHooksV1();
    expect(() => render(React.createElement(SkinEditorContainer, {
        appHooks: createAppHooksV1([
          appHooks.modules.get("myne.spaces"),
          { ...unavailableAppearanceHooksV1, useSkinEditor },
        ]),
        onClose: vi.fn(),
        open: true,
      }),
    )).toThrow(/myne\.appearance is unavailable/);
    expect(useSkinEditor).not.toHaveBeenCalled();
  });

  it("reconciles controller state when stable fake hosts replace story presets and isolates mounts", async () => {
    const firstSave = vi.fn<AppearanceModuleV1["saveAppearance"]>(async () => ({ ok: true }));
    const secondSave = vi.fn<AppearanceModuleV1["saveAppearance"]>(async () => ({ ok: true }));
    const defaultState = createDefaultSkinState();
    const lightState: VDSkinState = {
      ...defaultState,
      activeGlobalSkinId: lightStudioSkin.id,
    };
    const toSnapshot = (state: VDSkinState) => ({
      schemaVersion: 1 as const,
      value: state as unknown as ReadonlyJsonValue,
    });
    const firstHost = createFakeAppHooksV1Host({
      appearanceSnapshot: toSnapshot(defaultState),
      saveAppearance: firstSave,
    });
    const secondHost = createFakeAppHooksV1Host({
      appearanceSnapshot: toSnapshot(defaultState),
      saveAppearance: secondSave,
    });
    const firstRegistry = firstHost.appHooks.modules;
    const firstAppearance = firstRegistry.get("myne.appearance");
    const firstUseSkinEditor = firstAppearance.useSkinEditor;
    const firstSaveAppearance = firstAppearance.saveAppearance;
    const firstMount = render(React.createElement(SkinEditorContainer, {
      appHooks: firstHost.appHooks, onClose: vi.fn(), open: true,
    }));
    const secondMount = render(React.createElement(SkinEditorContainer, {
      appHooks: secondHost.appHooks, onClose: vi.fn(), open: true,
    }));

    fireEvent.click(within(firstMount.container).getByRole("button", { name: "Create editable copy" }));
    expect(within(firstMount.container).getByText("Unsaved")).toBeTruthy();

    act(() => firstHost.setAppearanceSnapshot(toSnapshot(lightState)));

    await waitFor(() => {
      expect(within(firstMount.container).getByRole("button", { name: /Light Studio/ }).getAttribute("aria-pressed")).toBe("true");
    });
    expect(within(firstMount.container).queryByText("Unsaved")).toBeNull();
    expect(within(secondMount.container).getByRole("button", { name: /VD Default Dark/ }).getAttribute("aria-pressed")).toBe("true");
    expect(secondHost.getAppearanceSnapshot()).toEqual(toSnapshot(defaultState));
    expect(firstHost.appHooks).not.toBe(secondHost.appHooks);
    expect(firstHost.appHooks.modules).toBe(firstRegistry);
    expect(firstHost.appHooks.modules.get("myne.appearance")).toBe(firstAppearance);
    expect(firstAppearance.useSkinEditor).toBe(firstUseSkinEditor);
    expect(firstAppearance.saveAppearance).toBe(firstSaveAppearance);

    fireEvent.click(within(firstMount.container).getByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(firstSave).toHaveBeenCalledTimes(1));
    expect(firstSave.mock.calls[0]?.[0].snapshot.value).toMatchObject({
      activeGlobalSkinId: lightStudioSkin.id,
    });
    expect(secondSave).not.toHaveBeenCalled();
  });

  it("renders the migrated skin editor surface with stable semantic slots", () => {
    renderEditor();

    expect(
      screen
        .getByRole("region", { name: "Skin editor" })
        .getAttribute("data-vd-surface"),
    ).toBe("skin-editor");
    expect(
      document.querySelector('[data-vd-slot="skin-editor-library"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-editor"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-preview"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-import-export"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-diagnostics"]'),
    ).toBeTruthy();
  });

  it("previews, validates, saves, and applies an editable skin copy", async () => {
    const { onSave } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    fireEvent.change(screen.getByDisplayValue("VD Default Dark Custom"), {
      target: { value: "Neon Flight" },
    });
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#22d3ee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.activeGlobalSkinId).toMatch(/^vd-user-/);
    expect(savedState.userSkins[0]).toMatchObject({
      name: "Neon Flight",
      tokens: {
        colors: expect.objectContaining({
          accent: "#22d3ee",
        }),
      },
    });
  });

  it("shows diagnostics and preserves draft state when save rejects", async () => {
    const onSave = vi
      .fn<SkinEditorActions["saveSkinState"]>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ ok: true });
    renderEditor({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    fireEvent.change(screen.getByDisplayValue("VD Default Dark Custom"), {
      target: { value: "Neon Flight" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(/Skin state could not be saved\. disk full/),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Neon Flight")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(/Skin state could not be saved\. disk full/),
    ).toBeNull();
  });

  it("shows import diagnostics without saving invalid JSON", () => {
    const { onSave } = renderEditor();

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Skin package JSON could not be parsed.")).toBeTruthy();
  });

  it("keeps color token text as source of truth while normalizing swatches", () => {
    const shorthandSkin = {
      ...lightStudioSkin,
      id: "vd-user-shorthand",
      name: "Shorthand Skin",
      rawCss: [],
      tokens: {
        ...lightStudioSkin.tokens,
        colors: {
          ...lightStudioSkin.tokens.colors,
          accent: "#abc",
        },
      },
    };

    renderEditor({
      skinState: {
        version: 1,
        activeGlobalSkinId: shorthandSkin.id,
        userSkins: [shorthandSkin],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit custom skin" }));

    expect(screen.getByLabelText("Accent color").getAttribute("value")).toBe(
      "#abc",
    );
    expect(screen.getByLabelText("Accent swatch").getAttribute("value")).toBe(
      "#aabbcc",
    );
  });

  it("imports a valid global skin package and preserves existing custom skins", async () => {
    const existingSkin = {
      ...lightStudioSkin,
      id: "vd-user-existing",
      name: "Existing Skin",
      rawCss: [],
    };
    const importedSkin = {
      ...lightStudioSkin,
      id: "vd-user-imported",
      name: "Imported Skin",
      rawCss: [],
    };
    const state: VDSkinState = {
      version: 1,
      activeGlobalSkinId: existingSkin.id,
      userSkins: [existingSkin],
    };
    const skinPackage: VDSkinImportExportPackage = {
      packageVersion: 1,
      activeGlobalSkinId: importedSkin.id,
      skins: [importedSkin],
    };
    const { onSave } = renderEditor({ skinState: state });

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: JSON.stringify(skinPackage) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.userSkins.map((skin) => skin.id)).toEqual([
      existingSkin.id,
      importedSkin.id,
    ]);
    expect(savedState.activeGlobalSkinId).toBe(importedSkin.id);
  });

  it("routes rejected import saves through the same retryable diagnostic path", async () => {
    const importedSkin = {
      ...lightStudioSkin,
      id: "vd-user-imported",
      name: "Imported Skin",
      rawCss: [],
    };
    const skinPackage: VDSkinImportExportPackage = {
      packageVersion: 1,
      activeGlobalSkinId: importedSkin.id,
      skins: [importedSkin],
    };
    const importJson = JSON.stringify(skinPackage);
    const onSave = vi
      .fn<SkinEditorActions["saveSkinState"]>()
      .mockRejectedValueOnce("offline")
      .mockResolvedValueOnce({ ok: true });
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: importJson },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(/Skin state could not be saved\. offline/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Skin package JSON") as HTMLTextAreaElement).value,
    ).toBe(importJson);

    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("reverts to the default global skin while keeping saved custom skins", async () => {
    const existingSkin = {
      ...lightStudioSkin,
      id: "vd-user-existing",
      name: "Existing Skin",
      rawCss: [],
    };
    const { onSave } = renderEditor({
      skinState: {
        version: 1,
        activeGlobalSkinId: existingSkin.id,
        userSkins: [existingSkin],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.activeGlobalSkinId).toBe(DEFAULT_VD_SKIN_ID);
    expect(savedState.userSkins.map((skin) => skin.id)).toEqual([existingSkin.id]);
  });
});

describe("SkinEditorDialog view", () => {
  it("uses SkinRoot preview state and skin-aware primitives", () => {
    const props: SkinEditorDialogViewProps = {
      actions: {
        applySelectedSkin: vi.fn(),
        close: vi.fn(),
        exportSelectedSkin: vi.fn(),
        forkSelectedSkin: vi.fn(),
        importPackage: vi.fn(),
        revertToDefaultSkin: vi.fn(),
        saveDraftSkin: vi.fn(),
        selectSkin: vi.fn(),
        updateColorToken: vi.fn(),
        updateDraftAuthor: vi.fn(),
        updateDraftDescription: vi.fn(),
        updateDraftName: vi.fn(),
        updateImportText: vi.fn(),
      },
      model: {
        activeGlobalSkinId: lightStudioSkin.id,
        colorFields: [
          {
            key: "accent",
            label: "Accent",
            swatchValue: "#22d3ee",
            value: "#22d3ee",
          },
        ],
        diagnostics: [],
        draftSkin: null,
        exportText: "",
        importText: "",
        isDirty: false,
        isEditingCustomSkin: false,
        isSaving: false,
        previewState: {
          version: 1,
          activeGlobalSkinId: lightStudioSkin.id,
          userSkins: [],
        },
        rawCssStatus: "deferred",
        selectedSkin: lightStudioSkin,
        selectedSkinIsBuiltIn: true,
        skinOptions: [
          {
            id: lightStudioSkin.id,
            isActive: true,
            isBuiltIn: true,
            isSelected: true,
            name: lightStudioSkin.name,
          },
        ],
        statusMessage: null,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(SkinEditorDialogView, props),
    );

    expect(html).toContain("data-vd-skin-root=\"true\"");
    expect(html).toContain("data-vd-skin-id=\"vd-light-studio\"");
    expect(html).toContain("data-vd-surface=\"skin-editor\"");
    expect(html).toContain("data-vd-component=\"button\"");
    expect(html).toContain("data-vd-text=\"primary\"");
  });
});
