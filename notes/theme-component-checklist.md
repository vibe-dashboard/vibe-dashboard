# React component theme audit

Generated from all `.tsx` and `.jsx` files under `src`, including stories and entry points.
Checked means reviewed for rendered colors and theme inheritance, with fixed-palette
styling converted or an explicit exception below. This is a source audit, not a
claim that every state has been visually exercised in every theme.

Tracking: `task-bjw` (inventory/audit), `.1` (Open Craft), `.2` (core surfaces),
`.3` (external kanban), `.4` (stories), `.5` (BeadsForm host CSS).

- [x] `src/components/AddTabModal.stories.tsx` — converted story canvas/text.
- [x] `src/components/AddTabModal.tsx` — already uses HeroUI surfaces, text, dividers and semantic actions.
- [x] `src/components/AddressBar.stories.tsx` — converted story canvas.
- [x] `src/components/AddressBar.tsx` — already uses HeroUI surfaces, text and focus tokens.
- [x] `src/components/AgentSplitViewPage.tsx` — already uses HeroUI tokens, including resize/focus states.
- [x] `src/components/AppLoadingScreen.stories.tsx` — converted story frame border.
- [x] `src/components/AppLoadingScreen.tsx` — already uses HeroUI canvas, text and spinner tokens.
- [x] `src/components/DashboardWorkspaceRoute.tsx` — converted status page and removed nested dark override.
- [x] `src/components/IframePanel.stories.tsx` — converted story canvas/border.
- [x] `src/components/IframePanel.tsx` — rendered UI uses tokens; literal white/transparent values detect external iframe backgrounds (exception).
- [x] `src/components/PreviewRunConfigsPanel.tsx` — converted forms, notices, surfaces and semantic actions.
- [x] `src/components/PreviewSlotDialog.tsx` — already uses HeroUI inputs, output, status and action colors.
- [x] `src/components/RetryableInlineSurface.tsx` — already uses HeroUI text and border colors.
- [x] `src/components/Sidebar.tsx` — already uses HeroUI surfaces, selection, text and status colors; inherits root palette.
- [x] `src/components/SpacesOverview.stories.tsx` — converted story canvas.
- [x] `src/components/SpacesOverview.tsx` — converted dashboard, workspace rows, badges, voyage controls, picker and loading/error states.
- [x] `src/components/TabContextMenu.stories.tsx` — converted story canvas, border and text.
- [x] `src/components/TabContextMenu.tsx` — already uses HeroUI surfaces, text, dividers and danger colors.
- [x] `src/components/ThemeProvider.tsx` — applies selected palette to document root; no rendered colors.
- [x] `src/components/ThemeSelector.tsx` — controls use tokens; swatches intentionally show catalog palette values (exception).
- [x] `src/components/UnifiedTabView.tsx` — converted empty-state text.
- [x] `src/components/WorkspaceContentView.tsx` — already uses HeroUI empty-state text.
- [x] `src/components/WorkspacePreviewMenu.tsx` — already uses HeroUI menu, output and focus colors.
- [x] `src/components/WorkspaceShell.tsx` — converted remaining backdrops to overlay token.
- [x] `src/components/WorkspaceShellScenes.stories.tsx` — already uses HeroUI story surfaces and text.
- [x] `src/components/WorkspaceShellScenes.tsx` — existing tokenized voyage/craft UI; converted remaining backdrops to overlay token.
- [x] `src/components/dialogs/AddVKWorkspaceModal.stories.tsx` — converted Open Craft story canvas/text.
- [x] `src/components/dialogs/AddVKWorkspaceModal.tsx` — converted modal, search/filter controls, workspace/space rows, custom-path inputs, pending/error states and footer.
- [x] `src/i18n/index.tsx` — context provider; no rendered colors.
- [x] `src/index.tsx` — module/state entry point; no rendered palette.
- [x] `src/modules/BeadsFormModule.tsx` — converted delegated `beadsform-*` host colors in `src/styles.css`.
- [x] `src/modules/MainUIShellModule.tsx` — converted Plugin Admin, including table, actions and errors; removed nested dark override.
- [x] `src/modules/plugins/kanban/ExternalKanbanRoute.tsx` — converted route status cards.
- [x] `src/modules/plugins/kanban/components/ExternalKanbanBoardShell.tsx` — converted boards, issue metadata/statuses, linked tasks/workspaces; removed nested dark override.
- [x] `src/modules/plugins/kanban/components/ExternalWorkspaceCreateDialog.tsx` — converted dialog, repo/branch controls and semantic action/error colors.
- [x] `src/modules/plugins/kanban/jira/components/ExternalJiraBoardView.stories.tsx` — converted story canvas.
- [x] `src/modules/plugins/kanban/jira/components/ExternalJiraBoardView.tsx` — converted board, cards, filters, create/bulk-convert dialogs, details drawer, side panel and diagnostics; removed nested dark override.
- [x] `src/modules/plugins/kanban/linear/components/ExternalLinearBoardView.stories.tsx` — provider-only wrapper; inherits root palette.
- [x] `src/modules/plugins/kanban/linear/components/ExternalLinearBoardView.tsx` — converted board, cards, details drawer, side panel and status cards.
- [x] `src/modules/plugins/vibe-dashboard/react-craft-surfaces.tsx` — already uses HeroUI canvas/text and inherits selected palette.

## Audit rules

- Canvas and raised surfaces: `background`, `content1`, `content2`, `content3`.
- Text: `foreground`, `default-500`; solid action text: `primary-foreground`.
- Semantic colors: `primary`, `secondary`, `success`, `warning`, `danger`, `focus`.
- Dividers use `divider` with restrained opacity; backdrops use `overlay`.
- Components inherit the selected root theme instead of forcing `dark` or `light`.
- `transparent`, `currentColor`, layout-only inline styles and iframe color-detection
  literals are not fixed application palettes. Authored/embedded content can own its styling.

## Inventory generation

Initial unchecked inventory was generated with Bash/Python from the filesystem:

```bash
python3 -c 'from pathlib import Path; paths=sorted(p for p in Path("src").rglob("*") if p.suffix in (".tsx", ".jsx")); print("\n".join(f"- [ ] `{p.as_posix()}`" for p in paths))'
```

The 40 paths above retain that generated order. React-bearing entry points and
stories are deliberately included so wrappers cannot silently reset the palette.
