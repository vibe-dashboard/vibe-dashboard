#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/rehearse-monorepo-cutover.sh \
    --vd-repo /path/to/vibe-dashboard \
    --vk-repo /path/to/Vktest \
    --vd-cutover-ref main \
    --vk-cutover-ref main \
    --workdir /tmp/vd-vk-cutover-rehearsal

Creates a disposable local clone of the VD repo, archives every VD branch/tag
under refs/archive/vd/*, moves local main to the VK cutover ref, imports the VD
cutover tree under vibe-dashboard/, and prints the real push commands.

It never pushes.
USAGE
}

die() {
  echo "rehearse-monorepo-cutover: $*" >&2
  exit 1
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

arg_value() {
  local name="$1"
  local value="${2:-}"
  [ -n "$value" ] || die "missing value for ${name}"
  printf '%s\n' "$value"
}

vd_repo=""
vk_repo=""
vd_cutover_ref=""
vk_cutover_ref=""
workdir=""
target_dir="vibe-dashboard"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --vd-repo)
      vd_repo="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    --vk-repo)
      vk_repo="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    --vd-cutover-ref)
      vd_cutover_ref="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    --vk-cutover-ref)
      vk_cutover_ref="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    --workdir)
      workdir="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    --target-dir)
      target_dir="$(arg_value "$1" "${2:-}")"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unexpected argument: $1"
      ;;
  esac
done

[ -n "$vd_repo" ] || die "--vd-repo is required"
[ -n "$vk_repo" ] || die "--vk-repo is required"
[ -n "$vd_cutover_ref" ] || die "--vd-cutover-ref is required"
[ -n "$vk_cutover_ref" ] || die "--vk-cutover-ref is required"
[ -n "$workdir" ] || die "--workdir is required"
[ "$target_dir" = "vibe-dashboard" ] || die "--target-dir must stay vibe-dashboard unless the migration plan changes"

command -v git >/dev/null 2>&1 || die "git is required"
command -v tar >/dev/null 2>&1 || die "tar is required"

case "$workdir" in
  /tmp/*|/var/tmp/*) ;;
  *) die "--workdir must be under /tmp or /var/tmp for this destructive rehearsal" ;;
esac

rehearsal_repo="$workdir/repo"
vd_tree="$workdir/vd-tree"

[ ! -e "$workdir" ] || die "workdir already exists: $workdir"

run mkdir -p "$workdir"
run git clone "$vd_repo" "$rehearsal_repo"

cd "$rehearsal_repo"
run git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'

vd_cutover_sha="$(git rev-parse "${vd_cutover_ref}^{commit}")"

echo "VD_CUTOVER_SHA=$vd_cutover_sha"

echo "Archiving VD local branches"
git for-each-ref refs/heads --format='%(refname)' |
while IFS= read -r ref; do
  short="${ref#refs/heads/}"
  run git update-ref "refs/archive/vd/heads/$short" "$ref"
done

echo "Archiving VD origin branches"
git for-each-ref refs/remotes/origin --format='%(refname)' |
while IFS= read -r ref; do
  short="${ref#refs/remotes/origin/}"
  [ "$short" != "HEAD" ] || continue
  run git update-ref "refs/archive/vd/heads/$short" "$ref"
done

echo "Archiving VD tags"
git for-each-ref refs/tags --format='%(refname)' |
while IFS= read -r ref; do
  short="${ref#refs/tags/}"
  run git update-ref "refs/archive/vd/tags/$short" "$ref"
done

run git remote add vk "$vk_repo"
run git fetch vk "$vk_cutover_ref"
vk_cutover_sha="$(git rev-parse 'FETCH_HEAD^{commit}')"
echo "VK_CUTOVER_SHA=$vk_cutover_sha"
run git switch -C main FETCH_HEAD

[ ! -e "$target_dir" ] || die "$target_dir already exists after switching to VK cutover"

run mkdir -p "$vd_tree" "$target_dir"
git archive "$vd_cutover_sha" | tar -x -C "$vd_tree"
tar -C "$vd_tree" -cf - . | tar -C "$target_dir" -xf -

cat > "$target_dir/SOURCE.md" <<EOF
# vibe-dashboard source

Imported from the pre-cutover vibe-dashboard repository.

- VD cutover commit: \`$vd_cutover_sha\`
- VK cutover commit: \`$vk_cutover_sha\`
- Imported directory: \`$target_dir/\`
- Archived VD branches: \`refs/archive/vd/heads/*\`
- Archived VD tags: \`refs/archive/vd/tags/*\`
EOF

run git add "$target_dir"
run git \
  -c user.name='VD VK Cutover Rehearsal' \
  -c user.email='vd-vk-cutover-rehearsal@example.invalid' \
  commit -m "Import vibe-dashboard under $target_dir"

cat <<EOF

Rehearsal repo:
  $rehearsal_repo

Local result:
  main now follows VK history at $vk_cutover_sha
  VD tree from $vd_cutover_sha is imported under $target_dir/
  old VD branches/tags are archived under refs/archive/vd/*

Real cutover push shape, after review:
  git push origin 'refs/archive/vd/*:refs/archive/vd/*'
  git push --force-with-lease origin main

ken: linear ref archive/import; add batching only after three manual branch migrations are clean.
EOF
