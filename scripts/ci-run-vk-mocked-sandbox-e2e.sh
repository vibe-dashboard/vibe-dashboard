#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${VK_MOCKED_SANDBOX_RUN_DIR:-.vk-mocked-sandbox/current}"
READY_TIMEOUT_SECONDS="${VK_MOCKED_SANDBOX_READY_TIMEOUT_SECONDS:-120}"
PORT_LOCK="${VK_MOCKED_SANDBOX_PORT_LOCK:-${TMPDIR:-/tmp}/vk-mocked-sandbox-ports.lock}"

cleanup() {
  if [[ -n "${sandbox_pid:-}" ]] && kill -0 "$sandbox_pid" 2>/dev/null; then
    kill -TERM "$sandbox_pid" 2>/dev/null || true
    wait "$sandbox_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$RUN_DIR"

npm run e2e:vk-mocked-sandbox:reset -- --variant basic-seeded
npm run build:vibe-agent-cli

# Port probes do not reserve sockets. Serialize allocation through readiness so
# another worktree cannot select these ports before the services bind them.
command -v flock >/dev/null 2>&1 || {
  echo "flock is required for concurrent mocked-sandbox port allocation" >&2
  exit 1
}
exec 9>"$PORT_LOCK"
flock 9

echo "::group::Prepare VK mocked sandbox"
VK_MOCKED_PREBUILD_BACKEND=1 \
  node --experimental-strip-types scripts/vk-mocked-sandbox.ts setup
echo "::endgroup::"

# setup owns port allocation. Reuse that exact plan when start constructs its
# commands, rather than racing another branch on fixed ports.
source "$RUN_DIR/env.sh"
export VK_MOCKED_SANDBOX_URL="${VK_MOCKED_SANDBOX_URL:-$VK_MOCKED_VD_URL}"
SANDBOX_URL="$VK_MOCKED_SANDBOX_URL"
VK_HEALTH_URL="http://127.0.0.1:$VK_MOCKED_BACKEND_PORT/api/health"
SANDBOX_LOG="$VK_MOCKED_SANDBOX_RUN_DIR/sandbox.log"

echo "Starting VK mocked sandbox; log: $SANDBOX_LOG"
VK_MOCKED_PREBUILD_BACKEND=1 VK_MOCKED_SKIP_LOCAL_WEB_BUILD=1 VK_MOCKED_SKIP_SETUP_COMMANDS=1 \
  node --experimental-strip-types scripts/vk-mocked-sandbox.ts start >"$SANDBOX_LOG" 2>&1 &
sandbox_pid=$!

deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
until curl --fail --silent "$VK_HEALTH_URL" >/dev/null \
  && curl --fail --silent "$SANDBOX_URL/workspaces" >/dev/null; do
  if ! kill -0 "$sandbox_pid" 2>/dev/null; then
    echo "VK mocked sandbox exited before becoming ready. Last log lines:" >&2
    tail -200 "$SANDBOX_LOG" >&2 || true
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting ${READY_TIMEOUT_SECONDS}s for $SANDBOX_URL/workspaces. Last log lines:" >&2
    tail -200 "$SANDBOX_LOG" >&2 || true
    exit 1
  fi
  sleep 2
done

flock -u 9

echo "VK mocked sandbox is ready: $VK_HEALTH_URL and $SANDBOX_URL/workspaces"
npx playwright test --config playwright.vk-mocked-sandbox.config.ts
