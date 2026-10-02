#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  refresh-vd-worktree-after-merge.sh [options]

Options:
  --worktree <path>           VD worktree (default: current dir)
  --base <ref>                Fresh base ref (default: origin/main)
  --branch <name>             Current branch name override
  --workspace-id <id>         VK workspace id (default: infer by cwd)
  --no-workspace-update       Do not call VK branch API; raw git branch switch only
  --force                     Refresh even if no merged PR is found
  --pre-commit-check          Only block commits on already-merged branches
  --install-pre-commit        Install local pre-commit guard in this worktree
  -h, --help                  Show this help

Refresh a VD worktree after its PR was merged. The current branch tip is saved
as backup/<branch>-before-round2-<timestamp>, then the worktree switches to a
new <branch>-roundN branch at the latest origin/main.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

api_base_url() {
  printf '%s\n' "${VK_API_URL:-${VIBE_API_URL:-http://localhost:3007}}"
}

infer_workspace_id() {
  local worktree=$1
  local api_url
  local workspaces_file
  api_url=$(api_base_url)

  workspaces_file=$(mktemp)
  if ! curl -fsS "$api_url/api/workspaces" -o "$workspaces_file" 2>/dev/null; then
    rm -f "$workspaces_file"
    return 0
  fi

  WORKTREE=$worktree python3 - "$workspaces_file" <<'PY'
import json, os, pathlib, sys

worktree = pathlib.Path(os.environ["WORKTREE"]).resolve()
try:
    with open(sys.argv[1]) as f:
        payload = json.load(f)
except Exception:
    raise SystemExit(0)

for workspace in payload.get("data", []):
    container = workspace.get("container_ref")
    if not container:
        continue
    try:
        root = pathlib.Path(container).resolve()
    except Exception:
        continue
    if worktree == root or root in worktree.parents:
        print(workspace.get("id", ""))
        break
PY
  rm -f "$workspaces_file"
}

workspace_repos_json() {
  local workspace_id=$1
  vk workspace-repos "$workspace_id" --json
}

count_workspace_repos() {
  python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
}

ensure_workspace_repos_clean() {
  local repos_json=$1

  REPOS_JSON=$repos_json python3 - <<'PY' |
import json, os
for repo in json.loads(os.environ["REPOS_JSON"]):
    path = repo.get("path")
    if path:
        print(path)
PY
  while IFS= read -r repo_path; do
    if [ -n "$(git -C "$repo_path" status --porcelain)" ]; then
      git -C "$repo_path" status --short >&2
      die "dirty VK workspace repo: $repo_path"
    fi
  done
}

rename_workspace_branch() {
  local workspace_id=$1
  local new_branch=$2
  local api_url
  api_url=$(api_base_url)

  curl -fsS \
    -X PUT \
    -H 'content-type: application/json' \
    -d "{\"new_branch_name\":\"$new_branch\"}" \
    "$api_url/api/workspaces/$workspace_id/git/branch" |
    python3 - <<'PY'
import json, sys
payload = json.load(sys.stdin)
if payload.get("success"):
    raise SystemExit(0)
print(json.dumps(payload), file=sys.stderr)
raise SystemExit(1)
PY
}

branch_has_merged_pr() {
  local branch=$1
  local worktree=$2

  if command -v gh >/dev/null 2>&1; then
    local prs_json
    prs_json=$(cd "$worktree" && gh pr list --head "$branch" --state merged --json headRefName,mergedAt,number,url --limit 50)
    BRANCH_NAME=$branch PRS_JSON=$prs_json python3 - <<'PY'
import json, os, sys
branch = os.environ["BRANCH_NAME"]
for pr in json.loads(os.environ["PRS_JSON"]):
    if pr.get("headRefName") == branch and pr.get("mergedAt"):
        print(f"merged_pr=#{pr.get('number')} {pr.get('url')}")
        raise SystemExit(0)
raise SystemExit(1)
PY
    return $?
  fi

  git -C "$worktree" merge-base --is-ancestor HEAD origin/main
}

round_branch_name() {
  local original=$1
  local worktree=$2
  local stem=$original
  local n=2

  if [[ "$original" =~ ^(.+)-round([0-9]+)$ ]]; then
    stem=${BASH_REMATCH[1]}
    n=$((BASH_REMATCH[2] + 1))
  fi

  while :; do
    candidate="${stem}-round${n}"
    if ! git -C "$worktree" show-ref --verify --quiet "refs/heads/$candidate" &&
       ! git -C "$worktree" show-ref --verify --quiet "refs/remotes/origin/$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
    n=$((n + 1))
  done
}

install_pre_commit() {
  local worktree=$1
  local hook

  hook=$(git -C "$worktree" rev-parse --git-path hooks/pre-commit)
  case "$hook" in
    /*) ;;
    *) hook="$worktree/$hook" ;;
  esac

  if [ -e "$hook" ] && ! grep -q "refresh-vd-worktree-after-merge" "$hook"; then
    die "pre-commit hook already exists and is not managed by this script: $hook"
  fi

  mkdir -p "$(dirname "$hook")"
  cat >"$hook" <<EOF
#!/usr/bin/env bash
set -euo pipefail
repo_root=\$(git rev-parse --show-toplevel)
script="\$repo_root/scripts/git/refresh-vd-worktree-after-merge.sh"
if [ ! -x "\$script" ]; then
  exit 0
fi
"\$script" --worktree "\$repo_root" --pre-commit-check
EOF
  chmod +x "$hook"
  echo "installed_pre_commit=$hook"
}

worktree=.
base=origin/main
branch_override=
workspace_id=
workspace_id_explicit=0
workspace_update=1
force=0
mode=refresh

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree)
      worktree=${2:?missing --worktree value}
      shift 2
      ;;
    --base)
      base=${2:?missing --base value}
      shift 2
      ;;
    --branch)
      branch_override=${2:?missing --branch value}
      shift 2
      ;;
    --workspace-id)
      workspace_id=${2:?missing --workspace-id value}
      workspace_id_explicit=1
      shift 2
      ;;
    --no-workspace-update)
      workspace_update=0
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    --pre-commit-check)
      mode=pre_commit_check
      shift
      ;;
    --install-pre-commit)
      mode=install_pre_commit
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

worktree=$(git -C "$worktree" rev-parse --show-toplevel)

if [ "$mode" = install_pre_commit ]; then
  install_pre_commit "$worktree"
  exit 0
fi

branch=${branch_override:-$(git -C "$worktree" rev-parse --abbrev-ref HEAD)}

[ "$branch" != HEAD ] || die "detached HEAD worktree: $worktree"

if [ "${SKIP_MERGED_BRANCH_GUARD:-}" = 1 ]; then
  exit 0
fi

git -C "$worktree" fetch origin main --quiet

if [ "$mode" = pre_commit_check ]; then
  merged_out=$(mktemp)
  merged_err=$(mktemp)
  if branch_has_merged_pr "$branch" "$worktree" >"$merged_out" 2>"$merged_err"; then
    cat "$merged_out" >&2 || true
    echo "refusing commit on merged branch: $branch" >&2
    echo "run: scripts/git/refresh-vd-worktree-after-merge.sh" >&2
    exit 1
  fi
  exit 0
fi

if [ -n "$(git -C "$worktree" status --porcelain)" ]; then
  git -C "$worktree" status --short >&2
  die "dirty worktree: $worktree"
fi

if [ "$force" -ne 1 ]; then
  merged_out=$(mktemp)
  merged_err=$(mktemp)
  if ! branch_has_merged_pr "$branch" "$worktree" >"$merged_out" 2>"$merged_err"; then
    cat "$merged_err" >&2 || true
    die "no merged PR found for branch $branch; pass --force to refresh anyway"
  fi
  cat "$merged_out"
fi

git -C "$worktree" rev-parse --verify "$base" >/dev/null

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_branch="backup/${branch}-before-round2-${timestamp}"
new_branch=$(round_branch_name "$branch" "$worktree")

vk_workspace_updated=0
workspace_repo_count=
if [ "$workspace_update" -eq 1 ]; then
  if [ -z "$workspace_id" ]; then
    workspace_id=$(infer_workspace_id "$worktree")
  fi

  if [ -z "$workspace_id" ] && [ "$workspace_id_explicit" -eq 0 ] && [ -n "${VK_WORKSPACE_ID:-}" ]; then
    current_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$current_root" ] && [ "$current_root" = "$worktree" ]; then
      workspace_id=$VK_WORKSPACE_ID
    fi
  fi

  if [ -n "$workspace_id" ]; then
    repos_json=$(workspace_repos_json "$workspace_id")
    repo_count=$(printf '%s' "$repos_json" | count_workspace_repos)
    workspace_repo_count=$repo_count
    ensure_workspace_repos_clean "$repos_json"
    git -C "$worktree" branch "$backup_branch" HEAD
    rename_workspace_branch "$workspace_id" "$new_branch"
    vk_workspace_updated=1
  fi
fi

if [ "$vk_workspace_updated" -eq 1 ]; then
  git -C "$worktree" reset --hard "$base"
else
  git -C "$worktree" branch "$backup_branch" HEAD
  git -C "$worktree" switch -c "$new_branch" "$base"
fi

echo "worktree=$worktree"
echo "old_branch=$branch"
echo "backup_branch=$backup_branch"
echo "new_branch=$new_branch"
echo "base=$base"
echo "workspace_id=${workspace_id:-}"
echo "workspace_repo_count=${workspace_repo_count:-}"
echo "vk_workspace_updated=$vk_workspace_updated"
if [ "$vk_workspace_updated" -eq 1 ]; then
  echo "renamed_shared_workspace_branch=1"
  echo "reset_current_repo_only=$worktree"
fi
git -C "$worktree" status --short --branch
