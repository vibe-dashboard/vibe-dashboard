# VD themes

The approved discussion response is attached to bead `task-9ek` / form
`vd_themes_discussion`. It selected direct chat conversion, all five presets,
shared persistent state and both selectable-font options. The implementation
uses IBM Plex Mono by default, with System UI selectable independently.

## Ownership

`src/lib/themes.ts` defines the preset catalog and HeroUI colors. `src/hero.ts`
passes those presets to HeroUI's Tailwind plugin. Components use HeroUI roles:
background/foreground, content1–4, default, divider, primary/secondary,
success/warning/danger and focus. New component colors belong in the HeroUI
configuration rather than literal component colors or another token system.

Presets are Neutral Dark, Midnight (navy/cyan), Forest (green/mint), Sand
(light cream/teal), and Plum (aubergine/lavender).

`src/modules/ThemesModule.ts` registers an isomorphic, remote Springboard
module named `Themes`. Its fresh `preferences` persistent state stores
`themeId` and `uiFont`. This preference is **shared by all connected clients
of the VD instance**, not scoped to a browser, workspace, voyage or person.
Writes validate catalog IDs; rendering unknown saved IDs uses safe defaults
without rewriting stored state. There is no migration or second storage copy.

The main provider subscribes to preferences and applies the preset, base
light/dark mode, font and native `color-scheme` to the document root. The
sidebar's Appearance controls save immediately and report action failures.
There can be a fallback-to-saved-preset transition during initial bootstrap.

## Chat and fonts

Chat's active components use HeroUI roles directly in `packages/inline-chat`,
`packages/web-core` and `packages/ui` under `vibe-kanban/`. The original
`packages/local-web` application is not the development surface.

The parent base-mode context passes light/dark to inline chat's existing theme
prop. Inline chat adapts that to web-core's `ThemeProviderContext`, keeping
diffs and provider/file icons aligned with the named preset. Neither context
stores another preference. Theme updates preserve the existing chat tree and
surface IDs.

Pierre diff chrome/addition/deletion surfaces use HeroUI variables inside its
shadow root. Its GitHub light/dark syntax-highlighting schemes remain in use;
Lexical code highlighting derives from HeroUI colors. IBM Plex Mono is served
locally from `public/fonts`, with its SIL Open Font License. Code/diffs stay
monospaced in System UI mode. Interface font selection also applies to
Tailwind's explicit `font-sans` consumers and portaled controls.

## Continuing page-sized conversion

The first pass covers agent chat, its common menus/editor/diff renderers,
sidebar, voyage/craft bars, address bar, split-view chrome, loaders and surface
fallbacks. Storybook's toolbar can select presets and fonts for review.

Dashboard/SpacesOverview, external kanban, plugin admin, BeadsForm and deeper
create-workspace configuration remain later page-sized passes. Nonconflicting
legacy utilities temporarily derive from HeroUI for their remaining consumers.
The conflicting unlayered `bg-primary` / `bg-secondary` definitions were
removed: those names now always mean HeroUI action colors. When touching an
older VK component, replace its surface usage with `bg-background` or
`bg-content1/2`, not `bg-primary`/`bg-secondary`.

## Verification

`src/modules/ThemesModule.test.ts` exercises the persistent-state contract,
shared updates, re-registration, validation and safe read fallback.
`tests/browser/inline-chat/themes.spec.ts` checks all presets, portaled chat
menus, shadow-root diff mode, locally loaded fonts, two retained drafts and
expanded diffs, and mobile appearance controls including save failure.
The browser harness uses the parent VD stylesheet and actual inline chat;
its appearance callbacks are controlled test state, not a second production
preference store.
