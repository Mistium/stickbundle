# Velora `/chat` frontend, reconstructed

Source: https://velora.ikelene.net/chat, pulled 2026-10-15.

## Source maps: none shipped
- `index-BXffRQMU.js` and `index-CNL6lm4G.css` have no `sourceMappingURL` comment and no `SourceMap` header.
- `*.js.map` / `*.css.map` return 404, and so do `/src/*`, `/package.json`, `/vite.config.js`, `/.git/HEAD` and `/.vite/manifest.json`.
- The six `/assets/js/*.js` side scripts are plain, unminified JS. They're served as written, so `public/assets/js/` has the original source.

## What was shipped
A Vite/Rollup production build: one 913 KB ES module, one 227 KB CSS file, no lazy chunks. Runtime fetches: `/assets/js/cursors.js`, `/assets/js/user-suggest.js`, `/assets/emoji/emoji.json`.

## How this was reconstructed
1. `webcrack` handled deobfuscation, unminification and `jsx()` → JSX (`main/deobfuscated.js`, 38.8k lines).
2. `../scripts/split.mjs` split the flat Rollup scope into modules:
   - vendor libraries were cut at their license banners: React, jsx-runtime, scheduler, react-dom, @remix-run/router 1.23.3, react-router, react-router-dom, lucide-react 0.441.0
   - app code was split into one file per component (≥25 lines), with the helpers that precede each component kept with it
   - minified component names were recovered from the route table (`HomePage`, `MePage`, `AdminPage`, `ChatPage`) or from the root CSS class (`vc-composer` → `VcComposer`). Mapping: `src/_renames.json`.
   - `import`/`export` statements were generated from Babel scope analysis
3. Prettier formatted everything. The CSS went to `src/index.css`.

## Limits
- Local variable names are gone (`e`, `n`, `s`…). Component/file names are inferred, not the originals.
- Module boundaries are a heuristic, not the original file layout.
- Vendor code is kept inline. It could be swapped for the npm packages at the versions above.

## Build
`bun build src/main.jsx --outdir dist/assets --target browser --external '/assets/*'`
(`tsconfig.json` aliases `react` / `react/jsx-runtime` to the bundled vendor copy.)
