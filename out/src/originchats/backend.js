// Velora's UI talks to one backend over REST and one WebSocket. This module
// plays that backend in the browser: each Velora "server" is an OriginChats
// server the user added, with its own WebSocket. REST calls are answered from
// OriginChats commands, Velora socket messages become OriginChats commands,
// and OriginChats events are re-emitted in the shape Velora's store expects.

import { OCConnection } from "./connection.js";
import {
  ALL_BITS,
  P,
  allowedBy,
  avatarFor,
  bitsFromPermissions,
  contentToOC,
  host,
  makeCtx,
  permissionsFromBits,
  reactionsToV,
  toVAttachment,
  toVMessage,
  toVRole,
} from "./convert.js";
import { cidFor, eidFor, knownNum, msgNum, readMarker, sidFor, uuidOf } from "./ids.js";
import { cachedVerification, checkSigningAccess, isSigned, signMessage, verifyMessage } from "./signing.js";
import { roturAccount, roturActivities, roturAvatar, roturProfile, roturToVelora, roturValidator } from "./rotur.js";
import * as store from "./storage.js";

const DISCOVERY_URL = "https://discovery.host.originchats.com/discovery.json";

const servers = new Map(); // sid -> server state
const channelIndex = new Map(); // cid -> { sid, name }
const emojiIndex = new Map(); // eid -> { sid, id, name, url, animated }
const messageIndex = new Map(); // numeric id -> { sid, channel, raw }

let hooks = {
  emit() {},
  getState: () => ({}),
  setMe() {},
};
let started = false;
let globalMe = null;

// ---------------------------------------------------------------- identity

function profile() {
  return store.getProfile();
}

function signedIn() {
  return !!profile();
}

function meFromProfile() {
  const p = profile();
  if (p && p.username) {
    return { id: p.id || p.username, username: p.username, pfp: p.pfp || null, color: null, rank: null };
  }
  return null;
}

function currentMe() {
  if (!globalMe) {
    globalMe = meFromProfile();
  }
  return globalMe;
}

// Without a Rotur account, your identity is the first server account that
// signs in. Its display name is its nickname (the bare registered name).
function adoptLocalIdentity(st) {
  if (currentMe() || !st.me) {
    return;
  }
  const u = st.me;
  globalMe = {
    id: u.username,
    username: u.nickname || u.username,
    pfp: avatarFor(st, u, u.username),
    color: u.color || null,
    rank: null,
  };
  store.setProfile({ ...(profile() || {}), kind: "local", id: globalMe.id, username: globalMe.username, pfp: globalMe.pfp });
  hooks.setMe(globalMe);
}

// ---------------------------------------------------------------- servers

function stateFor(url) {
  const sid = sidFor(url);
  let st = servers.get(sid);
  if (!st) {
    const saved = store.getServers().find((s) => s.url === url) || {};
    st = {
      url,
      sid,
      name: saved.name || host(url),
      icon: saved.icon || null,
      banner: saved.banner || null,
      me: null,
      roles: {},
      users: new Map(),
      channels: [],
      unreads: {},
      emojis: {},
      stickers: {},
      readyWaiters: [],
      loaded: false,
    };
    st.conn = new OCConnection(url, {
      onEvent: (c, frame, isResponse) => onFrame(st, frame, isResponse),
      onState: () => onConnState(st),
    });
    servers.set(sid, st);
  }
  return st;
}

function ctxOf(st) {
  return makeCtx(st, currentMe());
}

function lookupEmoji(h, id) {
  for (const st of servers.values()) {
    if (host(st.url) === h && st.emojis[id]) {
      return emojiOf(st, id);
    }
  }
  // a token can name the server that hosts the picture (assetServerUrl)
  for (const st of servers.values()) {
    for (const key of Object.keys(st.emojis)) {
      const e = st.emojis[key];
      if (key !== id || !e || !e.assetServerUrl) {
        continue;
      }
      const base = /^https?:\/\//i.test(e.assetServerUrl) ? e.assetServerUrl : `https://${e.assetServerUrl}`;
      if (host(base) === h) {
        return emojiOf(st, key);
      }
    }
  }
  return null;
}

function emojiOf(st, id) {
  const e = st.emojis[id];
  if (!e) {
    return null;
  }
  const eid = eidFor(st.url, id);
  const asset = e.assetServerUrl
    ? /^https?:\/\//i.test(e.assetServerUrl)
      ? e.assetServerUrl
      : `https://${e.assetServerUrl}`
    : null;
  const base = asset || st.url;
  // New servers serve a web emoji by id; an asset server keeps its file name.
  const assetId = asset ? e.fileName || e.id || id : e.id || e.fileName || id;
  const out = {
    eid,
    id: String(id),
    sid: st.sid,
    name: e.name,
    animated: /\.gif$/i.test(e.fileName || ""),
    host: host(base),
    url: `${base}/emojis/${encodeURIComponent(assetId)}`,
  };
  emojiIndex.set(eid, out);
  return out;
}

function vMessage(st, channel, raw) {
  const m = toVMessage(ctxOf(st), lookupEmoji, channel, raw);
  messageIndex.set(m.id, { sid: st.sid, channel, raw });
  if (signatureMatters(st, raw)) {
    if (isSigned(raw)) {
      const known = cachedVerification(raw);
      m.signed = known || "pending";
      if (!known) checkSignature(st, channel, raw, m.id);
    } else {
      m.signed = "unsigned";
    }
  }
  if (m.reply) {
    messageIndex.set(m.reply.id, messageIndex.get(m.reply.id) || { sid: st.sid, channel, raw: null });
  }
  return m;
}

// Signature marks only mean something for Rotur accounts on servers that
// take signatures; server accounts, system messages, plain webhooks and
// slash command replies can't sign.
function signatureMatters(st, raw) {
  if (!st.conn.has("message_signatures_v1")) return false;
  if (!raw.user || raw.user === "originChats" || raw.interaction || raw.ephemeral) return false;
  if (raw.webhook && !raw.alias) return false;
  if (String(raw.user).startsWith("USR:")) return false;
  const u = st.users.get(raw.user);
  return !(u && u.cracked);
}

// Verifies a signed message, then redraws it with the result.
function checkSignature(st, channel, raw, id) {
  const url = st.conn.handshake && st.conn.handshake.signing_url;
  if (!url) return;
  verifyMessage(raw, url).then(() => {
    const entry = messageIndex.get(id);
    if (entry && entry.raw && entry.raw.id === raw.id) {
      if (st.isDM) {
        hooks.emit({ type: "oc_msg_patch", key: dmKey(st, channel), id, patch: { signed: vMessage(st, channel, entry.raw).signed } });
      } else {
        hooks.emit({ type: "chat_message_update", message: vMessage(st, channel, entry.raw) });
      }
    }
  });
}

function myRoles(st) {
  return (st.me && st.me.roles) || [];
}

function myPermissionList(st) {
  const names = myRoles(st);
  const list = [];
  for (const n of names) {
    const r = st.roles[n];
    if (r && Array.isArray(r.permissions)) {
      list.push(...r.permissions);
    }
  }
  if (names.includes("owner")) {
    list.push("owner");
  }
  return list;
}

function myBits(st) {
  let bits = bitsFromPermissions(myPermissionList(st)) | P.SEND | P.VIEW;
  // Deleting others' messages and pinning are channel rules, not server
  // permissions: offer them when any channel lets one of your roles do it.
  const roles = myRoles(st).filter((r) => r !== "user");
  if (
    roles.length &&
    st.channels.some((ch) =>
      ["delete", "pin"].some((k) => ((ch.permissions && ch.permissions[k]) || []).some((r) => roles.includes(r))),
    )
  ) {
    bits |= P.MANAGE_MESSAGES;
  }
  // The last handshake still counts while reconnecting, so the composer
  // doesn't lose its attach button for a moment.
  const hs = st.conn.handshake || st.lastHandshake;
  if (hs && hs.attachments && hs.attachments.enabled) {
    bits |= P.ATTACH;
  }
  return bits;
}

function myRole(st) {
  const roles = myRoles(st);
  if (roles.includes("owner")) return "owner";
  if (myPermissionList(st).includes("administrator")) return "admin";
  return "member";
}

function serverSummary(st) {
  const ready = st.conn.state === "ready";
  let unread = false;
  let mentions = 0;
  for (const ch of st.channels) {
    const u = st.unreads[ch.name];
    if (u && u.unread_count > 0) unread = true;
    if (u && u.ping_count > 0) mentions += u.ping_count;
  }
  const users = [...st.users.values()];
  return {
    sid: st.sid,
    name: st.name,
    icon: st.icon || null,
    banner: st.banner || null,
    unread,
    mentions,
    member_count: users.length || undefined,
    online: users.filter((u) => u.status && u.status.status && u.status.status !== "offline").length,
    perms: ready ? myBits(st) : 0,
    role: ready ? myRole(st) : "member",
    invite: host(st.url),
    discoverable: false,
    is_default: false,
    oc_url: st.url,
    oc_state: st.conn.state,
    oc_error: st.conn.error,
    oc_loaded: !!st.everLoaded,
  };
}

function listServers() {
  return store.getServers().map((s) => serverSummary(stateFor(s.url)));
}

function vChannels(st) {
  const roles = myRoles(st);
  const out = [];
  const categories = [];
  let category = "";
  let separators = 0;
  st.channels.forEach((ch, i) => {
    if (ch.type === "separator") {
      separators++;
      // Unnamed separators become invisible, unique category names so they
      // still draw as dividers.
      category = ch.display_name || ch.name || "​".repeat(separators);
      categories.push(category);
      return;
    }
    if (ch.type !== "text" && ch.type !== "voice") {
      return;
    }
    const cid = cidFor(st.url, ch.name);
    channelIndex.set(cid, { sid: st.sid, name: ch.name });
    const u = st.unreads[ch.name] || {};
    const canPost = allowedBy(ch.permissions && ch.permissions.send, roles);
    out.push({
      cid,
      name: ch.display_name || ch.name,
      oc_name: ch.name,
      type: ch.type === "voice" ? "voice" : "text",
      topic: ch.description || "",
      category,
      position: i,
      icon: ch.icon && /^https:/.test(ch.icon) ? ch.icon : undefined,
      locked: !canPost,
      private: !((ch.permissions && ch.permissions.view) || []).includes("user"),
      can_post: canPost,
      unread: (u.unread_count || 0) > 0,
      mentions: u.ping_count || 0,
      last_read_id: readMarker(u.last_viewed),
      last_message_id: ch.last_message_id ? msgNum(ch.last_message_id, ch.last_message) : null,
      slow_mode: ch.slow_mode_cooldown || 0,
    });
  });
  return { channels: out, categories };
}

function vRoles(st) {
  const list = Object.values(st.roles);
  const maxPos = Math.max(0, ...list.map((r) => Number(r.position) || 0));
  return list
    .map((r) => toVRole(st.url, r, maxPos))
    .sort((a, b) => b.position - a.position);
}

function vMember(st, u) {
  const ctx = ctxOf(st);
  const roleIds = (u.roles || [])
    .map((n) => st.roles[n])
    .filter(Boolean)
    .map((r) => toVRole(st.url, r, 0).rid);
  const roles = u.roles || [];
  const isAdmin = roles.some((n) => st.roles[n] && (st.roles[n].permissions || []).includes("administrator"));
  return {
    id: u.username,
    username: ctx.vname(u.username),
    pfp: avatarFor(st, u, u.username),
    color: u.color || null,
    role: roles.includes("owner") ? "owner" : isAdmin ? "admin" : null,
    roles: roleIds,
    bot: !!u.bot,
    cracked: !!u.cracked || String(u.username).startsWith("USR:") || undefined,
    presence: vPresence(u),
  };
}

function vPresence(u) {
  const s = (u && u.status) || {};
  return {
    status: s.status === "invisible" ? "offline" : s.status || "offline",
    custom: s.text || null,
    mobile: (u.devices || []).includes("mobile") && !(u.devices || []).includes("computer"),
  };
}

function vDetail(st) {
  let { channels, categories } = vChannels(st);
  // Before a server's first sign-in there are no channels yet; a reconnect
  // keeps showing the last ones.
  if (st.conn.state !== "ready" && !st.everLoaded) {
    // Something to navigate to while the server signs in; the sign-in gate
    // covers it, then moves to a real channel.
    channels = [
      { cid: cidFor(st.url, "\u0000gate"), name: "connecting", type: "text", topic: "", category: "", position: 0, can_post: false, locked: true },
    ];
    categories = [];
  }
  const sum = serverSummary(st);
  return {
    server: { ...sum, description: "", allow_accent: true },
    channels,
    categories,
    roles: vRoles(st),
    voice: {},
  };
}

function waitReady(st, ms = 12000) {
  const s = st.conn.state;
  if (s === "ready" && st.loaded) return Promise.resolve(true);
  if (s === "needs_login" || s === "error" || s === "closed") return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(st.conn.state === "ready"), ms);
    st.readyWaiters.push((ok) => {
      clearTimeout(timer);
      resolve(ok);
    });
  });
}

function flushWaiters(st, ok) {
  const w = st.readyWaiters;
  st.readyWaiters = [];
  w.forEach((f) => f(ok));
}

function onConnState(st) {
  const s = st.conn.state;
  if (s === "needs_login" || s === "error" || s === "closed") {
    flushWaiters(st, false);
  }
  if (s !== "ready") {
    st.loaded = false;
  }
  emitServersChanged(st);
}

let serversTimer = null;
const changedSids = new Set();
function emitServersChanged(st) {
  if (st) changedSids.add(st.sid);
  clearTimeout(serversTimer);
  serversTimer = setTimeout(() => {
    hooks.emit({ type: "oc_servers", servers: listServers() });
    const sids = [...changedSids];
    changedSids.clear();
    for (const sid of sids) {
      if (servers.has(sid)) hooks.emit({ type: "chat_perms_changed", server: sid });
    }
  }, 30);
}

function remember(st) {
  const list = store.getServers();
  const entry = list.find((s) => s.url === st.url);
  if (entry && (entry.name !== st.name || entry.icon !== st.icon || entry.banner !== st.banner)) {
    entry.name = st.name;
    entry.icon = st.icon;
    entry.banner = st.banner;
    store.setServers(list);
  }
}

async function loadServer(st) {
  const c = st.conn;
  const want = (cmd, fields, expect) => c.request(cmd, fields, expect ? { expect } : {}).catch(() => null);
  const [roles, users, emojis, stickers] = await Promise.all([
    want("roles_list"),
    want("users_list"),
    c.has("emoji_list") ? want("emoji_list") : null,
    c.has("sticker_list") ? want("sticker_list") : null,
  ]);
  if (roles && roles.val) st.roles = roles.val;
  if (users && users.users) {
    st.users = new Map(users.users.map((u) => [u.username, u]));
  }
  if (emojis && emojis.emojis) st.emojis = emojis.emojis;
  if (stickers && stickers.stickers) st.stickers = stickers.stickers;
  if (st.me) {
    st.users.set(st.me.username, { ...(st.users.get(st.me.username) || {}), ...st.me });
  }
  c.send("capabilities", { val: ["server_side_embeds"] });
  st.loaded = true;
  flushWaiters(st, true);
  adoptLocalIdentity(st);
  if (st.isDM) {
    dmListsChanged();
    st.everLoaded = true;
    return;
  }
  hooks.emit({ type: "chat_members_stale", server: st.sid });
  hooks.emit({ type: "chat_emojis_update" });
  emitServersChanged(st);
  if (st.everLoaded) {
    // A reconnect: Velora refetches what it missed in open channels.
    const me = currentMe();
    hooks.emit({ type: "chat_ready", you: { username: (me && me.username) || st.me.username, presence: vPresence(st.me) } });
  }
  st.everLoaded = true;
}

function refreshRoles(st) {
  st.conn
    .request("roles_list")
    .then((f) => {
      st.roles = f.val || st.roles;
      hooks.emit({ type: "chat_roles_update", server: st.sid, roles: vRoles(st) });
      emitServersChanged(st);
      hooks.emit({ type: "chat_members_stale", server: st.sid });
    })
    .catch(() => {});
}

function memberUpdate(st, username, change, shownAs) {
  const u = st.users.get(username);
  hooks.emit({
    type: "chat_member_update",
    server: st.sid,
    username: shownAs || ctxOf(st).vname(username),
    change,
    member: u ? vMember(st, u) : undefined,
    member_count: st.users.size,
  });
}

function presenceUpdate(st, u) {
  if (!u) return;
  hooks.emit({ type: "presence_update", username: ctxOf(st).vname(u.username), presence: vPresence(u) });
}

// ---------------------------------------------------------------- events

function onFrame(st, f, isResponse) {
  if (st.isDM && dmFrame(st, f, isResponse)) return;
  const ctx = ctxOf(st);
  const chan = f.channel;
  switch (f.cmd) {
    case "handshake":
      st.lastHandshake = f.val || null;
      if (f.val && f.val.server) {
        st.name = f.val.server.name || st.name;
        st.icon = f.val.server.icon || null;
        st.banner = f.val.server.banner || null;
        remember(st);
      }
      return;
    case "ready":
      st.me = f.user;
      if (Array.isArray(f.channels)) st.channels = f.channels;
      if (f.unreads) st.unreads = f.unreads;
      if (!Array.isArray(f.channels)) {
        st.conn
          .request("channels_get")
          .then((r) => {
            st.channels = r.val || [];
            return st.conn.request("unreads_get").catch(() => null);
          })
          .then((r) => {
            if (r && r.unreads) st.unreads = r.unreads;
            loadServer(st);
          })
          .catch(() => loadServer(st));
      } else {
        loadServer(st);
      }
      return;
    case "channels_get":
      if (Array.isArray(f.val)) {
        st.channels = f.val;
        const { channels, categories } = vChannels(st);
        hooks.emit({ type: "chat_channels_update", server: st.sid, channels, categories });
      }
      return;
    case "message_new": {
      if (isResponse || !f.message || f.thread_id) return;
      if (f.message.ephemeral) {
        hooks.emit({
          type: "chat_ephemeral",
          channel: cidFor(st.url, chan),
          kind: "info",
          body: ctx.vname(f.message.user) === "originChats" ? f.message.content : `${f.message.content}`,
        });
        return;
      }
      const m = vMessage(st, chan, f.message);
      const u = st.unreads[chan] || (st.unreads[chan] = { unread_count: 0, ping_count: 0 });
      const ch = st.channels.find((c) => c.name === chan);
      if (ch) {
        ch.last_message = f.message.timestamp;
        ch.last_message_id = f.message.id;
      }
      if (st.me && f.message.user !== st.me.username) {
        u.unread_count = (u.unread_count || 0) + 1;
      }
      hooks.emit({ type: "chat_message", message: m });
      return;
    }
    case "message_edit":
      if (!f.message || f.thread_id) return;
      hooks.emit({ type: "chat_message_update", message: vMessage(st, chan, f.message) });
      return;
    case "message_delete": {
      if (f.thread_id) return;
      const id = knownNum(f.id);
      if (!id) return;
      hooks.emit({ type: "chat_message_delete", channel: cidFor(st.url, chan), id });
      return;
    }
    case "message_pin":
    case "message_unpin": {
      const id = knownNum(f.id);
      const entry = id && messageIndex.get(id);
      if (entry && entry.raw) {
        entry.raw = { ...entry.raw, pinned: f.cmd === "message_pin" };
        hooks.emit({ type: "chat_message_update", message: vMessage(st, chan, entry.raw) });
      }
      hooks.emit({ type: "chat_pins_update", channel: cidFor(st.url, chan) });
      return;
    }
    case "reaction_add":
    case "reaction_remove":
    case "message_react_add":
    case "message_react_remove": {
      const id = knownNum(f.id);
      if (!id) return;
      const entry = messageIndex.get(id);
      if (!entry || !entry.raw) return;
      let reactions = f.reactions;
      if (!reactions) {
        reactions = { ...(entry.raw.reactions || {}) };
        const users = new Set(reactions[f.emoji] || []);
        if (/add$/.test(f.cmd)) users.add(f.from);
        else users.delete(f.from);
        if (users.size) reactions[f.emoji] = [...users];
        else delete reactions[f.emoji];
      }
      entry.raw = { ...entry.raw, reactions };
      hooks.emit({
        type: "chat_reactions",
        channel: cidFor(st.url, chan),
        id,
        reactions: reactionsToV(ctx, lookupEmoji, reactions) || [],
      });
      return;
    }
    case "typing":
      if (f.thread_id || !f.user || (st.me && f.user === st.me.username)) return;
      hooks.emit({
        type: "chat_typing",
        channel: cidFor(st.url, chan),
        username: ctx.vname(f.user),
        typing: Number(f.duration) !== 0,
      });
      return;
    case "unreads_update":
      if (chan && st.unreads[chan]) {
        st.unreads[chan] = { ...st.unreads[chan], last_viewed: f.last_viewed, unread_count: 0, ping_count: 0 };
      }
      if (chan) {
        const cid = cidFor(st.url, chan);
        hooks.emit({ type: "oc_read", key: `c:${cid}`, cid, sid: st.sid });
      }
      return;
    case "user_join":
      if (f.user && f.user.username) {
        st.users.set(f.user.username, f.user);
        memberUpdate(st, f.user.username, "joined");
      }
      return;
    case "user_leave": {
      const name = f.username || (typeof f.user === "string" ? f.user : f.user && f.user.username);
      if (name) {
        const shown = ctx.vname(name);
        st.users.delete(name);
        memberUpdate(st, name, "left", shown);
      }
      return;
    }
    case "user_kick": {
      // A kick disconnects them; they're still a member.
      const name = typeof f.user === "string" ? f.user : f.user && f.user.username;
      const prev = name && st.users.get(name);
      if (prev) {
        const next = { ...prev, status: { status: "offline", text: "" }, clients: [], devices: [] };
        st.users.set(name, next);
        presenceUpdate(st, next);
      }
      return;
    }
    case "user_connect":
    case "user_disconnect": {
      const u = f.user;
      if (u && u.username) {
        const prev = st.users.get(u.username) || {};
        const next = { ...prev, ...u };
        if (f.cmd === "user_disconnect") next.status = { status: "offline", text: "" };
        else if (!u.status || u.status.status === "offline") next.status = { ...(u.status || prev.status || {}), status: "online" };
        st.users.set(u.username, next);
        presenceUpdate(st, next);
      }
      return;
    }
    case "status_get": {
      const prev = st.users.get(f.username);
      if (prev) {
        const next = { ...prev, status: f.status };
        st.users.set(f.username, next);
        presenceUpdate(st, next);
      }
      return;
    }
    case "user_clients": {
      const prev = st.users.get(f.username);
      if (prev) st.users.set(f.username, { ...prev, clients: f.clients, devices: f.devices });
      return;
    }
    case "user_update":
    case "nickname_update":
    case "nickname_remove": {
      const name = f.username || f.user;
      const prev = st.users.get(name);
      if (prev) {
        // A nickname change can change how a server account is shown, so the
        // old entry goes and the new one comes in.
        const before = ctx.vname(name);
        const next = { ...prev };
        if ("nickname" in f || f.cmd === "nickname_remove") next.nickname = f.nickname || null;
        if (f.pfp) next.pfp = f.pfp;
        st.users.set(name, next);
        if (ctx.vname(name) !== before) memberUpdate(st, name, "left", before);
        memberUpdate(st, name, ctx.vname(name) !== before ? "joined" : "role");
      }
      return;
    }
    case "user_roles_get": {
      const name = f.user;
      const prev = st.users.get(name);
      if (prev) {
        st.users.set(name, { ...prev, roles: f.roles, color: f.color });
        memberUpdate(st, name, "role");
      }
      if (st.me && name === st.me.username) {
        st.me = { ...st.me, roles: f.roles };
        refreshChannels(st);
        emitServersChanged(st);
      }
      return;
    }
    case "role_create":
    case "role_update":
    case "role_delete":
    case "role_reorder":
      refreshRoles(st);
      return;
    case "server_update":
      st.name = f.name || st.name;
      if ("icon" in f) st.icon = f.icon || null;
      if ("banner" in f) st.banner = f.banner || null;
      remember(st);
      hooks.emit({ type: "chat_server_update", server: { sid: st.sid, name: st.name, icon: st.icon, banner: st.banner } });
      emitServersChanged(null);
      return;
    case "rate_limit":
      if (!isResponse && f.length > 0 && f.reason) {
        hooks.emit({ type: "chat_error", error: f.reason, request: "rate_limit" });
      }
      return;
    case "auth_error":
      if (f.reason === "kicked" || f.reason === "banned") {
        hooks.emit({ type: "chat_error", error: `${st.name}: ${f.val}`, request: "auth" });
      }
      return;
    case "error":
      if (!isResponse && f.val && f.src && !["typing", "unreads_ack"].includes(f.src)) {
        hooks.emit({ type: "chat_error", error: f.val, request: f.src });
      }
      return;
    default:
      return;
  }
}

function refreshChannels(st) {
  st.conn
    .request("channels_get")
    .then((r) => {
      st.channels = r.val || st.channels;
      const { channels, categories } = vChannels(st);
      hooks.emit({ type: "chat_channels_update", server: st.sid, channels, categories });
    })
    .catch(() => {});
}

// ---------------------------------------------------------------- lookups

function stBySid(sid) {
  const st = servers.get(sid);
  if (!st || !store.getServers().some((s) => s.url === st.url)) {
    throw httpError(404, "not_a_member");
  }
  return st;
}

// Like channelOf, but a channel of a server that hasn't signed in yet (a
// reload straight into a channel) is waited for.
async function channelOfAsync(cid) {
  try {
    return channelOf(cid);
  } catch (e) {
    const waiting = [...servers.values()].filter((st) => st.conn.state !== "ready" || !st.loaded);
    if (!waiting.length) throw e;
    await Promise.all(waiting.map((st) => waitReady(st)));
    return channelOf(cid);
  }
}

function channelOf(cid) {
  let c = channelIndex.get(cid);
  if (!c) {
    for (const st of servers.values()) {
      vChannels(st);
    }
    c = channelIndex.get(cid);
  }
  if (!c) throw httpError(404, "Channel not found");
  return { st: servers.get(c.sid), name: c.name };
}

function messageOf(num) {
  const uuid = uuidOf(num);
  const entry = messageIndex.get(String(num));
  if (!uuid || !entry) throw httpError(404, "Message not found");
  return { st: servers.get(entry.sid), channel: entry.channel, uuid, entry };
}

function httpError(status, error) {
  return Object.assign(new Error(error), { status, error });
}

function ocError(e) {
  if (e && e.status === 0) return httpError(503, "offline");
  if (e && e.status === 504) return httpError(504, "The server didn't answer in time.");
  return httpError(e && e.status ? e.status : 400, (e && e.message) || "request_failed");
}

async function readyConn(st) {
  if (!(await waitReady(st))) {
    throw httpError(503, st.conn.error || "That server isn't connected.");
  }
  return st.conn;
}

async function users(st) {
  await readyConn(st);
  return st;
}

// ---------------------------------------------------------------- uploads

async function uploadTo(st, file) {
  const c = await readyConn(st);
  const hs = c.handshake || {};
  if (!hs.attachments || !hs.attachments.enabled) {
    throw httpError(403, "This server doesn't accept uploads.");
  }
  if (hs.attachments.max_size && file.size > hs.attachments.max_size) {
    throw httpError(413, "file_too_large");
  }
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name || "file");
  form.append("mime_type", file.type || "application/octet-stream");
  if (c.uploadToken) {
    form.append("local_upload_token", c.uploadToken);
  } else {
    if (!roturAccount()) throw httpError(401, "Sign in with Rotur to upload here.");
    form.append("validator_key", hs.validator_key);
    form.append("validator", await roturValidator(hs.validator_key));
  }
  const res = await realFetch(`${st.url}/attachments/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.attachment) {
    throw httpError(res.status || 400, data.error || "upload_failed");
  }
  return { ...toVAttachment(data.attachment), oc_sid: st.sid };
}

function viewServer() {
  const v = hooks.getState().view || {};
  if (v.kind === "dm" || v.kind === "group") return roturAccount() ? dmState() : null;
  return v.sid ? servers.get(v.sid) : null;
}

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS = {
  show_typing: true,
  share_typing: true,
  share_activity: true,
  sounds: true,
  notify_sound: "short",
  notifications: "mentions",
  dm_privacy: "everyone",
  compact: false,
  animations: true,
  link_images: true,
  link_previews: true,
  developer_mode: false,
  allow_vc_calls: false,
  yt_mode: "ask",
  dm_upload_dest: "ask",
  radio_enabled: false,
  radio_url: "",
  strip_tracking: null,
  daily_notice: false,
};
const readLocal = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const writeLocal = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readLocal("oc_chat_settings", {}) });

// ---------------------------------------------------------------- search

function parseQuery(q) {
  const filters = {};
  let channel = null;
  const words = [];
  for (const part of String(q || "").split(/\s+/).filter(Boolean)) {
    const m = /^(from|has|in):(.+)$/i.exec(part);
    if (!m) {
      words.push(part);
      continue;
    }
    const k = m[1].toLowerCase();
    const v = m[2].replace(/^[@#]/, "");
    if (k === "from") (filters.from = filters.from || []).push(v);
    else if (k === "in") channel = v;
    else {
      const has = { file: "attachment", image: "image", video: "video", link: "link", embed: "embed" }[v] || v;
      (filters.has = filters.has || []).push(has);
    }
  }
  return { query: words.join(" "), filters, channel };
}

async function searchChannel(st, name, q) {
  const ctx = ctxOf(st);
  const fields = { channel: name };
  if (q.query) fields.query = q.query;
  if (Object.keys(q.filters).length) {
    fields.filters = { ...q.filters };
    if (fields.filters.from) fields.filters.from = fields.filters.from.map((u) => ctx.ocname(u));
  }
  if (!fields.query && !fields.filters) return [];
  const r = await st.conn.request("messages_search", fields);
  const display = (st.channels.find((c) => c.name === name) || {}).display_name || name;
  return (r.results || []).filter(Boolean).map((m) => ({ ...vMessage(st, name, m), channel_name: display }));
}

// ---------------------------------------------------------------- REST

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

const json = (body) => body;

route("GET", /^\/account\/me$/, async () => {
  // Server accounts only, before any server has signed in: a placeholder
  // until the first one tells us who we are.
  const me = currentMe() || { id: "you", username: "you", pfp: null };
  return {
    // Ember's current shape
    account: { id: me.id, username: me.username, rank: null, created: null, badges: [], onboarded: true, pro: false },
    profile: { pfp: me.pfp, color: null, banner: (profile() && profile().banner) || null, bio: (profile() && profile().bio) || "" },
    bio_limit: 0,
    // kept for older copies of the client
    sys: { id: me.id, username: me.username, rank: null, created: null, badges: [], onboarded: true },
  };
});

// A person's profile for Velora's cards: their Rotur profile (display name,
// bio, pronouns, banner, badges, connections, accent colour, activities) for
// Rotur accounts, or what the server knows about a server account.
function serverAccount(name) {
  for (const st of servers.values()) {
    const u = st.users.get(ctxOf(st).ocname(name));
    if (u) return { st, u };
  }
  return null;
}

route("GET", /^\/account\/lookup\/([^/]+)$/, async (m) => {
  const name = decodeURIComponent(m[1]);
  const known = serverAccount(name);
  if (known && (known.u.cracked || String(known.u.username).startsWith("USR:"))) {
    const { st, u } = known;
    return {
      id: u.username,
      username: name,
      pfp_url: avatarFor(st, u, u.username),
      color: u.color || null,
      rank: null,
      bio: "",
      badges: [],
      banner_url: null,
    };
  }
  const roturName = known ? known.u.username : name;
  const p = await roturProfile(roturName);
  if (!p) {
    if (known) {
      return { id: known.u.username, username: name, pfp_url: avatarFor(known.st, known.u, known.u.username), color: known.u.color || null, badges: [] };
    }
    throw httpError(404, "user_not_found");
  }
  const v = roturToVelora(p);
  // Keep the name the UI uses for them (your own Rotur name, or theirs).
  return { ...v, username: name };
});

route("GET", /^\/chat\/users\/([^/]+)$/, async (m) => {
  const name = decodeURIComponent(m[1]);
  let presence = null;
  const mutual = [];
  let rotur = true;
  for (const st of servers.values()) {
    if (st.isDM) continue;
    const u = st.users.get(ctxOf(st).ocname(name));
    if (u) {
      if (u.cracked || String(u.username).startsWith("USR:")) rotur = false;
      presence = presence || vPresence(u);
      mutual.push({ sid: st.sid, name: st.name, icon: st.icon, role: (u.roles || []).includes("owner") ? "owner" : null });
    }
  }
  if (rotur) {
    // Rotur's own status carries rich activities (Spotify and the like).
    const p = await roturProfile(name);
    const activities = p ? roturActivities(p.status) : [];
    if (activities.length) {
      presence = { ...(presence || { status: (p.status && p.status.presence) || "offline" }), activities };
      hooks.emit({ type: "presence_update", username: name, presence });
    }
  }
  return { presence, mutual_servers: mutual };
});

route("GET", /^\/chat\/settings$/, () => ({ settings: getSettings() }));
route("PATCH", /^\/chat\/settings$/, (m, body) => {
  const next = { ...readLocal("oc_chat_settings", {}), ...(body || {}) };
  if (Array.isArray(body && body.server_order)) {
    const order = body.server_order.map((sid) => servers.get(sid)).filter(Boolean).map((st) => st.url);
    store.moveServers(order);
    delete next.server_order;
    emitServersChanged(null);
  }
  writeLocal("oc_chat_settings", next);
  return { settings: getSettings() };
});

route("GET", /^\/chat\/notify$/, () => ({ notify: readLocal("oc_notify", {}) }));
route("PUT", /^\/chat\/notify\/([^/]+)$/, (m, body) => {
  const all = readLocal("oc_notify", {});
  const cur = all[m[1]] || { level: null, muted_until: null, push: true };
  if ("level" in body) cur.level = body.level;
  if ("push" in body) cur.push = !!body.push;
  if ("mute_minutes" in body) {
    const n = Number(body.mute_minutes);
    cur.muted_until = n === 0 ? null : n < 0 ? 4102444800000 : Date.now() + n * 60000;
  }
  all[m[1]] = cur;
  writeLocal("oc_notify", all);
  return { notify: cur };
});

route("GET", /^\/chat\/servers$/, () => ({ servers: listServers() }));

route("GET", /^\/chat\/servers\/([^/]+)$/, async (m) => {
  const st = stBySid(m[1]);
  st.conn.state === "idle" && st.conn.connect();
  // Signed in and loading the rest: worth a short wait. Still connecting:
  // answer now, so the server opens straight away; it refreshes once ready.
  if (st.conn.state === "ready") await waitReady(st, 8000);
  return vDetail(st);
});

route("PATCH", /^\/chat\/servers\/([^/]+)$/, async (m, body) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const fields = {};
  if (body.name) fields.name = body.name;
  if ("icon" in body && (body.icon === null || /^https?:/.test(body.icon))) fields.icon = body.icon;
  if ("banner" in body && (body.banner === null || /^https?:/.test(body.banner))) fields.banner = body.banner;
  if (Object.keys(fields).length) {
    await c.request("server_update", fields).catch((e) => {
      throw ocError(e);
    });
    Object.assign(st, fields);
    remember(st);
  }
  return { server: serverSummary(st) };
});

route("GET", /^\/chat\/servers\/([^/]+)\/members$/, async (m) => {
  const st = await users(stBySid(m[1]));
  return { members: [...st.users.values()].map((u) => vMember(st, u)) };
});

route("DELETE", /^\/chat\/servers\/([^/]+)\/members\/([^/?]+)$/, async (m, body, url) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const user = ctxOf(st).ocname(decodeURIComponent(m[2]));
  const ban = url.searchParams.get("ban") === "1";
  await c.request(ban ? "user_ban" : "user_kick", { user }).catch((e) => {
    throw ocError(e);
  });
  if (ban) {
    const shown = ctxOf(st).vname(user);
    st.users.delete(user);
    memberUpdate(st, user, "banned", shown);
  }
  return { ok: true };
});

route(["PUT", "DELETE"], /^\/chat\/servers\/([^/]+)\/members\/([^/]+)\/roles\/([^/]+)$/, async (m, body, url, method) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const user = ctxOf(st).ocname(decodeURIComponent(m[2]));
  const role = Object.values(st.roles).find((r) => toVRole(st.url, r, 0).rid === m[3]);
  if (!role) throw httpError(404, "role_not_found");
  const u = st.users.get(user) || { roles: ["user"] };
  let roles = (u.roles || []).filter((r) => r !== role.name);
  if (method === "PUT") roles = [...roles, role.name];
  if (!roles.length) roles = ["user"];
  await c.request("user_roles_set", { user, roles }, { expect: ["user_roles_set", "user_roles_get"] }).catch((e) => {
    throw ocError(e);
  });
  st.users.set(user, { ...u, roles });
  memberUpdate(st, user, "role");
  return { ok: true };
});

route("POST", /^\/chat\/servers\/([^/]+)\/roles$/, async (m, body) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  let name = String(body.name || "new role").trim();
  let n = 2;
  while (st.roles[name]) name = `${body.name || "new role"} ${n++}`;
  const r = await c.request("role_create", { name, color: body.color || "" }).catch((e) => {
    throw ocError(e);
  });
  const role = r.val || { id: name, name };
  st.roles[role.name] = role;
  hooks.emit({ type: "chat_roles_update", server: st.sid, roles: vRoles(st) });
  return { role: toVRole(st.url, role, 0) };
});

route(["PATCH", "DELETE"], /^\/chat\/servers\/([^/]+)\/roles\/(r[0-9a-f]{10})$/, async (m, body, url, method) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const role = Object.values(st.roles).find((r) => toVRole(st.url, r, 0).rid === m[2]);
  if (!role) throw httpError(404, "role_not_found");
  if (method === "DELETE") {
    await c.request("role_delete", { name: role.name }).catch((e) => {
      throw ocError(e);
    });
    delete st.roles[role.name];
  } else {
    const fields = { id: role.id };
    if (body.name != null && body.name !== role.name) {
      throw httpError(400, "Roles can't be renamed on OriginChats: members and channel rules refer to roles by name.");
    }
    if ("color" in body) fields.color = body.color || "";
    if ("hoist" in body) fields.hoisted = !!body.hoist;
    if ("permissions" in body) fields.permissions = permissionsFromBits(Number(body.permissions) || 0, role.permissions);
    const r = await c.request("role_update", fields).catch((e) => {
      throw ocError(e);
    });
    const next = r.val || { ...role, ...fields };
    delete st.roles[role.name];
    st.roles[next.name] = next;
  }
  hooks.emit({ type: "chat_roles_update", server: st.sid, roles: vRoles(st) });
  emitServersChanged(st);
  return { ok: true };
});

route("PUT", /^\/chat\/servers\/([^/]+)\/roles\/order$/, async (m, body) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const byRid = new Map(Object.values(st.roles).map((r) => [toVRole(st.url, r, 0).rid, r.name]));
  const names = (body.order || []).map((rid) => byRid.get(rid)).filter(Boolean);
  const fixed = Object.values(st.roles)
    .filter((r) => !names.includes(r.name))
    .sort((a, b) => a.position - b.position)
    .map((r) => r.name);
  // Velora lists the highest role first; OriginChats ranks position 0 highest.
  const order = [...fixed.filter((n) => n === "owner"), ...names, ...fixed.filter((n) => n !== "owner")];
  await c.request("role_reorder", { roles: order }).catch((e) => {
    throw ocError(e);
  });
  refreshRoles(st);
  return { ok: true };
});

route("POST", /^\/chat\/servers\/([^/]+)\/channels$/, async (m, body) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const name = String(body.name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-");
  if (!name) throw httpError(400, "name_required");
  const fields = { name, type: body.type === "voice" ? "voice" : "text" };
  if (body.topic) fields.description = body.topic;
  await c.request("channel_create", fields).catch((e) => {
    throw ocError(e);
  });
  const r = await c.request("channels_get").catch(() => null);
  if (r && r.val) st.channels = r.val;
  return { channel: { cid: cidFor(st.url, name) } };
});

route(["PATCH", "DELETE"], /^\/chat\/channels\/(c[0-9a-f]{10})$/, async (m, body, url, method) => {
  const { st, name } = await channelOfAsync(m[1]);
  const c = await readyConn(st);
  if (method === "DELETE") {
    await c.request("channel_delete", { name }).catch((e) => {
      throw ocError(e);
    });
  } else {
    const updates = {};
    if (body.name != null && body.name !== name) updates.display_name = body.name;
    if ("topic" in body) updates.description = body.topic || null;
    if (Object.keys(updates).length) {
      await c.request("channel_update", { current_name: name, updates }).catch((e) => {
        throw ocError(e);
      });
    }
  }
  const r = await c.request("channels_get").catch(() => null);
  if (r && r.val) st.channels = r.val;
  return { ok: true };
});

route("PUT", /^\/chat\/servers\/([^/]+)\/layout$/, async (m) => {
  throw httpError(400, "Reordering channels isn't supported on OriginChats servers yet.");
});

route("POST", /^\/chat\/servers\/([^/]+)\/leave$/, (m) => {
  const st = stBySid(m[1]);
  st.conn.close();
  store.removeServer(st.url);
  servers.delete(st.sid);
  for (const [cid, c] of channelIndex) if (c.sid === st.sid) channelIndex.delete(cid);
  for (const [id, e] of messageIndex) if (e.sid === st.sid) messageIndex.delete(id);
  for (const [eid, e] of emojiIndex) if (e.sid === st.sid) emojiIndex.delete(eid);
  hooks.emit({ type: "chat_server_removed", server: st.sid, reason: "left" });
  emitServersChanged(null);
  return { ok: true };
});

route("GET", /^\/chat\/channels\/(c[0-9a-f]{10})\/messages$/, async (m, body, url) => {
  const { st, name } = await channelOfAsync(m[1]);
  const c = await readyConn(st);
  const limit = Math.min(100, Number(url.searchParams.get("limit")) || 50);
  const before = url.searchParams.get("before");
  const after = url.searchParams.get("after");
  const fields = { channel: name, limit };
  if (before) {
    const uuid = uuidOf(before);
    if (uuid) fields.start = uuid;
  }
  const r = await c.request("messages_get", fields).catch((e) => {
    throw ocError(e);
  });
  let list = (r.val || []).filter(Boolean).map((raw) => vMessage(st, name, raw));
  if (after && /^\d+$/.test(after)) {
    const a = BigInt(after);
    list = list.filter((x) => BigInt(x.id) > a);
  }
  return { messages: list, has_more: !r.at_start && !after };
});

route("POST", /^\/chat\/channels\/(c[0-9a-f]{10})\/read$/, async (m) => {
  const { st, name } = await channelOfAsync(m[1]);
  st.conn.send("unreads_ack", { channel: name });
  st.unreads[name] = { ...(st.unreads[name] || {}), unread_count: 0, ping_count: 0 };
  return { ok: true };
});

route("GET", /^\/chat\/channels\/(c[0-9a-f]{10})\/pins$/, async (m) => {
  const { st, name } = await channelOfAsync(m[1]);
  const c = await readyConn(st);
  const r = await c.request("messages_pinned", { channel: name }).catch((e) => {
    throw ocError(e);
  });
  return { messages: (r.messages || []).filter(Boolean).map((raw) => vMessage(st, name, raw)) };
});

route("GET", /^\/chat\/channels\/(c[0-9a-f]{10})\/search$/, async (m, body, url) => {
  const { st, name } = await channelOfAsync(m[1]);
  await readyConn(st);
  const list = await searchChannel(st, name, parseQuery(url.searchParams.get("q"))).catch((e) => {
    throw ocError(e);
  });
  return { messages: list, total: list.length };
});

route("GET", /^\/chat\/servers\/([^/]+)\/search$/, async (m, body, url) => {
  const st = stBySid(m[1]);
  await readyConn(st);
  const q = parseQuery(url.searchParams.get("q"));
  const targets = st.channels
    .filter((c) => c.type === "text" || c.type === "voice")
    .filter((c) => !q.channel || c.name === q.channel || c.display_name === q.channel)
    .slice(0, 20);
  const results = await Promise.all(targets.map((c) => searchChannel(st, c.name, q).catch(() => [])));
  const list = results.flat().sort((a, b) => b.created_at - a.created_at).slice(0, 60);
  return { messages: list, total: list.length };
});

route(["PUT", "DELETE"], /^\/chat\/messages\/(\d+)\/pin$/, async (m, body, url, method) => {
  const { st, channel, uuid } = messageOf(m[1]);
  const c = await readyConn(st);
  await c.request(method === "PUT" ? "message_pin" : "message_unpin", { channel, id: uuid }).catch((e) => {
    throw ocError(e);
  });
  return { ok: true };
});

route(["PATCH", "DELETE"], /^\/chat\/messages\/(\d+)$/, async (m, body, url, method) => {
  const { st, channel, uuid, entry } = messageOf(m[1]);
  const c = await readyConn(st);
  if (method === "DELETE") {
    await c.request("message_delete", { channel, id: uuid }).catch((e) => {
      throw ocError(e);
    });
  } else {
    const content = contentToOC(ctxOf(st), (eid) => emojiIndex.get(eid), body.message);
    const fields = { channel, id: uuid, content };
    const raw = entry.raw;
    if (raw && c.me && raw.user === c.me.username) {
      // An edit of your own message is signed over the whole new version.
      const current = raw.original || raw;
      Object.assign(
        fields,
        await signMessage(c, {
          content,
          attachments: current.attachments || [],
          after: Number(current.signed_at) || 0,
        }),
      );
    }
    await c.request("message_edit", fields).catch((e) => {
      throw ocError(e);
    });
  }
  return { ok: true };
});

route(["PUT", "DELETE"], /^\/chat\/messages\/(\d+)\/reactions\/(.+)$/, async (m, body, url, method) => {
  const { st, channel, uuid, entry } = messageOf(m[1]);
  const c = await readyConn(st);
  const key = decodeURIComponent(m[2]);
  let emoji = key;
  const custom = /^e[0-9a-f]{10}$/.test(key) ? emojiIndex.get(key) : null;
  if (/^e[0-9a-f]{10}$/.test(key)) {
    if (!custom) throw httpError(400, "unknown_emoji");
    emoji = `<emoji:${custom.host || host(custom.url)}/${custom.id}>`;
  }
  if (method === "DELETE") {
    // Remove with the exact key it was added under (canonical or either old form).
    const forms = custom
      ? [
          `<emoji:${custom.host || host(custom.url)}/${custom.id}>`,
          `originChats:<emoji>//${custom.host || host(custom.url)}/${custom.id}`,
          `originChats://${custom.host || host(custom.url)}/emojis/${custom.id}`,
          key,
        ]
      : [key];
    const keys = Object.keys((entry.raw && entry.raw.reactions) || {});
    const match = keys.find((k) => forms.includes(k)) || keys.find((k) => custom && k.endsWith(`/${custom.id}`));
    if (match) emoji = match;
  }
  await c.request(method === "PUT" ? "reaction_add" : "reaction_remove", { channel, id: uuid, emoji }).catch((e) => {
    throw ocError(e);
  });
  return { ok: true };
});

route("GET", /^\/chat\/emojis$/, () => ({
  servers: [...servers.values()]
    .filter((st) => st.conn.state === "ready" && store.getServers().some((s) => s.url === st.url))
    .map((st) => ({
      sid: st.sid,
      name: st.name,
      icon: st.icon,
      emojis: Object.keys(st.emojis).map((id) => emojiOf(st, id)),
    }))
    .filter((s) => s.emojis.length),
}));

route("GET", /^\/chat\/emojis\/(e[0-9a-f]{10})\/info$/, (m) => {
  const e = emojiIndex.get(m[1]);
  const st = e && servers.get(e.sid);
  return {
    server: st ? { sid: st.sid, name: st.name, icon: st.icon, discoverable: false, member_count: st.users.size, joined: true } : null,
  };
});

route("GET", /^\/chat\/servers\/([^/]+)\/emojis$/, async (m) => {
  const st = stBySid(m[1]);
  await readyConn(st);
  return { emojis: Object.keys(st.emojis).map((id) => emojiOf(st, id)), max: 1000 };
});

route("POST", /^\/chat\/servers\/([^/]+)\/emojis$/, async (m, body) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const file = body instanceof FormData ? body.get("file") : null;
  if (!file) throw httpError(400, "No file");
  const name = String((body.get("name") || file.name || "emoji").replace(/\.[^.]+$/, ""))
    .replace(/[^\w]/g, "_")
    .slice(0, 64);
  const r = await c.request("emoji_add", { name, image: await fileToDataUrl(file) }).catch((e) => {
    throw ocError(e);
  });
  st.emojis[r.id] = { name: r.name, fileName: r.fileName };
  hooks.emit({ type: "chat_emojis_update" });
  return { emoji: emojiOf(st, r.id) };
});

route(["PATCH", "DELETE"], /^\/chat\/servers\/([^/]+)\/emojis\/(e[0-9a-f]{10})$/, async (m, body, url, method) => {
  const st = stBySid(m[1]);
  const c = await readyConn(st);
  const e = emojiIndex.get(m[2]);
  if (!e) throw httpError(404, "unknown_emoji");
  if (method === "DELETE") {
    await c.request("emoji_delete", { emoji_id: e.id }).catch((x) => {
      throw ocError(x);
    });
    delete st.emojis[e.id];
  } else {
    const r = await c.request("emoji_update", { emoji_id: e.id, name: body.name }).catch((x) => {
      throw ocError(x);
    });
    if (r.updated === false) throw httpError(400, "That name is already taken.");
    st.emojis[e.id] = { ...st.emojis[e.id], name: r.name || body.name };
  }
  hooks.emit({ type: "chat_emojis_update" });
  return { ok: true };
});

route("POST", /^\/chat\/media\/(external|upload|temp|account)$/, async (m, body) => {
  const file = body instanceof FormData ? body.get("file") : null;
  const st = viewServer();
  if (!file) throw httpError(400, "No file");
  if (!st) throw httpError(400, "Open a server channel to upload files.");
  return { attachment: await uploadTo(st, file) };
});

route("GET", /^\/chat\/media\/limits$/, () => ({ server_mb: 95, saved_mb: 60 }));
route("POST", /^\/chat\/media\/save$/, () => ({ status: "saved" }));
route("POST", /^\/chat\/media\/gif$/, (m, body) => ({ id: String(body.url || "") }));

route("POST", /^\/chat\/presence\/custom$/, (m, body) => {
  const text = String((body && body.text) || "").slice(0, 100);
  writeLocal("oc_custom_status", text);
  for (const st of servers.values()) {
    if (st.conn.state === "ready") {
      const status = (st.me && st.me.status && st.me.status.status) || "online";
      st.conn.send("status_set", { status, text });
    }
  }
  return { ok: true };
});

let discoverCache = null;
async function discoverList() {
  if (!discoverCache) {
    discoverCache = realFetch(DISCOVERY_URL)
      .then((r) => r.json())
      .then((list) =>
        (Array.isArray(list) ? list : [])
          .filter((s) => s && s.url && (s.status || "approved") === "approved")
          .map((s) => {
            const url = store.normalizeServerUrl(s.url);
            return {
              sid: sidFor(url),
              url,
              name: s.name || s.url,
              description: s.description || "",
              icon: s.icon || null,
              banner: s.banner || null,
              tags: s.tags || [],
              member_count: undefined,
            };
          }),
      )
      .catch((e) => {
        discoverCache = null;
        throw e;
      });
  }
  return discoverCache;
}

route("GET", /^\/chat\/discover$/, async () => {
  const joined = new Set(store.getServers().map((s) => s.url));
  const list = await discoverList().catch(() => []);
  // Member counts come from each server's public /info page.
  await Promise.all(
    list
      .filter((s) => s.member_count === undefined)
      .map((s) =>
        fetchInfo(s.url, 3000)
          .then((info) => {
            s.member_count = info && info.stats ? info.stats.total_users : null;
          })
          .catch(() => {
            s.member_count = null;
          }),
      ),
  );
  return { servers: list.map((s) => ({ ...s, joined: joined.has(s.url) })) };
});

// An invite "code" is a server address, `host/CODE`, or an originchats.com
// invite link (https://originchats.com/invite/<host>/<code>).
function parseInvite(code) {
  let s = decodeURIComponent(String(code || "")).trim();
  const link = /originchats\.com\/invite\/([^/\s]+)(?:\/([^/\s?#]+))?/i.exec(s);
  if (link) return { url: store.normalizeServerUrl(link[1]), invite: link[2] || null };
  const m = /^((?:https?|wss?):\/\/)?([^/\s]+)(?:\/([A-Za-z0-9-]+))?\/?$/.exec(s);
  if (m && /[.:]/.test(m[2])) return { url: store.normalizeServerUrl((m[1] || "") + m[2]), invite: m[3] || null };
  return { url: "", invite: null };
}

async function fetchInfo(url, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await realFetch(`${url}/info`, { signal: ctl.signal });
    if (!r.ok) throw new Error();
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

route("GET", /^\/chat\/invite\/(.+)$/, async (m) => {
  const { url } = parseInvite(m[1]);
  if (!url) throw httpError(404, "invalid_invite");
  const info = await fetchInfo(url).catch(() => null);
  if (!info || !info.server) throw httpError(404, "That address isn't an OriginChats server.");
  return {
    server: {
      sid: sidFor(url),
      name: info.server.name || host(url),
      icon: info.server.icon || null,
      description: url,
      member_count: info.stats && info.stats.total_users,
    },
  };
});

function addServer(url, invite) {
  if (!url) throw httpError(400, "invalid_invite");
  store.addServer(url);
  const st = stateFor(url);
  if (invite) st.conn.extraAuth = { ...st.conn.extraAuth, invite_code: invite };
  if (st.conn.state === "idle" || st.conn.state === "closed") st.conn.connect();
  emitServersChanged(null);
  return { server: { sid: st.sid } };
}

route("POST", /^\/chat\/join\/(.+)$/, (m) => {
  const { url, invite } = parseInvite(m[1]);
  return addServer(url, invite);
});

route("POST", /^\/chat\/servers\/([^/]+)\/join$/, async (m) => {
  const list = await discoverList().catch(() => []);
  const s = list.find((x) => x.sid === m[1]);
  if (!s) throw httpError(404, "invalid_invite");
  return addServer(s.url, null);
});

// "Create a server" becomes "add a server by address".
route("POST", /^\/chat\/servers$/, (m, body) => {
  const { url, invite } = parseInvite((body && (body.url || body.name)) || "");
  if (!url) throw httpError(400, "Enter a server address, like chats.mistium.com.");
  return addServer(url, invite);
});

route("GET", /^\/chat\/unfurl$/, () => ({ embed: null }));

// GIF search: gifs.originchats.com, like the official client. An empty search
// shows the most viewed ones.
const GIFS = "https://gifs.originchats.com";
const GIF_PAGE = 40;
route("GET", /^\/chat\/gifs$/, async (m, body, url) => {
  const q = String(url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const params = new URLSearchParams({ limit: String(GIF_PAGE), offset: String((page - 1) * GIF_PAGE) });
  if (q) params.set("q", q);
  else params.set("sort", "views");
  const res = await realFetch(`${GIFS}/api/gifs?${params}`).catch(() => null);
  const data = res && res.ok ? await res.json().catch(() => null) : null;
  if (!data || !Array.isArray(data.gifs)) throw httpError(502, "Couldn't load GIFs right now.");
  const gifs = data.gifs.map((g) => {
    const src = new URL(g.url || `/api/gif/${g.id}`, GIFS).href;
    // Tiles use a small animated preview; the full GIF is what gets sent.
    const preview = `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=240&n=-1&output=webp`;
    return { id: g.id, title: g.title || "GIF", url: src, preview, width: g.width, height: g.height };
  });
  return { gifs, has_more: gifs.length === GIF_PAGE };
});

// Velora features with no OriginChats equivalent answer with empty data so
// the UI around them stays quiet.
const EMPTY = [
  [/^\/friends$/, { friends: [] }],
  [/^\/friends\/requests$/, { incoming: [], outgoing: [], requests: [] }],
  [/^\/friends\/status\/.+$/, { status: "none" }],
  [/^\/account\/notifications\/unread-count$/, { unread: 0 }],
  [/^\/account\/notifications$/, { notifications: [], unread: 0, next_cursor: null }],
  [/^\/account\/notices$/, { notices: [] }],
  [/^\/account\/blocks$/, { blocks: [] }],
  [/^\/account\/dm-requests$/, { requests: [], settings: { who: "everyone" } }],
  [/^\/chat\/modmail$/, { messages: [], unread: 0 }],
  [/^\/chat\/modmail\/staff$/, { staff: false }],
  [/^\/chat\/media$/, { items: [] }],
  [/^\/chat\/sounds$/, { sounds: [] }],
  [/^\/chat\/servers\/[^/]+\/sounds$/, { sounds: [] }],
  [/^\/chat\/bots$/, { bots: [] }],
  [/^\/bonfire\/session$/, {}],
  [/^\/bonfire\/scopes\.json$/, { scopes: [] }],
  [/^\/push\/state$/, { enabled: false }],
  [/^\/stats$/, {}],
  [/^\/arcade\/profile\/.+$/, {}],
];

async function handle(method, url, body) {
  const path = url.pathname;
  for (const r of routes) {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    if (!methods.includes(method)) continue;
    const m = r.re.exec(path);
    if (m) return r.fn(m, body || {}, url, method);
  }
  if (method === "GET") {
    for (const [re, value] of EMPTY) {
      if (re.test(path)) return JSON.parse(JSON.stringify(value));
    }
  }
  throw httpError(404, "That isn't available on OriginChats servers.");
}

// ---------------------------------------------------------------- DMs
//
// Direct messages and group chats live on the OriginChats DM server
// (dms.originchats.com), like in the official client. Each conversation is a
// `chat` channel there: a DM's description is "Direct message with <user>",
// anything else is a group. New conversations are made with text commands in
// its `cmds` channel. Velora's own DM and group UI is driven from it.

const DM_URL = "https://dms.originchats.com";
const DM_PREFIX = "Direct message with ";
let dm = null;

function dmState() {
  if (!dm) {
    dm = stateFor(DM_URL);
    dm.isDM = true;
  }
  return dm;
}

const isChat = (ch) => ch && ch.type === "chat";
const isDmChannel = (ch) => isChat(ch) && String(ch.description || "").startsWith(DM_PREFIX);
const isGroupChannel = (ch) => isChat(ch) && !isDmChannel(ch);
const dmOther = (ch) => String(ch.description || "").slice(DM_PREFIX.length) || ch.display_name || ch.name;
const roomOf = (ch) => `grp_${ch.name}`;

function dmChannelWith(st, username) {
  const want = ctxOf(st).ocname(username).toLowerCase();
  return st.channels.find((ch) => isDmChannel(ch) && dmOther(ch).toLowerCase() === want) || null;
}

function groupChannel(st, room) {
  return st.channels.find((ch) => isGroupChannel(ch) && roomOf(ch) === room) || null;
}

// Where a DM-server channel's messages live in Velora's store.
function dmKey(st, channelName) {
  const ch = st.channels.find((c) => c.name === channelName);
  if (!ch) return null;
  return isDmChannel(ch) ? `d:${ctxOf(st).vname(dmOther(ch)).toLowerCase()}` : `g:${roomOf(ch)}`;
}

// The DM message shape Velora's vm() reads.
function toIm(st, ch, raw) {
  const v = vMessage(st, ch.name, raw);
  const ctx = ctxOf(st);
  const me = ctx.vname(st.me ? st.me.username : "");
  const other = ctx.vname(dmOther(ch));
  const from = v.author ? v.author.username : raw.user;
  return {
    id: v.id,
    body: v.body,
    from,
    to: from === me ? other : me,
    from_pfp: v.author && v.author.pfp,
    sent_at: v.created_at,
    edited_at: v.edited_at,
    reply: v.reply
      ? { id: v.reply.id, from: v.reply.author && v.reply.author.username, body: v.reply.body, gone: false }
      : null,
    reactions: v.reactions,
    attachments: v.attachments,
    embeds: v.embeds,
    signed: v.signed,
  };
}

// The group message shape Velora's Qj() reads.
function toGroupMessage(st, ch, raw) {
  const v = vMessage(st, ch.name, raw);
  return {
    room: roomOf(ch),
    id: v.id,
    user: v.author ? v.author.username : raw.user,
    pfp: v.author && v.author.pfp,
    message: v.body,
    timestamp: v.created_at,
    edited_at: v.edited_at,
    reply: v.reply ? { id: v.reply.id, user: v.reply.author && v.reply.author.username, message: v.reply.body } : null,
    reactions: v.reactions,
    attachments: v.attachments,
    embeds: v.embeds,
    signed: v.signed,
    system: !!v.system,
  };
}

function dmListsChanged() {
  clearTimeout(dmListsChanged.t);
  dmListsChanged.t = setTimeout(() => hooks.emit({ type: "oc_dm_lists" }), 30);
}

// DM-server frames that need DM handling; false lets the generic handler run.
function dmFrame(st, f, isResponse) {
  const ch = f.channel ? st.channels.find((c) => c.name === f.channel) : null;
  switch (f.cmd) {
    case "channels_get":
      if (Array.isArray(f.val)) {
        st.channels = f.val;
        dmListsChanged();
      }
      return true;
    case "message_new": {
      if (isResponse || !f.message || !ch || !isChat(ch)) return true;
      const u = st.unreads[ch.name] || (st.unreads[ch.name] = { unread_count: 0, ping_count: 0 });
      ch.last_message = f.message.timestamp;
      if (st.me && f.message.user !== st.me.username) u.unread_count = (u.unread_count || 0) + 1;
      if (isDmChannel(ch)) {
        const mine = st.me && f.message.user === st.me.username;
        hooks.emit({ type: mine ? "im_sent" : "im_received", message: toIm(st, ch, f.message) });
      } else {
        hooks.emit({ type: "roomMessage", ...toGroupMessage(st, ch, f.message) });
      }
      return true;
    }
    case "message_edit": {
      if (!f.message || !ch) return true;
      const key = dmKey(st, ch.name);
      const v = isDmChannel(ch) ? toIm(st, ch, f.message) : toGroupMessage(st, ch, f.message);
      const body = isDmChannel(ch) ? v.body : v.message;
      hooks.emit({
        type: "oc_msg_patch",
        key,
        id: v.id,
        patch: { body, edited_at: v.edited_at, attachments: v.attachments, embeds: v.embeds, signed: v.signed },
      });
      return true;
    }
    case "message_delete":
      if (ch && knownNum(f.id)) hooks.emit({ type: "oc_msg_remove", key: dmKey(st, ch.name), id: knownNum(f.id) });
      return true;
    case "message_pin":
    case "message_unpin":
      return true;
    case "reaction_add":
    case "reaction_remove":
    case "message_react_add":
    case "message_react_remove": {
      const id = knownNum(f.id);
      if (!id) return true;
      const entry = messageIndex.get(id);
      if (!entry || !entry.raw || !ch) return true;
      let reactions = f.reactions;
      if (!reactions) {
        reactions = { ...(entry.raw.reactions || {}) };
        const users = new Set(reactions[f.emoji] || []);
        if (/add$/.test(f.cmd)) users.add(f.from);
        else users.delete(f.from);
        if (users.size) reactions[f.emoji] = [...users];
        else delete reactions[f.emoji];
      }
      entry.raw = { ...entry.raw, reactions };
      hooks.emit({
        type: "oc_msg_patch",
        key: dmKey(st, ch.name),
        id,
        patch: { reactions: reactionsToV(ctxOf(st), lookupEmoji, reactions) },
      });
      return true;
    }
    case "typing":
      if (ch && isDmChannel(ch) && f.user && !(st.me && f.user === st.me.username)) {
        hooks.emit({ type: "dm_typing", from: ctxOf(st).vname(f.user), typing: Number(f.duration) !== 0 });
      }
      return true;
    case "unreads_update":
      if (f.channel && st.unreads[f.channel]) {
        st.unreads[f.channel] = { ...st.unreads[f.channel], last_viewed: f.last_viewed, unread_count: 0, ping_count: 0 };
      }
      if (ch && isDmChannel(ch)) {
        const who = ctxOf(st).vname(dmOther(ch)).toLowerCase();
        hooks.emit({ type: "oc_read", key: `d:${who}`, dm: who });
      }
      return true;
    default:
      return false;
  }
}

async function dmReady() {
  const st = dmState();
  if (!roturAccount()) throw httpError(401, "Sign in with Rotur to use direct messages.");
  if (st.conn.state === "idle" || st.conn.state === "closed") st.conn.connect();
  if (!(await waitReady(st))) throw httpError(503, st.conn.error || "Couldn't reach the DM server.");
  return st;
}

// Runs a DM-server text command, then waits for a channel it should create.
async function dmCommand(st, text, find, ms = 10000) {
  const existing = find();
  if (existing) return existing;
  if (!st.conn.send("message_new", { channel: "cmds", content: text })) throw httpError(503, "offline");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    const ch = find();
    if (ch) return ch;
  }
  throw httpError(504, "The DM server didn't answer in time.");
}

async function ensureDmChannel(st, username) {
  const oc = ctxOf(st).ocname(username);
  if (st.me && oc.toLowerCase() === st.me.username.toLowerCase()) throw httpError(400, "You can't message yourself.");
  return dmCommand(st, `dm add ${oc}`, () => dmChannelWith(st, username));
}

route("GET", /^\/im\/conversations$/, async () => {
  if (!roturAccount()) return { conversations: [] };
  const st = dmState();
  if (st.conn.state === "idle" || st.conn.state === "closed") st.conn.connect();
  await waitReady(st, 8000);
  const ctx = ctxOf(st);
  const conversations = st.channels
    .filter(isDmChannel)
    .sort((a, b) => (Number(b.last_message) || 0) - (Number(a.last_message) || 0))
    .map((ch) => {
      const other = dmOther(ch);
      const u = st.unreads[ch.name] || {};
      return {
        username: ctx.vname(other),
        pfp: ch.icon || avatarFor(st, st.users.get(other), other),
        unread: u.unread_count || 0,
        last_at: (Number(ch.last_message) || 0) * 1000,
      };
    });
  return { conversations };
});

route("GET", /^\/im\/with\/([^/?]+)$/, async (m, body, url) => {
  const st = await dmReady();
  const ch = dmChannelWith(st, decodeURIComponent(m[1]));
  if (!ch) return { messages: [], has_more: false };
  const fields = { channel: ch.name, limit: Math.min(100, Number(url.searchParams.get("limit")) || 50) };
  const before = url.searchParams.get("before");
  if (before && uuidOf(before)) fields.start = uuidOf(before);
  const r = await st.conn.request("messages_get", fields).catch((e) => {
    throw ocError(e);
  });
  return { messages: (r.val || []).filter(Boolean).map((raw) => toIm(st, ch, raw)), has_more: !r.at_start };
});

route("POST", /^\/im\/with\/([^/]+)\/read$/, async (m) => {
  if (!roturAccount()) return { ok: true };
  const st = dmState();
  const ch = dmChannelWith(st, decodeURIComponent(m[1]));
  if (ch && st.conn.state === "ready") {
    st.conn.send("unreads_ack", { channel: ch.name });
    st.unreads[ch.name] = { ...(st.unreads[ch.name] || {}), unread_count: 0, ping_count: 0 };
  }
  return { ok: true };
});

route("GET", /^\/im\/status-reply\/.+$/, () => ({ can: false }));

// DM edits, deletes and reactions are the same commands as in channels.
route("PATCH", /^\/im\/(\d+)\/edit$/, (m, body) =>
  handle("PATCH", new URL(`/chat/messages/${m[1]}`, location.origin), { message: body.body }),
);
route("DELETE", /^\/im\/(\d+)$/, (m) => handle("DELETE", new URL(`/chat/messages/${m[1]}`, location.origin), {}));
route(["PUT", "DELETE"], /^\/chat\/dm\/(\d+)\/reactions\/(.+)$/, (m, body, url, method) =>
  handle(method, new URL(`/chat/messages/${m[1]}/reactions/${m[2]}`, location.origin), {}),
);

route("GET", /^\/groups$/, async () => {
  if (!roturAccount()) return { groups: [] };
  const st = dmState();
  if (st.conn.state === "idle" || st.conn.state === "closed") st.conn.connect();
  await waitReady(st, 8000);
  const ctx = ctxOf(st);
  return {
    groups: st.channels
      .filter(isGroupChannel)
      .sort((a, b) => (Number(b.last_message) || 0) - (Number(a.last_message) || 0))
      .map((ch) => ({
        room: roomOf(ch),
        name: ch.display_name || ch.name,
        owner: ch.owner ? ctx.vname(ch.owner) : null,
        members: (ch.members || []).map((u) => ctx.vname(u)),
        unread: (st.unreads[ch.name] || {}).unread_count || 0,
      })),
  };
});

route("GET", /^\/groups\/([^/]+)\/messages$/, async (m, body, url) => {
  const st = await dmReady();
  const ch = groupChannel(st, decodeURIComponent(m[1]));
  if (!ch) throw httpError(404, "That group doesn't exist any more.");
  const r = await st.conn
    .request("messages_get", { channel: ch.name, limit: Math.min(200, Number(url.searchParams.get("limit")) || 100) })
    .catch((e) => {
      throw ocError(e);
    });
  return { messages: (r.val || []).filter(Boolean).map((raw) => toGroupMessage(st, ch, raw)) };
});

// Group names travel inside text commands, so they can't contain spaces.
const groupToken = (s) => String(s || "").trim().replace(/\s+/g, "-");

route("POST", /^\/groups$/, async (m, body) => {
  const st = await dmReady();
  const name = groupToken(body.name);
  if (!name) throw httpError(400, "name_required");
  const before = new Set(st.channels.map((c) => c.name));
  const ch = await dmCommand(st, `group create ${name}`, () =>
    st.channels.find((c) => isGroupChannel(c) && !before.has(c.name) && (c.display_name || c.name) === name),
  );
  for (const u of body.members || []) {
    st.conn.send("message_new", { channel: "cmds", content: `group add ${name} ${ctxOf(st).ocname(u)}` });
  }
  dmListsChanged();
  return { group: { room: roomOf(ch), name } };
});

route("POST", /^\/groups\/([^/]+)\/members$/, async (m, body) => {
  const st = await dmReady();
  const ch = groupChannel(st, decodeURIComponent(m[1]));
  if (!ch) throw httpError(404, "That group doesn't exist any more.");
  const name = ch.display_name || ch.name;
  st.conn.send("message_new", { channel: "cmds", content: `group add ${name} ${ctxOf(st).ocname(body.username)}` });
  return { ok: true };
});

route("DELETE", /^\/groups\/([^/]+)\/members\/([^/]+)$/, async (m) => {
  const st = await dmReady();
  const ch = groupChannel(st, decodeURIComponent(m[1]));
  if (!ch) throw httpError(404, "That group doesn't exist any more.");
  const user = ctxOf(st).ocname(decodeURIComponent(m[2]));
  const leaving = st.me && user.toLowerCase() === st.me.username.toLowerCase();
  await st.conn
    .request(leaving ? "user_leave" : "channel_kick", leaving ? { channel: ch.name } : { channel: ch.name, user }, {
      expect: ["success", leaving ? "user_leave" : "channel_kick", "channels_get"],
    })
    .catch((e) => {
      throw ocError(e);
    });
  return { ok: true };
});

route(["PATCH", "DELETE"], /^\/groups\/([^/]+)$/, async (m, body, url, method) => {
  const st = await dmReady();
  const ch = groupChannel(st, decodeURIComponent(m[1]));
  if (!ch) throw httpError(404, "That group doesn't exist any more.");
  const req =
    method === "DELETE"
      ? st.conn.request("channel_delete", { channel: ch.name }, { expect: ["success", "channel_delete", "channels_get"] })
      : st.conn.request(
          "channel_update",
          { channel: ch.name, updates: { name: groupToken(body.name) } },
          { expect: ["success", "channel_update", "channels_get"] },
        );
  await req.catch((e) => {
    throw ocError(e);
  });
  return { ok: true };
});

// People to start a DM with: members of your servers, plus an exact Rotur
// username.
route("GET", /^\/account\/search$/, async (m, body, url) => {
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return { users: [] };
  const seen = new Map();
  for (const st of servers.values()) {
    const ctx = ctxOf(st);
    for (const u of st.users.values()) {
      if (u.cracked || String(u.username).startsWith("USR:")) continue;
      const name = ctx.vname(u.username);
      if (name.toLowerCase().includes(q) && !seen.has(name.toLowerCase())) {
        seen.set(name.toLowerCase(), { username: name, pfp_url: avatarFor(st, u, u.username) });
      }
    }
  }
  if (/^[\w.-]{2,32}$/.test(q) && !seen.has(q)) {
    const r = await realFetch(`https://api.rotur.dev/profile?name=${encodeURIComponent(q)}`).catch(() => null);
    const p = r && r.ok ? await r.json().catch(() => null) : null;
    if (p && p.username) seen.set(q, { username: p.username, pfp_url: roturAvatar(p.username) });
  }
  const me = currentMe();
  return {
    users: [...seen.values()]
      .filter((u) => !me || u.username !== me.username)
      .sort((a, b) => (a.username.toLowerCase().startsWith(q) ? 0 : 1) - (b.username.toLowerCase().startsWith(q) ? 0 : 1))
      .slice(0, 20),
  };
});

async function sendDm(msg) {
  try {
    const st = await dmReady();
    const ch = await ensureDmChannel(st, msg.to);
    await sendToDmChannel(st, ch, msg, (raw) => hooks.emit({ type: "im_ack", nonce: msg.nonce, message: toIm(st, ch, raw) }));
  } catch (e) {
    hooks.emit({ type: "im_error", nonce: msg.nonce, error: e.message || "request_failed" });
  }
}

async function sendRoom(msg) {
  try {
    const st = await dmReady();
    const ch = groupChannel(st, msg.room);
    if (!ch) throw httpError(404, "That group doesn't exist any more.");
    await sendToDmChannel(st, ch, msg, (raw) => hooks.emit({ type: "roomMessage", ...toGroupMessage(st, ch, raw) }));
  } catch (e) {
    hooks.emit({ type: "chat_error", error: e.message || "request_failed", request: "roomMessage" });
  }
}

async function attachmentMime(a) {
  if (a.mime_type) return a.mime_type;
  if (a.type === "gif") return "image/gif";
  if (a.type === "image") return "image/png";
  if (a.type === "video") return "video/mp4";
  if (a.type === "audio") return "audio/mpeg";
  return "application/octet-stream";
}

// Records for files the server already has, and for links (GIFs, external
// pictures) the official client also sends in `attachments`.
function attachmentRecord(a) {
  if (a.oc_id) {
    return a.oc_raw || { id: a.oc_id };
  }
  if (!a.url) {
    return null;
  }
  return {
    id: a.id || a.oc_id || `ext_${Math.random().toString(36).slice(2, 10)}`,
    name: a.name || String(a.url).split("/").pop() || "file",
    mime_type: attachmentMime(a),
    size: a.size || 0,
    url: a.url,
    ...(a.width ? { width: a.width } : {}),
    ...(a.height ? { height: a.height } : {}),
  };
}

async function sendToDmChannel(st, ch, msg, done) {
  let content = contentToOC(ctxOf(st), (eid) => emojiIndex.get(eid), msg.message);
  const attachments = [];
  for (const a of msg.attachments || []) {
    const rec = attachmentRecord(a);
    if (rec) attachments.push(rec);
  }
  const fields = { channel: ch.name, content };
  if (attachments.length) fields.attachments = attachments;
  const replyUuid = msg.reply_to ? uuidOf(String(msg.reply_to).replace(/^(im|g)/, "")) : null;
  if (replyUuid) fields.reply_to = replyUuid;
  const proof = await signMessage(st.conn, { content, attachments });
  const f = await st.conn.request("message_new", { ...fields, ...proof }).catch((e) => {
    throw ocError(e);
  });
  done(f.message);
}

// ---------------------------------------------------------------- fetch shim

const realFetch = window.fetch.bind(window);
const API_PREFIX = /^\/(chat\/|account\/|media\/|im\/|friends|groups|bonfire\/(session|scopes|replace-token)|push\/|currency\/|connect\/|auth\/|arcade\/|storage|stats|admin\/|build\.json)/;

window.fetch = async function (input, init = {}) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw, location.href);
  } catch {
    return realFetch(input, init);
  }
  if (url.origin !== location.origin || !API_PREFIX.test(url.pathname)) {
    return realFetch(input, init);
  }
  const method = String(init.method || (input && input.method) || "GET").toUpperCase();
  let body = init.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {}
  }
  try {
    const data = await handle(method, url, body);
    return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    if (status >= 500 && status !== 503 && status !== 504) console.error("[originchats]", method, url.pathname, e);
    return new Response(JSON.stringify({ error: (e && (e.error || e.message)) || "request_failed" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ---------------------------------------------------------------- socket

const pendingNonces = new Map();

function sendFromVelora(msg) {
  const t = msg && msg.type;
  switch (t) {
    // Ember's home socket handshake. The in-page bridge has no Velora account
    // behind it: the OriginChats identity is already established, so accept it
    // and send the server list.
    case "auth_token": {
      if (!store.getProfile()) {
        setTimeout(() => hooks.emit({ type: "auth_error", error: "invalid_token" }), 0);
        return true;
      }
      setTimeout(() => {
        hooks.emit({ type: "auth_success" });
        hooks.emit({ type: "oc_servers", servers: listServers() });
      }, 0);
      return true;
    }
    case "chat_hello": {
      const me = currentMe();
      setTimeout(
        () =>
          hooks.emit({
            type: "chat_ready",
            you: { username: (me && me.username) || "you", presence: { status: "online" } },
          }),
        0,
      );
      return true;
    }
    case "chat_send": {
      let ch;
      try {
        ch = channelOf(msg.channel);
      } catch {
        return false;
      }
      const { st, name } = ch;
      if (st.conn.state !== "ready") return false;
      const ctx = ctxOf(st);
      let content = contentToOC(ctx, (eid) => emojiIndex.get(eid), msg.message);
      const attachments = [];
      for (const a of msg.attachments || []) {
        // Uploads go back as their full record, which the signature covers;
        // GIFs and other links travel as attachment records too.
        const rec = attachmentRecord(a);
        if (rec) attachments.push(rec);
      }
      const fields = { channel: name, content };
      if (attachments.length) fields.attachments = attachments;
      const replyUuid = msg.reply_to ? uuidOf(msg.reply_to) : null;
      if (replyUuid) fields.reply_to = replyUuid;
      signMessage(st.conn, { content, attachments })
        .then((proof) => st.conn.request("message_new", { ...fields, ...proof }))
        .then((f) => {
          hooks.emit({ type: "chat_ack", nonce: msg.nonce, message: vMessage(st, name, f.message) });
        })
        .catch((e) => {
          hooks.emit({ type: "chat_error", nonce: msg.nonce, error: e.message || "request_failed", request: "chat_send" });
        });
      return true;
    }
    case "chat_typing": {
      let ch;
      try {
        ch = channelOf(msg.channel);
      } catch {
        return false;
      }
      return ch.st.conn.send("typing", { channel: ch.name, duration: msg.typing === false ? 0 : 6000 });
    }
    case "chat_read": {
      let ch;
      try {
        ch = channelOf(msg.channel);
      } catch {
        return false;
      }
      const uuid = msg.id ? uuidOf(msg.id) : null;
      ch.st.unreads[ch.name] = { ...(ch.st.unreads[ch.name] || {}), unread_count: 0, ping_count: 0 };
      return ch.st.conn.send("unreads_ack", uuid ? { channel: ch.name, message_id: uuid } : { channel: ch.name });
    }
    case "set_status": {
      const text = readLocal("oc_custom_status", "");
      let any = false;
      for (const st of servers.values()) {
        if (st.conn.state === "ready") {
          any = st.conn.send("status_set", { status: msg.status, text }) || any;
          if (st.me) st.me = { ...st.me, status: { status: msg.status, text } };
        }
      }
      return any;
    }
    case "chat_presence": {
      for (const st of servers.values()) {
        const u = st.users.get(ctxOf(st).ocname(msg.username));
        if (u) {
          setTimeout(() => presenceUpdate(st, u), 0);
          break;
        }
      }
      return true;
    }
    case "im_send":
      sendDm(msg);
      return true;
    case "roomMessage":
      sendRoom(msg);
      return true;
    case "dm_typing": {
      const st = dm;
      const ch = st && st.conn.state === "ready" ? dmChannelWith(st, msg.to) : null;
      return ch ? st.conn.send("typing", { channel: ch.name, duration: msg.typing === false ? 0 : 6000 }) : true;
    }
    case "chat_rtc_join":
    case "voice_call":
      setTimeout(
        () => hooks.emit({ type: "chat_error", nonce: msg.nonce, request: t, error: "Voice isn't supported in this client yet." }),
        0,
      );
      return true;
    default:
      // ping, chat_hello, chat_active, rich presence, dm_typing, ...
      return true;
  }
}

function start(nextHooks) {
  hooks = { ...hooks, ...nextHooks };
  if (started) return;
  started = true;
  for (const s of store.getServers()) {
    const st = stateFor(s.url);
    st.conn.connect();
  }
  emitServersChanged(null);
  if (roturAccount()) dmState().conn.connect();
  checkSigningAccess();
}

// ---------------------------------------------------------------- UI helpers

function emojiSrc(eid, animated) {
  const e = emojiIndex.get(eid);
  return e ? e.url : `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
}

function serverInfo(sid) {
  const st = servers.get(sid);
  if (!st) return null;
  const hs = st.conn.handshake || st.lastHandshake || {};
  const caps = hs.capabilities || [];
  return {
    sid,
    url: st.url,
    name: st.name,
    icon: st.icon,
    state: st.conn.state,
    error: st.conn.error,
    authMode: hs.auth_mode || "rotur",
    canLogin: hs.auth_mode === "cracked" || hs.auth_mode === "cracked-only" || caps.includes("login"),
    canRegister: caps.includes("register"),
    canRotur: (hs.auth_mode || "rotur") !== "cracked-only",
    hasRotur: !!roturAccount(),
    connected: !!st.conn.ws,
    access: st.conn.accessNeeded || (hs.access_control ? { mode: hs.access_control.mode } : null),
  };
}

function loginLocal(sid, username, password, register) {
  const st = servers.get(sid);
  if (!st) return Promise.reject(new Error("Unknown server"));
  return st.conn.loginLocal(username, password, { register });
}

function retryAccess(sid, extra) {
  const st = servers.get(sid);
  if (st) {
    st.conn.accessNeeded = null;
    st.conn.retryWith(extra);
  }
}

function reconnect(sid) {
  const st = servers.get(sid);
  if (st) {
    st.conn.retries = 0;
    st.conn.error = null;
    if (st.conn.ws) st.conn.signIn();
    else st.conn.connect();
  }
}

function hasAnyIdentity() {
  return signedIn();
}

export {
  emojiSrc,
  hasAnyIdentity,
  loginLocal,
  reconnect,
  retryAccess,
  sendFromVelora,
  serverInfo,
  start,
};
