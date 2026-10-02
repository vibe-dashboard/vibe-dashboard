#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  port-vk-branch-to-vd-monorepo.sh [options]

Options:
  --vk-worktree <path>       VK-only worktree to port (default: current dir)
  --vd-worktree <path>       Existing VD worktree to use
  --workspace-id <id>        Vibe Kanban workspace id (default: $VK_WORKSPACE_ID)
  --vd-repo-id <id>          VD repo id for attaching to the workspace
  --vd-repo-name <name>      VD repo name to discover (default: vibe-kanban-vscode-web)
  --vd-target <ref>          VD base ref when attaching/resetting (default: origin/main)
  --branch <name>            VD branch to create (default: vk/<vk-branch>-monorepo)
  --commit-message <msg>     Commit message for squashed port
  --no-commit                Leave staged changes after verifying tree equality
  -h, --help                 Show this help

From a VK-only branch, create one VD monorepo commit that replaces
vibe-kanban/ with the exact VK HEAD tree. The staged VD vibe-kanban tree must
match VK HEAD^{tree}, or the script aborts before committing.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

json_get_vd_path='
import json, os, sys
name = os.environ["VD_REPO_NAME"]
repos = json.load(sys.stdin)
for item in repos:
    if item.get("name") == name or item.get("display_name") == name or os.path.basename(item.get("path", "")) == name:
        print(item.get("path", ""))
        break
'

json_get_repo_id='
import json, os, sys
name = os.environ["VD_REPO_NAME"]
repos = json.load(sys.stdin)
for item in repos:
    if item.get("name") == name or item.get("display_name") == name or os.path.basename(item.get("path", "")) == name:
        print(item.get("id", ""))
        break
'

vk_worktree=.
vd_worktree=
workspace_id=${VK_WORKSPACE_ID:-}
vd_repo_id=
vd_repo_name=vibe-kanban-vscode-web
vd_target=origin/main
branch_name=
commit_message=
do_commit=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --vk-worktree)
      vk_worktree=${2:?missing --vk-worktree value}
      shift 2
      ;;
    --vd-worktree)
      vd_worktree=${2:?missing --vd-worktree value}
      shift 2
      ;;
    --workspace-id)
      workspace_id=${2:?missing --workspace-id value}
      shift 2
      ;;
    --vd-repo-id)
      vd_repo_id=${2:?missing --vd-repo-id value}
      shift 2
      ;;
    --vd-repo-name)
      vd_repo_name=${2:?missing --vd-repo-name value}
      shift 2
      ;;
    --vd-target)
      vd_target=${2:?missing --vd-target value}
      shift 2
      ;;
    --branch)
      branch_name=${2:?missing --branch value}
      shift 2
      ;;
    --commit-message)
      commit_message=${2:?missing --commit-message value}
      shift 2
      ;;
    --no-commit)
      do_commit=0
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

vk_worktree=$(git -C "$vk_worktree" rev-parse --show-toplevel)

if [ -n "$(git -C "$vk_worktree" status --porcelain)" ]; then
  git -C "$vk_worktree" status --short >&2
  die "dirty VK worktree: $vk_worktree"
fi

git -C "$vk_worktree" fetch origin main

vk_branch=$(git -C "$vk_worktree" rev-parse --abbrev-ref HEAD)
[ "$vk_branch" != HEAD ] || die "VK worktree is detached; pass --branch explicitly after checking out a branch"

if [ -z "$branch_name" ]; then
  branch_slug=${vk_branch#vk/}
  branch_name="vk/${branch_slug}-monorepo"
fi

if [ -z "$commit_message" ]; then
  commit_message="Port VK branch ${vk_branch} into embedded vibe-kanban"
fi

workspace_repos_json=
if [ -z "$vd_worktree" ]; then
  [ -n "$workspace_id" ] || die "VD worktree not given and VK_WORKSPACE_ID/--workspace-id is empty"
  workspace_repos_json=$(vk workspace-repos "$workspace_id" --json)
  vd_worktree=$(VD_REPO_NAME=$vd_repo_name python3 -c "$json_get_vd_path" <<<"$workspace_repos_json")
fi

if [ -z "$vd_worktree" ]; then
  [ -n "$workspace_id" ] || die "workspace id required to attach VD repo"
  if [ -z "$vd_repo_id" ]; then
    repos_json=$(vk repos --json)
    vd_repo_id=$(VD_REPO_NAME=$vd_repo_name python3 -c "$json_get_repo_id" <<<"$repos_json")
  fi
  [ -n "$vd_repo_id" ] || die "could not discover VD repo id for $vd_repo_name; pass --vd-repo-id"

  set +e
  vk workspace-repos add "$workspace_id" --repo "${vd_repo_id}:${vd_target}" --json >/dev/null 2>/dev/null
  add_code=$?
  set -e

  if [ "$add_code" -ne 0 ]; then
    api_url=${VK_API_URL:-${VIBE_API_URL:-http://localhost:3007}}
    curl -fsS \
      -H 'content-type: application/json' \
      -d "{\"repo_id\":\"$vd_repo_id\",\"target_branch\":\"$vd_target\"}" \
      "$api_url/api/workspaces/$workspace_id/repos" >/dev/null
  fi

  workspace_repos_json=$(vk workspace-repos "$workspace_id" --json)
  vd_worktree=$(VD_REPO_NAME=$vd_repo_name python3 -c "$json_get_vd_path" <<<"$workspace_repos_json")
fi

[ -n "$vd_worktree" ] || die "could not find VD worktree after attach"
vd_worktree=$(git -C "$vd_worktree" rev-parse --show-toplevel)

if [ -n "$(git -C "$vd_worktree" status --porcelain)" ]; then
  git -C "$vd_worktree" status --short >&2
  die "dirty VD worktree: $vd_worktree"
fi

git -C "$vd_worktree" fetch origin main
git -C "$vd_worktree" rev-parse --verify "$vd_target" >/dev/null

if git -C "$vd_worktree" show-ref --verify --quiet "refs/heads/$branch_name"; then
  die "branch already exists in VD worktree repo: $branch_name"
fi

git -C "$vd_worktree" switch -c "$branch_name" "$vd_target"

[ -d "$vd_worktree/vibe-kanban" ] || die "VD base does not contain vibe-kanban/"

rm -rf "$vd_worktree/vibe-kanban"
mkdir -p "$vd_worktree/vibe-kanban"
git -C "$vk_worktree" archive --format=tar HEAD | tar -xf - -C "$vd_worktree/vibe-kanban"

git -C "$vd_worktree" add -A vibe-kanban

vk_tree=$(git -C "$vk_worktree" rev-parse 'HEAD^{tree}')
vd_tree=$(git -C "$vd_worktree" write-tree --prefix=vibe-kanban/)

echo "vk_worktree=$vk_worktree"
echo "vd_worktree=$vd_worktree"
echo "vk_branch=$vk_branch"
echo "vd_branch=$branch_name"
echo "vk_tree=$vk_tree"
echo "vd_staged_vibe_kanban_tree=$vd_tree"

[ "$vk_tree" = "$vd_tree" ] || die "staged VD vibe-kanban tree does not equal VK HEAD tree"

if git -C "$vd_worktree" diff --cached --quiet -- vibe-kanban; then
  echo "result=no-change"
  exit 0
fi

if [ "$do_commit" -eq 1 ]; then
  git -C "$vd_worktree" commit -m "$commit_message"
  echo "result=committed"
else
  echo "result=staged"
fi

git -C "$vd_worktree" status --short --branch
