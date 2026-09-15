import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const scriptPath = join(projectRoot, "scripts/check-ui-customization-boundaries.mjs");

function writeFixture(root: string, overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "src/components/SpacesOverview.tsx":
      'export function SpacesOverview({ appHooks }) { appHooks.modules.get("myne.spaces").useSpacesOverview(); return <SkinRoot className="h-full w-full" state={skinState}>; }',
    "src/theme/skins/SkinEditorDialog.tsx":
      'export function SkinEditorContainer({ appHooks }) { appHooks.modules.get("myne.appearance").useSkinEditor(); return <SkinEditorDialog />; }',
    "src/app-hooks/AppHooks.ts":
      'import { useSyncExternalStore } from "react"; export interface AppHooksV1 { readonly contractVersion: 1 }',
    "src/components/spaces-overview/DefaultSpacesOverview.view.tsx": `
      import { MyneHeading, MyneText } from "../../theme/skins";
      export function DefaultSpacesOverviewLayout() {
        return <div data-myne-surface="spaces-overview" data-myne-view-pack="default">
          <div data-myne-slot="page-header"><MyneHeading level={1}>Dashboard</MyneHeading></div>
          <div data-myne-slot="workspace-list"><MyneText tone="secondary">Workspaces</MyneText></div>
        </div>;
      }
    `,
    "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx":
      '<div data-myne-slot="workspace-list"><span className="myne-text myne-text--primary">Dense</span></div>',
    "src/components/spaces-overview/RunningDevServersSection.view.tsx":
      '<div data-myne-slot="running-dev-servers"><span className="myne-status--success">Running</span></div>',
    "src/components/spaces-overview/SpacePickerModal.view.tsx":
      '<div data-myne-slot="space-picker-modal"><button className="myne-button">Open</button></div>',
    "src/components/spaces-overview/craftSections.view.tsx": `
      <div data-myne-slot="recent-sessions"></div>
      <div data-myne-slot="spaces-list"></div>
    `,
    "src/components/spaces-overview/workspaceList.view.tsx": `
      import { MyneAction, MyneRow } from "../../theme/skins";
      <MyneRow><span className="myne-text myne-text--primary">Workspace</span></MyneRow>
      <MyneAction>Open</MyneAction>
    `,
    "src/theme/skins/SkinEditorDialog.view.tsx": `
      import { MyneAction, MyneCard, MyneHeading, MyneText } from "./primitives.view";
      export function SkinEditorDialogView() {
        return <section data-myne-surface="skin-editor">
          <MyneCard data-myne-slot="skin-editor-library"><MyneHeading level={2}>Library</MyneHeading></MyneCard>
          <MyneCard data-myne-slot="skin-editor-editor"><MyneText>Editor</MyneText></MyneCard>
          <MyneCard data-myne-slot="skin-editor-preview"><MyneText>Preview</MyneText></MyneCard>
          <MyneCard data-myne-slot="skin-editor-import-export"><MyneAction>Import</MyneAction></MyneCard>
          <MyneCard data-myne-slot="skin-editor-diagnostics"><MyneText status="success">Valid</MyneText></MyneCard>
        </section>;
      }
    `,
    "src/theme/skins/primitives.view.tsx":
      'export const MyneText = () => <span className="myne-text myne-text--primary" />;',
    "src/theme/skins/SkinRoot.view.tsx":
      'export const SkinRootView = () => <div className="myne-theme" data-myne-skin="default" />;',
    "src/theme/skins/runtime.ts":
      'export const variables = { "--myne-color-foreground": "#fff" };',
    "src/theme/skins/myne.css": `
      .myne-text--primary {} .myne-text--secondary {} .myne-text--muted {}
      .myne-status--success {} .myne-status--warning {} .myne-status--danger {} .myne-status--accent {}
    `,
    "src/theme/skins/SkinEditorDialog.module.css": ".root {} .surface {}",
    "src/components/spaces-overview/SpacesOverview.composition.ts":
      "export const spacesOverviewCompositionRegistry = {}; export const defaultSpacesOverviewManifest = {}; export const denseSpacesOverviewManifest = {};",
    "src/theme/skins/SkinEditorDialog.composition.tsx":
      "export const skinEditorCompositionRegistry = {}; export const defaultSkinEditorManifest = {}; export const selectedSkinEditorComposition = {};",
    "src/components/spaces-overview/SpacesOverview.skin.module.css": `
      .surface { min-width: 0; }
    `,
    ...overrides,
  };

  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
}

describe("UI customization boundary check", () => {
  it("passes for migrated skinned views that use semantic hooks or shared primitives", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-pass-"));
    writeFixture(root);

    const output = execFileSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(output).toContain("UI customization boundary check passed");
  });

  it("fails with actionable output for hardcoded foreground color utilities", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-fail-"));
    writeFixture(root, {
      "src/components/spaces-overview/workspaceList.view.tsx":
        '<div className="text-zinc-100"><span>Workspace</span></div>',
    });

    const result = spawnSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Hardcoded skin-controlled utility \"text-zinc-100\"",
    );
    expect(result.stdout).toContain(
      "Use myne primitives, registered public classes, or inherited surface color",
    );
  });

  it("fails when major SpacesOverview skin hooks are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-hooks-"));
    writeFixture(root, {
      "src/components/spaces-overview/DefaultSpacesOverview.view.tsx":
        "<div>No stable SpacesOverview surface hook</div>",
    });

    const result = spawnSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Missing semantic hook "data-myne-surface="');
    expect(result.stdout).toContain('Missing semantic hook "data-myne-slot="');
  });

  it("fails when migrated containers hide host clients or views receive appHooks", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-dependencies-"));
    writeFixture(root, {
      "src/components/SpacesOverview.tsx":
        'import { vkClient } from "../lib/vk-client"; export function SpacesOverview() { return <div />; }',
      "src/theme/skins/SkinEditorDialog.view.tsx":
        'export function SkinEditorDialogView({ appHooks }) { return <section />; }',
    });

    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Migrated container imports a host implementation");
    expect(result.stdout).toContain("Presentation view references appHooks");
  });

  it("fails when the public AppHooks contract imports host or proof-surface types", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-app-hooks-"));
    writeFixture(root, {
      "src/app-hooks/AppHooks.ts":
        'import type { DashboardWorkspace } from "../components/spaces-overview/SpacesOverview.contracts"; export interface AppHooksV1 {}',
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Public AppHooks contract imports an implementation type");
  });

  it("fails when a migrated surface omits its typed registry or view-pack manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-composition-"));
    writeFixture(root, {
      "src/components/spaces-overview/SpacesOverview.composition.ts":
        "export const spacesOverviewCompositionRegistry = {};",
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing composition registration");
    expect(result.stdout).toContain("denseSpacesOverviewManifest");
  });

  it("fails when CSS Modules reach into public selectors", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-css-module-"));
    writeFixture(root, {
      "src/theme/skins/SkinEditorDialog.module.css":
        ".root :global(.myne-button) { color: red; }",
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("private CSS Module reaches into the public myne selector contract");
  });

  it("fails for stale public names and non-identity data-myne attributes", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-vocabulary-"));
    writeFixture(root, {
      "src/components/spaces-overview/RunningDevServersSection.view.tsx":
        '<div data-myne-status="success"><VDText>Running</VDText></div>',
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Stale VD customization vocabulary");
    expect(result.stdout).toContain("Variant or component state is encoded as a data-myne attribute");
  });
});

describe("CI UI customization wiring", () => {
  it("commits the OpenLint policy used by UI customization checks", () => {
    const policy = readFileSync(".github/openlint/openlint.yaml", "utf8");

    expect(policy).toContain("tsx-view-boundary:");
    expect(policy).toContain("ui-customization-fences:");
    expect(policy).toContain("openlint/no-intrinsic-jsx-outside-view");
    expect(policy).toContain("openlint/no-hooks-in-view");
    expect(policy).toContain("jsx/attribute-ban(attribute=style)");
  });

  it("exposes one local npm command for OpenLint fences and skinability checks", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["lint:tsx-view-boundary:migrated"]).toContain(
      "OPENLINT_POLICY_DIR=.github/openlint",
    );
    expect(packageJson.scripts["lint:tsx-view-boundary:migrated"]).toContain(
      "src/theme/skins/SkinEditorDialog.view.tsx",
    );
    expect(packageJson.scripts["lint:ui-fences:migrated"]).toContain(
      "OPENLINT_POLICY_DIR=.github/openlint",
    );
    expect(packageJson.scripts["lint:ui-fences:migrated"]).toContain(
      "src/theme/skins/SkinEditorDialog.view.tsx",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:tsx-view-boundary:migrated",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:ui-fences:migrated",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:skinability",
    );
  });

  it("runs the UI customization boundary command in CI on pushes and pull requests", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const uiJobStart = workflow.indexOf("  ui-customization-boundaries:");
    const nextJobStart = workflow.indexOf("\n  test-workflow-core:", uiJobStart);
    const uiJob = workflow.slice(uiJobStart, nextJobStart);

    expect(workflow).toContain("pull_request:");
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s+main/);
    expect(uiJob).toContain("ui-customization-boundaries:");
    expect(uiJob).not.toContain("repository: vibe-dashboard/open-lint");
    expect(uiJob).not.toContain("dtolnay/rust-toolchain@stable");
    expect(uiJob).toContain(
      "npm install --global @mickmister/openlint@0.1.0",
    );
    expect(uiJob).toContain("OPENLINT_POLICY_DIR: .github/openlint");
    expect(uiJob).toContain("npm run lint:ui-customization");
    expect(workflow).toContain("- ui-customization-boundaries");
  });
});
