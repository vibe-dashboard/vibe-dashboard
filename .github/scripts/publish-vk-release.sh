#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?Missing release repository token}"
: "${VK_ASSET_REPOSITORY:?Missing asset repository}"
: "${RELEASE_TAG:?Missing release tag}"
: "${RELEASE_NAME:?Missing release name}"
: "${RELEASE_BODY:?Missing release body}"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
deadline=$((SECONDS + ${GH_RELEASE_RETRY_BUDGET_SECONDS:-3600}))

gh_retry() {
  local attempt status delay reset now
  for attempt in 1 2 3; do
    if gh "$@" 2>"$scratch/error"; then
      return 0
    else
      status=$?
    fi
    cat "$scratch/error" >&2
    if ! grep -Eiq 'API rate limit exceeded|secondary rate limit|HTTP 429' "$scratch/error"; then
      return "$status"
    fi
    if [[ "$attempt" == 3 ]]; then
      return "$status"
    fi

    delay="${GH_RELEASE_RETRY_DELAY_SECONDS:-60}"
    # The rate-limit endpoint has a separate allowance and remains available
    # when the core REST quota used by release operations is exhausted.
    if grep -qi 'API rate limit exceeded' "$scratch/error"; then
      reset="$(gh api rate_limit --jq '.resources.core.reset' 2>/dev/null || true)"
      now="$(date +%s)"
      if [[ "$reset" =~ ^[0-9]+$ ]] && (( reset >= now )); then
        delay=$((reset - now + 2))
      fi
    fi
    if (( SECONDS + delay > deadline )); then
      echo "GitHub rate-limit reset exceeds the release retry budget; stopping." >&2
      return "$status"
    fi
    echo "GitHub release API rate-limited; retrying in ${delay}s (attempt $((attempt + 1))/3)." >&2
    sleep "$delay"
  done
}

printf '%s\n' "$RELEASE_BODY" > release-body.md

if gh_retry release view "$RELEASE_TAG" --repo "$VK_ASSET_REPOSITORY" \
    > /dev/null 2>"$scratch/lookup-error"; then
  gh_retry release edit "$RELEASE_TAG" --repo "$VK_ASSET_REPOSITORY" \
    --title "$RELEASE_NAME" --notes-file release-body.md --prerelease
else
  status=$?
  cat "$scratch/lookup-error" >&2
  # Authentication, quota, and transport errors must not become creates.
  if ! grep -Eiq 'release not found|HTTP 404' "$scratch/lookup-error"; then
    exit "$status"
  fi
  gh_retry release create "$RELEASE_TAG" --repo "$VK_ASSET_REPOSITORY" \
    --title "$RELEASE_NAME" --notes-file release-body.md --prerelease
fi

gh_retry release upload "$RELEASE_TAG" release-assets/* \
  --repo "$VK_ASSET_REPOSITORY" --clobber
