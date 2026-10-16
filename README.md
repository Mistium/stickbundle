# stickbundle

An [OriginChats](https://docs.originchats.com) client. It used to run on a
reconstruction of Velora's Bonfire web client; that code has been removed
from the repository and its history, because Velora's
[license](https://velora.ikelene.net/license) doesn't allow redistributing it
or building a client from it without Ikelene's permission.

There is no UI at the moment, so the build doesn't produce anything yet.

## What's here
`out/src/originchats/` is the OriginChats layer written for this project.

These talk only to OriginChats and Rotur, and work with any UI:

| File | What it does |
| --- | --- |
| `connection.js` | One WebSocket per server: handshake, sign-in (resumed `session`, then Rotur validator, then saved server account), requests matched by `listener`, reconnect with backoff. |
| `rotur.js` | Rotur sign-in through `rotur-sdk`, profiles, avatars and activities. |
| `signing.js` | Signs messages and edits with the account's Rotur identity key (`originchats.message.v1` payload, clock synced to the server) and verifies signed messages in the browser, with an `@noble/ed25519` fallback. |
| `storage.js` | The Rotur key, the server list, session tokens and server-account logins, in localStorage. |

These were written for the old UI and are shaped around its data model, so
they need replacing for a new one:

| File | What it was for |
| --- | --- |
| `backend.js` | Answered the old client's REST and socket calls from OriginChats commands. |
| `convert.js` | Turned OriginChats messages, reactions, attachments, embeds, roles and permissions into the old client's shapes and permission bits. |
| `ids.js` | Derived the old client's id formats from server URLs, channel names and UUIDs. |
| `LoginPage.jsx`, `ui.jsx`, `SigBadge.jsx`, `cosmetics.js` | Sign-in page, home view, per-server sign-in gate, signature shield and avatar overlays. They import the old client's React and components. |
| `originchats.css` | Styles for the above. |

## Build
`scripts/build.sh` bundles `out/src/main.jsx` into `out/dist` for Cloudflare
Pages (`wrangler.jsonc`), and `bun scripts/serve.ts "$PWD/out/dist" 5180`
serves it locally. Both need a new entry point first.
