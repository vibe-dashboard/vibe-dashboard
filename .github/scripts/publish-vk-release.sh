#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?Missing VK_RELEASE_REPOSITORY_TOKEN}"
: "${VK_ASSET_REPOSITORY:?}"
: "${RELEASE_TAG:?}"
: "${RELEASE_NAME:?}"
: "${RELEASE_BODY:?}"

# Cross-repository release tokens share the owner's API quota. Allow one quota
# window to recover, but fail immediately for permissions and other errors.
# Uploads are safe to retry because they use --clobber.
gh_with_rate_limit_retry() {
  local output status attempt
  for ((attempt = 1; attempt <= 61; attempt++)); do
    if output="$(gh "$@" 2>&1)"; then
      printf '%s\n' "$output"
      return 0
    else
      status=$?
    fi
    printf '%s\n' "$output" >&2
    if [[ "$output" != *"API rate limit exceeded"* && "$output" != *"secondary rate limit"* ]]; then
      return "$status"
    fi
    if (( attempt == 61 )); then
      return "$status"
    fi
    printf 'GitHub API rate limited; retrying in 60s (%s/60).\n' "$attempt" >&2
    sleep 60
  done
}

printf '%s\n' "$RELEASE_BODY" > release-body.md

if release_output="$(gh_with_rate_limit_retry release view "$RELEASE_TAG" --repo "$VK_ASSET_REPOSITORY" 2>&1)"; then
  gh_with_rate_limit_retry release edit "$RELEASE_TAG" \
    --repo "$VK_ASSET_REPOSITORY" \
    --title "$RELEASE_NAME" \
    --notes-file release-body.md \
    --prerelease
elif [[ "$release_output" == *"release not found"* || "$release_output" == *"(HTTP 404)"* ]]; then
  gh_with_rate_limit_retry release create "$RELEASE_TAG" \
    --repo "$VK_ASSET_REPOSITORY" \
    --title "$RELEASE_NAME" \
    --notes-file release-body.md \
    --prerelease
else
  printf '%s\n' "$release_output" >&2
  exit 1
fi

gh_with_rate_limit_retry release upload "$RELEASE_TAG" release-assets/* \
  --repo "$VK_ASSET_REPOSITORY" \
  --clobber
