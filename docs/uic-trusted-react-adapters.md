# UIC trusted React component references

Status: design/prototype slice for
`vkvw-8xaj.18.1.1 — Design trusted React component references and
external-library adapters for UIC XML`.

This slice is intentionally narrow: it first proved the SpacesOverview
`pageHeader` fixture, then expanded to a full SpacesOverview layout shell in
development and Storybook while preserving the existing React renderer as
fallback. The first UIC-owned component body is a read-only Running Dev Servers
region that consumes a trusted serializable resource projection. UIC still does
not own hooks, raw AppHooks, query clients, promises, or mutations.

## Registry model

UIC uses a host-owned trusted descriptor registry. XML packages never import
modules, npm packages, JSX, callbacks, React nodes, AppHooks, URLs, or vendor
APIs. Each descriptor declares:

- generated XML tag name;
- trusted host component ID or wrapper ID;
- surface/slot allowlist;
- serializable scalar props and binding paths;
- named slots and accepted child tags;
- forbidden raw props such as `class`, `className`, `style`, `onPress`, `href`,
  and polymorphic `as`;
- fallback behavior.

The current proof descriptor lives in `src/uic/trustedComponents.ts` and maps:

- `uic:pageHeader` and the other required SpacesOverview layout tags to
  existing trusted `myne.spaces.*` component IDs;
- `uic:pageHeaderAction` to wrapper ID `uic.heroui.button.action`.

The `myne.*` ID is an existing compatibility target, not XML authoring syntax.

## XML syntax

V1 uses generated readable tags only:

```xml
<uic:spaceOverviewPage
  xmlns:uic="https://vibedashboard.dev/uic/xml/v1"
  artifactVersion="1">
  <uic:css><![CDATA[
    :uic-scope { --myne-slot-page-header-gap: 1rem; }
  ]]></uic:css>
  <uic:pageHeader title="{model.title}" subtitle="{model.subtitle}">
    <uic:slot name="actions">
      <uic:pageHeaderAction label="Start voyage" />
    </uic:slot>
  </uic:pageHeader>
  <uic:recentSessions />
  <uic:starredCraft />
  <uic:runningDevServers />
  <uic:recentlyVisitedCraft />
  <uic:recentlyCreatedCraft />
  <uic:workspaceList />
  <uic:spaces />
  <uic:spacePicker />
</uic:spaceOverviewPage>
```

The prototype rejects generic `<uic:component ref="...">`, default/arbitrary
children, unknown slots, raw class/style props, executable XML features, and
unsupported namespaces before mount.

## Schema, digests, and IR

The trusted descriptor is the single source for generated XSD, semantic
validation, and canonical UIC IR. The compiled IR records:

- UIC artifact version;
- XML namespace;
- surface/root tag;
- generated schema digest;
- trusted registry digest;
- top-level co-located CSS text;
- resolved trusted component/wrapper IDs.

App-local authoring tags are unversioned in XML; compatibility is bound by the
generated schema and registry digests.

## Props, bindings, events, and slots

This first proof supports only literal scalar props, read-only `{model.*}`
bindings, and trusted-container resource projections. Named events/actions are
deferred until an interactive SpacesOverview slice needs them. Children are
named slots only; `actions` is the only `pageHeader` slot in this fixture.

The Running Dev Servers body uses a finite read-only resource state:

- `pending` renders a busy/loading message;
- `empty` renders an empty-state message;
- `ready` renders a bounded keyed list of workspace name, branch, and repo
  labels.

It deliberately omits stop/open/navigate controls. Those require
`vkvw-8xaj.18.4 — Expose typed AppHooks capabilities to UIC templates for
declarative pages`.

## External libraries and HeroUI

External libraries are wrapper-first. UIC never exposes the full HeroUI API.
Trusted application code may register narrow wrappers such as
`uic.heroui.button.action` with serializable props and named events. The wrapper
owns vendor props, accessibility defaults, portals/focus rules, and styling
constraints. Direct external component registration is not allowed in this
slice.

## Fallback behavior

Descriptor-declared node fallback is allowed only when it preserves semantics
and accessibility. Structural failures, unknown tags/slots, digest mismatch,
or fallback failure escalate to the enclosing trusted React slot/layout. The
Storybook proof intentionally renders the full existing SpacesOverview view
through public `myne-*` / `data-myne-*` hooks and reports validation diagnostics
while falling back to the trusted React layout.

## Current proof

- Core descriptor/XSD/IR proof: `src/uic/trustedComponents.ts`
- Focused tests: `src/uic/trustedComponents.test.ts`
- SpacesOverview dev fixture: `src/components/spaces-overview/SpacesOverview.uic.view.tsx`
- Storybook exposure: `Scenes/SpacesOverview/UIC layout shell proof`
- UIC-owned read-only region: Running Dev Servers loading/empty/ready states.

No Marketplace, persistence, package archive, production selection, broad page
migration, or runtime user exposure is included in this slice.

Next slices must sequence through:

- `vkvw-8xaj.18.4 — Expose typed AppHooks capabilities to UIC templates for
  declarative pages` before XML receives host capabilities or actions;
- `vkvw-8xaj.18.5 — Expose typed asynchronous resource state to UIC templates`
  before XML renders loading/error/empty/success branches directly;
- `vkvw-8xaj.18.6 — Evaluate Mitosis-inspired declarative control-flow
  directives for UIC XML` before XML owns iteration over workspace/session rows.
