#!/usr/bin/env bash
set -euo pipefail

service="${VKVD_COMPOSE_SERVICE:-code-vibe}"
timeout_seconds="${VKVD_DOCKER_TIMEOUT_SECONDS:-120}"
restart_cycles="${VKVD_RESTART_CYCLES:-0}"
if ! [[ "$restart_cycles" =~ ^[0-9]+$ ]]; then
  echo "VKVD_RESTART_CYCLES must be a nonnegative integer." >&2
  exit 1
fi

compose() {
  VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose "$@"
}

wait_for_docker() {
  local deadline=$((SECONDS + timeout_seconds))
  until compose exec -T --user vkuser "$service" \
    docker --host=unix:///var/run/docker.sock info >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Inner Docker did not become ready within ${timeout_seconds}s." >&2
      compose logs "$service" >&2
      return 1
    fi
    sleep 2
  done
}

if ! docker info --format '{{json .Runtimes}}' | grep -q '"sysbox-runc"'; then
  echo "sysbox-runc is not registered in the active Docker context." >&2
  echo "Run ./scripts/setup-sysbox.sh first." >&2
  exit 1
fi

compose up -d "$service"

wait_for_docker

compose exec -T --user vkuser "$service" \
  docker --host=unix:///var/run/docker.sock run --rm alpine:3.20 true

# Opt-in: this deliberately interrupts the selected service. Run against an
# isolated test deployment, never the live workspace.
if [ "$restart_cycles" -gt 0 ]; then
  marker="vkvd-restart-smoke-$(date +%s)-$$"
  compose exec -T "$service" sh -c 'test "$(stat -f -c %T /run)" = tmpfs'
  compose exec -T "$service" touch "/var/lib/docker/$marker"
  for ((cycle = 1; cycle <= restart_cycles; cycle++)); do
    compose exec -T "$service" touch "/run/$marker"
    if ((cycle % 2 == 1)); then
      compose kill -s SIGKILL "$service"
      compose start "$service"
    else
      compose restart "$service"
    fi
    wait_for_docker
    compose exec -T "$service" sh -c 'test ! -e "/run/$1" && test -f "/var/lib/docker/$1"' sh "$marker"
    compose exec -T --user vkuser "$service" docker --host=unix:///var/run/docker.sock run --rm alpine:3.20 true
  done
  compose exec -T "$service" rm "/var/lib/docker/$marker"
fi

echo "Sysbox Docker-in-Docker smoke passed (${restart_cycles} restart cycles)"
