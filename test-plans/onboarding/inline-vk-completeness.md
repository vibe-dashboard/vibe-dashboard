# Inline VK completeness acceptance

## Automated layers

Run the isolated interaction suite with:

```bash
npm run test:e2e:inline-chat
```

It runs the real inline React package in a two-pane Vite harness with controlled
HTTP/WebSocket responses. It does not start a VK backend, use model credentials,
or build Rust. Unexpected API calls and uncaught browser errors fail the tests.
The main CI Playwright job runs this suite after the shell e2e tests.

The actual VD shell also has split acceptance coverage:

```bash
pnpm exec playwright test tests/e2e/agent-split-page.spec.ts tests/e2e/native-agent-split.spec.ts
```

**Show in split view** opens `/split-view` with the chosen craft on the left.
Each pane has a picker for an existing workspace craft; the other pane's
workspace is disabled. The page renders two independent Agent surfaces with
stable craft-and-side identities. Craft selections and the divider position
are stored in the URL for reloads and bookmarks, without changing saved voyage
or workspace schemas. **Back to dashboard** returns to the last dashboard URL.
This page is a contained stop-gap before DockView.

The page test creates two different workspace crafts through the real workspace
RPC, then verifies correct-session sends, independent streams and diff summaries,
draft/session restoration, pane unmount isolation, resizing, reload, unavailable
craft recovery and return navigation. It fails on uncaught browser errors.

**Split this workspace’s Agents** retains the same-workspace native pair.
Its test creates a voyage through the workspace RPC and verifies
independent sessions, streams and drafts, reload persistence, repeated opening,
and returning to a single Agent and back. VK HTTP/WebSocket responses are
controlled fixtures; this layer does not establish real OpenCode execution.

The separate remote-runtime suite remains:

```bash
scripts/ci-run-vk-mocked-sandbox-e2e.sh
```

That layer exercises the actual content-addressed VK server and VD integration
with runtime agent-response mocking. Passing the isolated harness is not a
substitute for that server integration, or for the real-provider checks below.

| Contract | Automated evidence |
| --- | --- |
| Same-session drafts and mode selection remain independent | Two-pane browser test, including unmount/remount and reload |
| Server-backed pane drafts | Fresh browser context restores both panes; acknowledged caches yield to newer server drafts; sending clears only the submitted pane; delayed saves cannot resurrect it; existing browser-only drafts upload on reconnect |
| Session selection and streaming remain independent | Two concurrent sessions, distinct streamed messages, selection restoration |
| Local diff expansion and diff summaries remain independent | Same-session expansion; distinct-workspace stats; unmount cleanup |
| Unsupported settings/navigation are not presented as working actions | Creation preset menu and inline diff browser tests |
| Loading and recoverable surface failures | Component tests for both labels, rejected loaders, render errors, retry and neighboring draft retention |
| Model/reasoning/permission selection | Browser checks actual follow-up request overrides using controlled OpenCode discovery |
| Context gauge | Streamed token usage produces the expected percentage |
| Attachments | Actual browser file selection, multipart upload, and attachment reference in the follow-up request |
| Sessions | New-session creation and follow-up without changing the neighboring pane |
| Queue/stop | Queue request, cancellation, and execution stop against the correct session |
| Approvals/questions | Pending WebSocket events, user response payload and resumed stream |
| Beads | Counts/groups, completed-section default, form link, housekeeping target and exact prompt |
| Preview menu | Enabled slots, canonical server URL, opened HTTP response and host configuration callback |

The preview harness serves a small HTTP fixture. It does not prove that a real
repository's preview process or staging wildcard host/proxy is reachable.
Likewise, controlled OpenCode discovery does not establish real model support,
permissions enforcement, or token reporting.

Inline follow-up drafts use the existing VK SQLite scratch API with stable
per-pane/session UUIDs. No database migration is required. Browser-local drafts
remain a dirty-write recovery cache; standalone VK scratch IDs are unchanged.
Opening the same craft, Agent view and session in another browser restores its
server draft. Selected-session and chat-mode preferences remain browser-local.

## Real OpenCode staging acceptance

Use the image produced for the tested branch commit after target-commit CI passes.
Record the image tag/digest, staging origin, runtime, OpenCode version/model and
the workspace/session used. Do not put credentials or tokens in the report.
Both `VK_QA_MODE` and legacy `QA_MODE` must be absent or false for this layer.

The QA Compose file defaults to `sysbox-runc`; its host must support that runtime.
Use the staging deployment's actual configuration rather than assuming this
development container is the staging host. Set `SITE_ORIGIN` to the deployed
origin so preview URL generation uses the correct host and scheme.

1. Open an existing craft and confirm its history and selected session load.
   Change sessions, enter a draft, switch crafts, then reload and confirm the
   selected session and draft restore to the correct surface.
2. Create a workspace using OpenCode and request a small named file change.
   Confirm real streamed output and the resulting file. Verify the destination
   Agent becomes active and the submitting creation craft disappears. Repeat
   while navigating elsewhere during creation; completion must not steal focus.
3. Change the supported model/reasoning and permission mode. Send a follow-up and
   confirm OpenCode uses the intended settings. If a feature is unsupported by
   that model/provider, record that explicitly rather than counting its absence
   as a successful interaction.
4. Attach a file and paste an image where supported. Ask the agent to describe
   their contents. Remove an unsent attachment and confirm it is not submitted.
5. During an active request, queue then cancel a follow-up, and stop execution.
   Confirm the actual process stops. Exercise message edit/retry and Your
   Messages navigation against multiple real turns, verifying the intended turn
   is selected and retried.
6. Exercise an applicable approval or question flow. Confirm the correct session
   pauses, the user response is accepted, and real execution resumes. Check
   context usage after a provider response that reports usage.
7. Open workspace tasks against a populated Beads store. Confirm counts and
   refresh, open a form, then select a housekeeping session. Confirm that session
   receives exactly `Please do housekeeping on this workspace's beads`.
8. Configure a real preview process/slot in PreviewServer, start it, and open it
   from Agent. Confirm the server-provided URL is reachable through staging
   DNS/TLS/proxy and serves the expected application. Check disabled slots and
   error/recovery behavior.
9. Repeat the core create/reopen/send/menu interactions at mobile width and
   confirm overlays and popovers do not prevent navigation or sending.

Record pass/fail and observed evidence for each workflow in `task-9hp` and
`task-7tg`. Real-agent retry/paste semantics, actual OpenCode behavior and real
preview serving remain manual acceptance until those results are recorded.
Restart-persistence testing and an all-provider matrix are outside the approved
gate; broader settings, PR review, advanced Beads, DockView and Monaco remain
separate follow-ups.
