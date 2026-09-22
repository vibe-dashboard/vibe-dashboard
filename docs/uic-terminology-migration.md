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

## Boundary between UIC and existing `@myne` v1

Existing `@myne` v1 remains authoritative for production appearance and
composition compatibility until a separate migration is reviewed:

- `docs/myne-v1-contract.md` defines the current public appearance contract.
- `docs/myne-architecture.md` documents the checked-in component tree proof.
- `src/app-hooks/AppHooks.ts` still publishes `myne.spaces` and
  `myne.appearance`.
- `src/components/spaces-overview/SpacesOverview.composition.ts` still uses
  `myne.spaces.*` layout, view-pack, and component identifiers.
- `src/theme/skins/appearanceSnapshot.ts` still uses
  `myne.appearance.snapshot`, `myne.skin`, and `myne.composition`.
- `src/theme/skins/myne.css` still owns the production `myne-*` classes,
  `--myne-*` custom properties, and `myne.*` cascade layers.

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
| Composition IDs | `myne.spaces.layout.default`, `myne.spaces.page-header.default` | Preserve as trusted host IDs. UIC component descriptors map readable tags to these IDs internally. |
| View-pack IDs | `myne.spaces.view-pack.default` | Preserve until a separately reviewed persisted-format migration exists. |
| DOM/CSS hooks | `myne-root`, `myne-slot--workspace-list`, `--myne-*` | Preserve for production skins and histories. UIC CSS targets generated scope plus approved existing hooks/tokens. |
| Package/snapshot formats | `myne.appearance.snapshot` | Preserve; UIC templates are separately versioned artifacts, not appearance snapshots. |
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
grep -R "UI injection\\|ui-injection" -n docs src scripts
grep -R "@myne\\|myne\\." -n docs src scripts
grep -R "uic:" -n docs src scripts
```

Review each hit by category:

- allowed legacy compatibility reference;
- allowed product/browser-extension reference;
- allowed archival note;
- required rename to UIC for new framework/XML work.

No automated mass rename is approved by this decision because existing `myne.*`
runtime IDs are load-bearing compatibility identifiers.

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
