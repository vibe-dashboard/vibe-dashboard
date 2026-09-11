# `@myne` v1 app customization contract

Status: approved implementation contract for the first app migration

Contract version: 1

Initial conformance surfaces: SpacesOverview and Skin Editor

## 1. Purpose and status language

`@myne` is the public contract through which a host application exposes
replaceable presentation and user-controlled appearance without exposing its
private application implementation. The v1 contract is deliberately proven by
this application first. It avoids assumptions that would prevent another host
or future browser tooling from implementing the same vocabulary, but it does
not attempt to standardize arbitrary websites in v1.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative requirements when written in uppercase.

This document separates:

- **Normative v1:** compatibility requirements for hosts, views, skins, and
  packages.
- **Implementation details:** current choices that may change without changing
  the public contract.
- **Deferred work:** explicitly excluded from the first implementation.

## 2. Normative v1 architecture

```text
host composition root
  -> stable, complete AppHooksV1 prop
  -> high-level plugin page/container
  -> semantic model + actions
  -> presentation-only view or view pack
  -> semantic HTML + coarse myne-* classes
  -> validated tokens and scoped CSS under a myne-root
```

The host owns application state, authorization, data acquisition, persistence,
navigation, and side effects. A page/container adapts those capabilities into a
semantic model and actions. A view owns presentation only. A skin changes paint
and other declared appearance properties. A view pack may replace structure but
MUST preserve its surface contract and behavior obligations.

Application behavior MUST NOT depend on the selected skin or view pack.

## 3. Public vocabulary and namespace

All public DOM classes use the `myne-` namespace. All public CSS custom
properties use the `--myne-` namespace. Package identifiers use an explicitly
versioned `myne` schema namespace. Hosts MUST NOT publish CSS Module output names
or framework utility classes as customization hooks.

The v1 vocabulary is intentionally coarse:

| Concept | Purpose | Example |
| --- | --- | --- |
| root | Scope and active appearance | `myne-root` |
| theme | Active theme identity | `myne-theme-light-studio` |
| surface | Independently skinnable page/dialog region | `myne-surface myne-surface--spaces-overview` |
| slot | Major stable region within a surface | `myne-slot myne-slot--workspace-list` |
| role | Reusable semantic UI role | `myne-card`, `myne-row`, `myne-action` |
| tone | Intent that is not state | `myne-tone--danger` |
| status | Current semantic state | `myne-status--success` |

A public class MUST represent a stable semantic role, a genuine customization
boundary, or an accessibility-relevant state. Incidental wrappers, individual
text nodes, DOM depth, and current spacing choices MUST remain private.

New public slots SHOULD be added only when at least two implementations need the
same role or an independently customizable region cannot be expressed through
an existing surface, role, status, or inherited token.

### 3.1 Semantic HTML

Views MUST use the most appropriate native element before adding a public class.
Landmarks, heading order, lists, buttons, labels, dialog semantics, disabled
state, and keyboard behavior remain part of view conformance. Public classes do
not replace native semantics or ARIA.

Skin CSS MUST NOT change semantics by hiding required labels, focus indicators,
validation feedback, or interactive state. View packs MUST preserve the
accessibility obligations of the surface even when their DOM structure differs.

### 3.2 Theme roots and inheritance

Every skinned subtree MUST have one `myne-root` and one active
`myne-theme-<id>` class. Theme IDs MUST be normalized package identifiers that
are safe to emit as class-name suffixes. The root projects validated values as
CSS custom properties. Descendants SHOULD inherit ordinary foreground,
typography, and density values rather than repeating hooks on every element.

Representative variables include:

```css
--myne-color-background
--myne-color-foreground
--myne-color-muted
--myne-color-accent
--myne-density-scale
--myne-surface-spaces-overview-background
--myne-component-card-radius
--myne-slot-workspace-list-gap
```

The canonical variable registry is versioned with the manifest schema. Unknown
variables MAY be ignored; required variables MUST resolve through validated skin
values or built-in defaults.

## 4. Styling layers

### 4.1 Stable contract styles

Global `myne-*` classes and `--myne-*` variables are the only public CSS
contract. Hosts SHOULD put contract styling in explicit cascade layers so base,
skin, and user-authored rules have deterministic precedence.

### 4.2 CSS Modules

CSS Modules are an app-owned implementation mechanism. A module MAY style a
surface by combining a private local class with public `myne-*` descendants.
Generated module class names MUST NOT appear in manifests, user CSS, tests of
the public contract, or marketplace metadata.

### 4.3 Tailwind and other utilities

Utility classes MAY implement layout, responsive behavior, and non-contractual
details. Migrated skinned views MUST NOT hardcode utility colors or other visual
identity values that override skin-controlled variables. A utility class name
MUST NOT be a supported skin selector.

## 5. Skins, scoped CSS, and the raw-CSS boundary

A v1 skin package is declarative data. It MAY contain validated tokens,
surface/slot/role recipes, assets, metadata, and user-editable scoped CSS. It
MUST NOT contain or load JavaScript.

Token values MUST be validated by category before projection. A package with an
unsupported schema, invalid token, unsafe asset reference, or unsafe CSS MUST
produce actionable diagnostics and MUST NOT partially activate.

### 5.1 Scoped user CSS

User CSS is an intentional v1 authoring feature, but its execution path is not
the same as trusted source-controlled CSS. Before preview or activation, the
host MUST parse and validate it and constrain it to the package's `myne-root`.
String-prefix checks alone are insufficient.

At minimum, the implementation MUST:

- accept selectors only within the declared `myne-root` scope;
- reject selectors that escape to the document, host shell, or unrelated roots;
- reject external network loads, `@import`, unsafe URLs, script-capable legacy
  constructs, and style-element breakout content;
- allow only an explicit property and at-rule policy;
- constrain asset references to validated package assets;
- apply the exact same validation to real-time preview and persisted activation;
- avoid HTML interpolation as the style-injection mechanism;
- retain the last valid appearance when validation or application fails;
- expose line/column diagnostics where the parser can provide them; and
- offer a recovery path that disables custom CSS while preserving token data.

Preview MUST be disposable and MUST NOT create a committed revision until the
user explicitly applies or saves it. The detailed parser, sanitizer, and style
sheet mechanism are implementation decisions and require dedicated security
tests before custom CSS writes are enabled.

## 6. View packs

A view pack is a replaceable presentation implementation for a declared surface
contract. It receives only semantic model, actions, appearance context, and
injected presentation primitives. It MUST NOT import host application APIs.

A view-pack declaration MUST identify:

- contract and package schema versions;
- implemented surface IDs;
- required host capabilities;
- supported states and density modes;
- accessibility obligations; and
- stable state fixtures used for preview and conformance.

A host MUST reject a view pack whose required contract version or capabilities
are unavailable. Skin and view-pack selection are independent: changing either
MUST NOT require controller edits.

## 7. `appHooks` host boundary

`appHooks` is one complete, stable, typed, and versioned object passed through
props to high-level plugin page/container components.

"Complete" means complete for the declared public host contract version. It
does not mean access to private host internals, unregistered capabilities,
authorization bypasses, raw state supervisors, private RPC clients, or every
module loaded by the host.

Conceptually:

```ts
interface AppHooksV1 {
  readonly version: 1;
  readonly capabilities: ReadonlySet<AppCapabilityV1>;
  readonly workspace: WorkspaceHooksV1;
  readonly navigation: NavigationHooksV1;
  readonly appearance: AppearanceHooksV1;
  readonly notifications: NotificationHooksV1;
}
```

The exact namespaces are established from actual app needs during
`vkvw-8xaj.2 — Inject app hooks, data sources, and server actions through page
and container props`.

The host MUST keep the root object and namespace identities stable for the
mounted host contract. The object and its public members MUST be readonly.
Capabilities MUST preserve the authorization and validation behavior of the
host operations they adapt.

A high-level page/container MAY invoke `appHooks` hooks. It MUST follow the
framework's hook-order rules and derive presentation-facing models and actions.
It MUST NOT pass `appHooks` into presentation-only views.

A presentation view:

- receives semantic models and actions;
- MUST NOT receive `appHooks`;
- MUST NOT import host hooks, Springboard modules, API clients, stores, server
  actions, or navigation implementations; and
- MUST remain usable with deterministic Storybook fixtures.

This boundary is framework-specific at the host/container edge and
framework-neutral at the semantic view contract. A future non-React host can
provide an equivalent adapter without reproducing React hooks.

## 8. Package, schema, and compatibility rules

Contract, manifest, snapshot, and package versions are distinct fields. A
package MUST declare the contract and package schema versions it targets. A host
MUST validate both before preview or installation.

Within v1:

- additive optional fields are allowed;
- unknown optional fields are preserved when safe or ignored with diagnostics;
- required-field removal, semantic reinterpretation, and identifier reuse are
  breaking changes;
- IDs remain stable after publication; and
- exports are canonical and deterministic.

The current VD-era proof artifacts have not been used or published. They are
edited in place during the two-surface cutover. There is no legacy DOM, CSS
variable, public primitive, package, or runtime compatibility contract.

After that cutover, migrated source MUST contain no `data-vd-*`, `--vd-*`, or
public `VD*` primitive references. The migration MUST NOT add aliases or emit
both old and new contracts. This is a scoped cutover, not a blind
repository-wide rename.

Once an `@myne` package is published or persisted, future incompatible changes
require an explicit version migration at the package/import boundary. Runtime
and exports remain canonical rather than maintaining parallel DOM contracts.

## 9. Snapshots, revisions, and marketplace packages

These artifacts are related but distinct:

| Artifact | Purpose | Identity and lifecycle |
| --- | --- | --- |
| working draft | disposable real-time editing state | mutable, not history |
| appearance snapshot | portable complete appearance state | immutable and shareable |
| persisted revision | auditable committed app setting | ordered with parent/base revision |
| marketplace package | reviewed distributable artifact | package ID and release version |
| Git commit | marketplace collaboration mechanism | not the live settings database |

A canonical snapshot contains the complete normalized appearance state needed
to reproduce the selection, including skin, view-pack and density choices,
schema versions, metadata, and referenced asset integrity information.

A persisted revision MUST record the canonical snapshot, revision ID, expected
base revision, parent revision, timestamp, actor/source, and human-readable
summary. Writes MUST use optimistic concurrency and fail clearly when their base
revision is stale. Undo creates or selects a new current revision; it MUST NOT
silently mutate historical records.

Git MAY back marketplace review and sharing. It is not the primary live
appearance-state store.

## 10. Write safety and production staging

Before full revision history is available, the only allowed persistent
appearance mutation is a validated, user-confirmed selection of a built-in skin
through preview/apply/revert. The host MUST retain a known-good built-in fallback
and an explicit revert path.

Until revision history is implemented, the host MUST block:

- agent or CLI appearance writes;
- custom skin or scoped-CSS persistence;
- imported or generated package activation; and
- marketplace package installation that changes persisted appearance.

Read-only production browsing and disposable previews MAY ship earlier.

After history is available, every user, agent, CLI, import, generated, and
marketplace mutation MUST use the same validation, optimistic-concurrency, and
revision-writing service. Authorization is evaluated independently of
`appHooks` capability availability.

## 11. Deterministic previews and screenshots

Storybook/SkinLab is the initial conformance and preview harness. Every migrated
surface SHOULD provide canned loading, error, empty, populated, and relevant
interaction states. Fixtures MUST avoid private production data.

Screenshot generation produces two separate artifact classes:

1. **Visual-regression artifacts:** fixed environment, viewport, fonts, clock,
   locale, animation policy, state IDs, skin, view pack, and density; intended
   for automated comparison and failure diagnosis.
2. **Marketplace artifacts:** selected presentational captures and metadata;
   intended for human discovery and package review, not pixel-diff baselines.

The two outputs MAY originate from the same canonical fixture matrix but MUST
have separate retention, naming, approval, and publishing rules. Missing
required matrix entries or duplicate generated story identities MUST fail
generation rather than silently reducing coverage.

## 12. Production-oriented conformance examples

### 12.1 SpacesOverview

```text
host composition
  -> SpacesOverview appHooks container
  -> workspace/space semantic model + actions
  -> selected SpacesOverview view pack
  -> <main class="myne-surface myne-surface--spaces-overview">
       <section class="myne-slot myne-slot--workspace-list">
         <article class="myne-row">...</article>
       </section>
     </main>
```

Conformance requires behaviorally identical workspace loading, filtering,
pagination, navigation, and picker actions across supported view packs. A theme
class and scoped CSS may materially change layout and paint without changing the
container. Lists, headings, buttons, loading state, errors, and empty state must
remain semantically and accessibly represented.

### 12.2 Skin Editor

```text
host composition
  -> Skin Editor appHooks container
  -> draft/diagnostic/revision semantic model + actions
  -> Skin Editor view
  -> <section class="myne-surface myne-surface--skin-editor">
       <form class="myne-slot myne-slot--skin-fields">...</form>
       <section class="myne-slot myne-slot--preview">...</section>
     </section>
```

The editor keeps draft text as its source of truth, validates tokens and scoped
CSS before preview, and keeps preview separate from committed state. Save,
import, apply, revert, and retry behavior remain container actions. Before full
history exists, only user-confirmed built-in apply/revert may persist.

## 13. Two-surface cutover gate

SpacesOverview and Skin Editor cut over as one gated milestone delivered through
multiple reviewable green commits. Intermediate commits MUST NOT be released or
merged as a supported mixed contract.

The milestone is complete only when:

- both surfaces, shared primitives, root/runtime, CSS Modules, fixtures,
  Storybook stories, tests, documentation, and OpenLint policy use `@myne`;
- migrated source contains no `data-vd-*`, `--vd-*`, or public `VD*` primitive
  references;
- semantic/accessibility and behavior tests pass for both surfaces;
- default and alternate skins and view packs remain materially distinct;
- scoped CSS preview uses the approved validator or remains disabled;
- UI-injection and skinability checks are actionable and green; and
- production selection cannot observe an intermediate mixed contract.

## 14. VK projection constraints

Detailed work remains in `vkvw-9yay.7 — Plan VD to VK appearance projection
after global skin architecture stabilizes`. The v1 constraints are:

- projection consumes canonical resolved `@myne` appearance state;
- it never projects obsolete DOM selectors or internal CSS Module/Tailwind
  classes;
- ownership, revision, failure, and retry semantics are explicit;
- projection cannot bypass validation, authorization, or history gating;
- embedded and standalone VK behavior must have deterministic tests; and
- whether VK receives a token subset, resolved snapshot, or package reference is
  decided only after production persistence is proven.

## 15. Runtime-plugin constraints and deferred research

Executable runtime plugins are not part of `@myne` v1. Skins and marketplace
packages MUST NOT contain JavaScript. The complete `appHooks` object is a trusted
host contract, not a security sandbox for arbitrary code.

V1 preserves these future constraints:

- declarative contracts do not assume React outside the host/container edge;
- capabilities are explicit and versioned;
- executable extensions would require trust tiers, permissions, isolation,
  lifecycle, failure containment, signing, rollback, and dependency policy; and
- CSS variables and semantic contracts need an explicit bridge across iframe or
  Shadow DOM boundaries.

`vkvw-9yay.10 — Research microfrontend architecture for custom runtime plugins`
may record lightweight constraints alongside v1. Full loader research and all
runtime implementation remain deferred until a concrete executable-UI use case
is approved.

## 16. Implementation details and deferred questions

Current implementation details, not public guarantees:

- React and Springboard are the current host/container runtime.
- CSS Modules and Tailwind are current source styling tools.
- Storybook and SkinLab are the current fixture/preview harness.
- OpenLint plus repository-owned checks enforce migrated boundaries.
- The current runtime projects validated tokens through inline custom-property
  declarations on the root.

Deferred beyond this contract task:

- implementation of the two-surface rename and `appHooks` migration;
- the exact scoped-CSS parser, sanitizer, and stylesheet application mechanism;
- production Skin Editor persistence and navigation;
- revision retention, compaction, and asset garbage collection;
- marketplace repository governance and contribution automation;
- screenshot runner and storage provider selection;
- detailed VK projection design;
- runtime-loaded JavaScript and microfrontend selection; and
- browser-extension implementation or arbitrary-site inference.

## 17. Migration map

| Current proof concept | Canonical direction | Migration owner |
| --- | --- | --- |
| `data-vd-skin-root` | `myne-root` | two-surface cutover |
| `data-vd-surface="spaces-overview"` | `myne-surface myne-surface--spaces-overview` | two-surface cutover |
| `data-vd-slot="workspace-list"` | `myne-slot myne-slot--workspace-list` | two-surface cutover |
| `data-vd-component="card"` | `myne-card` | shared primitives |
| `data-vd-tone="danger"` | `myne-tone--danger` | shared primitives |
| `data-vd-status="success"` | `myne-status--success` | shared primitives |
| `--vd-*` | `--myne-*` | skin runtime and CSS Modules |
| public `VDHeading`, `VDText`, and related primitives | generic `Myne*` exports or approved neutral names | shared primitives |
| controller imports application hooks directly | complete `AppHooksV1` prop at container boundary | host composition and containers |
| view imports application APIs | prohibited; use semantic model/actions | presentation views |
| mutable editor draft | disposable working draft | Skin Editor container |
| exported skin state | canonical portable snapshot/package | package and snapshot work |
| Git as possible settings history | Git only for marketplace collaboration | revision and marketplace work |

## 18. Related work

- `vkvw-8xaj.2 — Inject app hooks, data sources, and server actions through page
  and container props`
- `vkvw-8xaj.3 — Adopt semantic HTML and generic class-based @myne skin hooks`
- `vkvw-8xaj.4 — Integrate @myne skins and view packs into app appearance
  workflows`
- `vkvw-8xaj.6 — Define portable @myne appearance snapshots and package sharing`
- `vkvw-8xaj.7 — Design git-backed declarative @myne appearance marketplace
  lifecycle`
- `vkvw-8xaj.8 — Add explicitly authorized in-app PR contribution flow for
  @myne packages`
- `vkvw-ioxa — Add undoable theme and skin change history for UI customization`
- `vkvw-ioxa.1 — Define @myne appearance revision storage, retention, and
  concurrency semantics`
- `vkvw-9yay.7 — Plan VD to VK appearance projection after global skin
  architecture stabilizes`
- `vkvw-9yay.10 — Research microfrontend architecture for custom runtime
  plugins`
- `vkvw-9yay.12 — Wire Skin Editor into production app settings and global
  appearance persistence`
- `vkvw-jspj — Decide Storybook automation script scope`

## References

- Local UI injection architecture: `../ui-injection.md`
- React Rules of Hooks: <https://react.dev/reference/rules/rules-of-hooks>
- CSS custom properties: <https://developer.mozilla.org/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties>
- CSS cascade layers: <https://developer.mozilla.org/docs/Web/CSS/Reference/At-rules/@layer>
- Storybook visual testing: <https://storybook.js.org/docs/writing-tests/visual-testing>
