# Vibe Dashboard

**Break out of the terminal and into your personal dashboard.**

Vibe Dashboard gives you one browser workspace for repositories, coding agents, decisions,
previews, and follow-up work.

> **README under construction:** product screenshots and several documentation links are being
> finalized.

[Self-host](#self-host) · [Explore the features](#features) · [In-progress work](#in-progress) · [Documentation](#documentation)

<!-- SCREENSHOT: hero-dashboard-workflow | 1440x900 | repository workspace, active agent, task context, preview URL | use public sample data and redact accounts -->
![Placeholder for the Vibe Dashboard workspace](https://picsum.photos/seed/vd-hero-dashboard/1440/900?grayscale&blur=2)

> **Copy and media TODO:** explain the overall repository → agent → result workflow, then replace
> this image with a hero screenshot or GIF showing a workspace, agent, task context, and preview.

## Self-host

You need Docker with Compose and credentials for the coding agents you choose to run.

```bash
git clone https://github.com/vibe-dashboard/vibe-dashboard.git
cd vibe-dashboard
docker compose up
```

Open <http://localhost:3001>. No environment variables are required for the default local
configuration. It uses `ghcr.io/vibe-dashboard/vk-vd:latest`.

For a stable release instead of the moving `latest` tag:

```bash
VKVD_IMAGE_VERSION=0.1.0 docker compose up
```

See [Self-hosting and operations](user-docs/self-hosting.md) for authentication, persistence,
ports, routing, tracing, private networking, and the current Docker trust boundary.

## Features

- [Repository workspaces](#repository-workspaces)
- [Automatic nudging](#automatic-nudging)
- [Per-workspace beads management](#per-workspace-beads-management)
- [Structured questions](#structured-questions)
- [Preview URLs](#preview-urls)
- [Issue intake](#issue-intake)
- [Create work from repositories](#create-work-from-repositories)
- [Browser VS Code](#browser-vs-code)
- [Agent coordination](#agent-coordination)
- [Callbacks](#callbacks)
- [Docker-in-Docker isolation](#docker-in-docker-isolation)

## Repository workspaces

> **Copy TODO:** describe repository workspaces, Git worktree management, and agent sessions.

- [ ] Explain what a workspace contains and what stays attached to it.
- [ ] Explain how separate Git worktrees prevent concurrent tasks from overwriting one another.
- [ ] Explain how users start and follow coding-agent sessions.

<!-- SCREENSHOT: repository-workspaces | 1440x900 | workspace list, selected repository, worktree branch, active agent session | do not imply runtime security isolation -->
![Placeholder for repository workspaces and agent sessions](https://picsum.photos/seed/vd-repository-workspaces/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture multiple repository workspaces with separate worktrees and an agent
> session attached to the selected task.

## Automatic nudging

> **Copy TODO:** describe when an agent is automatically prompted to continue and how the user
> remains in control.

- [ ] Explain what makes work eligible for a nudge.
- [ ] Explain what the agent receives when it resumes.
- [ ] Explain how nudging stops when the work is complete or blocked.

<!-- SCREENSHOT: automatic-nudging | 1440x900 | active goal, paused agent, automatic continuation, resulting progress | show controls and avoid fabricated timing claims -->
![Placeholder for automatic agent nudging](https://picsum.photos/seed/vd-automatic-nudging/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture an agent automatically continuing an unfinished workspace goal.

## Per-workspace beads management

> **Copy TODO:** describe automatic Beads management for single-repository and multi-repository
> workspaces.

- [ ] Explain when and where the workspace Beads store is created.
- [ ] Explain how tasks, dependencies, assignments, and acceptance criteria remain durable.
- [ ] Explain how management differs, if at all, between single- and multi-repository workspaces.

<!-- SCREENSHOT: per-workspace-beads | 1440x900 | workspace, task tree, dependency, single- and multi-repository context | sample task names only -->
![Placeholder for per-workspace Beads management](https://picsum.photos/seed/vd-workspace-beads/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a workspace task graph shared by agents working across its
> repositories.

## Structured questions

> **Copy TODO:** describe BeadsForms and normalized responses.

- [ ] Explain how an agent requests a structured decision.
- [ ] Explain what the user can answer or annotate in the browser.
- [ ] Explain how the normalized response returns to the task and its agents.

<!-- SCREENSHOT: structured-questions | 1440x900 | originating task, BeadsForm choices, annotation, normalized response | sample values only -->
![Placeholder for a structured BeadsForm decision](https://picsum.photos/seed/vd-structured-questions/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a BeadsForm beside its originating task and normalized response.

## Preview URLs

> **Copy TODO:** describe how preview URLs expose a running application from its owning
> workspace.

- [ ] Explain how the preview is discovered or configured.
- [ ] Explain where the user opens it.
- [ ] Explain its lifecycle and relevant access boundary.

<!-- SCREENSHOT: preview-urls | 1440x900 | workspace, detected preview, open URL action, running application | use a harmless sample app -->
![Placeholder for a workspace preview URL](https://picsum.photos/seed/vd-preview-urls/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a workspace opening its running application through a preview
> URL.

## Issue intake

> **Copy TODO:** describe GitHub, Jira, and Linear issue intake.

- [ ] Explain how each provider is connected.
- [ ] Explain which issue context enters the workspace.
- [ ] Explain how the source issue remains linked to the resulting work.

<!-- SCREENSHOT: issue-intake | 1440x900 | GitHub, Jira, or Linear source issue becoming a workspace task | use public or synthetic issue data -->
![Placeholder for GitHub, Jira, and Linear issue intake](https://picsum.photos/seed/vd-issue-intake/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture an external issue becoming assigned work without losing its
> source.

## Create work from repositories

> **Copy TODO:** describe repository workspace creation and opening GitHub URLs.

- [ ] Explain the repository-first path when no issue exists.
- [ ] List the GitHub URL types users can paste.
- [ ] Explain what Vibe Dashboard creates after resolving the repository.

<!-- SCREENSHOT: repository-work-creation | 1440x900 | GitHub URL input, resolved repository, new workspace | public repository only -->
![Placeholder for creating work from a GitHub repository](https://picsum.photos/seed/vd-create-from-repository/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a GitHub URL resolving into a ready repository workspace.

## Browser VS Code

> **Copy TODO:** describe browser-based inspection, editing, terminals, and human takeover.

- [ ] Explain how Browser VS Code opens the selected workspace and worktree.
- [ ] Explain what users can do there that focused dashboard views do not cover.
- [ ] Explain how agents continue after a human edits the workspace.

<!-- SCREENSHOT: browser-vscode | 1440x900 | workspace file tree, editor, terminal, dashboard navigation | redact repository secrets -->
![Placeholder for browser VS Code in a workspace](https://picsum.photos/seed/vd-browser-vscode/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture browser VS Code opened directly in the selected workspace
> worktree.

## Agent coordination

> **Copy TODO:** describe agent-to-agent communication and Agent Control MCP.

- [ ] Explain how agents discover and address one another.
- [ ] Explain messaging and bounded handoffs.
- [ ] Explain which coordination operations Agent Control MCP exposes.

<!-- SCREENSHOT: agent-coordination | 1440x900 | two named agents, guarded message, workspace ownership, MCP action | sample content only -->
![Placeholder for agent-to-agent coordination](https://picsum.photos/seed/vd-agent-coordination/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture one workspace agent handing a bounded task to another through
> MCP.

## Callbacks

> **Copy TODO:** describe yielding during long-running work and resuming when it completes.

- [ ] Explain how an agent registers a callback.
- [ ] Explain what happens while the command runs.
- [ ] Explain how completion returns to the owning agent and workspace.

<!-- SCREENSHOT: callbacks | 1440x900 | long-running command, registered callback, completion, resumed agent | show real timestamps only -->
![Placeholder for an agent callback](https://picsum.photos/seed/vd-agent-callbacks/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a long-running command completing and returning control to its
> agent.

## Docker-in-Docker isolation

> **Copy TODO:** describe Docker-in-Docker support through Sysbox, including its benefits and
> trust boundary.

- [ ] Explain what runs inside the Sysbox-backed workspace container.
- [ ] Explain what Sysbox isolates and what it does not guarantee.
- [ ] Explain that the host must install and support Sysbox.

Select the runtime when starting Vibe Dashboard:

```bash
VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up
```

Review the [self-hosting and operations guide](user-docs/self-hosting.md) before exposing
repositories, credentials, or network services.

<!-- SCREENSHOT: sysbox-docker-in-docker | 1440x900 | runtime configuration, workspace container, nested Docker workload | never show credentials -->
![Placeholder for Sysbox Docker-in-Docker isolation](https://picsum.photos/seed/vd-sysbox-dind/1440/900?grayscale&blur=2)

> **Screenshot TODO:** capture a workspace using `sysbox-runc` to run its own Docker workload.

## In progress

These capabilities are being developed and are not part of the available feature showcase yet:

- **Targeted context delivery:** route selected evidence or attachments to a specific agent.
- **Code diff review:** inspect workspace changes in a focused review surface.
- **Review feedback:** return specific requested changes to the responsible agent.
- **Environment-value management:** define and validate workspace configuration with Vardash/Varlock.
- **Persistent Nix tools:** retain declared development tools across workspace sessions.
- **Private Tailscale access:** provide turnkey private access to dashboards and previews.
- **Browser automation:** give agents controlled browser access for testing and inspection.

## Documentation

- [Self-hosting and operations](user-docs/self-hosting.md)

## Support

- [Report bugs and request features](https://github.com/vibe-dashboard/vibe-dashboard/issues)

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
