# Vibe Dashboard

**Break out of the terminal, and into your personal dashboard**

Note: This readme is currently in-progress and under construction 10/16/26 :)

[Self-host](#self-host-in-60-seconds) · [Explore the workflow](#from-request-to-reviewed-change) · [Documentation](#documentation) · [Support](#support)

<!-- SCREENSHOT: hero-issue-to-review | mixed status | 1440x900 | issue, active agent, structured decision, preview, review | redact repository/account data -->
![Placeholder for the Vibe Dashboard issue-to-review workflow](https://picsum.photos/seed/vd-hero-issue-review/1440/900?grayscale&blur=2)

> **Hero media placeholder:** an issue becomes agent work, a structured decision returns to
> the agent, and the resulting change enters review.

## Self-host

```bash
git clone https://github.com/vibe-dashboard/vibe-dashboard.git
cd vibe-dashboard
docker compose up
```

Open <http://localhost:3001>. A successful start shows the workspace UI. The default image is
`ghcr.io/vibe-dashboard/vk-vd:latest`

See [Self-hosting and operations](user-docs/self-hosting.md) for authentication, ports, preview
routing, persistent credentials, tracing, private networking, and browser sidecars.

## From request to reviewed change

1. Bring in work from a repository or external task.
2. Give an agent a workspace and the context to act.
3. Resolve nuanced questions in structured forms instead of long chat threads.
4. Preview the result and inspect the diff.
5. Return feedback to the agent or finish in browser VS Code.

### Features

- [Run agents in isolated workspaces](#run-agents-in-isolated-workspaces)
- [Bring work into the dashboard](#bring-work-into-the-dashboard)
- [Turn agent questions into decisions](#turn-agent-questions-into-decisions)
- [Preview, review, and take over](#preview-review-and-take-over)
- [Keep context between agent turns](#keep-context-between-agent-turns)
- [Prepare safer development environments](#prepare-safer-development-environments)
- [Reach the workspace where you work](#reach-the-workspace-where-you-work)

**Available** means usable from the current self-hosted baseline. **In progress** means working
development exists but is not stable. **Experimental** means dogfoodable and subject to change.
**Planned** means direction only.

## Run agents in isolated workspaces

**Available · In progress**

**Problem:** agents scatter work across terminal tabs.

**Action:** start and follow Codex,
Claude, or OpenCode sessions from a repository workspace.

**Result:** the task, conversation,
working tree, and next human action stay together.

Agent-to-agent setup is still difficult. In-progress agent-control MCP work makes catch-up,
guarded messaging, callbacks, workspace creation, and preview control available without manual
CLI setup. **PR link pending.**

<!-- SCREENSHOT: multi-agent-workspace | available + in progress | 1440x900 | two sessions, workspace task, handoff state | do not imply cloud isolation -->
![Placeholder for two agent sessions in one workspace](https://picsum.photos/seed/vd-multi-agent-workspace/1440/900?grayscale&blur=2)

> **Media placeholder:** two sessions working from one repository workspace.

## Bring work into the dashboard

**In progress**

**Problem:** requests lose context during handoff.

**Action:** open a GitHub URL as a workspace
or route an external issue into the dashboard.

**Result:** the source remains connected to the
workspace and agent executing it.

- [Open GitHub URLs as workspaces — PR #38](https://github.com/vibe-dashboard/vibe-dashboard/pull/38)
- Jira/Linear intake — **PR link pending**
- Chrome-assisted feedback capture — **PR link pending**

<!-- SCREENSHOT: work-intake | in progress | 1440x900 | source issue, workspace, assigned agent | public seed data -->
![Placeholder for external work entering Vibe Dashboard](https://picsum.photos/seed/vd-work-intake/1440/900?grayscale&blur=2)

> **Media placeholder:** an external issue opening as assigned workspace work.

## Turn agent questions into decisions

**Available**

**Problem:** Juggling multiple topics/decisions in the same chat can get cumbersome

**Action:** Use BeadsForm to streamline answering questions and provide annotations

**Result:** Decisions are memorialized and easily discoverable by all agents involved with the task

Core forms and attachments are available. Routing selected context to a specific agent is in
progress. **PR link pending.**

<!-- SCREENSHOT: structured-decisions | available + in progress | 1440x900 | request, form, normalized handoff | sample values only -->
![Placeholder for a structured agent decision form](https://picsum.photos/seed/vd-structured-decisions/1440/900?grayscale&blur=2)

> **Media placeholder:** a decision form beside its originating agent session.

## Preview, review, and take over

**Available · In progress · Experimental**

**Problem:** review spans a terminal, Git diff, and dev server.

**Action:** open browser VS
Code, inspect the preview and diff, then return specific feedback.

**Result:** the human stays
in control without reconstructing the environment.

Browser VS Code is available. Diff and feedback surfaces are in progress. Preview URLs are
experimental. **Diff-review PR link pending.**

<!-- SCREENSHOT: preview-review | mixed status | 1440x900 | preview, diff feedback, browser VS Code | label each surface status -->
![Placeholder for preview, diff, and review](https://picsum.photos/seed/vd-preview-review/1440/900?grayscale&blur=2)

> **Media placeholder:** the running change, its diff, and feedback returning to the agent.

## Keep context between agent turns

**Available · In progress**

**Problem:** durable task state outlives chat turns.

**Action:** use workspace-native Beads and
callbacks today; use the developing timeline and outline for longer work.

**Result:** work stays
attached to the workspace that owns it.

Agent summaries in commit messages are in progress and **optional** because git history is
durable and shared.

<!-- SCREENSHOT: durable-agent-context | mixed status | 1440x900 | task, callback, timeline/outline | separate branch captures if needed -->
![Placeholder for durable task and callback context](https://picsum.photos/seed/vd-durable-context/1440/900?grayscale&blur=2)

> **Media placeholder:** durable tasks and callback state, with developing navigation shown separately.

## Prepare safer development environments

**In progress**

- Vardash/Varlock environment values ([PR #48](https://github.com/vibe-dashboard/vibe-dashboard/pull/48); final `main` integration link pending)
- persistent Nix tools — **PR link pending**
- Sysbox runtime boundary ([PR #49](https://github.com/vibe-dashboard/vibe-dashboard/pull/49))
- turnkey private Tailscale access — **PR link pending**

These are development direction, not security guarantees. Inactivity/auto-sleep is omitted.

<!-- SCREENSHOT: safe-environment | in progress | 1440x900 | sample variable, tool environment, private URL | never capture credentials -->
![Placeholder for safe environment configuration](https://picsum.photos/seed/vd-safe-environment/1440/900?grayscale&blur=2)

> **Media placeholder:** safe sample configuration leading to a private preview.

## Reach the workspace where you work

**Available · In progress**

The self-hosted dashboard works in a browser at desktop and narrow widths. Turnkey Tailscale
configuration is in progress. Managed hosting is waitlist-only. This README does not claim a
native mobile application.

<!-- SCREENSHOT: responsive-browser-access | available + in progress | desktop + phone browser | same real workspace -->
![Placeholder for desktop and phone browser access](https://picsum.photos/seed/vd-responsive-browser/1440/900?grayscale&blur=2)

> **Media placeholder:** the same workspace in desktop and phone browsers.

## Development index

| Work | Status | Evidence |
| --- | --- | --- |
| Timeline and conversation outline | In progress | PR link pending |
| Optional agent summaries in commits | In progress | PR link pending |
| Vardash/Varlock | In progress | [PR #48](https://github.com/vibe-dashboard/vibe-dashboard/pull/48) |
| Persistent Nix tools | In progress | PR link pending |
| Sysbox runtime | In progress | [PR #49](https://github.com/vibe-dashboard/vibe-dashboard/pull/49) |
| Turnkey Tailscale access | In progress | PR link pending |
| Voyage/DockView workspace grids | In progress | PR link pending |

## Documentation

- [Self-hosting and operations](user-docs/self-hosting.md)
- Integration guides — **placeholder: documentation hub pending**
- Feature guides — **placeholder: documentation hub pending**

## Support

- Bugs: [GitHub Issues](https://github.com/vibe-dashboard/vibe-dashboard/issues)
- Product questions and community — **placeholder: destination pending**

## Contributing

```bash
npm run check-types
npm test
npm run test:e2e:install
npm run test:e2e
```

Push your branch to your remote to run the full GitHub Actions suite; local checks are not the
entire release gate.

## License

Vibe Dashboard is distributed under the terms in [LICENSE](LICENSE).
