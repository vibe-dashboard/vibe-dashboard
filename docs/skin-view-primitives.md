# Historical proof: skin-aware view primitives

> **Do not implement new work from this document.** It records the initial proof
> architecture only. The names below were never a published compatibility
> contract. `docs/myne-v1-contract.md` defines the approved replacement.
> SpacesOverview and Skin Editor will migrate together, without retaining
> VD-era DOM/CSS aliases, under `vkvw-8xaj.3 — Adopt semantic HTML and generic
> class-based @myne skin hooks`. Do not add new VD-prefixed primitives,
> attributes, variables, or selectors.

The initial proof used `data-vd-*` attributes as the DOM hooks that global skins
targeted. Its authoring model avoided requiring every view file to hand-annotate
every element: shared skin-aware primitives emitted common semantic hooks so
views remained readable while the proof skins used stable selectors.

## Proof API

- `VDHeading`: renders an `h1`-`h4` with `data-vd-text="primary"` by default.
- `VDText`: renders `span`, `p`, or `div` text with `primary`, `secondary`,
  `muted`, or status semantics.
- `VDAction`: renders a native `button` with `data-vd-component="button"` and
  optional `data-vd-tone`.
- `VDBadge`: renders a `span` with `data-vd-component="badge"` and optional
  `data-vd-status`.
- `VDCard`: renders a `div` with `data-vd-component="card"`.
- `VDRow`: renders a `div` or native `button` with `data-vd-component="row"`.
- `VDIcon`: renders an `svg` with a named `data-vd-icon`.

## Proof inheritance guidance

The proof used plain text when the surface or parent component already supplied
the right foreground through inheritance and the text was not a semantic
exception. Its CI did not require every text node to carry `data-vd-text`.

## When the proof used an explicit hook

The proof used a primitive or explicit `data-vd-*` hook when the element was:

- a stable surface, slot, or component boundary that skins should target;
- primary/secondary/muted text inside a component that sets its own foreground;
- a status, action tone, badge, icon, or other semantic exception;
- part of a reusable view-pack contract.

## Historical CI implications

Milestone 4 checks were designed to enforce outcomes, not annotation count:

- ban hardcoded foreground color utilities in skinned view files;
- keep controller/view boundaries clean;
- allow primitives and inherited foregrounds to satisfy the semantic contract;
- avoid requiring blanket `data-vd-text` attributes.

The proof's combined local/CI boundary command was:

```sh
npm run lint:ui-customization
```

That command ran OpenLint's migrated view/controller and customization fence
presets, then ran the project-owned skinability check for migrated
SpacesOverview surfaces. The proof's OpenLint policy was committed in
`.github/openlint`, and CI provisioned the OpenLint CLI from the published
`@mickmister/openlint` npm package.
