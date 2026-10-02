# CI-generated artifact maintenance plan

This document records the weekly-dev operating assumption for generated outputs
that are expensive or noisy to regenerate locally.

## Operating assumption

Do not rely on coding agents to run heavyweight local VK release builds or broad
regeneration jobs in weekly-dev containers. Local VK work should stay limited to
quick checks and focused validation. Release/build artifact generation should be
offloaded to CI, where disk, cache, toolchain, and credentials are controlled.

## Generated outputs in scope

The first CI maintenance job should cover generated artifacts that are already
validated by CI today:

- `shared/types.ts` via `pnpm run generate-types:check`
- SQLx offline query metadata under `crates/db/.sqlx` via
  `pnpm run prepare-db:check`

Future extensions can add other generated outputs, such as remote generated
TypeScript types or remote SQLx metadata, after the same update-and-commit
contract is reviewed.

## Proposed CI job

Add a manual and/or label-triggered GitHub Actions workflow that:

1. Checks out the requested branch with write credentials.
2. Sets up the same Node, pnpm, Rust, SQLx CLI, and disk-space reclamation used
   by the normal backend schema checks.
3. Runs non-check regeneration commands:
   - `pnpm run generate-types`
   - `pnpm run prepare-db`
4. Runs `git diff --check`.
5. If no files changed, exits successfully with a summary that generated outputs
   were already current.
6. If files changed, commits only reviewed generated-output paths using a bot
   commit message such as `Update generated VK artifacts`.
7. Pushes the commit back to the same branch or, if branch protection requires
   it, opens a small generated-artifacts PR targeting that branch.
8. Re-runs or requires the normal check jobs on the new commit.

The job must fail instead of committing if unexpected files changed. The initial
allowlist should be narrow:

- `shared/types.ts`
- `crates/db/.sqlx/**`

## Safety rules

- Do not commit generated churn from an agent workspace unless a reviewer has
  explicitly accepted it.
- Do not run local release builds (`cargo build --release`, `local-build.sh`, or
  `pnpm run build:npx`) as the default hotswap artifact path in weekly-dev
  containers.
- Prefer existing CI release assets for VK hotswap artifacts, keyed by the
  source commit SHA.
- Local checks remain appropriate when targeted and bounded, for example focused
  Rust tests with a temporary `DATABASE_URL`, package TypeScript checks, and
  targeted Vitest suites.
