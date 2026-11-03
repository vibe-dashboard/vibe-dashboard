#!/usr/bin/env bash
set -euo pipefail

SHA="${VK_MOCKED_RELEASE_SHA:-2d974feef593c55dcfdbb1789e32cd3d36ad0011}"
RUN="${VK_MOCKED_RELEASE_RUN_ID:-36040408196}"
PUBLIC_ORIGIN="${VK_MOCKED_PUBLIC_ORIGIN:-}"

ART_ROOT="${PWD}/.vk-mocked-sandbox/vk-release-assets/${SHA}/${RUN}"
ART_DIR="${ART_ROOT}/release-assets-linux-x64"
BIN="${ART_ROOT}/extracted/vibe-kanban"

export PATH="/usr/local/go/bin:${PWD}/.tmp/custom-caddy:${PATH}"

if [ ! -x "${BIN}" ]; then
  mkdir -p "${ART_DIR}" "${ART_ROOT}/extracted"
  gh release download "vk-assets-${SHA}" \
    --repo vibe-dashboard/vibe-kanban \
    --pattern manifest.json \
    --pattern vibe-kanban-linux-x64.tar.gz \
    --pattern vibe-kanban-linux-x64.tar.gz.sha256 \
    --dir "${ART_DIR}" \
    --clobber
  (cd "${ART_DIR}" && sha256sum -c vibe-kanban-linux-x64.tar.gz.sha256)
  tar -xzf "${ART_DIR}/vibe-kanban-linux-x64.tar.gz" -C "${ART_ROOT}/extracted"
  chmod +x "${BIN}"
fi

if [ ! -x .tmp/custom-caddy/caddy ]; then
  scripts/build-custom-caddy.sh caddy-module .tmp/custom-caddy/caddy
fi

mkdir -p .vk-mocked-sandbox/beads-form-pending-cache

export BEADS_FORM_PENDING_CACHE_DIR="${PWD}/.vk-mocked-sandbox/beads-form-pending-cache"
export BEADS_FORM_PENDING_WARM_ON_STARTUP=0
export VK_MOCKED_VK_BACKEND=ci-release
export VK_MOCKED_RELEASE_SHA="${SHA}"
export VK_MOCKED_RELEASE_RUN_ID="${RUN}"
export VK_MOCKED_RELEASE_CACHE_DIR="${ART_ROOT}"
export VK_MOCKED_CADDY_PORT="${PORT}"
if [ -n "${PUBLIC_ORIGIN}" ]; then
  export VK_MOCKED_PUBLIC_ORIGIN="${PUBLIC_ORIGIN}"
fi

echo "Preview caddy listening on 0.0.0.0:${PORT}"
if [ -n "${PUBLIC_ORIGIN}" ]; then
  echo "Preview public origin: ${PUBLIC_ORIGIN}"
fi
exec npm run dev:vk-mocked-sandbox:ci-release
