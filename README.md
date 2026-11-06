# stickbundle

An [OriginChats](https://docs.originchats.com) client built on
[Ember's web client](https://github.com/Ikelene/ember-client). It is published
as a fork at [Mistium/stickbundle](https://github.com/Mistium/stickbundle).
Ember's React UI, store and message components are used as-is; this repository
adds a browser-side bridge that makes OriginChats servers look like Ember's
backend.

## How it works

Ember normally talks to one Velora backend over REST (`/chat/...`,
`/account/...`, `/im/...`) and one WebSocket. Here the page itself answers
those calls:

| File | What it does |
| --- | --- |
| `out/src/originchats/backend.js` | A `fetch` shim that answers Ember's REST paths from OriginChats commands, and turns Ember's socket frames (`chat_send`, `chat_read`, `im_send`, ...) into OriginChats commands. |
| `out/src/originchats/ws.js` | An in-memory WebSocket for Ember's home connection: outbound frames go to the bridge, inbound events go back to Ember's store unchanged. |
| `out/src/originchats/connection.js` | One real WebSocket per OriginChats server: handshake, sign-in (resumed `session`, then Rotur validator, then saved server account), request matching and reconnect. |
| `out/src/originchats/convert.js` | Messages, reactions, attachments, embeds, roles, permissions and emoji between Ember's shapes and OriginChats'. |
| `out/src/originchats/ids.js` | Stable Ember-style ids (`s…`, `c…`, `r…`, `e…`, numeric messages) derived from server URLs, channel names and UUIDs. |
| `out/src/originchats/rotur.js` | Rotur sign-in through `rotur-sdk`, profiles, avatars, activities and validators. |
| `out/src/originchats/signing.js` | Signs messages and edits with the Rotur identity key (`originchats.message.v1`), syncs the clock to the server, and verifies signed messages. |
| `out/src/originchats/storage.js` | Rotur key, server list, sessions and server-account logins in localStorage. |
| `out/src/originchats/session.js` | Maps an OriginChats identity onto Ember's web sign-in (`bonfire_token`), including sign-out. |
| `out/src/originchats/OcLogin.jsx` | The OriginChats sign-in screen (Rotur, account key, or server accounts only). |
| `out/src/originchats/OcServers.jsx` | Add a server by address/invite and browse the public OriginChats directory. |
| `out/src/originchats/OcServerGate.jsx` | Per-server sign-in gate for server accounts, invites and passwords. |

The rest of `out/src` is Ikelene's Ember client, with small changes marked by
`__ORIGINCHATS__`: plaintext DMs instead of Nookara's E2EE, its own sign-in
instead of Nookara's, and the add/discover dialogs above. DMs and group chats
use the OriginChats DM server (`dms.originchats.com`); servers, channels,
members, roles, message history, reactions, edits, pins, search, typing and
unread counts are mapped per server.

## What works

- Servers: add by address or invite, or from public discovery; server icon,
  banner, roles, members, presence and per-server sign-in.
- Channels: history and paging, sending, replying, editing, deleting, pins,
  reactions (Unicode and custom), typing, search, unread and mentions.
- Attachments: uploads go to the server you are viewing.
- DMs and group chats on the OriginChats DM server, including edits, deletes
  and reactions.
- Message signatures with the Rotur identity key, verified in the browser.

OriginChats has no equivalent for voice, web push, credits, bots, server
hosting or the Nookara account pages; those controls either hide or answer
with an empty result.

## Build

```sh
./scripts/build.sh            # Vite build into out/dist
bun scripts/serve.ts "$PWD/out/dist" 5180
```

Set `ROTUR_APP_ID=app_…` when building to use a registered Rotur app;
without it sign-in uses Rotur's `rotur.dev/auth` flow.

Deploy the static build in `out/dist` with Cloudflare Pages
(`wrangler pages deploy out/dist --project-name stickbundle`). `_redirects`
serves `/chat` from `index.html`, so reloading a chat keeps working.

## License

AGPL-3.0-or-later. Ember's client is AGPL-3.0; see `LICENSE` and
[Ikelene/ember-client](https://github.com/Ikelene/ember-client). The AOL and
PlayStation message sounds that Ember's documentation mentions belong to their
owners and are not covered by that license.
