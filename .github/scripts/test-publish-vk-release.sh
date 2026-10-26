#!/usr/bin/env bash
set -euo pipefail

publisher="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/publish-vk-release.sh"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
mkdir -p "$tmpdir/bin" "$tmpdir/release-assets"
touch "$tmpdir/release-assets/manifest.json"

cat > "$tmpdir/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_DIR/commands"
operation="$2"
if [[ "$SCENARIO" == forbidden ]]; then
  echo 'HTTP 403: Resource not accessible by personal access token' >&2
  exit 1
fi
if [[ "$SCENARIO" == exhausted ]]; then
  echo 'HTTP 403: API rate limit exceeded' >&2
  exit 1
fi
if [[ "$SCENARIO" == "quota-$operation" && ! -f "$TEST_DIR/retried" ]]; then
  touch "$TEST_DIR/retried"
  echo 'HTTP 403: API rate limit exceeded' >&2
  exit 1
fi
if [[ "$operation" == view && ( "$SCENARIO" == create || "$SCENARIO" == quota-create ) ]]; then
  echo 'release not found' >&2
  exit 1
fi
SH
cat > "$tmpdir/bin/sleep" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_DIR/sleeps"
SH
chmod +x "$tmpdir/bin/gh" "$tmpdir/bin/sleep"

for scenario in create quota-view quota-edit quota-create quota-upload forbidden exhausted; do
  mkdir "$tmpdir/$scenario"
  if (
    cd "$tmpdir"
    PATH="$tmpdir/bin:$PATH" \
      SCENARIO="$scenario" TEST_DIR="$tmpdir/$scenario" \
      GH_TOKEN=test-token VK_ASSET_REPOSITORY=example/runtime \
      RELEASE_TAG=test-tag RELEASE_NAME='Test release' RELEASE_BODY='Test notes' \
      bash "$publisher" > "$tmpdir/$scenario/output" 2>&1
  ); then
    status=0
  else
    status=$?
  fi
  commands="$tmpdir/$scenario/commands"
  case "$scenario" in
    forbidden)
      [[ "$status" == 1 ]]
      [[ "$(wc -l < "$commands")" == 1 ]]
      [[ ! -f "$tmpdir/$scenario/sleeps" ]]
      ;;
    exhausted)
      [[ "$status" == 1 ]]
      [[ "$(grep -c '^release view ' "$commands")" == 61 ]]
      [[ "$(wc -l < "$tmpdir/$scenario/sleeps")" == 60 ]]
      ! grep -Eq '^release (create|edit|upload) ' "$commands"
      ;;
    *)
      [[ "$status" == 0 ]]
      grep -q '^release upload .* --clobber$' "$commands"
      if [[ "$scenario" == create || "$scenario" == quota-create ]]; then
        grep -q '^release create ' "$commands"
        ! grep -q '^release edit ' "$commands"
      else
        grep -q '^release edit ' "$commands"
        ! grep -q '^release create ' "$commands"
      fi
      if [[ "$scenario" == quota-* ]]; then
        [[ "$(wc -l < "$tmpdir/$scenario/sleeps")" == 1 ]]
        [[ "$(grep -c "^release ${scenario#quota-} " "$commands")" == 2 ]]
      fi
      ;;
  esac
  printf 'PASS: %s\n' "$scenario"
done
