#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_dir="${repo_root}/.github/scripts"
resolver="${script_dir}/resolve-vk-vd-ci-refs.sh"
expected_vk_hash="$("${script_dir}/vk-content-hash.sh")"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git config --global --add safe.directory "$tmpdir" >/dev/null 2>&1 || true

make_vd_repo() {
  local work="$tmpdir/vd-work"
  local bare="$tmpdir/vd.git"

  git init --quiet --initial-branch=main "$work"
  git -C "$work" config user.email test@example.com
  git -C "$work" config user.name "Resolver Test"
  printf 'main\n' > "$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit --quiet -m "main"
  git -C "$work" clone --quiet --bare . "$bare"
  git -C "$work" remote add origin "$bare"
  git -C "$work" push --quiet --set-upstream origin main

  git -C "$work" checkout --quiet -B feature/sync main
  printf 'feature\n' > "$work/feature.txt"
  git -C "$work" add feature.txt
  git -C "$work" commit --quiet -m "feature"
  git -C "$work" push --quiet --set-upstream origin feature/sync

  printf '%s\n' "$work"
}

read_output() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2-
}

run_resolver() {
  local output_file="$tmpdir/output-$RANDOM.env"
  : > "$output_file"

  (
    cd "$repo_root"
    env -i \
      PATH="$PATH" \
      HOME="$HOME" \
      DEFAULT_BRANCH=main \
      VD_REPO_URL="$vd_bare" \
      SKIP_ASSET_FALLBACK=true \
      SKIP_ASSET_WAIT=true \
      GITHUB_OUTPUT="$output_file" \
      "$@" \
      "$resolver" >/dev/null
  )
  local status=$?
  [[ "$status" == "0" ]] || return "$status"

  printf '%s\n' "$output_file"
}

run_resolver_with_asset_probe() {
  local output_file="$tmpdir/output-$RANDOM.env"
  : > "$output_file"

  (
    cd "$repo_root"
    env -i \
      PATH="$fakebin:$PATH" \
      HOME="$HOME" \
      DEFAULT_BRANCH=main \
      VD_REPO_URL="$vd_bare" \
      VK_ASSET_WAIT_ATTEMPTS="${VK_ASSET_WAIT_ATTEMPTS:-1}" \
      VK_ASSET_WAIT_DELAY_SECONDS=0 \
      GITHUB_OUTPUT="$output_file" \
      ASSET_PRESENT_HASH="${ASSET_PRESENT_HASH:-}" \
      CURL_LOG="$curl_log" \
      "$@" \
      "$resolver" >/dev/null
  )
  local status=$?
  [[ "$status" == "0" ]] || return "$status"

  printf '%s\n' "$output_file"
}

assert_fails() {
  local message="$1"
  shift
  set +e
  "$@" >/tmp/resolve-vk-vd-ci-refs-failure.log 2>&1
  local status=$?
  set -e
  if [[ "$status" == "0" ]]; then
    echo "not ok - $message" >&2
    echo "  command succeeded unexpectedly" >&2
    exit 1
  fi
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "not ok - $message" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

vd_work="$(make_vd_repo)"
vd_bare="$tmpdir/vd.git"
fakebin="$tmpdir/fakebin"
curl_log="$tmpdir/curl.log"
mkdir -p "$fakebin"

cat > "$fakebin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$fakebin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url="${@: -1}"
printf '%s\n' "$url" >> "${CURL_LOG:?}"
if [[ -n "${ASSET_PRESENT_HASH:-}" && "$url" == *"vk-assets-sha256-${ASSET_PRESENT_HASH}/manifest.json" ]]; then
  exit 0
fi
exit 22
SH
chmod +x "$fakebin/curl" "$fakebin/sleep"

vd_main_sha="$(git -C "$vd_work" rev-parse main)"
vd_feature_sha="$(git -C "$vd_work" rev-parse feature/sync)"

output="$(run_resolver \
  GITHUB_EVENT_NAME=push \
  GITHUB_REF=refs/heads/feature/sync \
  GITHUB_REF_NAME=feature/sync \
  GITHUB_SHA="$vd_feature_sha")"
assert_equals "$expected_vk_hash" "$(read_output "$output" vk_commit)" "push resolves VK by monorepo content hash"
assert_equals "vibe-dashboard/vibe-kanban" "$(read_output "$output" vk_asset_repository)" "push uses VK asset repository"
assert_equals "vk-${expected_vk_hash:0:7}-vd-${vd_feature_sha:0:7}" "$(read_output "$output" deploy_image_tag)" "push deploy tag uses VK content hash"

output="$(run_resolver_with_asset_probe \
  GITHUB_EVENT_NAME=push \
  GITHUB_REF=refs/heads/main \
  GITHUB_REF_NAME=main \
  GITHUB_SHA="$vd_main_sha" \
  ASSET_PRESENT_HASH="$expected_vk_hash")"
assert_equals "$expected_vk_hash" "$(read_output "$output" vk_commit)" "push waits for exact content-addressed VK assets"
grep -q "vibe-dashboard/vibe-kanban/releases/download/vk-assets-sha256-${expected_vk_hash}/manifest.json" "$curl_log" || {
  echo "not ok - resolver did not probe content-addressed asset manifest" >&2
  exit 1
}

assert_fails \
  "push fails while exact content-addressed VK assets are pending" \
  run_resolver_with_asset_probe \
    GITHUB_EVENT_NAME=push \
    GITHUB_REF=refs/heads/main \
    GITHUB_REF_NAME=main \
    GITHUB_SHA="$vd_main_sha" \
    ASSET_PRESENT_HASH=""

echo "ok - resolve-vk-vd-ci-refs"
