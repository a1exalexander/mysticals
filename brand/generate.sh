#!/usr/bin/env bash
# Regenerates every brand asset from brand/logo.svg and brand/og-image.svg.
set -euo pipefail
cd "$(dirname "$0")"
for t in rsvg-convert magick; do
  command -v "$t" >/dev/null || { echo "error: $t not found (brew install librsvg imagemagick)" >&2; exit 1; }
done

mkdir -p png
for s in 16 32 48 64 128 180 192 256 512 1024; do
  rsvg-convert -w "$s" -h "$s" logo.svg -o "png/icon-$s.png"
done
magick png/icon-16.png png/icon-32.png png/icon-48.png favicon.ico
rsvg-convert -w 1200 -h 630 og-image.svg -o og-image.png

# .icns needs macOS iconutil; skipped elsewhere (electron-builder makes its own for the desktop app)
if command -v iconutil >/dev/null; then
  tmp=$(mktemp -d); set="$tmp/icon.iconset"; mkdir "$set"
  for s in 16 32 128 256 512; do
    cp "png/icon-$s.png" "$set/icon_${s}x${s}.png"
    cp "png/icon-$((s * 2)).png" "$set/icon_${s}x${s}@2x.png"
  done
  iconutil -c icns "$set" -o icon.icns
  rm -rf "$tmp"
else
  echo "note: iconutil not found (macOS only), skipped icon.icns" >&2
fi

pub=../apps/landing/public
cp logo.svg "$pub/icon.svg"
cp favicon.ico og-image.png "$pub/"
cp png/icon-32.png "$pub/favicon-32.png"
cp png/icon-180.png "$pub/apple-touch-icon.png"
cp png/icon-192.png png/icon-512.png "$pub/"
echo "brand assets regenerated"
