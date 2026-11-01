#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  should-run-agent-upgrade-gate.sh [--changed-files-from-stdin]

Prints "true" when changed files touch coding-agent CLI version/config/protocol,
fixture, or upgrade-gate paths; otherwise prints "false".

Environment:
  BASE_SHA   Base commit for git diff. In PR CI, use pull_request.base.sha.
  HEAD_SHA   Head commit for git diff. In PR CI, use pull_request.head.sha.
  FORCE_AGENT_UPGRADE_GATE=1 forces "true".
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

is_relevant_path() {
  local path="$1"
  case "$path" in
    Cargo.lock | Cargo.toml | package.json | pnpm-lock.yaml | rust-toolchain.toml)
      return 0
      ;;
    crates/executors/Cargo.toml | crates/executors/default_profiles.json)
      return 0
      ;;
    crates/executors/src/agent_upgrade_contract.rs)
      return 0
      ;;
    crates/executors/src/executors/codex.rs | crates/executors/src/executors/codex/*)
      return 0
      ;;
    crates/executors/src/executors/claude.rs | crates/executors/src/executors/claude/*)
      return 0
      ;;
    crates/executors/src/executor_discovery.rs | crates/executors/src/model_selector.rs)
      return 0
      ;;
    crates/executors/tests/fixtures/agent-cli/*)
      return 0
      ;;
    crates/mcp/Cargo.toml)
      return 0
      ;;
    scripts/agent-fixtures/* | scripts/ci/agent-upgrade-gate.sh)
      return 0
      ;;
    scripts/ci/should-run-agent-upgrade-gate.sh)
      return 0
      ;;
    .github/workflows/test.yml | .github/actions/cargo-checks-common-setup/*)
      return 0
      ;;
    .github/actions/setup-node/*)
      return 0
      ;;
  esac
  return 1
}

changed_files_from_git() {
  local base="${BASE_SHA:-}"
  local head="${HEAD_SHA:-HEAD}"

  if [[ -z "$base" || "$base" =~ ^0+$ ]]; then
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      base="$(git merge-base origin/main "$head")"
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base="$(git merge-base main "$head")"
    else
      echo "Unable to determine BASE_SHA for agent upgrade gate path detection." >&2
      echo "Set BASE_SHA and HEAD_SHA explicitly, or use --changed-files-from-stdin." >&2
      exit 2
    fi
  fi

  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "BASE_SHA '$base' is not available in this checkout." >&2
    echo "Use actions/checkout with fetch-depth: 0 for this always-present gate." >&2
    exit 2
  fi
  if ! git cat-file -e "$head^{commit}" 2>/dev/null; then
    echo "HEAD_SHA '$head' is not available in this checkout." >&2
    exit 2
  fi

  git diff --name-only "$base" "$head"
}

if [[ "${FORCE_AGENT_UPGRADE_GATE:-}" == "1" ]]; then
  echo "Agent upgrade gate forced by FORCE_AGENT_UPGRADE_GATE=1." >&2
  echo "true"
  exit 0
fi

changed_files=()
if [[ "${1:-}" == "--changed-files-from-stdin" ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && changed_files+=("$path")
  done
elif [[ $# -eq 0 ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && changed_files+=("$path")
  done < <(changed_files_from_git)
else
  usage >&2
  exit 2
fi

for path in "${changed_files[@]}"; do
  if is_relevant_path "$path"; then
    echo "Agent upgrade gate relevant path changed: $path" >&2
    echo "true"
    exit 0
  fi
done

if [[ ${#changed_files[@]} -eq 0 ]]; then
  echo "No changed files detected for agent upgrade gate." >&2
else
  echo "No coding-agent CLI upgrade gate relevant files changed." >&2
fi
echo "false"
