#!/usr/bin/env bash
# Derive Fulvid application icons from assets/logo.png.
# Does not overwrite the source. Requires ImageMagick, optipng, and icotool.
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/assets/logo.png"
OUT_PNG="$ROOT/assets/fulvid.png"
OUT_ICO="$ROOT/assets/fulvid.ico"
ICONSET="$ROOT/assets/macos/fulvid.iconset"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

need convert
need identify
need optipng
need icotool

[ -f "$SOURCE" ] || fail "missing source icon: $SOURCE"

geometry="$(identify -format '%w %h %m %[channels]' -- "$SOURCE")"
[ "$geometry" = "512 512 PNG srgba" ] || fail "expected 512x512 PNG sRGBA, got: $geometry"

workdir="$(mktemp -d)"
cleanup() { rm -rf -- "$workdir"; }
trap cleanup EXIT

resize() {
  local size="$1"
  local dest="$2"
  convert -- "$SOURCE" \
    -strip \
    -colorspace sRGB \
    -background none \
    -alpha on \
    -filter Lanczos \
    -resize "${size}x${size}" \
    "png32:${dest}"
  optipng -quiet -o2 -- "$dest"
}

for size in 16 24 32 48 64 128 256 512; do
  resize "$size" "$workdir/${size}.png"
done

install -D -m 644 -- "$workdir/512.png" "$OUT_PNG"

icotool --create --output="$OUT_ICO" \
  "$workdir/16.png" \
  "$workdir/24.png" \
  "$workdir/32.png" \
  "$workdir/48.png" \
  "$workdir/64.png" \
  --raw "$workdir/128.png" \
  --raw "$workdir/256.png"

rm -rf -- "$ICONSET"
install -d "$ICONSET"
install -m 644 -- "$workdir/16.png" "$ICONSET/icon_16x16.png"
install -m 644 -- "$workdir/32.png" "$ICONSET/icon_16x16@2x.png"
install -m 644 -- "$workdir/32.png" "$ICONSET/icon_32x32.png"
install -m 644 -- "$workdir/64.png" "$ICONSET/icon_32x32@2x.png"
install -m 644 -- "$workdir/128.png" "$ICONSET/icon_128x128.png"
install -m 644 -- "$workdir/256.png" "$ICONSET/icon_128x128@2x.png"
install -m 644 -- "$workdir/256.png" "$ICONSET/icon_256x256.png"
install -m 644 -- "$workdir/512.png" "$ICONSET/icon_256x256@2x.png"
install -m 644 -- "$workdir/512.png" "$ICONSET/icon_512x512.png"
# icon_512x512@2x.png (1024) is omitted: the source is 512x512 and is not upscaled.

printf 'wrote %s\n' "$OUT_PNG" "$OUT_ICO" "$ICONSET"
