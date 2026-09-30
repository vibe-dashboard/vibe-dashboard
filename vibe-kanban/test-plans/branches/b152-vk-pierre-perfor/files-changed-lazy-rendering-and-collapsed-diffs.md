# Files Changed lazy rendering and collapsed diffs test plan

Feature bead: `Vktest-9kn4 — Fix Files Changed tab lazy rendering and collapsed diffs`

Branch: `vk/b152-vk-pierre-perfor`

Source guidance:

- `/opt/vibe-kanban-vscode-web-seed/test-plans/onboarding/overseer-intro.md`
- `/opt/vibe-kanban-vscode-web-seed/test-plans/onboarding/feature-work-process.md`
- `/opt/vibe-kanban-vscode-web-seed/test-plans/onboarding/implementer-testing-process.md`
- `/opt/vibe-kanban-vscode-web-seed/test-plans/onboarding/independent-tester-prompt.md`
- `/opt/vibe-kanban-vscode-web-seed/test-plans/onboarding/playwright-manual-to-e2e.md`

## User stories

### Desktop reviewer

As a desktop user reviewing workspace changes, I can navigate to the Files
Changed / Changes panel without eagerly rendering every diff expanded. Each diff
starts collapsed by default for first-time file paths, and I can manually expand
only the files I need.

### Mobile reviewer

As a mobile user, I can switch among workspace tabs without the inactive Changes
tab doing expensive diff rendering work. When I explicitly open or navigate to a
file in Changes, the app switches to the Changes tab and scrolls to that file
after the tab mounts.

### Returning reviewer in same workspace

As a user who manually expanded a diff file, I expect that manual expansion to
be remembered within the same workspace during the current app session. The same
path in another workspace should not inherit that expansion state.

## UX expectations to verify

- Diff files are collapsed by default the first time the Changes panel renders a
  file path in a workspace.
- Collapsed-by-default is not a forced reset on every navigation. Manual
  expansions are remembered by workspace for the current app session.
- Programmatic file navigation, such as "view file in changes" from chat or a
  file list, opens/switches to the Changes panel/tab and expands the target file
  so the requested file/line can be shown.
- On mobile, the Changes panel is not mounted while another mobile tab is
  active.
- On desktop, the Changes panel is only rendered while the right main panel mode
  is Changes.
- Rendering is incremental: diff items mount in batches rather than all at
  once.

## Preconditions and setup

1. Use a workspace/repository with at least three changed files, preferably:
   - one small modified text file;
   - one added file;
   - one deleted or renamed file;
   - one file with enough content to make expanded rendering visually obvious.
2. Start the VK app from this branch.
3. Use a fresh browser/session for first-pass default-collapse checks.
4. Use a second workspace or repository with a same-path changed file if
   workspace-scoped expansion memory can be validated manually.
5. For browser-driven testing, use the Playwright CLI snapshot/ref workflow
   documented in the onboarding files. Use unique sessions:
   - desktop: `files-changed-desktop-<timestamp>`
   - mobile: `files-changed-mobile-<timestamp>`

## Agent-driven browser workflow

Record exact commands, URLs, snapshot paths, locator hints, screenshots, and
observations on the tester bead. Suggested command shape:

```bash
PW_SESSION="files-changed-desktop-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 720
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

For mobile:

```bash
PW_SESSION="files-changed-mobile-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" resize 390 844
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

For important controls, generate stable locator hints before interacting:

```bash
pnpm playwright:cli -s="$PW_SESSION" generate-locator e<N> --json
```

Produce an E2E-conversion transcript artifact following
`playwright-manual-to-e2e.md`. Do not commit raw Playwright CLI artifacts.

## Test cases

### TEST_CASE_1A — Desktop first navigation shows collapsed diffs

Steps:

1. Open the app at a desktop viewport.
2. Select a workspace with changed files.
3. Navigate to the Files Changed / Changes panel.
4. Inspect the visible file rows before manually expanding anything.

Expected:

- Each visible diff file row is collapsed by default.
- Expanded diff hunks/code blocks are not visible until the tester explicitly
  expands a file.
- File headers, file names, and expand affordances remain visible and usable.
- No deleted/renamed/large-file special case starts expanded by default.

### TEST_CASE_1B — Desktop manual expansion is remembered in the same workspace

Steps:

1. Continue from `TEST_CASE_1A`.
2. Expand one file.
3. Navigate away from the Changes panel to another desktop panel.
4. Navigate back to Changes.

Expected:

- The manually expanded file remains expanded within the same workspace/session.
- Files that were not manually expanded remain collapsed.
- The remembered expansion is scoped to the current workspace.

### TEST_CASE_1C — Desktop targeted file navigation opens and expands target

Steps:

1. Navigate away from the Changes panel.
2. Use an available product path that invokes file-in-changes navigation, such
   as a chat "view in changes" affordance or file navigation entry.
3. Observe the right panel after navigation.

Expected:

- The right panel mode switches to Changes.
- The target file is expanded automatically.
- The panel scrolls to the target file, and to the target line when line
  navigation is available.
- Other files remain collapsed unless previously expanded manually.

### TEST_CASE_2A — Mobile inactive tabs do not render the Changes panel

Steps:

1. Open the app at a mobile viewport.
2. Select a workspace with changed files.
3. Leave the active mobile tab on a non-Changes tab.
4. Inspect the DOM/accessibility snapshot and visible UI.

Expected:

- The Changes tab content is not visible.
- Diff file rows and expanded diff code are not mounted while the Changes tab is
  inactive.
- Other mobile tabs continue to work normally.

### TEST_CASE_2B — Mobile first Changes navigation shows collapsed diffs

Steps:

1. Continue at a mobile viewport.
2. Tap the Changes tab.
3. Inspect the first visible diff rows before manually expanding anything.

Expected:

- The Changes tab mounts successfully.
- Diff file rows are collapsed by default on first render for that workspace.
- Expanding a file manually shows its diff content.
- Switching away and back remembers manual expansion for the same
  workspace/session, rather than forcing a reset.

### TEST_CASE_2C — Mobile file navigation while Changes is unmounted replays

Steps:

1. At a mobile viewport, switch to a non-Changes tab so Changes is unmounted.
2. Trigger file-in-changes navigation from chat, file tree, comments, or another
   available UI path.
3. Observe the active mobile tab and resulting Changes panel.

Expected:

- The app switches to the Changes tab.
- The Changes panel mounts only after the tab is active.
- The target file is expanded and scrolled into view after mount.
- The pending scroll is replayed once; it does not repeatedly snap back on
  unrelated re-renders.

### TEST_CASE_2D — Mobile selected file remains safe without workspace context

Steps:

1. If practical, exercise a route/state where file-in-changes navigation is
   invoked before a workspace id is available.
2. Observe errors and visible state.

Expected:

- No crash or console error is introduced.
- The file selection can be remembered.
- The app does not attempt to switch workspace panel mode without a workspace id.

Mark this case `SKIPPED` with explanation if there is no practical UI path to
reach no-workspace file navigation.

### TEST_CASE_3A — Workspace-scoped expansion state

Steps:

1. In workspace A, open Changes and manually expand a changed file.
2. Switch to workspace B with a changed file using the same path if available.
3. Open Changes for workspace B.

Expected:

- Workspace B's same-path file does not inherit workspace A's expansion state.
- Workspace B's file defaults collapsed until manually expanded.
- Returning to workspace A in the same app session preserves workspace A's
  manual expansion.

Mark this case `SKIPPED` with explanation if a same-path changed file in another
workspace cannot be set up in the available test environment.

### TEST_CASE_4A — Automated regression checks

Steps:

1. Run the focused provider tests.
2. Run web-core and UI checks.
3. Run whitespace checks for the feature commits.

Commands:

```bash
pnpm --filter @vibe/web-core exec vitest run src/shared/hooks/ChangesViewProvider.test.tsx
pnpm --filter @vibe/web-core run check
pnpm --filter @vibe/ui run check
git diff --check HEAD~3..HEAD
git diff --check
```

Expected:

- All commands pass.
- If any command fails because the local environment lacks setup/dependencies,
  record the exact failure and mark the test case `BLOCKED`, not `PASS`.

## Result schema

Tester should create a fresh tester bead and record results as JSON keyed by
test case:

```json
{
  "TEST_CASE_1A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1B": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1C": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2B": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2C": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2D": { "status": "SKIPPED", "notes": "No practical UI path." },
  "TEST_CASE_3A": { "status": "SKIPPED", "notes": "No second same-path workspace available." },
  "TEST_CASE_4A": { "status": "PASS", "notes": "..." }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Approval bar

Testing is approved only if:

- `TEST_CASE_1A`, `TEST_CASE_2A`, `TEST_CASE_2B`, `TEST_CASE_2C`, and
  `TEST_CASE_4A` pass.
- `TEST_CASE_1B`, `TEST_CASE_1C`, and `TEST_CASE_3A` pass or have a clearly
  justified `SKIPPED` status for unavailable setup/UI affordances.
- Any `FAIL` includes the observed behavior, expected behavior, artifact paths,
  and smallest actionable fix.

## Self-review notes

- The plan directly answers the main product question: file diffs are
  automatically collapsed on first navigation to the Changes/diff tab, but
  manual expansion memory is preserved per workspace.
- The plan separates desktop rendering expectations from mobile lazy-mount
  behavior so testing does not falsely pass one surface by only checking the
  other.
- The plan avoids risky nitpicks: it does not require strict reset on every tab
  navigation, visual redesign, or full e2e automation before the independent
  manual pass.
