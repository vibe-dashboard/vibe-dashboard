import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedSurfaces, publicMyneClasses, runtimeMyneTokens } from "./myne-contract-inventory.mjs";

const projectRoot = process.cwd();
const scriptPath = join(projectRoot, "scripts/check-ui-customization-boundaries.mjs");

function writeFixture(root: string, overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ scripts: { "lint:ui-fences:migrated": "ol check src/components/spaces-overview src/components/SpacesOverview.stories.tsx src/theme/skins/SkinEditorDialog.view.tsx src/theme/skins/SkinEditorDialog.stories.tsx" } }),
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
      <div data-myne-slot="starred-craft"></div>
      <div data-myne-slot="recently-visited-craft"></div>
      <div data-myne-slot="recently-created-craft"></div>
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
        return <section data-myne-surface="skin-editor" data-myne-view-pack="default">
          <header data-myne-slot="skin-editor-header"><MyneHeading level={1}>Editor</MyneHeading></header>
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
      runtimeMyneTokens.map(([, marker]) => `${marker}, value);`).join(" "),
    "src/theme/skins/myne.css": publicMyneClasses.map((className) => `.${className} {}`).join(" "),
    "src/theme/skins/SkinEditorDialog.module.css": ".root {} .surface {}",
    "src/components/spaces-overview/SpacesOverview.composition.ts":
      "export const spacesOverviewCompositionRegistry = { requiredSlots: spacesOverviewSlots }; export const defaultSpacesOverviewManifest = {}; export const denseSpacesOverviewManifest = {};",
    "src/theme/skins/SkinEditorDialog.composition.tsx":
      "export const skinEditorCompositionRegistry = { requiredSlots: skinEditorSlots }; export const defaultSkinEditorManifest = {}; export const selectedSkinEditorComposition = {};",
    "src/components/spaces-overview/SpacesOverview.skin.module.css": `
      .surface { min-width: 0; }
    `,
    "src/components/SpacesOverview.stories.tsx": "createSkinLabStories(); SpacesOverviewSkinLabStory();",
    "src/components/spaces-overview/SpacesOverview.composition.test.ts": 'it("rejects incomplete manifests"); it("swaps only compatible slots");',
    "src/components/spaces-overview/SpacesOverview.skin.test.ts": 'it("semantic surface and slot attributes"); it("view pack independently");',
    "src/theme/skins/SkinEditorDialog.stories.tsx": "createSkinLabStories(); SkinEditorStory();",
    "src/theme/skins/SkinEditorDialog.composition.test.ts": 'it("rejects extra slots"); it("compatible regional override");',
    "src/theme/skins/SkinEditorDialog.test.ts": 'it("stable semantic slots"); getByRole(); const x = "aria-pressed";',
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

  it.each(migratedSurfaces.flatMap((surface) => surface.slots))(
    "fails when required slot %s / %s is individually missing",
    (relativePath, slot) => {
      const root = mkdtempSync(join(tmpdir(), "ui-customization-slot-"));
      writeFixture(root);
      const path = join(root, relativePath);
      writeFileSync(path, readFileSync(path, "utf8").replace(`data-myne-slot="${slot}"`, "data-removed-slot"));
      const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`data-myne-slot="${slot}"`);
    },
  );

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

  it("fails when distinct public identifiers collide after normalization", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-identifiers-"));
    writeFixture(root, {
      "src/components/spaces-overview/SpacesOverview.composition.ts":
        'export const spacesOverviewCompositionRegistry = { "myne.spaces.foo_bar": 1, "myne.spaces.foo-bar": 2 }; export const defaultSpacesOverviewManifest = {}; export const denseSpacesOverviewManifest = {};',
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("normalize to the same value");
  });

  it("fails when a migrated surface is absent from deterministic OpenLint coverage", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-openlint-"));
    writeFixture(root, {
      "package.json": JSON.stringify({ scripts: { "lint:ui-fences:migrated": "ol check src/components/spaces-overview" } }),
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Migrated target");
  });

  it.each(migratedSurfaces.flatMap((surface) => surface.openLintTargets))(
    "fails when migrated target %s is individually uncovered",
    (target) => {
      const root = mkdtempSync(join(tmpdir(), "ui-customization-target-"));
      const allTargets = migratedSurfaces.flatMap((surface) => surface.openLintTargets).filter((candidate) => candidate !== target);
      writeFixture(root, { "package.json": JSON.stringify({ scripts: { "lint:ui-fences:migrated": `ol check ${allTargets.join(" ")}` } }) });
      const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`Migrated target "${target}"`);
    },
  );

  it("fails when canonical classes or typed tokens lack positive emitted output", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-output-"));
    writeFixture(root, {
      "src/theme/skins/myne.css": ".myne-text--primary {} .myne-text--secondary {} .myne-text--muted {} .myne-status--success {} .myne-status--warning {} .myne-status--danger {} .myne-status--accent {}",
      "src/theme/skins/runtime.ts": 'setVariable(style, "--myne-color-foreground", "#fff");',
    });
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Registered public class "myne-button" has no emitted selector');
    expect(result.stdout).toContain('Registered runtime token "--myne-color-accent" has no emitted assignment');
  });

  it.each(publicMyneClasses)("fails when canonical class %s is individually missing", (className) => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-class-"));
    writeFixture(root);
    const path = join(root, "src/theme/skins/myne.css");
    writeFileSync(path, readFileSync(path, "utf8").replace(`.${className} {}`, ""));
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Registered public class "${className}"`);
  });

  it.each(runtimeMyneTokens)("fails when canonical token %s is individually missing", (token, marker) => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-token-"));
    writeFixture(root);
    const path = join(root, "src/theme/skins/runtime.ts");
    writeFileSync(path, readFileSync(path, "utf8").replace(marker, "removedTokenMarker"));
    const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Registered runtime token "${token}"`);
  });

  it("fails when required story, accessibility, or compatibility evidence is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-evidence-"));
    writeFixture(root);
    const missingEvidence = join(root, "src/theme/skins/SkinEditorDialog.composition.test.ts");
    rmSync(missingEvidence);
    const check = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("Expected migrated UI customization target is missing");
    expect(check.stdout).toContain("SkinEditorDialog.composition.test.ts");
  });

  it.each(migratedSurfaces.flatMap((surface) => surface.evidence))(
    "fails when required evidence %s is empty or irrelevant",
    (relativePath) => {
      const root = mkdtempSync(join(tmpdir(), "ui-customization-empty-evidence-"));
      writeFixture(root, { [relativePath]: "export const irrelevant = true;" });
      const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Required evidence is missing assertion marker");
      expect(result.stdout).toContain(relativePath);
    },
  );

  it.each(migratedSurfaces.flatMap((surface) => surface.evidence.filter(([file]) => file.endsWith(".stories.tsx")).map(([file]) => file)))(
    "fails for stale identities and hardcoded skin values in production story %s",
    (storyPath) => {
      const root = mkdtempSync(join(tmpdir(), "ui-customization-story-"));
      writeFixture(root, { [storyPath]: 'createSkinLabStories(); SkinEditorStory(); SpacesOverviewSkinLabStory(); const id = "vd-user-stale"; <div className="bg-zinc-950" />;' });
      const result = spawnSync(process.execPath, [scriptPath, root], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Stale VD customization vocabulary");
      expect(result.stdout).toContain("Hardcoded skin-controlled utility");
    },
  );

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
    expect(policy).toContain("myne-local-contracts:");
    expect(policy).toContain("node scripts/openlint-myne-local.mjs");
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
