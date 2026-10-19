#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-download}
if [ "$MODE" != "status" ] && [ "$MODE" != "download" ] && [ "$MODE" != "apply" ]; then
  echo "Usage: $0 [status|download|apply] [--confirm-non-dry-run]" >&2
  exit 2
fi

CONFIRMED=0
for arg in "${@:2}"; do
  case "$arg" in
    --confirm-non-dry-run) CONFIRMED=1 ;;
    *) echo "Unexpected argument: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VD_REPO=$(cd "$SCRIPT_DIR/.." && pwd)
VK_REPO=${VK_REPO:-$VD_REPO/vibe-kanban}
VK_GH_REPO=${VK_GH_REPO:-vibe-dashboard/vibe-kanban}
VK_PLATFORM=${VK_PLATFORM:-linux-x64}
VK_GH_ARCHIVE_NAME=${VK_GH_ARCHIVE_NAME:-vibe-kanban-${VK_PLATFORM}.tar.gz}
VK_GH_DOWNLOAD_ROOT=${VK_GH_DOWNLOAD_ROOT:-/var/tmp/vk-gh-release-assets}
VK_GH_LOG=${VK_GH_LOG:-/tmp/vk-batch-stage-gh-artifact-$(date -u +%Y%m%dT%H%M%SZ).log}

exec > >(tee -a "$VK_GH_LOG") 2>&1

fail() {
  echo "[vk-gh-artifact] ERROR: $*" >&2
  exit 1
}

for command in gh sha256sum tar strings node; do
  command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
done

CONTENT_HASH=${VK_CONTENT_HASH:-$(cd "$VD_REPO" && .github/scripts/vk-content-hash.sh)}
[[ "$CONTENT_HASH" =~ ^[0-9a-fA-F]{64}$ ]] || fail "invalid VK content hash: $CONTENT_HASH"
CONTENT_HASH=${CONTENT_HASH,,}
RELEASE_TAG=${VK_RELEASE_TAG:-vk-assets-sha256-$CONTENT_HASH}
DOWNLOAD_DIR=$VK_GH_DOWNLOAD_ROOT/$CONTENT_HASH
ARCHIVE=$DOWNLOAD_DIR/$VK_GH_ARCHIVE_NAME
CHECKSUM=$ARCHIVE.sha256
MANIFEST=$DOWNLOAD_DIR/manifest.json
EXTRACT_DIR=$DOWNLOAD_DIR/extracted
VK_ARTIFACT=$EXTRACT_DIR/vibe-kanban

echo "[vk-gh-artifact] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[vk-gh-artifact] log: $VK_GH_LOG"
echo "[vk-gh-artifact] release: $VK_GH_REPO@$RELEASE_TAG"
echo "[vk-gh-artifact] content hash: $CONTENT_HASH"

gh release view "$RELEASE_TAG" --repo "$VK_GH_REPO" --json tagName,url,assets
if [ "$MODE" = "status" ]; then
  exit 0
fi

rm -rf "$DOWNLOAD_DIR"
mkdir -p "$DOWNLOAD_DIR" "$EXTRACT_DIR"
gh release download "$RELEASE_TAG" \
  --repo "$VK_GH_REPO" \
  --pattern manifest.json \
  --pattern "$VK_GH_ARCHIVE_NAME" \
  --pattern "$VK_GH_ARCHIVE_NAME.sha256" \
  --dir "$DOWNLOAD_DIR" \
  --clobber

[ -s "$MANIFEST" ] || fail "release is missing manifest.json"
[ -s "$ARCHIVE" ] || fail "release is missing $VK_GH_ARCHIVE_NAME"
[ -s "$CHECKSUM" ] || fail "release is missing $VK_GH_ARCHIVE_NAME.sha256"

node - "$MANIFEST" "$CONTENT_HASH" "$RELEASE_TAG" <<'NODE'
const fs = require('node:fs');
const [manifestPath, expectedHash, expectedTag] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const actualHash = manifest.vk_content_hash ?? manifest.content_hash ?? manifest.commit;
if (actualHash !== expectedHash) {
  throw new Error(`manifest content hash mismatch: expected ${expectedHash}, got ${actualHash}`);
}
if (manifest.release_tag && manifest.release_tag !== expectedTag) {
  throw new Error(`manifest release tag mismatch: expected ${expectedTag}, got ${manifest.release_tag}`);
}
NODE

(cd "$DOWNLOAD_DIR" && sha256sum -c "$VK_GH_ARCHIVE_NAME.sha256")
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
[ -f "$VK_ARTIFACT" ] || fail "archive did not contain vibe-kanban"
chmod 0755 "$VK_ARTIFACT"
if strings "$VK_ARTIFACT" | grep -q 'Please build @vibe/local-web first'; then
  fail "downloaded binary embeds local-web placeholder"
fi

BINARY_SHA=$(sha256sum "$VK_ARTIFACT" | awk '{print $1}')
VK_VERSION_LABEL=${VK_VERSION_LABEL:-weekly-dev-vk-${CONTENT_HASH:0:12}-sha256-${BINARY_SHA:0:8}}
echo "[vk-gh-artifact] verified binary: $VK_ARTIFACT"
echo "[vk-gh-artifact] version label: $VK_VERSION_LABEL"

if [ "$MODE" = "download" ]; then
  exit 0
fi
[ "$CONFIRMED" = "1" ] || fail "apply mode requires --confirm-non-dry-run"

env \
  VK_REPO="$VK_REPO" \
  VK_ARTIFACT="$VK_ARTIFACT" \
  VK_VERSION_LABEL="$VK_VERSION_LABEL" \
  VK_PLATFORM="$VK_PLATFORM" \
  VK_SUPERVISOR_PROGRAM="${VK_SUPERVISOR_PROGRAM:-vibe-kanban}" \
  VK_API_BASE="${VK_API_BASE:-http://127.0.0.1:3007}" \
  VK_HOTSWAP_ID="${VK_HOTSWAP_ID:-vk-release-${CONTENT_HASH:0:12}-$(date -u +%Y%m%dT%H%M%SZ)}" \
  VK_HOTSWAP_LOG="${VK_HOTSWAP_LOG:-/tmp/vk-release-hotswap-${CONTENT_HASH:0:12}-$(date -u +%Y%m%dT%H%M%SZ).log}" \
  bash "$SCRIPT_DIR/vk-batch-stage-hotswap-apply.sh"
