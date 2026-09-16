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
  DEFAULT_MYNE_SKIN_ID,
  SkinEditorDialog,
  SkinEditorContainer,
  type SkinEditorActions,
  SkinEditorDialogView,
  createDefaultSkinState,
  lightStudioSkin,
  type SkinEditorDialogViewProps,
  type MyneSkinImportExportPackage,
  type MyneSkinState,
} from "./index";
import { selectedSkinEditorComposition } from "./SkinEditorDialog.composition";
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
  skinState?: MyneSkinState;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("SkinEditorDialog controller", () => {
  it("gates confirmation on the exact delayed candidate that was rendered", async () => {
    const pending = deferred<Awaited<ReturnType<NonNullable<SkinEditorActions["compileSkinState"]>>>>();
    const save = vi.fn<SkinEditorActions["saveSkinState"]>(async () => ({ ok: true }));
    render(React.createElement(SkinEditorDialog, {
      actions: { compileSkinState: () => pending.promise, saveSkinState: save },
      onClose: vi.fn(), open: true, skinState: createDefaultSkinState(),
    }));
    const apply = screen.getByRole("button", { name: "Apply selected" });
    expect(apply.hasAttribute("disabled")).toBe(true);
    fireEvent.click(apply);
    expect(save).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, sourceDigest: "sha256-visible", artifact: { scope: "myne-visible", cssText: ".visible{color:red}", digest: "sha256-artifact" } }));
    await waitFor(() => expect(apply.hasAttribute("disabled")).toBe(false));
    expect(document.querySelector("style")?.textContent).toContain(".visible{color:red}");
    fireEvent.click(apply);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].candidate).toEqual({
      sourceDigest: "sha256-visible",
      artifactDigest: "sha256-artifact",
      artifact: { scope: "myne-visible", cssText: ".visible{color:red}", digest: "sha256-artifact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    expect(screen.getByRole("button", { name: "Save and apply" }).hasAttribute("disabled")).toBe(true);
  });

  it("stages an imported state through a delayed visible candidate and submits its exact handle", async () => {
    const initial = deferred<Awaited<ReturnType<NonNullable<SkinEditorActions["compileSkinState"]>>>>();
    const imported = deferred<Awaited<ReturnType<NonNullable<SkinEditorActions["compileSkinState"]>>>>();
    const compile = vi.fn<NonNullable<SkinEditorActions["compileSkinState"]>>()
      .mockReturnValueOnce(initial.promise).mockReturnValueOnce(imported.promise)
      .mockResolvedValue({ ok: true, sourceDigest: "sha256-after-save" });
    const save = vi.fn<SkinEditorActions["saveSkinState"]>(async () => ({ ok: true }));
    render(React.createElement(SkinEditorDialog, { actions: { compileSkinState: compile, saveSkinState: save }, onClose: vi.fn(), open: true, skinState: createDefaultSkinState() }));
    await act(async () => initial.resolve({ ok: true, sourceDigest: "sha256-initial" }));
    const importedSkin = { ...lightStudioSkin, id: "myne-user-import-preview", name: "Import preview", rawCss: [] };
    fireEvent.change(screen.getByLabelText("Skin package JSON"), { target: { value: JSON.stringify({ packageVersion: 1, activeGlobalSkinId: importedSkin.id, skins: [importedSkin] }) } });
    const button = screen.getByRole("button", { name: "Import package" });
    fireEvent.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await act(async () => imported.resolve({ ok: true, sourceDigest: "sha256-import", artifact: { scope: "myne-import", cssText: ".import-preview{color:red}", digest: "sha256-import-artifact" } }));
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect([...document.querySelectorAll("style")].some((style) => style.textContent?.includes(".import-preview{color:red}"))).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ source: "import", candidate: { sourceDigest: "sha256-import", artifactDigest: "sha256-import-artifact" } });
  });

  it("stages non-default to default revert, invalidates on source change, and permits cancellation", async () => {
    const compile = vi.fn<NonNullable<SkinEditorActions["compileSkinState"]>>(async ({ state }) => ({ ok: true, sourceDigest: `sha256-${state.activeGlobalSkinId}` }));
    const save = vi.fn<SkinEditorActions["saveSkinState"]>(async () => ({ ok: true }));
    render(React.createElement(SkinEditorDialog, {
      actions: { compileSkinState: compile, saveSkinState: save }, onClose: vi.fn(), open: true,
      skinState: { version: 1, activeGlobalSkinId: lightStudioSkin.id, userSkins: [] },
    }));
    const revert = screen.getByRole("button", { name: "Revert to default" });
    await waitFor(() => expect(revert.hasAttribute("disabled")).toBe(false));
    fireEvent.click(revert);
    expect(revert.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(revert.hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("Skin package JSON"), { target: { value: "cancel pending revert" } });
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(revert.hasAttribute("disabled")).toBe(false));
    fireEvent.click(revert);
    await waitFor(() => expect(revert.hasAttribute("disabled")).toBe(false));
    fireEvent.click(revert);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0]?.[0].state as MyneSkinState).activeGlobalSkinId).toBe(DEFAULT_MYNE_SKIN_ID);
    expect(save.mock.calls[0]?.[0].candidate.sourceDigest).toBe(`sha256-${DEFAULT_MYNE_SKIN_ID}`);
  });

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
    const lightState: MyneSkinState = {
      ...defaultState,
      activeGlobalSkinId: lightStudioSkin.id,
    };
    const toSnapshot = (state: MyneSkinState) => ({
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
    expect(within(secondMount.container).getByRole("button", { name: /Myne Default Dark/ }).getAttribute("aria-pressed")).toBe("true");
    expect(secondHost.getAppearanceSnapshot()).toEqual(toSnapshot(defaultState));
    expect(firstHost.appHooks).not.toBe(secondHost.appHooks);
    expect(firstHost.appHooks.modules).toBe(firstRegistry);
    expect(firstHost.appHooks.modules.get("myne.appearance")).toBe(firstAppearance);
    expect(firstAppearance.useSkinEditor).toBe(firstUseSkinEditor);
    expect(firstAppearance.saveAppearance).toBe(firstSaveAppearance);

    const applyButton = within(firstMount.container).getByRole("button", { name: "Apply selected" });
    await waitFor(() => expect(applyButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(applyButton);
    await waitFor(() => expect(firstSave).toHaveBeenCalledTimes(1));
    expect(firstSave.mock.calls[0]?.[0].snapshot.value).toMatchObject({
      activeGlobalSkinId: lightStudioSkin.id,
    });
    expect(secondSave).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "invalidates an in-flight save when a host snapshot changes before stale %s",
    async (settlement) => {
      const pending = deferred<{ ok: true }>();
      const firstSave = vi.fn<AppearanceModuleV1["saveAppearance"]>(() => pending.promise);
      const secondSave = vi.fn<AppearanceModuleV1["saveAppearance"]>(async () => ({ ok: true }));
      const defaultState = createDefaultSkinState();
      const staleDraftId = "vd-user-myne-default-dark-custom";
      const lightState: MyneSkinState = {
        ...defaultState,
        activeGlobalSkinId: lightStudioSkin.id,
        userSkins: [{ ...lightStudioSkin, id: staleDraftId, name: "Stale draft collision", rawCss: [] }],
      };
      const toSnapshot = (state: MyneSkinState) => ({
        schemaVersion: 1 as const,
        value: state as unknown as ReadonlyJsonValue,
      });
      const firstHost = createFakeAppHooksV1Host({
        appearanceSnapshot: toSnapshot(defaultState), saveAppearance: firstSave,
      });
      const secondHost = createFakeAppHooksV1Host({
        appearanceSnapshot: toSnapshot(defaultState), saveAppearance: secondSave,
      });
      const root = firstHost.appHooks;
      const registry = root.modules;
      const module = registry.get("myne.appearance");
      const firstMount = render(React.createElement(SkinEditorContainer, {
        appHooks: root, onClose: vi.fn(), open: true,
      }));
      const secondMount = render(React.createElement(SkinEditorContainer, {
        appHooks: secondHost.appHooks, onClose: vi.fn(), open: true,
      }));

      fireEvent.click(within(firstMount.container).getByRole("button", { name: "Create editable copy" }));
      const readySaveButton = within(firstMount.container).getByRole("button", { name: "Save and apply" });
      await waitFor(() => expect(readySaveButton.hasAttribute("disabled")).toBe(false));
      fireEvent.click(readySaveButton);
      await waitFor(() => expect(firstSave).toHaveBeenCalledTimes(1));
      const saveButton = within(firstMount.container).getByRole("button", { name: "Save and apply" });
      expect(saveButton.hasAttribute("disabled")).toBe(true);
      fireEvent.click(saveButton);
      expect(firstSave).toHaveBeenCalledTimes(1);

      act(() => firstHost.setAppearanceSnapshot(toSnapshot(lightState)));
      await waitFor(() => expect(
        within(firstMount.container).getByRole("button", { name: /Light Studio/ }).getAttribute("aria-pressed"),
      ).toBe("true"));

      await act(async () => {
        if (settlement === "resolve") pending.resolve({ ok: true });
        else pending.reject(new Error("stale failure"));
        await pending.promise.catch(() => undefined);
      });

      expect(within(firstMount.container).queryByText("Unsaved")).toBeNull();
      expect(within(firstMount.container).queryByText(/Saved Myne Default Dark Custom/)).toBeNull();
      expect(within(firstMount.container).queryByText(/stale failure/)).toBeNull();
      expect(within(firstMount.container).getByRole("button", { name: /Light Studio/ }).getAttribute("aria-pressed")).toBe("true");
      expect(within(firstMount.container).getByRole("button", { name: "Apply selected" }).hasAttribute("disabled")).toBe(false);
      expect(within(secondMount.container).getByRole("button", { name: /Myne Default Dark/ }).getAttribute("aria-pressed")).toBe("true");
      expect(secondSave).not.toHaveBeenCalled();
      expect(firstHost.appHooks).toBe(root);
      expect(root.modules).toBe(registry);
      expect(registry.get("myne.appearance")).toBe(module);
    },
  );

  it("renders the migrated skin editor surface with stable semantic slots", () => {
    renderEditor();

    expect(
      screen
        .getByRole("region", { name: "Skin editor" })
        .getAttribute("data-myne-surface"),
    ).toBe("skin-editor");
    expect(
      document.querySelector('[data-myne-slot="skin-editor-library"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-myne-slot="skin-editor-editor"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-myne-slot="skin-editor-preview"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-myne-slot="skin-editor-import-export"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-myne-slot="skin-editor-diagnostics"]'),
    ).toBeTruthy();
  });

  it("previews, validates, saves, and applies an editable skin copy", async () => {
    const { onSave } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    fireEvent.change(screen.getByDisplayValue("Myne Default Dark Custom"), {
      target: { value: "Neon Flight" },
    });
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#22d3ee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as MyneSkinState;
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
    fireEvent.change(screen.getByDisplayValue("Myne Default Dark Custom"), {
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
    const state: MyneSkinState = {
      version: 1,
      activeGlobalSkinId: existingSkin.id,
      userSkins: [existingSkin],
    };
    const skinPackage: MyneSkinImportExportPackage = {
      packageVersion: 1,
      activeGlobalSkinId: importedSkin.id,
      skins: [importedSkin],
    };
    const { onSave } = renderEditor({ skinState: state });

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: JSON.stringify(skinPackage) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as MyneSkinState;
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
    const skinPackage: MyneSkinImportExportPackage = {
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
    expect(onSave).not.toHaveBeenCalled();
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
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as MyneSkinState;
    expect(savedState.activeGlobalSkinId).toBe(DEFAULT_MYNE_SKIN_ID);
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
      isCandidateReady: true,
        previewState: {
          version: 1,
          activeGlobalSkinId: lightStudioSkin.id,
          userSkins: [],
        },
        rawCssStatus: "compiler-protected",
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
      React.createElement(SkinEditorDialogView, {
        ...props,
        components: selectedSkinEditorComposition.components,
      }),
    );

    expect(html).toContain("data-myne-skin=\"myne-light-studio\"");
    expect(html).toContain("data-myne-surface=\"skin-editor\"");
    expect(html).toContain("myne-button");
    expect(html).toContain("myne-text--primary");
    expect(html).not.toContain("data-vd-");
    expect(html).not.toContain("--vd-");
  });
});
