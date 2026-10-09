#!/usr/bin/env bash
set -euo pipefail

image="${VKVD_SMOKE_IMAGE:-vk-vd-workspace-beads-smoke:local}"
container_name="${VKVD_SMOKE_CONTAINER:-vk-vd-workspace-beads-smoke}"
backend_port="${VKVD_SMOKE_BACKEND_PORT:-33207}"
dashboard_port="${VKVD_SMOKE_DASHBOARD_PORT:-33205}"
code_port="${VKVD_SMOKE_CODE_PORT:-33208}"
caddy_port="${VKVD_SMOKE_CADDY_PORT:-33201}"
api_base="http://127.0.0.1:${backend_port}/api"

cleanup() {
  status="$?"
  if [[ "$status" != "0" ]]; then
    docker logs "$container_name" || true
    docker exec "$container_name" supervisorctl status || true
    docker exec "$container_name" sh -lc 'find /var/tmp/vibe-kanban/worktrees /var/lib/vd/beads /var/lib/vd/vk-config -maxdepth 4 -type f -o -type d 2>/dev/null | sort | head -200' || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if [[ "${VKVD_SMOKE_BUILD_IMAGE:-false}" == "true" ]]; then
  docker build \
    --file Dockerfile.vkvd \
    --build-arg VK_RUNTIME_SOURCE="${VK_RUNTIME_SOURCE:-local}" \
    --build-arg VK_COMMIT="${VK_COMMIT:-workspace-beads-smoke}" \
    --tag "$image" \
    .
fi

docker rm -f "$container_name" >/dev/null 2>&1 || true
docker run -d \
  --name "$container_name" \
  --network host \
  -e "CADDY_PORT=${caddy_port}" \
  -e "PROXY_DOMAIN=wrong.example" \
  -e "BACKEND_PORT=${backend_port}" \
  -e "DASHBOARD_PORT=${dashboard_port}" \
  -e "CODE_PORT=${code_port}" \
  -e "CODE_PASSWORD=__unset__" \
  -e "ENABLE_VIBE_KANBAN=true" \
  -e "VK_SHARED_API_BASE=" \
  -e "VK_ALLOWED_ORIGINS=" \
  -e "ENABLE_TAILSCALE=false" \
  -e "TAILSCALE_AUTHKEY=" \
  -e "TAILSCALE_HOSTNAME=vkdev" \
  -e "MEMORY_WATCHDOG_ENABLED=false" \
  -e "MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL=" \
  -e "VD_NUDGE_DAEMON_ENABLED=false" \
  "$image" >/dev/null

echo "Waiting for real VK API..."
for attempt in $(seq 1 180); do
  if curl -fsS "${api_base}/health" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "180" ]]; then
    echo "Timed out waiting for VK API" >&2
    exit 1
  fi
  sleep 2
done

echo "Creating source git repo inside runtime..."
docker exec "$container_name" runuser -u vkuser -- sh -lc '
  set -e
  mkdir -p /home/vkuser/e2e/repos/workspace-beads-repo
  cd /home/vkuser/e2e/repos/workspace-beads-repo
  git init -b main
  git config user.email smoke@example.invalid
  git config user.name "Smoke Test"
  printf "workspace beads smoke\n" > README.md
  git add README.md
  git commit -m init
'

repo_response="$(mktemp)"
workspace_response="$(mktemp)"

curl -fsS \
  -H 'content-type: application/json' \
  -d '{"path":"/home/vkuser/e2e/repos/workspace-beads-repo","display_name":"Workspace Beads Repo"}' \
  "${api_base}/repos" > "$repo_response"

repo_id="$(
  python3 - "$repo_response" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
data = payload.get("data", payload)
print(data["id"])
PY
)"

curl -fsS \
  -H 'content-type: application/json' \
  -d "{\"workspace_id\":\"11111111-2222-4333-8444-555555555555\",\"name\":\"workspace-beads-smoke\",\"repos\":[{\"repo_id\":\"${repo_id}\",\"target_branch\":\"main\"}],\"linked_issue\":null,\"attachment_ids\":null}" \
  "${api_base}/workspaces/create-only" > "$workspace_response"

read -r workspace_id workspace_dir < <(
  python3 - "$workspace_response" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
workspace = payload.get("data", payload)["workspace"]
print(workspace["id"], workspace["container_ref"])
PY
)

if [[ -z "$workspace_dir" || "$workspace_dir" == "null" ]]; then
  echo "VK workspace response did not include container_ref" >&2
  cat "$workspace_response" >&2
  exit 1
fi

persisted_beads="/var/lib/vd/beads/workspaces/${workspace_id}/.beads"
aggregate_dir="/var/lib/vd/beads/aggregate-workspaces"
aggregate_bead_id="vdw-${workspace_id//-/}"

echo "Asserting workspace beads redirect and persisted store..."
docker exec "$container_name" test -f "${workspace_dir}/.beads/redirect"
redirect_target="$(docker exec "$container_name" cat "${workspace_dir}/.beads/redirect" | tr -d '\r\n')"
test "$redirect_target" = "$persisted_beads"
docker exec "$container_name" test -d "$persisted_beads"
docker exec "$container_name" test -f "${persisted_beads}/config.yaml"

echo "Asserting stripped Codex-style PATH still uses bd wrapper..."
repo_worktree="${workspace_dir}/workspace-beads-repo"
docker exec "$container_name" runuser -u vkuser -- sh -lc 'PATH=/usr/local/bin:/usr/bin:/bin; test "$(command -v bd)" = "/usr/local/bin/bd"'
docker exec "$container_name" runuser -u vkuser -- sh -lc "cd '${repo_worktree}' && PATH=/usr/local/bin:/usr/bin:/bin bd list >/tmp/repo-subdir-bd-list.out 2>/tmp/repo-subdir-bd-list.err; test \"\$?\" = 2"
docker exec "$container_name" grep -Fq 'bd must be run from the workspace root' /tmp/repo-subdir-bd-list.err

echo "Asserting generated AGENTS/CLAUDE instructions are inlined..."
for instruction_file in AGENTS.md CLAUDE.md; do
  docker exec "$container_name" grep -Fq 'BEGIN VD MANAGED BLOCK: workspace-instructions' "${workspace_dir}/${instruction_file}"
  docker exec "$container_name" grep -Fq 'Run `bd` commands from this workspace root/top-level directory.' "${workspace_dir}/${instruction_file}"
  docker exec "$container_name" grep -Fq 'This workspace uses `.beads/redirect` to store beads in persisted VD storage.' "${workspace_dir}/${instruction_file}"
done

echo "Asserting bd from workspace root writes to persisted workspace store..."
docker exec "$container_name" runuser -u vkuser -- sh -lc "cd '${workspace_dir}' && bd create --force --id vdw-smoke-root --title 'Workspace root smoke' --description 'created from workspace root' --type task >/tmp/workspace-root-bd-create.log"
docker exec "$container_name" runuser -u vkuser -- sh -lc "BEADS_DIR='${persisted_beads}' /usr/local/bin/bd -C '$(dirname "${persisted_beads}")' show vdw-smoke-root --json >/tmp/workspace-root-bd-show.json"
docker exec "$container_name" grep -Fq 'Workspace root smoke' /tmp/workspace-root-bd-show.json

echo "Asserting aggregate workspace bead has repo metadata..."
docker exec "$container_name" runuser -u vkuser -- sh -lc "BEADS_DIR='${aggregate_dir}/.beads' /usr/local/bin/bd -C '${aggregate_dir}' show '${aggregate_bead_id}' --json >/tmp/workspace-aggregate-bead.json"
docker exec "$container_name" python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path('/tmp/workspace-aggregate-bead.json').read_text())
bead = payload[0] if isinstance(payload, list) else payload
metadata = bead.get('metadata') or {}
repos = metadata.get('repos') or []
assert metadata.get('kind') == 'workspace', metadata
assert metadata.get('vkWorkspaceId') == '11111111-2222-4333-8444-555555555555', metadata
assert any(repo.get('name') == 'workspace-beads-repo' and repo.get('targetBranch') == 'main' for repo in repos), repos
PY

echo "workspace-scoped beads Docker smoke passed."
