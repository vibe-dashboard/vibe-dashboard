#!/usr/bin/env bash

set -euo pipefail

default_branch="${DEFAULT_BRANCH:-main}"
github_server_url="${GITHUB_SERVER_URL:-https://github.com}"
github_repository="${GITHUB_REPOSITORY:-mickmister/vibe-dashboard}"
vd_repo_url="${VD_REPO_URL:-${github_server_url}/${github_repository}.git}"
event_name="${GITHUB_EVENT_NAME:-}"

event_ref="${GITHUB_REF:-}"
event_ref_name="${GITHUB_REF_NAME:-}"
event_sha="${GITHUB_SHA:-}"

image_tag_input="${IMAGE_TAG_INPUT:-}"
pr_number="${PR_NUMBER:-}"
pr_head_ref="${PR_HEAD_REF:-}"
pr_head_sha="${PR_HEAD_SHA:-}"
workflow_vk_ref="${WORKFLOW_VK_REF:-}"
vk_asset_fallback_policy="${VK_ASSET_FALLBACK_POLICY:-fallback-default-branch-only}"
vk_asset_repository="${VK_ASSET_REPOSITORY:-vibe-dashboard/vibe-kanban}"

die() {
  echo "::error::$*" >&2
  exit 1
}

notice() {
  echo "::notice::$*"
}

is_full_sha() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{40}$ ]]
}

is_sha256() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{64}$ ]]
}

is_stable_release_tag_ref() {
  [[ "${1:-}" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

head_ref() {
  local branch="$1"
  printf 'refs/heads/%s' "$branch"
}

remote_head_sha() {
  local repo_url="$1"
  local branch="$2"
  git ls-remote --heads "$repo_url" "$branch" | awk 'NR == 1 { print $1 }'
}

resolve_remote_ref_to_sha() {
  local repo_url="$1"
  local ref="$2"
  local tmpdir

  if is_full_sha "$ref"; then
    printf '%s\n' "${ref,,}"
    return 0
  fi

  tmpdir="$(mktemp -d)"
  git -C "$tmpdir" init --quiet
  git -C "$tmpdir" remote add origin "$repo_url"
  git -C "$tmpdir" fetch --depth 1 origin "$ref" >/dev/null 2>&1 || {
    rm -rf "$tmpdir"
    return 1
  }
  git -C "$tmpdir" rev-parse 'FETCH_HEAD^{commit}'
  rm -rf "$tmpdir"
}

resolve_vd() {
  vd_branch=""
  vd_ref=""
  vd_commit=""
  vd_resolution_source=""

  case "$event_name" in
    pull_request)
      [[ -n "$pr_head_ref" ]] || die "PR_HEAD_REF is required for pull_request events"
      [[ -n "$pr_head_sha" ]] || die "PR_HEAD_SHA is required for pull_request events"
      vd_branch="$pr_head_ref"
      vd_ref="$(head_ref "$vd_branch")"
      vd_commit="$pr_head_sha"
      vd_resolution_source="pull_request_head"
      ;;
    push)
      [[ -n "$event_ref_name" ]] || die "GITHUB_REF_NAME is required for push events"
      [[ -n "$event_sha" ]] || die "GITHUB_SHA is required for push events"
      if [[ "$event_ref" == refs/tags/* ]]; then
        # Main release path: pushing a tag at current VD main publishes latest
        # and deploys the resolved VK/VD image. Keep this intentionally narrow
        # so arbitrary branch tags cannot become production releases.
        vd_branch="$default_branch"
        vd_ref="$event_ref"
        vd_commit="$(resolve_remote_ref_to_sha "$vd_repo_url" "$vd_ref")" \
          || die "Unable to resolve VD release tag: ${vd_ref}"
        local vd_default_commit
        vd_default_commit="$(remote_head_sha "$vd_repo_url" "$default_branch")"
        [[ -n "$vd_default_commit" ]] || die "Could not resolve VD ${default_branch}"
        [[ "$vd_commit" == "$vd_default_commit" ]] \
          || die "Release tag ${vd_ref} points to ${vd_commit}, but ${default_branch} is ${vd_default_commit}. Move the tag to current ${default_branch} before publishing latest."
        vd_resolution_source="tag_on_default_branch"
      else
        vd_branch="$event_ref_name"
        vd_ref="${event_ref:-$(head_ref "$vd_branch")}"
        vd_commit="$event_sha"
        vd_resolution_source="push_ref"
      fi
      ;;
    workflow_dispatch)
      if [[ -n "$event_ref_name" ]]; then
        vd_branch="$event_ref_name"
        vd_ref="${event_ref:-$(head_ref "$vd_branch")}"
        if [[ -n "$event_sha" ]]; then
          vd_commit="$event_sha"
        elif [[ "$vd_ref" == refs/heads/* ]]; then
          vd_commit="$(remote_head_sha "$vd_repo_url" "$vd_branch")"
        fi
      fi
      [[ -n "$vd_commit" ]] || die "Could not resolve VD ref for workflow_dispatch"
      vd_resolution_source="workflow_dispatch_ref"
      ;;
    *)
      die "Unsupported event for VD resolution: ${event_name:-<unset>}"
      ;;
  esac
}

resolve_vk() {
  vk_branch=""
  vk_commit=""
  vk_short_commit=""
  vk_resolution_source=""

  case "$event_name" in
    pull_request)
      vk_branch="$vd_branch"
      vk_resolution_source="monorepo_content_hash"
      ;;
    workflow_dispatch)
      vk_branch="${workflow_vk_ref:-${vd_branch:-main}}"
      vk_resolution_source="monorepo_content_hash"
      ;;
    push)
      vk_branch="$vd_branch"
      vk_resolution_source="monorepo_content_hash"
      ;;
    *)
      die "Unsupported event for VK resolution: ${event_name:-<unset>}"
      ;;
  esac

  vk_commit="$(.github/scripts/vk-content-hash.sh)"
  is_sha256 "$vk_commit" || die "Resolved VK content hash is not sha256 hex: ${vk_commit}"
  vk_short_commit="${vk_commit:0:7}"
}

vk_assets_release_url() {
  local vk_hash="$1"
  printf 'https://github.com/%s/releases/download/vk-assets-sha256-%s/manifest.json' "$vk_asset_repository" "$vk_hash"
}

vk_assets_exist() {
  local vk_sha="$1"
  curl -fsI "$(vk_assets_release_url "$vk_sha")" >/dev/null
}

wait_for_vk_assets() {
  if [[ "${SKIP_ASSET_WAIT:-false}" == "true" || -z "${vk_commit:-}" ]]; then
    return 0
  fi

  local attempts="${VK_ASSET_WAIT_ATTEMPTS:-60}"
  local delay="${VK_ASSET_WAIT_DELAY_SECONDS:-30}"

  for attempt in $(seq 1 "$attempts"); do
    if vk_assets_exist "$vk_commit"; then
      notice "VK release assets are available for $vk_commit."
      return 0
    fi

    if [[ "$attempt" == "$attempts" ]]; then
      break
    fi

    notice "VK release assets for $vk_commit are not available yet; waiting ${delay}s (${attempt}/${attempts})."
    sleep "$delay"
  done

  die "VK release assets for $vk_commit are not available after waiting. Expected release vk-assets-sha256-${vk_commit} in ${vk_asset_repository}. Re-run after VK release CI publishes assets, or inspect VK release CI for this content hash."
}

resolve_asset_fallback_if_needed() {
  used_asset_fallback=false

  if [[ "${SKIP_ASSET_FALLBACK:-false}" == "true" ]]; then
    return 0
  fi

  if [[ -z "$vk_commit" ]]; then
    return 0
  fi

  if vk_assets_exist "$vk_commit"; then
    return 0
  fi

  if [[ "$vk_resolution_source" != "fallback_default_branch" && "$vk_asset_fallback_policy" != "allow-matching-branch-fallback" ]]; then
    return 0
  fi

  notice "VK release assets for $vk_commit are not available yet; using the latest published vk-assets release for this VD branch image."
  local latest_assets_tag
  latest_assets_tag="$(
    curl -fsSL "https://api.github.com/repos/${vk_asset_repository}/releases?per_page=100" \
      | python3 -c 'import json,sys; releases=[r for r in json.load(sys.stdin) if r.get("tag_name", "").startswith("vk-assets-sha256-")]; releases.sort(key=lambda r: r.get("published_at") or r.get("created_at") or "", reverse=True); print(releases[0]["tag_name"] if releases else "")'
  )"

  [[ -n "$latest_assets_tag" ]] || die "No published vk-assets release found to use as a fallback."

  vk_commit="${latest_assets_tag#vk-assets-sha256-}"
  is_sha256 "$vk_commit" || die "Latest vk-assets release tag does not contain a sha256 content hash: $latest_assets_tag"

  vk_branch="$latest_assets_tag"
  vk_short_commit="${vk_commit:0:7}"
  vk_resolution_source="latest_assets_fallback"
  used_asset_fallback=true
  notice "Using fallback VK assets release $latest_assets_tag"
}

resolve_publish_latest() {
  publish_latest=false
}

write_outputs() {
  local deploy_pr_preview=false
  if [[ "$event_name" == "pull_request" ]]; then
    deploy_pr_preview=true
  fi

  local vd_short_commit="${vd_commit:0:7}"
  local deploy_image_tag="vd-${vd_commit}"
  if [[ -n "$vk_short_commit" ]]; then
    deploy_image_tag="vk-${vk_short_commit}-vd-${vd_short_commit}"
  fi
  local output_file="${GITHUB_OUTPUT:-/dev/stdout}"

  {
    echo "image_tag=$image_tag_input"
    echo "deploy_image_tag=$deploy_image_tag"
    echo "deploy_pr_preview=$deploy_pr_preview"
    echo "pr_number=$pr_number"
    echo "vk_branch=$vk_branch"
    echo "vk_commit=$vk_commit"
    echo "vk_short_commit=$vk_short_commit"
    echo "vk_asset_repository=$vk_asset_repository"
    echo "vk_resolution_source=$vk_resolution_source"
    echo "vd_branch=$vd_branch"
    echo "vd_ref=$vd_ref"
    echo "vd_commit=$vd_commit"
    echo "vd_short_commit=$vd_short_commit"
    echo "vd_resolution_source=$vd_resolution_source"
    echo "publish_latest=$publish_latest"
  } >> "$output_file"
}

resolve_vd
resolve_vk
resolve_asset_fallback_if_needed
wait_for_vk_assets
resolve_publish_latest

echo "Resolved VD ${vd_ref} (${vd_resolution_source}) to ${vd_commit}"
if [[ -n "$vk_commit" ]]; then
  echo "Resolved VK ${vk_branch} (${vk_resolution_source}) to ${vk_commit}"
fi
echo "Publish latest: ${publish_latest}"

write_outputs
