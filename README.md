# Vibe Dashboard

**Break out of the terminal and into your personal dashboard.**

Vibe Dashboard gives you one browser workspace for repositories, coding agents, decisions,
previews, and follow-up work.

> **README under construction:** product screenshots and several documentation links are being
> finalized.

[Self-host](#self-host) · [Explore the features](#features) · [In-progress work](#in-progress) · [Documentation](#documentation)

<!-- SCREENSHOT: hero-dashboard-workflow | 1440x900 | repository workspace, active agent, task context, preview URL | use public sample data and redact accounts -->
![Placeholder for the Vibe Dashboard workspace](https://picsum.photos/seed/vd-hero-dashboard/1440/900?grayscale&blur=2)

> **Media placeholder:** a repository workspace moving from assigned agent work to a running
> preview and a clear next action.

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

Give each task a durable home instead of spreading its state across terminal tabs. A workspace
keeps the repository, task context, agent sessions, working tree, and next human action together.

Vibe Dashboard manages Git worktrees so independent tasks can use separate branches without
overwriting one another. Start and follow supported coding-agent sessions from the workspace
that owns their changes.

<!-- SCREENSHOT: repository-workspaces | 1440x900 | workspace list, selected repository, worktree branch, active agent session | do not imply runtime security isolation -->
![Placeholder for repository workspaces and agent sessions](https://picsum.photos/seed/vd-repository-workspaces/1440/900?grayscale&blur=2)

> **Media placeholder:** multiple repository workspaces with separate worktrees and an agent
> session attached to the selected task.

## Automatic nudging

Long-running agent work should not stop merely because a turn ended. Automatic nudging checks
work that still has an active goal and prompts the responsible agent to continue when another
action is ready.

The workspace keeps ownership visible, so continuation happens in the task that already holds
the relevant context rather than in a new, disconnected chat.

<!-- SCREENSHOT: automatic-nudging | 1440x900 | active goal, paused agent, automatic continuation, resulting progress | show controls and avoid fabricated timing claims -->
![Placeholder for automatic agent nudging](https://picsum.photos/seed/vd-automatic-nudging/1440/900?grayscale&blur=2)

> **Media placeholder:** an agent automatically continuing an unfinished workspace goal.

## Per-workspace beads management

Vibe Dashboard creates and manages a Beads task store for each workspace. Tasks, dependencies,
assignments, and acceptance criteria survive individual chat turns and remain attached to the
work that owns them.

The same workflow applies to a workspace containing one repository or several repositories.
Each agent can inspect the shared task graph and pick up the next unblocked item without relying
on a transient conversation checklist.

<!-- SCREENSHOT: per-workspace-beads | 1440x900 | workspace, task tree, dependency, single- and multi-repository context | sample task names only -->
![Placeholder for per-workspace Beads management](https://picsum.photos/seed/vd-workspace-beads/1440/900?grayscale&blur=2)

> **Media placeholder:** a workspace task graph shared by agents working across its repositories.

## Structured questions

When an agent needs a nuanced decision, it can create a BeadsForm instead of burying several
questions in a long chat message. The form presents choices, explanations, annotations, and
free-form fields in the browser.

Submitting the form returns a normalized response that agents can consume without interpreting
an ambiguous block of prose. The decision remains discoverable with the task that requested it.

<!-- SCREENSHOT: structured-questions | 1440x900 | originating task, BeadsForm choices, annotation, normalized response | sample values only -->
![Placeholder for a structured BeadsForm decision](https://picsum.photos/seed/vd-structured-questions/1440/900?grayscale&blur=2)

> **Media placeholder:** a BeadsForm beside its originating task and normalized response.

## Preview URLs

Open a running application from the workspace that produced it. Preview URLs keep the running
result connected to its repository, agent, and task instead of leaving users to find a port in
terminal output.

Use the preview to exercise the change while the agent retains the surrounding implementation
context.

<!-- SCREENSHOT: preview-urls | 1440x900 | workspace, detected preview, open URL action, running application | use a harmless sample app -->
![Placeholder for a workspace preview URL](https://picsum.photos/seed/vd-preview-urls/1440/900?grayscale&blur=2)

> **Media placeholder:** a workspace opening its running application through a preview URL.

## Issue intake

Bring existing work into the dashboard without copying its context by hand. GitHub, Jira, and
Linear issues can become workspace tasks while retaining a reference to their source.

The imported request gives the assigned agent a concrete starting point and keeps the original
tracker visible during implementation.

<!-- SCREENSHOT: issue-intake | 1440x900 | GitHub, Jira, or Linear source issue becoming a workspace task | use public or synthetic issue data -->
![Placeholder for GitHub, Jira, and Linear issue intake](https://picsum.photos/seed/vd-issue-intake/1440/900?grayscale&blur=2)

> **Media placeholder:** an external issue becoming assigned work without losing its source.

## Create work from repositories

Start from the code when there is no pre-existing issue. Create a workspace for a repository, or
paste a supported GitHub URL and let Vibe Dashboard resolve the repository context needed to
begin work.

The resulting workspace owns its branch, worktree, task state, and agent sessions from the
start.

<!-- SCREENSHOT: repository-work-creation | 1440x900 | GitHub URL input, resolved repository, new workspace | public repository only -->
![Placeholder for creating work from a GitHub repository](https://picsum.photos/seed/vd-create-from-repository/1440/900?grayscale&blur=2)

> **Media placeholder:** a GitHub URL resolving into a ready repository workspace.

## Browser VS Code

Open the complete workspace in browser VS Code whenever you need to inspect files, use a
terminal, debug a process, or take over an edit directly. It is a foundational escape hatch:
the same repository and worktree remain available when the dashboard's focused views are not
enough.

After manual work, the workspace and its agents continue from the changed files rather than
requiring a separate local checkout.

<!-- SCREENSHOT: browser-vscode | 1440x900 | workspace file tree, editor, terminal, dashboard navigation | redact repository secrets -->
![Placeholder for browser VS Code in a workspace](https://picsum.photos/seed/vd-browser-vscode/1440/900?grayscale&blur=2)

> **Media placeholder:** browser VS Code opened directly in the selected workspace worktree.

## Agent coordination

Agents can discover collaborators, exchange guarded messages, and hand off work without asking
the user to relay every update. Agent-control MCP exposes those operations through the same
workspace-aware interface agents already use for their tools.

Messages retain explicit sender, recipient, and workspace ownership so coordination does not
turn into an untraceable shared chat.

<!-- SCREENSHOT: agent-coordination | 1440x900 | two named agents, guarded message, workspace ownership, MCP action | sample content only -->
![Placeholder for agent-to-agent coordination](https://picsum.photos/seed/vd-agent-coordination/1440/900?grayscale&blur=2)

> **Media placeholder:** one workspace agent handing a bounded task to another through MCP.

## Callbacks

An agent can start a long-running command, register a callback, and yield instead of keeping an
interactive turn open. When the command completes, the callback returns the result and resumes
the owning agent with the workspace context intact.

Callbacks are useful for builds, deployments, and test suites whose completion is known but not
immediate.

<!-- SCREENSHOT: callbacks | 1440x900 | long-running command, registered callback, completion, resumed agent | show real timestamps only -->
![Placeholder for an agent callback](https://picsum.photos/seed/vd-agent-callbacks/1440/900?grayscale&blur=2)

> **Media placeholder:** a long-running command completing and returning control to its agent.

## Docker-in-Docker isolation

Run workspace containers through Sysbox rather than granting ordinary workspace processes
direct control of the host Docker daemon. This enables Docker-in-Docker workflows with a
stronger runtime boundary for agent-created containers.

The host must install and support Sysbox. Select its runtime when starting Vibe Dashboard:

```bash
VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up
```

Sysbox changes the container boundary; it does not make untrusted code risk-free. Review the
[self-hosting and operations guide](user-docs/self-hosting.md) before exposing repositories,
credentials, or network services.

<!-- SCREENSHOT: sysbox-docker-in-docker | 1440x900 | runtime configuration, workspace container, nested Docker workload | never show credentials -->
![Placeholder for Sysbox Docker-in-Docker isolation](https://picsum.photos/seed/vd-sysbox-dind/1440/900?grayscale&blur=2)

> **Media placeholder:** a workspace using `sysbox-runc` to run its own Docker workload.

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
