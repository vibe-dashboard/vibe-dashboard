#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? process.cwd());

const migratedSurfaces = [
  {
    id: "spaces-overview",
    openLintTarget: "src/components/spaces-overview",
    composition: "src/components/spaces-overview/SpacesOverview.composition.ts",
    compositionMarkers: ["spacesOverviewCompositionRegistry", "defaultSpacesOverviewManifest", "denseSpacesOverviewManifest"],
    views: [
      "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
      "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx",
      "src/components/spaces-overview/RunningDevServersSection.view.tsx",
      "src/components/spaces-overview/SpacePickerModal.view.tsx",
      "src/components/spaces-overview/craftSections.view.tsx",
      "src/components/spaces-overview/workspaceList.view.tsx",
    ],
    styles: ["src/components/spaces-overview/SpacesOverview.skin.module.css"],
    evidence: [
      "src/components/SpacesOverview.stories.tsx",
      "src/components/spaces-overview/SpacesOverview.composition.test.ts",
      "src/components/spaces-overview/SpacesOverview.skin.test.ts",
    ],
  },
  {
    id: "skin-editor",
    openLintTarget: "src/theme/skins/SkinEditorDialog.view.tsx",
    composition: "src/theme/skins/SkinEditorDialog.composition.tsx",
    compositionMarkers: ["skinEditorCompositionRegistry", "defaultSkinEditorManifest", "selectedSkinEditorComposition"],
    views: ["src/theme/skins/SkinEditorDialog.view.tsx"],
    styles: ["src/theme/skins/SkinEditorDialog.module.css"],
    evidence: [
      "src/theme/skins/SkinEditorDialog.stories.tsx",
      "src/theme/skins/SkinEditorDialog.composition.test.ts",
      "src/theme/skins/SkinEditorDialog.test.ts",
    ],
  },
];
const skinnedViewFiles = migratedSurfaces.flatMap((surface) => surface.views);

const hardcodedSkinColorUtility =
  /\b(?:hover:|group-hover:|disabled:hover:)?(?:text|bg|border(?:-[trblxy])?)-(?:white|black|zinc|slate|gray|neutral|stone|red|green|amber|yellow|blue|cyan|indigo|violet|purple|pink|primary)(?:-[^\s"`']+)?/g;

const requiredHooks = [
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-myne-surface=',
    rationale: "SpacesOverview needs a stable surface hook for global skin targeting.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-myne-view-pack=',
    rationale: "View-pack variants need a stable identifier for proofs and targeted styling.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-myne-slot="page-header"',
    rationale: "The page header is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-myne-slot="workspace-list"',
    rationale: "The workspace list is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/craftSections.view.tsx",
    hook: 'data-myne-slot="recent-sessions"',
    rationale: "Recent sessions are part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/craftSections.view.tsx",
    hook: 'data-myne-slot="spaces-list"',
    rationale: "Spaces list is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-surface="skin-editor"',
    rationale: "Skin Editor needs a stable surface hook for global skin targeting.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-slot="skin-editor-library"',
    rationale: "Skin Editor library is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-slot="skin-editor-editor"',
    rationale: "Skin Editor token editor is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-slot="skin-editor-preview"',
    rationale: "Skin Editor preview is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-slot="skin-editor-import-export"',
    rationale: "Skin Editor import/export is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-myne-slot="skin-editor-diagnostics"',
    rationale: "Skin Editor diagnostics are part of the stable Skin Editor skin contract.",
  },
];

const requiredSkinSelectors = [
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-text--primary',
    rationale: "Primary text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-text--secondary',
    rationale: "Secondary text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-text--muted',
    rationale: "Muted text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-status--success',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-status--warning',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-status--danger',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/theme/skins/myne.css",
    hook: '.myne-status--accent',
    rationale: "Accent foreground colors must remain skin-controlled.",
  },
];

const representativePrimitiveFiles = [
  "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
  "src/components/spaces-overview/workspaceList.view.tsx",
  "src/theme/skins/SkinEditorDialog.view.tsx",
];
const publicClassDefinitions = [
  "myne-button",
  "myne-card",
  "myne-row",
  "myne-state",
  "myne-status",
  "myne-text--primary",
];
const emittedTokenAssignments = [
  "--myne-color-background",
  "--myne-color-foreground",
  "--myne-color-accent",
  "--myne-color-danger",
];

const findings = [];
const packageSource = readProjectFile("package.json");
if (packageSource !== null) {
  const scripts = JSON.parse(packageSource).scripts ?? {};
  const openLintCommand = scripts["lint:ui-fences:migrated"] ?? "";
  for (const surface of migratedSurfaces) {
    if (!openLintCommand.includes(surface.openLintTarget)) findings.push({
      filePath: "package.json",
      message: `Migrated surface "${surface.id}" is not covered by the deterministic OpenLint target list.`,
      guidance: `Add ${surface.openLintTarget} to lint:ui-fences:migrated.`,
    });
  }
}

for (const surface of migratedSurfaces) {
  const composition = readProjectFile(surface.composition);
  if (composition === null) continue;
  for (const marker of surface.compositionMarkers) {
    if (!composition.includes(marker)) findings.push({
      filePath: surface.composition,
      message: `Surface ${surface.id} is missing composition registration "${marker}".`,
      guidance: "Register layouts, compatible slot components, and view packs in the typed surface manifest.",
    });
  }
  const identifiers = [...new Set([...composition.matchAll(/["'](myne\.[a-zA-Z0-9._-]+)["']/g)].map((match) => match[1]))];
  const normalizedIdentifiers = new Map();
  for (const identifier of identifiers) {
    const normalized = identifier.toLowerCase().replaceAll("_", "-");
    const existing = normalizedIdentifiers.get(normalized);
    if (existing && existing !== identifier) findings.push({
      filePath: surface.composition,
      message: `Public identifiers "${existing}" and "${identifier}" normalize to the same value.`,
      guidance: "Canonical registered identifiers must remain unique after lowercase and separator normalization.",
    });
    normalizedIdentifiers.set(normalized, identifier);
  }
  for (const evidenceFile of surface.evidence) readProjectFile(evidenceFile);
}

const publicCss = readProjectFile("src/theme/skins/myne.css");
if (publicCss !== null) {
  for (const className of publicClassDefinitions) {
    if (!publicCss.includes(`.${className}`)) findings.push({
      filePath: "src/theme/skins/myne.css",
      message: `Registered public class "${className}" has no emitted selector.`,
      guidance: "Every canonical public class needs a positive emitted-output assertion in the shared public layer.",
    });
  }
}
const runtimeSource = readProjectFile("src/theme/skins/runtime.ts");
if (runtimeSource !== null) {
  for (const token of emittedTokenAssignments) {
    if (!runtimeSource.includes(`setVariable(style, "${token}"`)) findings.push({
      filePath: "src/theme/skins/runtime.ts",
      message: `Registered runtime token "${token}" has no emitted assignment.`,
      guidance: "Compile canonical typed tokens to their exact --myne-* runtime properties.",
    });
  }
}

const migratedRuntimeFiles = [
  ...skinnedViewFiles,
  "src/theme/skins/primitives.view.tsx",
  "src/theme/skins/SkinRoot.view.tsx",
  "src/theme/skins/runtime.ts",
  "src/theme/skins/myne.css",
  "src/components/spaces-overview/SpacesOverview.skin.module.css",
  "src/theme/skins/SkinEditorDialog.module.css",
];
for (const filePath of migratedRuntimeFiles) {
  const source = readProjectFile(filePath);
  if (source && /(?:data-vd-|--vd-|\bVD(?:Action|Badge|Card|Heading|Icon|Row|Text|Skin)|\bVD_SKIN\b|DEFAULT_VD_SKIN|BUILT_IN_VD_SKINS)/.test(source)) findings.push({
    filePath,
    message: "Stale VD customization vocabulary remains in a migrated runtime path.",
    guidance: "Use registered myne classes, exact data-myne identities, and --myne-* runtime properties.",
  });
}

for (const filePath of migratedSurfaces.flatMap((surface) => surface.styles)) {
  const source = readProjectFile(filePath);
  if (source && /:global|\.myne-|\[data-myne-/.test(source)) findings.push({
    filePath,
    message: "A private CSS Module reaches into the public myne selector contract.",
    guidance: "Keep public myne classes and exact identity selectors in myne.css; CSS Modules may style only their local root classes.",
  });
}

for (const filePath of skinnedViewFiles) {
  const source = readProjectFile(filePath);
  if (source && /data-myne-(?:component|text|muted|status|tone|icon)=?/.test(source)) findings.push({
    filePath,
    message: "Variant or component state is encoded as a data-myne attribute.",
    guidance: "Reserve data-myne for exact surface, slot, skin, and view-pack identities; use registered classes and native/ARIA state.",
  });
}

const injectedContainers = [
  "src/components/SpacesOverview.tsx",
  "src/theme/skins/SkinEditorDialog.tsx",
];
const forbiddenHostImport =
  /from\s+["'][^"']*(?:vk-client|springboard|useModule|rpc|server-action|navigation)[^"']*["']/i;
const forbiddenPublicContractImport =
  /from\s+["'][^"']*(?:components|theme\/skins|vk-client|springboard|useModule|rpc|store|server-action|navigation)[^"']*["']/i;

for (const filePath of ["src/app-hooks/AppHooks.ts"]) {
  const source = readProjectFile(filePath);
  if (source !== null && forbiddenPublicContractImport.test(source)) {
    findings.push({
      filePath,
      message: "Public AppHooks contract imports an implementation type.",
      guidance: "Define narrow readonly semantic DTOs in the public app-hooks boundary and translate in host adapters and containers.",
    });
  }
}

for (const filePath of injectedContainers) {
  const source = readProjectFile(filePath);
  if (source === null) continue;
  if (forbiddenHostImport.test(source)) {
    findings.push({
      filePath,
      message: "Migrated container imports a host implementation.",
      guidance: "Receive the complete AppHooksV1 envelope through props; keep host imports in composition adapters.",
    });
  }
  if (!source.includes("appHooks")) {
    findings.push({
      filePath,
      message: "Migrated container does not expose the AppHooksV1 prop boundary.",
      guidance: "High-level plugin containers must receive appHooks explicitly through props.",
    });
  }
}

for (const filePath of skinnedViewFiles) {
  const source = readProjectFile(filePath);
  if (source === null) continue;
  if (source.includes("appHooks")) {
    findings.push({
      filePath,
      message: "Presentation view references appHooks.",
      guidance: "Presentation views receive semantic models and actions only.",
    });
  }
  if (forbiddenHostImport.test(source)) {
    findings.push({
      filePath,
      message: "Presentation view imports a host implementation.",
      guidance:
        "Presentation views may import presentation contracts only, never host hooks, stores, clients, RPC, actions, or navigation implementations.",
    });
  }
}

for (const filePath of skinnedViewFiles) {
  const source = readProjectFile(filePath);
  if (source === null) continue;

  for (const match of source.matchAll(hardcodedSkinColorUtility)) {
    findings.push({
      filePath,
      message: `Hardcoded skin-controlled utility "${match[0]}" found in a migrated skinned view.`,
      guidance:
        "Use myne primitives, registered public classes, or inherited surface color instead of hardcoded foreground color classes.",
    });
  }
}

for (const requirement of [...requiredHooks, ...requiredSkinSelectors]) {
  const source = readProjectFile(requirement.filePath);
  if (source === null) continue;

  if (!source.includes(requirement.hook)) {
    findings.push({
      filePath: requirement.filePath,
      message: `Missing semantic hook "${requirement.hook}".`,
      guidance: requirement.rationale,
    });
  }
}

for (const filePath of representativePrimitiveFiles) {
  const source = readProjectFile(filePath);
  if (source === null) continue;

  if (!/from\s+["'](?:\.\.\/\.\.\/theme\/skins|\.\/primitives\.view)["']/.test(source)) {
    findings.push({
      filePath,
      message: "Missing shared skin primitive import.",
      guidance:
        "Use framework-first myne primitives where they fit; reserve data-myne attributes for exact identities.",
    });
  }
}

const skinRootSource = readProjectFile("src/components/SpacesOverview.tsx");
if (skinRootSource !== null && !/<SkinRoot[^>]*className="h-full w-full"/.test(skinRootSource)) {
  findings.push({
    filePath: "src/components/SpacesOverview.tsx",
    message: "SpacesOverview SkinRoot must preserve the full-height/full-width wrapper.",
    guidance:
      'Keep className="h-full w-full" at the SpacesOverview SkinRoot usage unless layout ownership changes intentionally.',
  });
}

if (findings.length > 0) {
  console.log("UI customization boundary check failed:");
  for (const finding of findings) {
    console.log(`- ${finding.filePath}: ${finding.message}`);
    console.log(`  ${finding.guidance}`);
  }
  process.exit(1);
}

console.log("UI customization boundary check passed.");

function readProjectFile(filePath) {
  const absolutePath = resolve(projectRoot, filePath);
  if (!existsSync(absolutePath)) {
    findings.push({
      filePath,
      message: "Expected migrated UI customization target is missing.",
      guidance:
        "Update scripts/check-ui-customization-boundaries.mjs when migrated skin targets are intentionally renamed or moved.",
    });
    return null;
  }

  return readFileSync(absolutePath, "utf8");
}
