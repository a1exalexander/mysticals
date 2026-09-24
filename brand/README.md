# Brand

| File | What |
| --- | --- |
| `logo.svg` | Master icon (1024×1024 canvas, 824px squircle). Same as `apps/desktop/build/icon.svg`. |
| `png/icon-{16…1024}.png` | Icon as PNG in 16, 32, 48, 64, 128, 180, 192, 256, 512, 1024 px |
| `favicon.ico` | 16/32/48 favicon |
| `icon.icns` | macOS icon (only built on macOS, needs `iconutil`) |
| `og-image.svg` / `og-image.png` | 1200×630 social card |

Colors: background `#0b0b10`, personal `#bd93f9` (purple), work `#ffb86c` (orange), today dot `#f8f8f2`, calendar dots `#0b0b10` at 40%.

Regenerate everything (and refresh the site's copies in `apps/landing/public/`) after editing `logo.svg` or `og-image.svg`:

```sh
./brand/generate.sh   # needs rsvg-convert (librsvg) and magick (ImageMagick 7)
```

The social card uses Geist Mono / JetBrains Mono / Menlo, falling back to any monospace font installed.
