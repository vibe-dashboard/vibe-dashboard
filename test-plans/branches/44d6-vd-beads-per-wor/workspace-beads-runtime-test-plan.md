# Test Plan: workspace-scoped beads runtime

Branch: `vk/44d6-vd-beads-per-wor`

Feature beads:

- `vkvw-ak6jg — Research per-workspace beads foundation`
- `vkvw-uwrda — Show error when bd commands are run in repo folders`
- `vkvw-g9lr4 — Docker e2e for workspace-scoped beads initialization`

## Goal

Verify from requirements, not from existing E2E implementation details, that a
real VK/VD runtime creates and maintains workspace-scoped beads automatically,
keeps VK bead-unaware, gives agents clear migration errors when they run `bd`
from repo folders, and has a safe offline migration path away from shared-server
bd state.

## Assumptions

- Docker runtime tests should run in CI for now; local Docker may be unavailable.
- VK owns generic workspace/session mechanics only.
- VD owns beads setup, beads paths, instruction fragments, punt behavior, and
  shared-server migration.
- The tester may inspect existing tests after this plan is written, but this
  plan itself is requirements-first.

## Test cases

### TEST_CASE_1A — Real Docker runtime boots VK and VD

Steps:

1. Trigger or inspect the branch CI job that builds the VK/VD Docker image.
2. Confirm the image includes a real VK server binary, real VD runtime code, the
   VD workspace beads setup script, and the `bd` wrapper.
3. Start the container through the documented CI smoke path.
4. Wait for VK and VD HTTP health/API endpoints to respond.

Expected:

- CI uses the branch code, not a mocked replacement for VK or VD.
- VK and VD are reachable inside the container.
- The container does not depend on local developer Docker state.

### TEST_CASE_2A — Create-only workspace initializes workspace beads

Steps:

1. In the running Docker runtime, create a disposable git repository.
2. Register that repository with VK.
3. Call VK's create-only workspace path for the repository.
4. Inspect the created workspace root.

Expected:

- A real VK workspace exists.
- No agent session/execution is created by the create-only path.
- The workspace root has `.beads/redirect`.
- The redirect target is under `VD_BEADS_DIRECTORY`, for example
  `/var/lib/vd/beads/workspaces/<workspace-id>/.beads`.
- The target beads store exists and has a usable bd config.
- VK code/config does not need a beads-specific directory variable.

### TEST_CASE_2B — Started workspace runs setup before agent work

Steps:

1. In the same runtime, create/start a VK workspace through the normal start
   path with a harmless prompt.
2. Before asserting agent output, inspect the workspace root and beads store.
3. Then wait for the first agent process to start or complete.

Expected:

- The generic VK setup command runs after VK creates baseline workspace files
  such as `AGENTS.md`/`CLAUDE.md` and before the agent does useful work.
- The same `.beads/redirect`, persisted store, and instruction behavior from
  `TEST_CASE_2A` is present.
- A setup failure would fail closed instead of starting an agent without beads
  context.

### TEST_CASE_3A — Managed instructions are inlined and customizable

Steps:

1. Configure the persisted VD workspace setup TOML to include the checked-in
   beads instruction fragment and a user append fragment.
2. Create a fresh workspace.
3. Read the generated `AGENTS.md` and `CLAUDE.md` files.
4. Change only the user append fragment.
5. Rerun the workspace setup command for the same workspace.

Expected:

- Generated agent files contain inlined instruction text, not links that require
  the agent to read separate files.
- Checked-in required beads instructions are present by default.
- User append text is present.
- Rerunning setup updates the owned block without erasing unrelated human text.
- Seeding does not overwrite user-customized persisted files after first setup.

### TEST_CASE_4A — bd from workspace root uses the workspace store

Steps:

1. From the workspace root, run `bd context` or an equivalent read command.
2. Create a throwaway bead from the workspace root.
3. Inspect the persisted workspace beads store under `VD_BEADS_DIRECTORY`.

Expected:

- `bd` resolves the workspace-scoped store, not a repo-scoped `.beads` database.
- The throwaway bead is visible in the workspace store.
- No repo folder receives a new independent `.beads` database.

### TEST_CASE_4B — bd from repo folders fails with migration guidance

Steps:

1. `cd` into a repository subdirectory below a workspace root.
2. Run a read-only `bd` command.
3. Run a mutating `bd` command.
4. Rerun one command with `--ignore-workspace-root`.

Expected:

- All normal `bd` commands from repo folders fail.
- The error clearly names the workspace root and tells the agent to rerun there.
- The wrapper does not auto-rerun from the workspace root.
- The wrapper does not create repo-level `.beads` redirect stubs.
- `--ignore-workspace-root` delegates to real `bd` and strips the override flag.

### TEST_CASE_5A — Workspace aggregate bead is created and refreshed

Steps:

1. Create a workspace with one registered repository.
2. Inspect the aggregate workspace bead/index database.
3. Add another repository to the workspace or recreate/ensure the workspace.
4. Inspect the aggregate workspace bead/index database again.

Expected:

- The aggregate database has one bead for the VK workspace.
- The aggregate bead includes workspace metadata and repository metadata.
- Adding or refreshing repositories updates the aggregate bead idempotently.
- No all-beads mirror is required for this branch.

### TEST_CASE_6A — External issue workspace creation is idempotent

Steps:

1. Start a workspace from an external issue/tracker input.
2. Inspect the VD SQL mapping row and workspace bead pointer fields.
3. Repeat the same external issue workspace creation request.
4. Simulate or inspect the documented partial-success path where VK workspace
   creation succeeds but mapping/bead update fails.

Expected:

- External issue bead IDs are deterministic from workspace/provider/site/key.
- Repeating the request repairs or reuses the same mapping/bead instead of
  creating duplicates.
- If VK start succeeds but mapping/bead update fails, the API reports partial
  success with repair information rather than a plain create failure.

### TEST_CASE_7A — Punt to existing workspace is two-phase and repairable

Steps:

1. Create a source bead in one workspace.
2. Punt it to an existing destination workspace.
3. Inspect source bead status and destination bead metadata.
4. Rerun the same punt command.

Expected:

- Destination bead is created with pending move metadata before source closure.
- Source bead is closed only after destination creation/linking succeeds.
- Destination bead is marked complete after source closure.
- Rerun does not create duplicate destination beads.

### TEST_CASE_7B — Punt to new workspace starts by default

Steps:

1. Run punt with new-workspace inputs: repositories, branches, and optional
   `append_to_prompt`.
2. Confirm the command asks the user to confirm the chosen repos/branches before
   execution.
3. Allow default start behavior.
4. Inspect destination workspace and punt metadata.

Expected:

- A new VK workspace is created and started.
- The initial prompt is canned, references the new destination bead, and includes
  the optional append prompt.
- Workspace beads setup runs before the new agent starts.
- Source/destination move metadata follows the two-phase model.

### TEST_CASE_7C — Punt to new workspace with no-start creates but does not start

Steps:

1. Run punt with new-workspace inputs and the no-start option.
2. Inspect VK workspace/session state.
3. Inspect source and destination beads.

Expected:

- A VK workspace is created through the create-only path.
- No agent session/execution starts.
- Source bead remains open.
- Destination bead remains pending/incomplete so the move can be finished later.

### TEST_CASE_8A — Offline shared-server migration apply succeeds safely

Steps:

1. Prepare a legacy shared-server bd source with at least one bead.
2. Run migration dry-run and record the planned source, backup, export, import,
   verification, and config paths.
3. Run migration apply with the required offline approval guard.
4. Inspect backups, exported data, embedded target stores, and the actual bd user
   config path used by the runtime.

Expected:

- Apply refuses to run without the offline approval guard.
- Shared-server source and current bd config are backed up.
- Legacy data is exported explicitly from shared-server mode.
- Embedded/per-workspace targets are imported and verified.
- Only after successful export/import does the actual bd user config switch to
  non-shared-server mode.
- The report names migrated/skipped counts and relevant paths.

### TEST_CASE_8B — Offline shared-server migration fails closed on export failure

Steps:

1. Prepare a legacy shared-server source.
2. Force legacy export to fail, for example with an unreachable shared-server
   port.
3. Run migration apply with the required offline approval guard.
4. Inspect process exit code, actual bd user config, and embedded targets.

Expected:

- Apply exits nonzero.
- Actual bd user config remains unchanged.
- Embedded targets are not initialized/imported as if migration succeeded.
- The report explains the export failure.

### TEST_CASE_9A — CI covers the runtime assertions

Steps:

1. Inspect the branch CI workflow configuration and a passing CI run.
2. Map CI jobs/smoke scripts to the test cases above.
3. Record which test cases are covered by committed automation, which are only
   covered by manual smoke evidence, and which are not covered.

Expected:

- Relevant push/PR paths trigger the Docker e2e workflow.
- CI produces enough logs/artifacts to diagnose failures.
- Any untested requirements are listed explicitly with a recommendation:
  automate now, keep manual for this branch, or defer.

## Result report schema

The tester should report a JSON object keyed by the IDs above:

```json
{
  "TEST_CASE_1A": { "status": "PASS", "evidence": "..." },
  "TEST_CASE_2A": { "status": "FAIL", "notes": "Expected X, observed Y" },
  "TEST_CASE_3A": { "status": "BLOCKED", "notes": "Missing CI access" },
  "coverage_summary": {
    "automated": ["TEST_CASE_1A"],
    "manual_or_prior_smoke": [],
    "not_verified": []
  }
}
```

Allowed test-case statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Cleanup

- Stop Docker containers created by the test unless CI owns cleanup.
- Remove disposable repositories/workspaces unless the test intentionally keeps
  artifacts for debugging.
- Do not commit Playwright CLI artifacts, screenshots, container logs, or other
  scratch output unless a follow-up explicitly asks for fixture artifacts.
