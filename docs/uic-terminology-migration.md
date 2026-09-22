# UIC terminology and migration decision

Status: design decision for `vkvw-8xaj.18.3 — Rename the UI injection
framework and XML vocabulary to UIC`.

This document freezes the naming boundary before any UIC implementation work.
It does **not** rename existing persisted `myne.*` identifiers, DOM classes, CSS
custom properties, snapshot formats, revision streams, or appearance history.
Those names are part of the approved Milestone 1–3 compatibility baseline.

## Decision

Use **UIC** (“UI Injection Contract”) for the framework, XML authoring language,
schemas, runtime descriptors, canonical template IR, diagnostics, and future
developer tools. Reserve **Myne** for the browser-extension/product experience
and for existing `@myne` appearance compatibility identifiers.

The first implementation sequence is:

1. finish this terminology decision;
2. design and prototype UIC XML on this cleaned branch;
3. expose UIC only in development and Storybook until the whole
   SpacesOverview layout is stable;
4. keep React fallbacks available while UIC is being proven;
5. defer Marketplace work until the UIC baseline is stable.

## Canonical vocabulary

| Layer | Canonical new name | Compatibility rule |
| --- | --- | --- |
| Framework | UIC / UI Injection Contract | Do not introduce new framework-level `Myne` names. |
| XML prefix | `uic:` | Required for authored UIC XML. |
| XML namespace URI | `https://vibedashboard.dev/uic/xml/v1` | Versioned by URI path. A future incompatible XML grammar uses a new URI. |
| Generated schema files | `uic-*.xsd` | XSD validates XML shape; semantic validation still checks contracts and digests. |
| Runtime descriptors | UIC component/surface descriptors | New descriptors use UIC naming even when they point at legacy `myne.*` component IDs. |
| Canonical IR | UIC IR v1 | Persist/hash IR with explicit UIC schema version and registry/schema digests. |
| Component authoring tags | generated readable `uic:*` tags | No generic `<uic:component ref="...">` in v1. |
| Slots | named UIC slots only | No default/arbitrary children in v1. |
| CSS in UIC files | top-level co-located UIC CSS section | CSS remains scoped/validated and must emit approved existing `--myne-*` runtime tokens until a separate token migration is approved. |
| Browser-extension product | Myne | Product docs and UX may say “Myne uses UIC”. |
| Existing app customization contract | `@myne` v1 | Remains the approved Milestone 1–3 appearance/composition compatibility contract. |

## Future UIC package and API naming scheme

UIC framework-level code uses UIC names even when it adapts to existing
`@myne` v1 compatibility IDs.

| Artifact | Required naming |
| --- | --- |
| Source directories | Prefer `src/uic/**` for shared parser, descriptors, schema generation, IR, diagnostics, and render helpers. Surface-specific UIC adapters may live beside their surface, for example `src/components/spaces-overview/uic/**`, when that keeps proof code reviewable. |
| Documentation | Use `docs/uic-*.md` for UIC framework/XML documents. Keep `docs/myne-*.md` only for existing appearance compatibility and product/extension work. |
| Tests and fixtures | Use `*.uic.test.ts`, `*.uic.fixture.xml`, `*.uic.ir.json`, and Storybook story names containing `UIC`, not `Myne`, for new XML-template proof code. |
| Generated XML schema | `uic-<surface>-v<version>.xsd`. |
| Generated semantic descriptors | `uic-<surface>-descriptor-v<version>.json`. |
| Generated editor metadata | `uic-<surface>-editor-v<version>.json`. |
| Canonical IR artifacts | `uic-<surface>-ir-v<version>.json`; canonical digests are over the normalized IR plus registry/schema/compiler metadata. |
| Registry names | `UICSurfaceRegistry`, `UICComponentRegistry`, `UICDescriptorRegistry`, and `createUICRegistry` style APIs. Avoid new `Myne*Registry` names for UIC framework code. |
| TypeScript API prefixes | `UIC*` for exported framework types and functions, for example `UICTemplateIR`, `UICDiagnostic`, `defineUICComponent`, `compileUICXml`. |
| Diagnostic prefixes | Human-readable diagnostics use `UIC####` or `uic/<category>` codes, for example `UIC1001` / `uic/schema/unknown-tag`. |
| Runtime CSS scope naming | UIC CSS source sections may use UIC source concepts such as `:uic-scope`; compiled output must still target approved existing `myne-*`, `data-myne-*`, and `--myne-*` runtime compatibility hooks until a separate token migration is approved. |
| npm package names | Framework packages use application-owned UIC names if package extraction is approved later, for example `@vibedashboard/uic-core`, `@vibedashboard/uic-xml`, and `@vibedashboard/uic-react`. New framework-level `@myne/*` package names are forbidden. |
| Product package names | `@myne/*` remains reserved for a future Myne browser-extension product or compatibility shims and must not be used for new host-framework XML/runtime packages. |

## Boundary between UIC and existing `@myne` v1

Existing `@myne` v1 remains authoritative for production appearance and
composition compatibility until a separate migration is reviewed:

- `docs/myne-v1-contract.md` defines the current public appearance contract.
- `docs/myne-architecture.md` documents the checked-in component tree proof.
- `src/app-hooks/AppHooks.ts` still publishes `myne.spaces` and
  `myne.appearance`.
- `src/components/spaces-overview/SpacesOverview.composition.ts` still uses
  `myne.spaces.*` layout, view-pack, and component identifiers.
- `src/theme/skins/SkinEditorDialog.composition.tsx` still uses
  Skin Editor composition identifiers such as
  `myne.appearance.layout.dialog`, `myne.appearance.header.default`,
  `myne.appearance.library.default`,
  `myne.appearance.token-editor.default`,
  `myne.appearance.preview.default`,
  `myne.appearance.import-export.default`,
  `myne.appearance.diagnostics.default`,
  `myne.appearance.diagnostics.compact`,
  `myne.appearance.view-pack.default`, and
  `myne.appearance.view-pack.compact-diagnostics`.
- `src/theme/skins/appearanceSnapshot.ts` still uses
  `myne.appearance.snapshot`, `myne.skin`, and `myne.composition`.
- `src/theme/skins/appearanceRevisions.ts` still uses the current revision
  stream ID `myne.appearance.global`.
- `src/theme/skins/builtin.ts` still owns built-in skin IDs such as
  `myne-default-dark`, `myne-light-studio`, and
  `myne-high-contrast-terminal`; tests and import flows still use
  user/custom skin IDs such as `myne-user-*`.
- `src/theme/skins/myne.css` still owns the production `myne-*` classes,
  `--myne-*` custom properties, and `myne.*` cascade layers.
- `src/theme/skins/scopedCss.ts` still owns current compiler/policy constants
  such as `MYNE_SCOPED_CSS_COMPILER_VERSION` and
  `MYNE_SCOPED_CSS_POLICY_VERSION`, current public identity allowlists for
  `data-myne-surface`, `data-myne-slot`, `data-myne-skin`, and
  `data-myne-view-pack`, host scope attributes such as
  `data-myne-package-scope`, and compiled artifact attributes such as
  `data-myne-compiled-artifact`.
- `scripts/myne-contract-inventory.mjs`,
  `scripts/openlint-myne-local.mjs`, and
  `scripts/check-ui-customization-boundaries.mjs` still enforce the current
  Milestone 1–3 `@myne` public DOM/CSS contract.
- Storybook and test fixtures such as `src/components/SpacesOverview.stories.tsx`,
  `src/theme/skins/SkinEditorDialog.stories.tsx`, and related
  `*.test.ts(x)` files may continue to mention `myne.*` and `myne-*` when they
  prove existing compatibility behavior.

UIC descriptors may reference those compatibility identifiers because they are
the current trusted host inventory. That is an adapter boundary, not a reason to
name new UIC concepts `Myne`.

## XML example

Readable generated tags are the only v1 component syntax:

```xml
<uic:spaceOverviewPage
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  artifactVersion="1">
  <uic:css><![CDATA[
    :uic-scope {
      --myne-slot-page-header-gap: 1rem;
    }
  ]]></uic:css>

  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="{model.primaryActionLabel}" />
    </uic:slot>
  </uic:pageHeader>
</uic:spaceOverviewPage>
```

The example is illustrative only: generated descriptors decide the exact tag
names, attributes, binding paths, named slots, and fallback behavior.

## Rename inventory

| Current artifact family | Current examples | UIC treatment |
| --- | --- | --- |
| Historical planning docs | `docs/ui-customization-implementation-plan.md` | Leave archival; add no new requirements there. |
| Approved v1 appearance docs | `docs/myne-v1-contract.md`, `docs/myne-architecture.md`, `docs/myne-scoped-css-security.md`, `docs/myne-appearance-revisions.md` | Keep `@myne` where describing Milestone 1–3 production compatibility; add cross-links to this UIC decision when discussing future XML authoring. |
| AppHooks module IDs | `myne.spaces`, `myne.appearance` | Preserve for Milestone 3 compatibility; UIC containers consume projected data, not raw hooks. |
| SpacesOverview composition IDs | `myne.spaces.layout.default`, `myne.spaces.page-header.default`, `myne.spaces.running-dev-servers.default`, `myne.spaces.workspace-list.default`, `myne.spaces.workspace-list.dense` | Preserve as trusted host IDs. UIC component descriptors map readable tags to these IDs internally. |
| SpacesOverview view-pack IDs | `myne.spaces.view-pack.default`, `myne.spaces.view-pack.dense-workspace-list` | Preserve until a separately reviewed persisted-format migration exists. |
| Skin Editor composition IDs | `myne.appearance.layout.dialog`, `myne.appearance.header.default`, `myne.appearance.library.default`, `myne.appearance.token-editor.default`, `myne.appearance.preview.default`, `myne.appearance.import-export.default`, `myne.appearance.diagnostics.default`, `myne.appearance.diagnostics.compact` | Preserve as trusted host IDs for the current proof surface. UIC work must not rename them incidentally. |
| Skin Editor view-pack IDs | `myne.appearance.view-pack.default`, `myne.appearance.view-pack.compact-diagnostics` | Preserve as current compatibility IDs. |
| Revision stream IDs | `myne.appearance.global` | Preserve; changing the stream ID would be a persistence migration requiring restart, rollback, backup/corruption, and history-chain tests. |
| Built-in skin IDs | `myne-default-dark`, `myne-light-studio`, `myne-high-contrast-terminal` | Preserve as package/skin compatibility IDs. |
| User/imported skin IDs | `myne-user-*` | Preserve accepted user-skin namespace and validation behavior. |
| DOM/CSS classes and tokens | `myne-root`, `myne-surface`, `myne-slot--workspace-list`, `myne-card`, `myne-action`, `--myne-*`, `@layer myne.*` | Preserve for production skins and histories. UIC CSS targets generated scope plus approved existing hooks/tokens. |
| Public identity attributes | `data-myne-surface`, `data-myne-slot`, `data-myne-skin`, `data-myne-view-pack` | Preserve sparse public identities; do not introduce parallel `data-uic-*` identities without a separate styling-token migration. |
| Protected/scope/artifact attributes | `data-myne-protected`, `data-myne-protected-status`, `data-myne-package-scope`, `data-myne-compiled-artifact` | Preserve because compiler/runtime safety and protected UI tests depend on them. |
| Compiler/policy constants | `MYNE_SCOPED_CSS_COMPILER_VERSION`, `MYNE_SCOPED_CSS_POLICY_VERSION`, current scoped-CSS policy names | Preserve until a separately reviewed appearance compiler policy migration exists. UIC template compiler constants should use `UIC_*` names. |
| Package/snapshot formats | `myne.appearance.snapshot`, `myne.skin`, `myne.composition` | Preserve; UIC templates are separately versioned artifacts, not appearance snapshots. |
| Scripts/checkers | `scripts/myne-contract-inventory.mjs`, `scripts/openlint-myne-local.mjs`, `scripts/check-ui-customization-boundaries.mjs` | Preserve to enforce existing appearance compatibility. Add UIC-specific guardrails rather than weakening these scripts. |
| Storybook/test fixtures | `src/components/SpacesOverview.stories.tsx`, `src/theme/skins/SkinEditorDialog.stories.tsx`, `src/stories/skinLab.ts`, compatibility tests | Preserve `myne.*` references when fixtures assert current production compatibility. New UIC fixture/story names use UIC. |
| Marketplace artifacts | deferred | Do not add Marketplace/UIC distribution coupling in this branch. |
| Browser-extension product | Myne | Product may say “Myne templates are powered by UIC”. |

## Compatibility and migration rules

1. New XML, schema, descriptors, validators, tests, diagnostics, and Storybook
   labels use UIC terminology.
2. Existing persisted `myne.*` wire IDs remain accepted and emitted by current
   production workflows.
3. A future persisted-ID migration requires a separate bead with restart,
   rollback, history, and corruption-recovery tests.
4. UIC artifacts record the exact UIC XML namespace version, generated XSD
   digest, semantic descriptor digest, trusted registry digest, and compiler
   version used to produce the IR.
5. Unknown UIC namespaces or descriptor digests fail before mount and fall back
   to the enclosing trusted React slot/layout during the proof.
6. The first UIC implementation may map UIC tags to existing `myne.*`
   composition IDs, but must not expose those IDs as the XML authoring syntax.

## Searchability and collision checks

Use these checks during review and before closing the rename decision:

```bash
npm run lint:ui-customization
npm run lint:skinability
grep -R "UI injection\\|ui-injection" -n docs src scripts
grep -R "@myne\\|myne\\." -n docs src scripts
grep -R "Myne\\|MYNE_\\|myne-" -n docs src scripts
grep -R "uic:\\|UIC\\|uic-" -n docs src scripts
```

Review each hit by category:

- allowed legacy compatibility reference;
- allowed product/browser-extension reference;
- allowed archival note;
- required rename to UIC for new framework/XML work.

No automated mass rename is approved by this decision because existing `myne.*`
runtime IDs are load-bearing compatibility identifiers.

Before `vkvw-8xaj.18.3 — Rename the UI injection framework and XML vocabulary
to UIC` closes, the reviewer should confirm that every `Myne`/`myne` hit in
new UIC files is either an allowed adapter to an existing compatibility ID or
product/browser-extension language. If this remains manual at close time, create
a focused checker bead before UIC implementation for a pre-close command such
as:

```bash
node scripts/check-uic-terminology-boundary.mjs
```

The named future checker must fail on framework-level additions such as:

- `src/uic/**` exporting `Myne*`, `MYNE_*`, or `@myne/*` framework APIs;
- generated UIC XML/schema/IR files using `myne` as their namespace, prefix, or
  diagnostic family;
- new UIC tests/stories named as Myne framework fixtures;
- new package names under `@myne/*` for UIC framework/runtime modules;
- new `data-uic-*` or `--uic-*` styling hooks that bypass the approved current
  `@myne` appearance contract without a separate token migration.

Allowed exceptions must be explicit and narrow:

- references to current compatibility IDs listed in the rename inventory;
- existing `@myne` v1 docs, scripts, tests, and fixtures that enforce Milestone
  1–3 behavior;
- Myne browser-extension/product copy;
- archival text that is clearly marked non-normative.

## Implementation sequencing

1. Close `vkvw-8xaj.18.3 — Rename the UI injection framework and XML vocabulary
   to UIC` after independent review of this decision.
2. Then implement `vkvw-8xaj.18.1.1 — Design trusted React component references
   and external-library adapters for UIC XML` / `vkvw-8xaj.18.1.2 — Design
   trusted React component references and library adapters for UIC XML`, using
   generated readable tags, named slots, wrapper-first adapters, top-level CSS,
   development/Storybook exposure, and React fallback.
3. Then implement `vkvw-8xaj.18.1 — Design and prototype the @myne XML
   declarative view-pack DSL`, treating the title’s `@myne` wording as legacy
   bead text and UIC as the actual framework vocabulary.
4. The whole SpacesOverview layout is the delivery target. `pageHeader` may be
   the first fixture only.

## Objective acceptance checks

- New UIC implementation files avoid framework-level `Myne` names unless they
  are compatibility adapters to existing `myne.*` IDs.
- Generated XML examples use `uic:` tags and
  `https://vibedashboard.dev/uic/xml/v1`.
- UIC artifacts are distinct from appearance snapshot/package formats.
- Existing Milestone 3 appearance histories and `myne.*` runtime identifiers
  keep passing without migration.
- Marketplace implementation remains deferred.
