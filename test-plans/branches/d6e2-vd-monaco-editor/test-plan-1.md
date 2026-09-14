# Test Plan 1: VD Monaco composer with VK chat-only iframe

Branch: `vk/d6e2-vd-monaco-editor`

Sandbox guide: [`../../onboarding/vk-mocked-sandbox.md`](../../onboarding/vk-mocked-sandbox.md)

## User story

A developer using a VD craft can inspect and switch VK sessions in a chrome-free
Agent iframe, answer pending VK interactions, and compose follow-ups from a
compact Monaco-based VD footer without losing drafts or using real model tokens.
Normal VK `/vscode` behavior and non-Agent VD tabs must remain unchanged.

## Preconditions and evidence

- Use the `basic-seeded` mocked VK sandbox fixture and a fresh Playwright CLI
  session. Do all mutations through VD UI.
- Record commands, VD URL, iframe URLs, snapshots, generated locator hints,
  screenshots, console errors, and deviations on the implementation/tester bead.
- Convert the successful browser transcript into focused Playwright coverage per
  [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md).

## Test cases

### TEST_CASE_1A — Start and verify the sandbox

1. Start the `basic-seeded` sandbox as documented in the sandbox guide.
2. Verify VD, same-origin VK assets, and `/vk-api/*` routing are healthy.
3. Open VD at `1280x900` with a unique Playwright CLI session.

Expected: all services remain healthy; no fatal browser errors occur; record the
VD URL and cleanup command.

### TEST_CASE_2A — Agent iframe is chat-only

1. Open the seeded craft and select `Agent`.
2. Inspect the iframe URL and content.
3. Select `Code`, `Beads`, and `Forms`, then return to `Agent`.

Expected: Agent uses `/workspaces/<id>/vscode?chat_only=true&session_id=<encoded-id>`;
the iframe shows the feed but no VK navigation, header/sidebar, status/footer,
composer, or duplicated controls. VD's footer is visible only for Agent. Other
tabs and normal VK `/vscode` remain unchanged.

### TEST_CASE_2B — Loading, empty, and API failure states

1. Observe initial session loading.
2. Exercise a workspace with no sessions where the fixture supports it.
3. Simulate a sessions API failure and retry/recover.

Expected: stable loading/empty/error feedback appears without a wrong-session
flash, stale composer target, blank iframe, reload loop, or unhandled rejection.

### TEST_CASE_3A — Deterministic session selection

1. Note the latest session and selected footer option.
2. Switch to another session and inspect the iframe URL/feed.
3. Reload VD.
4. Exercise missing and invalid `session_id` values.
5. Refresh sessions while a non-latest session is selected.

Expected: selection, encoded URL, feed, and composer target always agree. Valid
IDs display that session synchronously; missing/invalid IDs select latest;
refresh does not loop, reset a still-valid choice, or briefly expose another feed.

### TEST_CASE_4A — Inline approval and question controls

1. Open chat-only sessions containing a pending approval and `ask_user_question`.
2. Approve, deny/request changes where supported, and answer a question.
3. Open normal VK `/vscode` for the same interaction.

Expected: chat-only actions are usable inline and update once; normal mode keeps
its established control placement without duplicates. Slow/API-failure attempts
show recoverable feedback and do not double-submit.

### TEST_CASE_5A — Monaco composer and keyboard behavior

1. Enter multiline Markdown in the VD Agent footer.
2. Confirm Enter inserts a newline and Cmd/Ctrl+Enter submits.
3. Repeat using `Send`; try whitespace-only input and rapid duplicate submits.

Expected: Monaco has textarea-like chrome, wrapping, no minimap/line numbers,
and accessible labeling. Exactly one non-empty follow-up targets the selected
session; invalid/duplicate submissions are blocked with stable feedback.

### TEST_CASE_5B — Executor/model configuration

1. Inspect null, known, and fixture-provided unknown executor values.
2. Choose supported executor, variant/preset, model, and reasoning/permission
   overrides, then submit.

Expected: unknown/null wire values fall back safely; supported selections are
sent in compatible `executor_config`; changing sessions initializes controls
correctly without crashing or silently targeting the prior session.

### TEST_CASE_5C — Draft persistence and isolation

1. Type distinct unsent drafts in two sessions and switch between them.
2. Reload VD and reopen the craft.
3. Submit one draft, then simulate save/load failure for another.

Expected: drafts restore per workspace/session using VK scratch parity; a sent
draft clears only after acceptance; stale drafts never cross sessions; failures
preserve recoverable text and expose non-destructive feedback.

### TEST_CASE_6A — Queue, cancel queue, stop, and recovery

1. While qa-mode is running, queue a follow-up.
2. Cancel a queued item, queue again, then stop the running execution.
3. Submit another follow-up after recovery.

Expected: status and enabled actions match server state; cancel/stop affect the
intended session once; stale responses do not corrupt the footer; recovery works
without real provider tokens.

### TEST_CASE_7A — Constrained viewport and visual smoke

1. Resize to `390x844`, switch sessions, enter a multiline draft, and submit.
2. Return to `1280x900` and capture final Agent screenshots.

Expected: feed, selectors, Monaco, and actions remain reachable without overlap,
clipping, duplicated chrome, or horizontal page scrolling. Screenshots show VD
chrome, selected craft/session, chat-only feed, VD footer, and completed output.

### TEST_CASE_8A — Automated and static gates

1. Run focused VK parser/component/route tests and VK type/format checks.
2. Run focused VD helper/state/component tests and VD type/format checks.
3. Run the feature Playwright spec derived from this plan.
4. Run `git diff --check` in both repositories.

Expected: all gates pass. Tests cover hidden/preserved controls, synchronous
requested/latest selection, URL lifecycle, nullable/unknown executor handling,
approval/question actions, composer send/queue/stop, and draft persistence.

### TEST_CASE_9A — Cleanup

1. Close the Playwright CLI session and stop the sandbox.
2. Check for leftover sandbox, Caddy, VK backend, Vite, and browser processes.

Expected: no process belonging to this run remains.

## Result schema

Record JSON keyed by every `TEST_CASE_*` ID using `PASS`, `FAIL`, `BLOCKED`, or
`SKIPPED`. Failures must include observed versus expected behavior, artifacts,
and the smallest actionable fix. The milestone is not accepted until impl,
review, and an independent tester all approve.
