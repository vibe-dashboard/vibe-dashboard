# @myne scoped CSS security policy v1

Status: normative compiler policy for `vkvw-8xaj.9 — Implement deterministic
scoped CSS compiler and protected preview runtime for @myne packages`.

## Parser and trust decision

The compiler uses `css-tree` 3.2.1 as a direct production dependency. It is a
maintained parser/walker/generator based on CSS specifications and browser
behavior, provides a structured AST rather than regex parsing, and canonicalizes
accepted syntax before hashing and rewriting. The host additionally rejects
unbalanced input because the CSS parsing model deliberately recovers from some
malformed EOF cases, while a security compiler must fail closed.

Primary references:

- [`css-tree` project and API](https://github.com/csstree/csstree)
- [CSS Syntax Module Level 3](https://www.w3.org/TR/css-syntax-3/)
- [CSS Cascading and Inheritance Level 5](https://www.w3.org/TR/css-cascade-5/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Deterministic compilation

`compileScopedAppearance` sorts CSS blocks by stable ID, parses and regenerates
canonical source, sorts token declarations, and hashes package ID plus those
canonical values using SHA-256. The first 96 digest bits form the opaque
host-generated `data-myne-package-scope`; the full base64url digest is recorded
with compiler, policy, parser, and canonical-byte metadata. Compilation either
returns one frozen, runtime-branded artifact or no artifact.

Output is always one `@layer myne.candidate` block. It cannot emit unlayered
rules or author-controlled layers. This is the final candidate layer in the
declared five-layer order `reset, tokens, components, skin, candidate`.
Preview and activation accept the same in-memory artifact identity; they never
reparse or rebuild it independently.

## Default-deny policy

Selectors require at least one exact registered public `myne-*` class or
`data-myne-*` identity. The compiler rejects unknown/public-looking names, IDs,
root/global selectors, pseudo-elements, selector-list functions, excessive
depth/size, and every protected identity. Accepted selectors are prefixed with
the generated package-root selector.

Policy v1 permits conservative visual, typography, spacing, border, grid, and
bounded transition declarations. It rejects undeclared properties, negative or
oversized layout values, package `!important`, positioning/stacking,
visibility/opacity/display removal, pointer/keyboard interaction changes,
generated content, transforms/filters, animation declarations, executable or
external URLs, imports, font faces, and non-private custom-property writes.
Only bounded width, forced-colors, and reduced-motion media queries are accepted.
Source, rule, declaration, selector, depth, value, and numeric layout budgets
are objective and versioned in code.

This intentionally allows broad styling inside registered semantic regions
without permitting global reach, overlays, spoofing, resource loading, or
disabling the controls required to recover.

## Protected operational UI

`ProtectedAppearanceBoundary` is rendered without a package scope and carries a
reserved `data-myne-protected` identity that package selectors cannot name.
Host CSS owns its positioning, visibility, interaction, focus indicator, state
patterns, forced-colors behavior, and reduced-motion behavior. The reserved
`Alt+Shift+R` handler moves keyboard focus to recovery controls and is removable
with its mount lifecycle.

The package may influence only a derived protected color subset. Foreground
requires 4.5:1 contrast; focus and semantic state colors require 3:1 against the
background and must remain distinct. Confirmation, warning, error/destructive,
and disabled states also have host-owned weight, underline, symbol, or pattern
cues so color is not the only distinction. Any missing or invalid projected
value atomically selects the complete known-good subset—never a partial mix.

## Recovery invariants

Startup safe mode retains history/last-known-good metadata but activates no user
artifact. Successful activation advances last-known-good atomically. A failed
load or health check restores that artifact and records a diagnostic. Runtime
activation accepts only artifacts branded by this compiler instance, preventing
forged or merely shape-compatible objects from bypassing validation.

Production package import and persistent revision wiring remain separate gates:
raw CSS is not accepted by the existing manifest importer until those callers
compile, verify, and persist the artifact through the revision service.
