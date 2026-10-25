#!/usr/bin/env bash
set -euo pipefail
# Generate raster icons from the supplied artwork, without inventing a new mark.
ROOT="$(dirname "$(dirname "$(realpath "$0")")")"
SOURCE="$ROOT/public/alohak-icon-source.png"
for size in 192 512; do
    convert "$SOURCE" -thumbnail "${size}x${size}" -background white -gravity center \
        -extent "${size}x${size}" "$ROOT/public/alohak-icon-${size}.png"
done
convert "$SOURCE" -thumbnail 180x180 -background white -gravity center -extent 180x180 "$ROOT/public/alohak-apple-touch-icon.png"
convert "$SOURCE" -thumbnail 350x350 -background white -gravity center -extent 512x512 "$ROOT/public/alohak-icon-maskable.png"
convert "$SOURCE" -background white -alpha remove -define icon:auto-resize=48,32,16 "$ROOT/public/alohak-favicon.ico"
