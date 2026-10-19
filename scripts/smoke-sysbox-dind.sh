#!/usr/bin/env bash
set -euo pipefail

service="${VKVD_COMPOSE_SERVICE:-code-vibe}"
timeout_seconds="${VKVD_DOCKER_TIMEOUT_SECONDS:-120}"

if ! docker info --format '{{json .Runtimes}}' | grep -q '"sysbox-runc"'; then
  echo "sysbox-runc is not registered in the active Docker context." >&2
  echo "Run ./scripts/setup-sysbox.sh first." >&2
  exit 1
fi

VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up -d "$service"

deadline=$((SECONDS + timeout_seconds))
until VKVD_CONTAINER_RUNTIME=sysbox-runc \
  docker compose exec -T --user vkuser "$service" docker info >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Inner Docker did not become ready within ${timeout_seconds}s." >&2
    VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose logs "$service" >&2
    exit 1
  fi
  sleep 2
done

VKVD_CONTAINER_RUNTIME=sysbox-runc \
  docker compose exec -T --user vkuser "$service" \
  docker run --rm alpine:3.20 true

echo "Sysbox Docker-in-Docker smoke passed"
