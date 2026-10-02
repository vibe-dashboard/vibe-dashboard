#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  realign-vd-weekly-branch.sh <worktree> [--onto <ref>] [--weekly <ref>]

Rebase a VD branch that was based on any weekly-dev ancestor onto a simulated
post-weekly main. The cut point is merge-base(<weekly>, HEAD).

On conflict, leaves the worktree in the conflicted rebase state.
EOF
}

worktree=${1:-}
shift || true

if [ "$worktree" = "-h" ] || [ "$worktree" = "--help" ]; then
  usage
  exit 0
fi

onto=vk/e767-vd-merge-weekly
weekly=origin/vk/05a2-vd-weekly-dev-br

while [ "$#" -gt 0 ]; do
  case "$1" in
    --onto)
      onto=${2:?missing --onto value}
      shift 2
      ;;
    --weekly)
      weekly=${2:?missing --weekly value}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$worktree" ]; then
  usage >&2
  exit 2
fi

git -C "$worktree" rev-parse --show-toplevel >/dev/null

if [ -n "$(git -C "$worktree" status --porcelain)" ]; then
  echo "refusing: dirty worktree: $worktree" >&2
  git -C "$worktree" status --short >&2
  exit 1
fi

head_ref=$(git -C "$worktree" rev-parse --abbrev-ref HEAD)
head_sha=$(git -C "$worktree" rev-parse HEAD)
onto_sha=$(git -C "$worktree" rev-parse "$onto")
weekly_sha=$(git -C "$worktree" rev-parse "$weekly")
cut_sha=$(git -C "$worktree" merge-base "$weekly_sha" "$head_sha")
replay_count=$(git -C "$worktree" rev-list --count "$cut_sha..$head_sha")

echo "worktree=$worktree"
echo "branch=$head_ref"
echo "head=$head_sha"
echo "onto=$onto_sha ($onto)"
echo "weekly=$weekly_sha ($weekly)"
echo "cut=$cut_sha"
echo "commits_to_replay=$replay_count"

set +e
rebase_output=$(git -C "$worktree" rebase --rebase-merges --onto "$onto_sha" "$cut_sha" 2>&1)
rebase_code=$?
set -e

printf '%s\n' "$rebase_output"

if [ "$rebase_code" -eq 0 ]; then
  echo "result=clean"
  git -C "$worktree" status --short --branch
  exit 0
fi

echo "result=conflict"
echo "conflicts:"
git -C "$worktree" diff --name-only --diff-filter=U
git -C "$worktree" status --short --branch
exit "$rebase_code"
