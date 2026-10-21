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

## Human decisions from form

Decisions captured on September 23, 2026:

- Show existing work before repository access.
- Opening or reopening existing workspace skips branch/work-mode steps.
- Remote-only selected branches create local tracking branches automatically.
- The selected-branch mode is called **Work on selected branch**.
- Spaces stay hidden. New workspace crafts are placed in the system/default Space, currently Home; existing craft locations are reused.
- If an active issue workspace mapping exists, **Create new workspace instead** is available only behind explicit confirmation.
- PR URLs with no existing workspace default to the PR head branch when safe.
- Users may edit the generated name for a new workspace branch. This may require VK API changes.
- Existing work defaults to the most recently used or updated Voyage/location that already contains the workspace.
- Suggested workspace names should factor in the issue or PR title/name.

## Wizard stages

### Stage 0: Resolve target facts

This is not a user stage.

The system resolves enough facts to decide which stages are necessary.

Resolve:

- target type: repository, PR, issue, tree, or blob;
- matching local VK repos and remotes;
- existing active or archived workspaces;
- issue mappings and stale mappings;
- related PRs for issue targets;
- whether the repository is already cloned or registered locally.

Do not ask about repository access before checking existing work when existing work can be found without cloning.

### Stage 1: Existing work

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
- **Create new workspace instead** only behind explicit confirmation when an active issue workspace mapping exists
- **Forget stale mapping** when the mapped workspace no longer exists

If the user opens or reopens existing work, skip branch/work-mode stages.

After an existing workspace is selected, go directly to the Voyage stage.

Default Voyage rule for existing work:

1. If one or more Voyages already contain the workspace, select the most recently used or updated one.
2. Otherwise select the current Voyage.
3. Allow choosing another existing Voyage or creating a new Voyage.

### Stage 2: Repository access

Show this stage only when all of these are true:

- the user is creating new work;
- the repository is not already cloned or registered locally;
- repository access cannot be inferred from an existing workspace.

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

### Stage 3: Branch choice

Show this stage only when the user is creating new work.

Title:

> How should this workspace work?

Controls:

- Branch selector.
- Mode cards:
  - **Work on selected branch**
  - **Create new workspace branch**

Do not use the term **direct work** in the UI.

`Work on selected branch` behavior:

- If the selected branch exists locally, use it.
- If the selected branch is remote-only, create a local tracking branch behind the scenes, then use that local branch.

The backend must own:

- deriving the local branch name;
- creating the tracking branch;
- detecting local branch collisions;
- detecting branches already checked out in another worktree;
- returning clear errors.

`Create new workspace branch` behavior:

- Create a new editable workspace branch from the selected base branch.
- Suggest a workspace branch name from the GitHub target, factoring in the issue or PR title/name.
- Let the user edit the new workspace branch name on the spot.
- If VK does not currently accept custom branch names for this operation, add the API support as part of implementation.

Default mode:

- Protected branch: create new workspace branch.
- Default branch: create new workspace branch.
- Unknown branch protection: create new workspace branch.
- Non-default unprotected branch: work on selected branch.

Target-specific defaults:

- Issue URL: default to a new workspace branch from the configured/default target branch.
- PR URL: if no existing PR workspace exists, default to the PR head branch when safe; create a local tracking branch automatically if the head is remote-only.
- Tree/blob URL: default from the resolved containing branch or permalink rules.
- Repository root URL: default from the configured/default target branch.

### Stage 4: Voyage

Show this stage before opening or creating the workspace.

Do not show a Space picker by default.

Spaces are legacy for this flow. Do not show them in the wizard and do not assume any non-system Spaces exist. New users may only have the system Home Space.

Craft placement rule:

1. If opening into an existing Voyage and the workspace craft already exists in a Space, reuse that Space/craft location.
2. Else create the workspace craft in the platform-owned system/default Space, currently the Home Space.
3. Do not create a user-visible non-system Space just for this wizard.

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
  step: "existing-work" | "repository-access" | "branch" | "voyage" | "running";
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
  {step === "existing-work" && <ExistingWorkStep />}
  {step === "repository-access" && <RepositoryAccessStep />}
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
- erroring clearly when the derived local tracking branch already exists but tracks a different upstream;
- reporting branch already checked out elsewhere;
- preserving branch protection defaults.

The branch/work-mode API should accept intent, not UI implementation detail.

Candidate input:

```ts
type WorkModeChoice =
  | { type: "work-on-selected-branch"; branch: string }
  | { type: "create-workspace-branch"; baseBranch: string; branchName: string };
```

## Acceptance checks

### Repository access

- Already cloned repositories skip repository access.
- Uncloned repositories show Fork and Clone without fork.
- Fork path still handles no writable fork.
- Clone path does not require fork access.

### Existing work

- Existing workspace is offered before repository access when it can be resolved without cloning.
- Existing workspace open skips branch/work-mode.
- Existing workspace defaults to a Voyage that already contains it when possible.
- Archived workspace can be reopened without creating a duplicate.
- Stale mapping repair remains explicit.

### Branch/work mode

- UI says Work on selected branch, not Work directly.
- Remote-only branches create a local tracking branch behind the scenes.
- New workspace branch mode suggests a branch name from the issue/PR title and lets the user edit it.
- Local branch collision gives a clear error.
- Branch checked out elsewhere gives a clear error.
- Protected/default/unknown branches default to new workspace branch.

### Voyage

- No Space picker is shown.
- Current Voyage is selected by default when no existing-work Voyage applies.
- The wizard does not assume non-system Spaces exist. It reuses an existing craft location when present; otherwise it creates the craft in the platform-owned system/default Space, currently Home.
- User can select existing Voyage or create a new one.

### Running and errors

- No review stage is shown.
- The primary action immediately performs the operation.
- Progress appears in the same dialog.
- Failures keep the wizard open with an actionable message.

## Suggested implementation slices

1. Add branch backend support for `work-on-selected-branch` with remote tracking branch creation.
2. Add VK/API support for custom new workspace branch names if the current API does not support it.
3. Add a new wizard view model behind the existing entry point.
4. Implement the new wizard UI for repo/tree/blob first.
5. Add PR existing-work reuse and PR-head defaults.
6. Add issue existing-work reuse, stale mapping repair, and explicit-confirmation duplicate creation.
7. Remove old dialog states after parity tests pass.

## Final implementation decisions

- Custom new workspace branch names: VK should own final branch-name validation and workspace creation support; dashboard suggests the default name from the GitHub target.
- Remote tracking branch collision: if `origin/feature` maps to local `feature` and local `feature` already exists but tracks a different upstream, return a clear error. Do not silently rename or retarget it.
- Existing-work Voyage default: use the most specific actual last-used timestamp available for the workspace craft/tab group; if unavailable, fall back to Voyage updated time.
