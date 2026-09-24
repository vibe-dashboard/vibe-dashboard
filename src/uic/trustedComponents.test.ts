import { describe, expect, it } from "vitest";
import {
  compileUICScopedCss,
  compileUICXml,
  generateUICXsd,
  getUICLayoutTree,
  spacesOverviewPageHeaderUICProof,
  validateUICXml,
} from "./trustedComponents";

const pageHeaderXml = `<uic:spaceOverviewPage xmlns:uic="https://vibedashboard.dev/uic/xml/v1" artifactVersion="1">
  <uic:css><![CDATA[:uic-scope { --myne-slot-page-header-gap: 1rem; }]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
</uic:spaceOverviewPage>`;

const fullSpacesOverviewXml = `<uic:spaceOverviewPage xmlns:uic="https://vibedashboard.dev/uic/xml/v1" artifactVersion="1">
  <uic:css><![CDATA[:uic-scope { --myne-slot-page-header-gap: 1rem; }]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
  <uic:recentSessions uic:on-resume="spaces.resumeSession" uic:on-start="spaces.startSession" uic:on-rename="spaces.renameSession" uic:on-delete="spaces.deleteSession" uic:on-toggle="spaces.toggleSession" uic:on-activate="spaces.navigateToCraft" />
  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" />
  <uic:recentlyVisitedCraft uic:on-activate="spaces.navigateToCraft" uic:on-page="spaces.pageRecentlyVisitedCraft" />
  <uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" uic:on-page="spaces.pageRecentlyCreatedCraft" />
  <uic:workspaceList uic:on-activate="spaces.openWorkspace" uic:on-navigate="spaces.navigateToCraft" uic:on-stop="spaces.stopDevServer" uic:on-filter="spaces.filterWorkspaces" uic:on-page="spaces.pageWorkspaces" />
  <uic:spaces uic:on-activate="spaces.navigateToCraft" />
  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />
</uic:spaceOverviewPage>`;

const structuralSpacesOverviewXml = `<uic:spaceOverviewPage xmlns:uic="https://vibedashboard.dev/uic/xml/v1" artifactVersion="1">
  <uic:css><![CDATA[:uic-scope { --myne-slot-page-header-gap: 1rem; }]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
  <uic:layout variant="command-center">
    <uic:region name="activeRail" as="aside" aria-label="Active work">
      <uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" />
      <uic:recentSessions uic:on-resume="spaces.resumeSession" uic:on-start="spaces.startSession" uic:on-rename="spaces.renameSession" uic:on-delete="spaces.deleteSession" uic:on-toggle="spaces.toggleSession" uic:on-activate="spaces.navigateToCraft" />
    </uic:region>
    <uic:region name="mainQueue" as="section" aria-label="Workspace command queue">
      <uic:workspaceList uic:on-activate="spaces.openWorkspace" uic:on-navigate="spaces.navigateToCraft" uic:on-stop="spaces.stopDevServer" uic:on-filter="spaces.filterWorkspaces" uic:on-page="spaces.pageWorkspaces" />
    </uic:region>
    <uic:region name="memoryRail" as="aside" aria-label="Space memory">
      <uic:spaces uic:on-activate="spaces.navigateToCraft" />
      <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />
      <uic:recentlyVisitedCraft uic:on-activate="spaces.navigateToCraft" uic:on-page="spaces.pageRecentlyVisitedCraft" />
      <uic:recentlyCreatedCraft uic:on-activate="spaces.navigateToCraft" uic:on-page="spaces.pageRecentlyCreatedCraft" />
    </uic:region>
  </uic:layout>
  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />
</uic:spaceOverviewPage>`;

describe("UIC trusted component descriptors", () => {
  it("generates named tag XSD from the trusted descriptor without generic component refs", () => {
    const xsd = generateUICXsd(spacesOverviewPageHeaderUICProof);

    expect(xsd).toContain('targetNamespace="https://vibedashboard.dev/uic/xml/v1"');
    expect(xsd).toContain('name="spaceOverviewPage"');
    expect(xsd).toContain('name="pageHeader"');
    expect(xsd).toContain('name="recentSessions"');
    expect(xsd).toContain('name="runningDevServers"');
    expect(xsd).toContain('name="spacePicker"');
    expect(xsd).toContain('name="pageHeaderAction"');
    expect(xsd).toContain('name="css"');
    expect(xsd).toContain('fixed="actions"');
    expect(xsd).toContain('name="title"');
    expect(xsd).toContain('name="label"');
    expect(xsd).toContain('name="uic:on-activate"');
    expect(xsd).toContain('name="uic:on-resume"');
    expect(xsd).toContain('name="uic:on-start"');
    expect(xsd).toContain('name="uic:on-rename"');
    expect(xsd).toContain('name="uic:on-delete"');
    expect(xsd).toContain('name="uic:on-toggle"');
    expect(xsd).toContain('name="uic:on-navigate"');
    expect(xsd).toContain('name="uic:on-stop"');
    expect(xsd).toContain('name="uic:on-open"');
    expect(xsd).toContain('name="uic:on-filter"');
    expect(xsd).toContain('name="uic:on-page"');
    expect(xsd).toContain('name="uic:on-close"');
    expect(xsd).toContain('name="uic:on-retry"');
    expect(xsd).toContain('name="uic:on-select"');
    expect(xsd).toContain('fixed="spaces.navigateToCraft"');
    expect(xsd).toContain('fixed="spaces.resumeSession"');
    expect(xsd).toContain('fixed="spaces.startSession"');
    expect(xsd).toContain('fixed="spaces.renameSession"');
    expect(xsd).toContain('fixed="spaces.deleteSession"');
    expect(xsd).toContain('fixed="spaces.toggleSession"');
    expect(xsd).toContain('fixed="spaces.stopDevServer"');
    expect(xsd).toContain('fixed="spaces.openWorkspace"');
    expect(xsd).toContain('fixed="spaces.filterWorkspaces"');
    expect(xsd).toContain('fixed="spaces.pageWorkspaces"');
    expect(xsd).toContain('fixed="spaces.pageRecentlyVisitedCraft"');
    expect(xsd).toContain('fixed="spaces.pageRecentlyCreatedCraft"');
    expect(xsd).toContain('fixed="spaces.dismissPicker"');
    expect(xsd).toContain('fixed="spaces.retryOpenWorkspace"');
    expect(xsd).toContain('fixed="spaces.selectSpaceForWorkspace"');
    expect(xsd).not.toContain('name="component"');
    expect(xsd).not.toContain('name="ref"');
    expect(xsd).not.toContain('name="version"');
  });

  it("compiles app-local unversioned generated tags into digest-bound canonical IR", async () => {
    const compiled = await compileUICXml(spacesOverviewPageHeaderUICProof, fullSpacesOverviewXml);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("expected successful compile");
    expect(compiled.ir).toMatchObject({
      artifactVersion: 1,
      surface: "spaces-overview",
      rootTag: "spaceOverviewPage",
      css: ":uic-scope { --myne-slot-page-header-gap: 1rem; }",
      nodes: [
        {
          tag: "pageHeader",
          componentId: "myne.spaces.page-header.default",
          props: {
            title: { kind: "binding", path: "model.title" },
            subtitle: { kind: "binding", path: "model.subtitle" },
          },
          slots: {
            actions: [
              {
                tag: "pageHeaderAction",
                adapter: "wrapper",
                componentId: "uic.heroui.button.action",
                props: { label: { kind: "literal", value: "Start voyage" } },
              },
            ],
          },
        },
        { tag: "recentSessions", componentId: "myne.spaces.recent-sessions.default", actions: { resume: "spaces.resumeSession", start: "spaces.startSession", rename: "spaces.renameSession", delete: "spaces.deleteSession", toggle: "spaces.toggleSession", activate: "spaces.navigateToCraft" } },
        { tag: "starredCraft", componentId: "myne.spaces.starred-craft.default", actions: { activate: "spaces.navigateToCraft" } },
        { tag: "runningDevServers", componentId: "myne.spaces.running-dev-servers.default", actions: { stop: "spaces.stopDevServer", activate: "spaces.navigateToCraft", open: "spaces.openWorkspace" } },
        { tag: "recentlyVisitedCraft", componentId: "myne.spaces.recently-visited.default", actions: { activate: "spaces.navigateToCraft", page: "spaces.pageRecentlyVisitedCraft" } },
        { tag: "recentlyCreatedCraft", componentId: "myne.spaces.recently-created.default", actions: { activate: "spaces.navigateToCraft", page: "spaces.pageRecentlyCreatedCraft" } },
        { tag: "workspaceList", componentId: "myne.spaces.workspace-list.default", actions: { activate: "spaces.openWorkspace", navigate: "spaces.navigateToCraft", stop: "spaces.stopDevServer", filter: "spaces.filterWorkspaces", page: "spaces.pageWorkspaces" } },
        { tag: "spaces", componentId: "myne.spaces.spaces.default", actions: { activate: "spaces.navigateToCraft" } },
        { tag: "spacePicker", componentId: "myne.spaces.space-picker.default", actions: { close: "spaces.dismissPicker", retry: "spaces.retryOpenWorkspace", select: "spaces.selectSpaceForWorkspace" } },
      ],
    });
    expect(compiled.ir.schemaDigest).toMatch(/^sha256-/);
    expect(compiled.ir.registryDigest).toMatch(/^sha256-/);
  });

  it("requires every SpacesOverview layout-shell tag exactly once before compile", async () => {
    const missingWorkspace = fullSpacesOverviewXml.replace('  <uic:workspaceList uic:on-activate="spaces.openWorkspace" uic:on-navigate="spaces.navigateToCraft" uic:on-stop="spaces.stopDevServer" uic:on-filter="spaces.filterWorkspaces" uic:on-page="spaces.pageWorkspaces" />\n', "");
    const duplicateSpaces = fullSpacesOverviewXml.replace('  <uic:spaces uic:on-activate="spaces.navigateToCraft" />', '  <uic:spaces uic:on-activate="spaces.navigateToCraft" />\n  <uic:spaces uic:on-activate="spaces.navigateToCraft" />');
    const reordered = fullSpacesOverviewXml.replace('  <uic:recentSessions uic:on-resume="spaces.resumeSession" uic:on-start="spaces.startSession" uic:on-rename="spaces.renameSession" uic:on-delete="spaces.deleteSession" uic:on-toggle="spaces.toggleSession" uic:on-activate="spaces.navigateToCraft" />\n  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />', '  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />\n  <uic:recentSessions uic:on-resume="spaces.resumeSession" uic:on-start="spaces.startSession" uic:on-rename="spaces.renameSession" uic:on-delete="spaces.deleteSession" uic:on-toggle="spaces.toggleSession" uic:on-activate="spaces.navigateToCraft" />');
    const extra = fullSpacesOverviewXml.replace('  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />', '  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />\n  <uic:unknownSection />');

    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, missingWorkspace)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/missing-required-node" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, duplicateSpaces)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/duplicate-node" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, reordered)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/slot-order" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, extra)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/unknown-tag" })]) });
  });

  it("accepts a safe structural primitive tree around trusted SpacesOverview slots", async () => {
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, structuralSpacesOverviewXml).diagnostics).toEqual([]);
    const tree = getUICLayoutTree(spacesOverviewPageHeaderUICProof, structuralSpacesOverviewXml);
    expect(tree[0]).toMatchObject({ kind: "primitive", tag: "layout" });
    expect(tree[0]?.kind === "primitive" ? tree[0].children[0] : undefined).toMatchObject({
      kind: "primitive",
      tag: "region",
      attrs: expect.objectContaining({ name: "activeRail", as: "aside", "aria-label": "Active work" }),
    });

    const compiled = await compileUICXml(spacesOverviewPageHeaderUICProof, structuralSpacesOverviewXml);
    expect(compiled).toMatchObject({ ok: true });
  });

  it("rejects unsafe or malformed structural primitive trees", () => {
    const tooDeep = structuralSpacesOverviewXml.replace(
      '<uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" />',
      '<uic:stack><uic:stack><uic:stack><uic:stack><uic:stack><uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" /></uic:stack></uic:stack></uic:stack></uic:stack></uic:stack>',
    );
    const tooManyNodes = structuralSpacesOverviewXml.replace("<uic:workspaceList ", `${"<uic:card></uic:card>".repeat(48)}<uic:workspaceList `);
    const cases = [
      ["unknown tag", structuralSpacesOverviewXml.replace("<uic:region", "<uic:blink"), "uic/xml/unknown-tag"],
      ["unknown attr", structuralSpacesOverviewXml.replace("<uic:layout ", '<uic:layout onclick="x" '), "uic/xml/unknown-attribute"],
      ["unsafe namespace", structuralSpacesOverviewXml.replace("<uic:region", "<x:region"), "uic/xml/unsupported-namespace"],
      ["duplicate slot", structuralSpacesOverviewXml.replace("</uic:region>", '<uic:runningDevServers /></uic:region>'), "uic/xml/duplicate-node"],
      ["missing slot", structuralSpacesOverviewXml.replace(/<uic:workspaceList[^>]+\/>/u, ""), "uic/xml/missing-required-node"],
      ["duplicate region", structuralSpacesOverviewXml.replace('name="mainQueue"', 'name="activeRail"'), "uic/xml/duplicate-region"],
      ["missing label", structuralSpacesOverviewXml.replace(' aria-label="Active work"', ""), "uic/xml/landmark-label"],
      ["depth", tooDeep, "uic/xml/depth-budget"],
      ["node budget", tooManyNodes, "uic/xml/node-budget"],
      ["url attr", structuralSpacesOverviewXml.replace('aria-label="Active work"', 'aria-label="https://example.test"'), "uic/xml/url-forbidden"],
    ] as const;

    for (const [name, xml, code] of cases) {
      expect(validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics, name).toContainEqual(
        expect.objectContaining({ code }),
      );
    }
  });

  it("rejects body slots hidden under non-rendered generated tags in structural layouts", () => {
    const hiddenRunning = structuralSpacesOverviewXml
      .replace('<uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" />', "")
      .replace('<uic:pageHeaderAction label="Start voyage" />', '<uic:pageHeaderAction label="hidden"><uic:runningDevServers uic:on-stop="spaces.stopDevServer" uic:on-activate="spaces.navigateToCraft" uic:on-open="spaces.openWorkspace" /></uic:pageHeaderAction>');
    const slotInLayout = structuralSpacesOverviewXml.replace("<uic:workspaceList ", '<uic:slot name="actions"></uic:slot><uic:workspaceList ');
    const nestedPageHeader = structuralSpacesOverviewXml.replace("<uic:workspaceList ", '<uic:pageHeader title="{model.title}" subtitle="{model.subtitle}" /><uic:workspaceList ');
    const movedSpacePicker = structuralSpacesOverviewXml
      .replace('  <uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" />\n', "")
      .replace("<uic:workspaceList ", '<uic:spacePicker uic:on-close="spaces.dismissPicker" uic:on-retry="spaces.retryOpenWorkspace" uic:on-select="spaces.selectSpaceForWorkspace" /><uic:workspaceList ');
    const cases = [
      ["hidden required slot", hiddenRunning, "uic/xml/missing-required-node"],
      ["slot inside layout", slotInLayout, "uic/xml/unsupported-structure"],
      ["nested pageHeader", nestedPageHeader, "uic/xml/unsupported-structure"],
      ["moved spacePicker", movedSpacePicker, "uic/xml/unsupported-structure"],
    ] as const;

    for (const [name, xml, code] of cases) {
      expect(validateUICXml(spacesOverviewPageHeaderUICProof, xml).diagnostics, name).toContainEqual(
        expect.objectContaining({ code }),
      );
      expect(getUICLayoutTree(spacesOverviewPageHeaderUICProof, xml), name).toEqual([]);
    }
  });

  it("compiles top-level UIC CSS to an artifact-scoped stylesheet", () => {
    const compiled = compileUICScopedCss(spacesOverviewPageHeaderUICProof, structuralSpacesOverviewXml, "uic.spaces.layout-command-center.proof");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.css).toContain('[data-uic-artifact="uic.spaces.layout-command-center.proof"] {');
    expect(compiled.css).toContain("--myne-slot-page-header-gap: 1rem");
    expect(compiled.css).not.toContain(":uic-scope");
  });

  it("rejects unsafe UIC CSS before mount", () => {
    const cssFor = (css: string) => structuralSpacesOverviewXml.replace(
      /<uic:css><!\[CDATA\[[\s\S]*?\]\]><\/uic:css>/u,
      `<uic:css><![CDATA[${css}]]></uic:css>`,
    );
    const overBudget = `:uic-scope { ${Array.from({ length: 90 }, (_value, index) => `--myne-over-${index}: ${index}px;`).join(" ")} }`;
    const cases = [
      ["global selector", "body { color: red; }", "uic/css/global-selector"],
      ["protected selector", '[data-uic-fallback-diagnostic] { display: block; }', "uic/css/protected-selector"],
      ["url value", ":uic-scope { background: url(https://example.test/a.png); }", "uic/css/url-forbidden"],
      ["import", '@import "https://example.test/x.css";', "uic/css/at-rule-forbidden"],
      ["unsafe property", ":uic-region(activeRail) { position: fixed; }", "uic/css/property-forbidden"],
      ["hiding value", ":uic-region(activeRail) { display: none; }", "uic/css/value-forbidden"],
      ["generic Myne selector hiding controls", ".myne-button { font-size: 0; color: transparent; max-width: 0; margin: -10000px; }", "uic/css/selector-forbidden"],
      ["transparent inherited text", ":uic-region(activeRail) { color: transparent; }", "uic/css/value-forbidden"],
      ["zero font", ":uic-region(activeRail) { font-size: 0; }", "uic/css/property-forbidden"],
      ["negative margin", ":uic-region(activeRail) { margin: -1rem; }", "uic/css/property-forbidden"],
      ["zero max width", ":uic-region(activeRail) { max-width: 0; }", "uic/css/property-forbidden"],
      ["over budget", overBudget, "uic/css/declaration-budget"],
    ] as const;

    for (const [name, css, code] of cases) {
      expect(compileUICScopedCss(spacesOverviewPageHeaderUICProof, cssFor(css), "uic.spaces.bad").diagnostics, name).toContainEqual(
        expect.objectContaining({ code }),
      );
      expect(validateUICXml(spacesOverviewPageHeaderUICProof, cssFor(css)).diagnostics, name).toContainEqual(
        expect.objectContaining({ code }),
      );
    }
  });

  it("rejects generic component refs, unknown slots, raw styling, and default children before mount", () => {
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, '<uic:component ref="x" />').diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/generic-component-forbidden" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace('name="actions"', 'name="footer"')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-slot" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:pageHeader ", '<uic:pageHeader class="p-2" ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/raw-style-forbidden" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:slot", "text<uic:slot")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/default-children-forbidden" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:pageHeader ", '<uic:unknown ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-tag" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:pageHeader ", '<uic:pageHeader version="1" ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/component-version-forbidden" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:pageHeaderAction ", '<uic:pageHeaderAction onPress="submit" ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/forbidden-prop" }),
    );
  });

  it("rejects every undeclared generated-tag attribute", () => {
    for (const attribute of ["onclick", "data-app-hooks", "dangerouslySetInnerHTML", "variant", "vendorProp", "unknown"]) {
      expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:pageHeader ", `<uic:pageHeader ${attribute}="x" `)).diagnostics).toContainEqual(
        expect.objectContaining({ code: "uic/xml/unknown-attribute" }),
      );
    }
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, pageHeaderXml.replace("<uic:slot ", '<uic:slot data-app-hooks="x" ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-attribute" }),
    );
  });

  it("allows only declared local UIC action bindings", () => {
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, fullSpacesOverviewXml).diagnostics).toEqual([]);
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, fullSpacesOverviewXml.replace("spaces.navigateToCraft", "spaces.deleteCraft")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-action" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, fullSpacesOverviewXml.replace("spaces.navigateToCraft", "https://example.test/action")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-action" }),
    );
    expect(validateUICXml(spacesOverviewPageHeaderUICProof, fullSpacesOverviewXml.replace("<uic:starredCraft ", '<uic:starredCraft onclick="alert(1)" ')).diagnostics).toContainEqual(
      expect.objectContaining({ code: "uic/xml/unknown-attribute" }),
    );
  });

  it("omits action IR when the generated tag has no action binding", async () => {
    const xml = fullSpacesOverviewXml
      .replaceAll(' uic:on-activate="spaces.navigateToCraft"', "")
      .replaceAll(' uic:on-resume="spaces.resumeSession"', "")
      .replaceAll(' uic:on-start="spaces.startSession"', "")
      .replaceAll(' uic:on-rename="spaces.renameSession"', "")
      .replaceAll(' uic:on-delete="spaces.deleteSession"', "")
      .replaceAll(' uic:on-stop="spaces.stopDevServer"', "")
      .replaceAll(' uic:on-open="spaces.openWorkspace"', "")
      .replaceAll(' uic:on-activate="spaces.openWorkspace"', "")
      .replaceAll(' uic:on-navigate="spaces.navigateToCraft"', "")
      .replaceAll(' uic:on-filter="spaces.filterWorkspaces"', "")
      .replaceAll(' uic:on-page="spaces.pageWorkspaces"', "")
      .replaceAll(' uic:on-page="spaces.pageRecentlyVisitedCraft"', "")
      .replaceAll(' uic:on-page="spaces.pageRecentlyCreatedCraft"', "")
      .replaceAll(' uic:on-close="spaces.dismissPicker"', "")
      .replaceAll(' uic:on-retry="spaces.retryOpenWorkspace"', "")
      .replaceAll(' uic:on-select="spaces.selectSpaceForWorkspace"', "");
    const compiled = await compileUICXml(spacesOverviewPageHeaderUICProof, xml);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("expected successful compile");
    expect(compiled.ir.nodes.find((node) => node.tag === "starredCraft")).not.toHaveProperty("actions");
    expect(compiled.ir.nodes.find((node) => node.tag === "recentlyVisitedCraft")).not.toHaveProperty("actions");
    expect(compiled.ir.nodes.find((node) => node.tag === "recentlyCreatedCraft")).not.toHaveProperty("actions");
    expect(compiled.ir.nodes.find((node) => node.tag === "workspaceList")).not.toHaveProperty("actions");
    expect(compiled.ir.nodes.find((node) => node.tag === "spaces")).not.toHaveProperty("actions");
    expect(compiled.ir.nodes.find((node) => node.tag === "spacePicker")).not.toHaveProperty("actions");
  });

  it("enforces the exact proof root and top-level structure before compiling", async () => {
    const cases = [
      ["missing root", pageHeaderXml.replace("<uic:spaceOverviewPage", "<uic:notRoot"), "uic/xml/root-required"],
      ["nested css", pageHeaderXml.replace("</uic:slot>", "</uic:slot><uic:css>bad</uic:css>"), "uic/xml/css-position"],
      ["extra sibling", `${pageHeaderXml}<uic:pageHeader />`, "uic/xml/single-root-required"],
      ["duplicate pageHeader", pageHeaderXml.replace("</uic:pageHeader>", "</uic:pageHeader><uic:pageHeader />"), "uic/xml/duplicate-node"],
      ["duplicate action", pageHeaderXml.replace("<uic:pageHeaderAction label=\"Start voyage\" />", '<uic:pageHeaderAction label="Start voyage" /><uic:pageHeaderAction label="Again" />'), "uic/xml/duplicate-node"],
      ["non-UIC element", pageHeaderXml.replace("</uic:slot>", "</uic:slot><div />"), "uic/xml/non-uic-element"],
      ["unsupported namespace", pageHeaderXml.replace("<uic:slot", "<x:slot"), "uic/xml/unsupported-namespace"],
    ] as const;

    for (const [, xml, code] of cases) {
      const compiled = await compileUICXml(spacesOverviewPageHeaderUICProof, xml);
      expect(compiled).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code })]) });
    }
  });

  it("records wrapper-first HeroUI policy without exposing vendor APIs", () => {
    const action = spacesOverviewPageHeaderUICProof.components.pageHeaderAction!;

    expect(action.adapter).toBe("wrapper");
    expect(action.externalLibrary).toEqual({ name: "HeroUI", exposure: "wrapped-only" });
    expect(action.props).toEqual(["label"]);
    expect(action.forbidden).toContain("className");
    expect(action.forbidden).toContain("onPress");
  });
});
