# Open from GitHub wizard rewrite plan

## Goal

Rewrite the Open from GitHub flow as one wizard.

Do not adapt the current dialog-state pile. Model the user decisions first. Keep backend recovery and safety rules, but do not expose backend implementation details as separate screens.

## Current problem

`OpenFromGitHub.tsx` grew by adding one dialog state for each backend branch.

This made the UI hard to reason about:

- Title and message are selected through a long conditional chain.
- Body rendering is another long conditional chain.
- Async resolution states are mixed with user decisions.
- Backend terms leak into the UI, such as direct work and local versus remote branches.
- Voyage and space are presented as separate choices even though the user only wants a destination.
- Existing workspace open can be forced through unnecessary later steps.

## Product model

The user is trying to answer three questions:

1. How can this repository be accessed on this machine?
2. Should VD reuse existing work or create new work?
3. Where should the workspace open?

Everything else is resolution, validation, or progress.

## Wizard stages

### Stage 1: Repository access

Show this stage only when the repository is not already cloned or registered locally.

Title:

> Would you like to fork or just clone this repository?

Choices:

- **Fork**
  - This allows you to make changes and push to GitHub.
- **Clone without fork**
  - This is useful for general analysis and local-only work. You can fork later.

Skip this stage when the repository is already local.

Expected behavior:

- Fork path may use a writable fork or ask the user to create one.
- Clone path clones the source repository without requiring fork access.
- After this stage, the wizard should know the local VK repo and remote.

### Stage 2: Existing work

Show this stage only when matching work exists.

Examples:

- active PR workspace
- archived PR workspace
- existing issue workspace mapping
- related PR work for an issue
- multiple matching workspaces

Primary choices:

- **Open existing workspace**
- **Reopen archived workspace** when applicable
- **Create new workspace instead** when safe and useful
- **Forget stale mapping** when the mapped workspace no longer exists

If the user opens or reopens existing work, skip branch/work-mode stages.

After an existing workspace is selected, go directly to the Voyage stage.

Default Voyage rule for existing work:

1. If one or more Voyages already contain the workspace, select the most recently used or updated one.
2. Otherwise select the current Voyage.
3. Allow choosing another existing Voyage or creating a new Voyage.

### Stage 3: Branch and work mode

Show this stage only when the user is creating new work.

Title:

> How should this workspace work?

Controls:

- Branch selector.
- Mode cards:
  - **Use existing branch**
  - **Create new workspace branch**

Do not use the term **direct work** in the UI.

`Use existing branch` behavior:

- If the selected branch exists locally, use it.
- If the selected branch is remote-only, create a local tracking branch behind the scenes, then use that local branch.
- If the derived local branch already exists with a different upstream, show a clear error.
- If the local branch is already checked out in another worktree, show a clear error.

`Create new workspace branch` behavior:

- Create a new editable workspace branch from the selected base branch.

Default mode:

- Protected branch: create new workspace branch.
- Default branch: create new workspace branch.
- Unknown branch protection: create new workspace branch.
- Non-default unprotected branch: use existing branch.

### Stage 4: Voyage

Show this stage before opening or creating the workspace.

Do not show a Space picker.

Spaces are legacy for this flow. Put the workspace in the first available non-system space automatically.

Controls:

- Existing Voyage selector.
- Create new Voyage option with name input.

Defaults:

- For existing work, prefer the most recently used or updated Voyage that already contains the workspace.
- Otherwise use the current Voyage.
- If there is no current Voyage, create a sensible default name from the GitHub target.

Primary button:

- **Open workspace** for existing work.
- **Create workspace** for new work.
- **Reopen workspace** for archived work.

There is no separate review stage.

### Stage 5: Running

This is not a decision stage.

Show progress in the same dialog while the action runs.

Possible messages:

- Cloning repository…
- Creating local tracking branch…
- Creating workspace branch…
- Reopening workspace…
- Opening workspace in Voyage…

On success, close the dialog and navigate/open the workspace.

On failure, keep the user in the wizard with an actionable error.

## State shape

Use one wizard state, not many unrelated dialog states.

```ts
type OpenGithubWizard = {
  step: "repository-access" | "existing-work" | "branch" | "voyage" | "running";
  target: ParsedGithubTarget;
  repo?: ResolvedRepoChoice;
  access?: "fork" | "clone";
  existingWork?: ExistingWorkChoice;
  workMode?: WorkModeChoice;
  voyage?: VoyageChoice;
  status?: RunningStatus;
  error?: string;
};
```

Stage skipping is derived from loaded facts.

Do not create separate top-level dialog states for every backend case.

## Component shape

Use plain stage components.

```tsx
<OpenFromGithubWizardDialog>
  {step === "repository-access" && <RepositoryAccessStep />}
  {step === "existing-work" && <ExistingWorkStep />}
  {step === "branch" && <BranchWorkModeStep />}
  {step === "voyage" && <VoyageStep />}
  {step === "running" && <RunningStep />}
</OpenFromGithubWizardDialog>
```

Avoid:

- generic wizard framework
- config-driven step engine
- XState
- render maps that hide control flow
- preserving current state names as components

## Backend implications

The UI should stop caring whether a branch is local or remote-only.

Backend or VK client flow must support:

- using an existing local branch;
- creating a local tracking branch for a remote-only branch;
- reporting local branch collision;
- reporting branch already checked out elsewhere;
- preserving branch protection defaults.

The branch/work-mode API should accept intent, not UI implementation detail.

Candidate input:

```ts
type WorkModeChoice =
  | { type: "use-existing-branch"; branch: string }
  | { type: "create-workspace-branch"; baseBranch: string; workspaceName?: string };
```

## Acceptance checks

### Repository access

- Already cloned repositories skip repository access.
- Uncloned repositories show Fork and Clone without fork.
- Fork path still handles no writable fork.
- Clone path does not require fork access.

### Existing work

- Existing workspace open skips branch/work-mode.
- Existing workspace defaults to a Voyage that already contains it when possible.
- Archived workspace can be reopened without creating a duplicate.
- Stale mapping repair remains explicit.

### Branch/work mode

- UI says Use existing branch, not Work directly.
- Remote-only branch can be selected for Use existing branch.
- System creates a local tracking branch behind the scenes.
- Local branch collision gives a clear error.
- Branch checked out elsewhere gives a clear error.
- Protected/default/unknown branches default to new workspace branch.

### Voyage

- No Space picker is shown.
- Current Voyage is selected by default when no existing-work Voyage applies.
- First available non-system space is used automatically.
- User can select existing Voyage or create a new one.

### Running and errors

- No review stage is shown.
- The primary action immediately performs the operation.
- Progress appears in the same dialog.
- Failures keep the wizard open with an actionable message.

## Suggested implementation slices

1. Add branch backend support for `use-existing-branch` with remote tracking branch creation.
2. Add a new wizard view model behind the existing entry point.
3. Implement the new wizard UI for repo/tree/blob first.
4. Add PR existing-work reuse.
5. Add issue existing-work reuse and stale mapping repair.
6. Remove old dialog states after parity tests pass.

## Open decisions for human discussion

1. Should remote-only `Use existing branch` create a local branch automatically, or should it ask first?
2. What is the exact collision policy when `feature` exists locally but `origin/feature` was selected?
3. Should `Create new workspace branch` still allow custom workspace branch names in this wizard?
4. Which Voyage timestamp should decide the default for existing work: Voyage updated time, tab group last visited time, or saved Voyage creation time?
5. Should `Create new workspace instead` be available when an existing issue workspace mapping exists?
