# UIC trusted React component references

Status: design/prototype slice for
`vkvw-8xaj.18.1.1 — Design trusted React component references and
external-library adapters for UIC XML`.

This slice is intentionally narrow: it proves the SpacesOverview `pageHeader`
fixture only, in development and Storybook, while preserving the existing React
renderer as fallback. The delivery target remains complete SpacesOverview UIC
migration after this foundation is reviewed.

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

- `uic:pageHeader` to existing trusted ID
  `myne.spaces.page-header.default`;
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

This first proof supports only literal scalar props and read-only `{model.*}`
bindings. Named events/actions are deferred until an interactive
SpacesOverview slice needs them. Children are named slots only; `actions` is the
only `pageHeader` slot in this fixture.

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
Storybook proof intentionally renders through the existing public `myne-*` /
`data-myne-*` hooks and reports validation diagnostics while falling back to
the trusted React pageHeader.

## Current proof

- Core descriptor/XSD/IR proof: `src/uic/trustedComponents.ts`
- Focused tests: `src/uic/trustedComponents.test.ts`
- SpacesOverview dev fixture: `src/components/spaces-overview/SpacesOverview.uic.view.tsx`
- Storybook exposure: `Scenes/SpacesOverview/UIC pageHeader proof`

No Marketplace, persistence, package archive, production selection, broad page
migration, or runtime user exposure is included in this slice.
