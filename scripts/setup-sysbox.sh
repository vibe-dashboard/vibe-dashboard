#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

case "$(uname -s)" in
  Darwin)
    require_cmd colima
    require_cmd docker
    exec "${repo_root}/scripts/colima/setup-sysbox.sh"
    ;;
  Linux)
    require_cmd docker
    if ! command -v apt-get >/dev/null 2>&1; then
      echo "Automatic Sysbox installation supports Debian/Ubuntu hosts only." >&2
      exit 1
    fi
    if [ "$(id -u)" -eq 0 ]; then
      bash "${repo_root}/scripts/colima/install-sysbox-guest.sh"
    else
      require_cmd sudo
      sudo bash "${repo_root}/scripts/colima/install-sysbox-guest.sh"
    fi
    echo "Sysbox is ready. Start with: VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up -d code-vibe"
    ;;
  *)
    echo "Unsupported host operating system: $(uname -s)" >&2
    exit 1
    ;;
esac
