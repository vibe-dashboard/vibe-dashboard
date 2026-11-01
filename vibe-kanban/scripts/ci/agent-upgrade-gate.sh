#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

should_run="$(bash scripts/ci/should-run-agent-upgrade-gate.sh)"

if [[ "$should_run" != "true" ]]; then
  echo "Coding-agent upgrade gate: no relevant files changed; no-op pass."
  exit 0
fi

echo "Coding-agent upgrade gate: relevant files changed; running mandatory checks."

if [[ "${CI:-}" == "true" && -n "${SKIP_MCP_CHECK:-}" ]]; then
  echo "SKIP_MCP_CHECK is local-only and cannot be used in CI." >&2
  exit 1
fi

run_step() {
  local name="$1"
  shift
  echo "::group::$name"
  "$@"
  echo "::endgroup::"
}

run_step "agent fixture metadata and JSONL check" pnpm run agent-fixtures:check
contract_tests="$(cargo test -p executors agent_upgrade_contract --lib -- --list)"
for test in codex_pinned_versions_are_in_lockstep \
  claude_pinned_version_matches_fixtures_without_router_coupling \
  codex_current_and_previous_saved_log_fixtures_normalize \
  claude_current_and_previous_saved_log_fixtures_normalize; do
  if [[ "$contract_tests" != *"agent_upgrade_contract::$test: test"* ]]; then
    printf 'Required agent upgrade contract is not registered: %s\n' "$test" >&2
    exit 1
  fi
done
run_step "executors agent upgrade contract tests" cargo test -p executors agent_upgrade_contract --lib
run_step "executors Codex tests" cargo test -p executors codex --lib
run_step "executors Claude tests" cargo test -p executors claude --lib
run_step "executors cargo check" cargo check -p executors

if [[ "${SKIP_MCP_CHECK:-}" == "1" ]]; then
  echo "Skipping cargo check -p mcp because SKIP_MCP_CHECK=1 and CI is not true."
else
  run_step "mcp cargo check" cargo check -p mcp
fi

echo "Coding-agent upgrade gate passed."
