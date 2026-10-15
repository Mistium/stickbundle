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

---

# OriginChats frontend

This build talks to [OriginChats](https://docs.originchats.com) servers instead of Velora's backend. The Velora UI is unchanged where it can be. Each Velora "server" is now an OriginChats server you add by address, with its own WebSocket.

## How it works
`src/originchats/` holds everything new:

| File | What it does |
| --- | --- |
| `connection.js` | One WebSocket per server: handshake, sign-in (resumed `session`, then Rotur validator, then saved server account), requests matched by `listener`, reconnect with backoff. |
| `backend.js` | Plays Velora's backend in the browser. A `fetch` shim answers Velora's REST paths (`/chat/*`, `/account/*`, …) from OriginChats commands. Velora socket messages (`chat_send`, `chat_typing`, `chat_read`, …) become OriginChats commands. OriginChats events come back as the events Velora's store already handles (`chat_message`, `chat_reactions`, `chat_member_update`, …). |
| `convert.js` | Messages, reactions, attachments, embeds, roles and permissions between the two shapes. Custom emoji `originChats:<emoji>//host/id` ↔ `<:name:eid>`, role mentions `@&name` ↔ `<@&rid>`. |
| `ids.js` | Velora's id formats (`s…`, `c…`, `r…`, `e…`, numeric message ids), derived from server URLs, channel names and UUIDs, with lookups back. |
| `storage.js` | The Rotur key, your server list, session tokens and server-account logins, in localStorage. |
| `LoginPage.jsx`, `ui.jsx` | `/login` (Rotur key, or server accounts only), the home view, and the per-server sign-in gate. |

The Velora store (`components/vc/VcEmGrid.jsx`) now sends through `sendFromVelora` and starts the connections with `start()` instead of opening its own socket.

## What maps to what
- Servers: added by address, invite link (`originchats.com/invite/<host>/<code>`), or from the public discovery list. "Create a server" became "Add a server", and "Leave" removes the server from your list.
- Channels: text and voice channels. Separators become category dividers. Forum channels are hidden.
- Messages: history and paging, send, reply, edit, delete, pins, reactions (Unicode and custom), search (`from:`, `has:`, `in:`), typing, unread and mention counts, and attachments (uploaded to the server you're viewing).
- Members and roles: member list with presence, role colours and hoisting, role editor, giving roles, kick and ban, custom status.
- Server settings: name, roles, emoji.

## Not supported
- Voice and video. OriginChats uses `@originchats/voice` signalling, so joining a voice channel shows a notice.
- Threads and forums.
- Polls (shown as text).
- DMs, friends and groups.
- Web Push.
- Channel reordering.
- Server icon uploads.
- Velora account features (profile editor, credits, bots).

## Build and run
```sh
./scripts/build.sh                  # bundles into out/dist
bun scripts/serve.ts "$PWD/out/dist" 5180
```
