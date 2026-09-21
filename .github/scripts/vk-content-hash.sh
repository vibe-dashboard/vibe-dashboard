#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git ls-files -z -- vibe-kanban \
  | LC_ALL=C sort -z \
  | while IFS= read -r -d '' path; do
      printf '%s\0' "$path"
      sha256sum "$path" | awk '{ printf "%s", $1 }'
      printf '\0'
    done \
  | sha256sum \
  | awk '{ print $1 }'
