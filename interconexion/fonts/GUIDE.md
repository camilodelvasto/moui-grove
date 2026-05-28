# shapes/deck/fonts/

Bundled font families for the deck shape. Loaded locally — no CDN, no network dependency.

## Included families

- **Fraunces** — variable weight, display and editorial headings
- **Inter** — variable weight, body and UI text
- **JetBrains Mono** — code blocks
- **Lato** — clean sans-serif for body and headings
- **Montserrat** — geometric sans-serif for headings
- **Raleway** — thin/light display headings

All OFL-licensed (SIL Open Font License).

## How fonts are served

The server auto-generates `/fonts/fonts.css` via `build_fonts_css` in `server.py`. No manual `@font-face` declarations needed. Artifacts link `/fonts/fonts.css` to access all bundled fonts.

File naming convention recognized by `parse_font_filename`:
- `-Variable.woff2` — variable-weight font
- `-Regular.woff2`, `-Bold.woff2`, `-Italic.woff2`, `-BoldItalic.woff2`

## Adding a new font

1. Create a subdirectory under `fonts/` matching the desired font-family name
2. Drop `.woff2` files with the correct suffix into it
3. Restart the server — `build_fonts_css` picks it up automatically

Reference in theme tokens: `font-heading: montserrat` (the subdirectory name IS the font-family name).

## No CDN

Fonts live here, not on any CDN. The renderer loads them from `/fonts/<family>/`. Presentations work offline. No usage data leaks to font hosting services.
