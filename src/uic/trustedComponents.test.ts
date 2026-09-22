import { describe, expect, it } from "vitest";
import {
  compileUICXml,
  generateUICXsd,
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
  <uic:recentSessions />
  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />
  <uic:runningDevServers />
  <uic:recentlyVisitedCraft />
  <uic:recentlyCreatedCraft />
  <uic:workspaceList />
  <uic:spaces />
  <uic:spacePicker />
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
        { tag: "recentSessions", componentId: "myne.spaces.recent-sessions.default" },
        { tag: "starredCraft", componentId: "myne.spaces.starred-craft.default" },
        { tag: "runningDevServers", componentId: "myne.spaces.running-dev-servers.default" },
        { tag: "recentlyVisitedCraft", componentId: "myne.spaces.recently-visited.default" },
        { tag: "recentlyCreatedCraft", componentId: "myne.spaces.recently-created.default" },
        { tag: "workspaceList", componentId: "myne.spaces.workspace-list.default" },
        { tag: "spaces", componentId: "myne.spaces.spaces.default" },
        { tag: "spacePicker", componentId: "myne.spaces.space-picker.default" },
      ],
    });
    expect(compiled.ir.schemaDigest).toMatch(/^sha256-/);
    expect(compiled.ir.registryDigest).toMatch(/^sha256-/);
  });

  it("requires every SpacesOverview layout-shell tag exactly once before compile", async () => {
    const missingWorkspace = fullSpacesOverviewXml.replace("  <uic:workspaceList />\n", "");
    const duplicateSpaces = fullSpacesOverviewXml.replace("  <uic:spaces />", "  <uic:spaces />\n  <uic:spaces />");
    const reordered = fullSpacesOverviewXml.replace('  <uic:recentSessions />\n  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />', '  <uic:starredCraft uic:on-activate="spaces.navigateToCraft" />\n  <uic:recentSessions />');
    const extra = fullSpacesOverviewXml.replace("  <uic:spacePicker />", "  <uic:spacePicker />\n  <uic:unknownSection />");

    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, missingWorkspace)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/missing-required-node" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, duplicateSpaces)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/duplicate-node" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, reordered)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/slot-order" })]) });
    await expect(compileUICXml(spacesOverviewPageHeaderUICProof, extra)).resolves.toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "uic/xml/unknown-tag" })]) });
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
