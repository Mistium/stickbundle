// Translation between OriginChats objects and the shapes Velora's UI renders.

import { cidFor, eidFor, msgNum, ridFor } from "./ids.js";
import { roturAvatar } from "./rotur.js";

// Velora's permission bits (VcRoles.jsx `$e`).
const P = {
  SEND: 1,
  MANAGE_CHANNELS: 2,
  MANAGE_SERVER: 4,
  MANAGE_ROLES: 8,
  KICK: 16,
  BAN: 32,
  MANAGE_MESSAGES: 64,
  MENTION_EVERYONE: 128,
  ATTACH: 256,
  ADMIN: 512,
  VIEW: 1024,
};
const ALL_BITS = 2047;

function bitsFromPermissions(list) {
  const perms = new Set(list || []);
  if (perms.has("owner") || perms.has("administrator")) {
    return ALL_BITS;
  }
  let bits = 0;
  if (perms.has("manage_channels")) bits |= P.MANAGE_CHANNELS;
  if (perms.has("manage_server")) bits |= P.MANAGE_SERVER;
  if (perms.has("manage_roles")) bits |= P.MANAGE_ROLES;
  if (perms.has("manage_users")) bits |= P.KICK | P.BAN;
  if (perms.has("kick_members")) bits |= P.KICK;
  if (perms.has("manage_messages")) bits |= P.MANAGE_MESSAGES;
  return bits;
}

// The inverse, for the role editor. OriginChats permissions Velora has no bit
// for (manage_emojis, view_audit_log, ...) are kept as they were.
function permissionsFromBits(bits, previous = []) {
  const mapped = new Set([
    "administrator",
    "manage_channels",
    "manage_server",
    "manage_roles",
    "manage_users",
    "kick_members",
    "manage_messages",
  ]);
  const out = new Set((previous || []).filter((p) => !mapped.has(p) && p !== "owner"));
  if ((previous || []).includes("owner")) out.add("owner");
  if (bits & P.ADMIN) out.add("administrator");
  if (bits & P.MANAGE_CHANNELS) out.add("manage_channels");
  if (bits & P.MANAGE_SERVER) out.add("manage_server");
  if (bits & P.MANAGE_ROLES) out.add("manage_roles");
  if (bits & P.BAN) out.add("manage_users");
  else if (bits & P.KICK) out.add("kick_members");
  if (bits & P.MANAGE_MESSAGES) out.add("manage_messages");
  return [...out];
}

// OriginChats channel permission lists: owner always passes, `!role` blocks,
// otherwise any listed role (or no plain roles at all) passes.
function allowedBy(list, roles) {
  if (roles.includes("owner")) {
    return true;
  }
  const l = Array.isArray(list) ? list : [];
  if (l.some((r) => r.startsWith("!") && roles.includes(r.slice(1)))) {
    return false;
  }
  const plain = l.filter((r) => !r.startsWith("!"));
  return plain.length === 0 || plain.some((r) => roles.includes(r));
}

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// Servers store unknown attachments and embeds as the sender wrote them, so
// only http(s) URLs are passed on to links and images.
function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined;
}

function attachmentType(a) {
  const m = String(a.mime_type || a.type || "").toLowerCase();
  if (m === "image/gif") return "gif";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

function toVAttachment(a) {
  return {
    url: safeUrl(a.url),
    type: attachmentType(a),
    name: a.name || String(a.url || "").split("/").pop(),
    size: a.size,
    width: a.width,
    height: a.height,
    oc_id: a.id,
    // The record as the server returned it: sent back as-is, because a
    // signature covers exactly this object.
    oc_raw: a,
  };
}

function toVEmbed(e) {
  if (!e || e.type === "poll") {
    return null;
  }
  const media = (m) => (m && safeUrl(m.url) ? { url: safeUrl(m.url), width: m.width, height: m.height } : undefined);
  return {
    color: typeof e.color === "number" ? e.color : undefined,
    author: e.author ? { name: e.author.name, url: safeUrl(e.author.url), icon_url: safeUrl(e.author.icon_url) } : undefined,
    title: e.title,
    url: safeUrl(e.url),
    description: e.description,
    fields: Array.isArray(e.fields) ? e.fields : undefined,
    image: media(e.image) || (e.type === "image" ? media(e.image) : undefined),
    thumbnail: media(e.thumbnail),
    footer: e.footer ? { text: e.footer.text, icon_url: safeUrl(e.footer.icon_url) } : undefined,
    timestamp: e.timestamp,
  };
}

function pollText(e) {
  const p = e && e.poll;
  if (!p || !p.question) {
    return "";
  }
  const lines = (p.options || []).map((o, i) => {
    const r = (p.results || []).find((x) => x.id === o.id || x.option_id === o.id) || (p.results || [])[i];
    const votes = r && r.votes != null ? ` - ${r.votes}` : "";
    return `- ${o.emoji ? `${o.emoji} ` : ""}${o.text || o.name || o}${votes}`;
  });
  return `> **${p.question}**${p.ended ? " (ended)" : ""}\n${lines.map((l) => `> ${l}`).join("\n")}`;
}

// Everything conversion needs to know about one server.
function makeCtx(st, globalMe) {
  return {
    st,
    url: st.url,
    sid: st.sid,
    // Your account on this server shows as your Velora identity everywhere.
    // Server accounts (`USR:local_bob`) show by their nickname when no one
    // else on the server already goes by it.
    vname(u) {
      if (st.me && u === st.me.username && globalMe && globalMe.username) {
        return globalMe.username;
      }
      const user = st.users.get(u);
      if (user && user.cracked && user.nickname && !st.users.has(user.nickname)) {
        return user.nickname;
      }
      return u;
    },
    ocname(u) {
      if (globalMe && u === globalMe.username && st.me) {
        return st.me.username;
      }
      if (st.users.has(u)) {
        return u;
      }
      for (const user of st.users.values()) {
        if (user.cracked && user.nickname === u) {
          return user.username;
        }
      }
      return u;
    },
  };
}

function avatarFor(st, user, username) {
  if (user && safeUrl(user.pfp || user.pfp_url)) {
    return safeUrl(user.pfp || user.pfp_url);
  }
  if (user && user.cracked) {
    return null;
  }
  if (String(username || "").startsWith("USR:")) {
    return null;
  }
  return roturAvatar(username);
}

const CUSTOM_EMOJI_RE = /originChats:<emoji>\/\/([^\s/]+)\/([\w-]+)|originChats:\/\/([^\s/]+)\/emojis\/([\w-]+)/g;

function contentToV(ctx, emojiLookup, text) {
  let s = String(text || "");
  s = s.replace(CUSTOM_EMOJI_RE, (m, h1, id1, h2, id2) => {
    const e = emojiLookup(h1 || h2, id1 || id2);
    return e ? `<${e.animated ? "a" : ""}:${e.name.slice(0, 32)}:${e.eid}>` : ":emoji:";
  });
  s = s.replace(/originChats:<sticker>\/\/([^\s/]+)\/([\w-]+)/g, (m, h, id) => {
    const st = ctx.st.stickers && ctx.st.stickers[id];
    return st && h === host(ctx.url) ? `\n${ctx.url}/stickers/${st.fileName}\n` : "[sticker]";
  });
  s = s.replace(/originChats:<message>\/\/[^\s/]+\/([^\s/]+)(?:\/[^\s/]+)?\/[\w-]+/g, (m, ch) => `#${ch}`);
  // Role mentions are `@&name` on the wire and `<@&rid>` in Velora.
  s = s.replace(/@&([\w-]+)/g, (m, name) => {
    const role = ctx.st.roles && ctx.st.roles[name];
    return role ? `<@&${ridFor(ctx.url, role.id)}>` : m;
  });
  s = s.replace(/@(USR:local_[\w-]+)/g, (m, u) => `@${ctx.vname(u)}`);
  if (ctx.st.me && ctx.vname(ctx.st.me.username) !== ctx.st.me.username) {
    const mine = ctx.st.me.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`@${mine}(?![\\w-])`, "g"), `@${ctx.vname(ctx.st.me.username)}`);
  }
  return s;
}

function contentToOC(ctx, emojiByEid, text) {
  let s = String(text || "");
  s = s.replace(/(^|\s)@([\w.-]{2,32})/g, (m, pre, u) => {
    const oc = ctx.ocname(u);
    return oc !== u ? `${pre}@${oc}` : m;
  });
  s = s.replace(/<(a?):([A-Za-z0-9_]{1,32}):(e[0-9a-f]{10})>/g, (m, a, name, eid) => {
    const e = emojiByEid(eid);
    return e ? `originChats:<emoji>//${host(e.url)}/${e.id}` : `:${name}:`;
  });
  s = s.replace(/<@&(r[0-9a-f]{10})>/g, (m, rid) => {
    const role = Object.values(ctx.st.roles || {}).find((r) => ridFor(ctx.url, r.id) === rid);
    return role ? `@&${role.name}` : m;
  });
  return s;
}

function reactionToV(ctx, emojiLookup, key) {
  const m = /^originChats:<emoji>\/\/([^\s/]+)\/([\w-]+)$/.exec(key) || /^originChats:\/\/([^\s/]+)\/emojis\/([\w-]+)$/.exec(key);
  if (m) {
    const e = emojiLookup(m[1], m[2]);
    return e ? `<${e.animated ? "a" : ""}:${e.name.slice(0, 32)}:${e.eid}>` : "❔";
  }
  return key;
}

function reactionsToV(ctx, emojiLookup, reactions) {
  const out = Object.entries(reactions || {})
    .filter(([, users]) => Array.isArray(users) && users.length)
    .map(([emoji, users]) => ({
      emoji: reactionToV(ctx, emojiLookup, emoji),
      count: users.length,
      users: users.map((u) => ctx.vname(u)),
      oc_key: emoji,
    }));
  return out.length ? out : undefined;
}

function toVMessage(ctx, emojiLookup, channel, m) {
  const st = ctx.st;
  const id = msgNum(m.id, m.timestamp);
  const isSystem = m.user === "originChats" && !m.webhook && !m.interaction;
  let body = contentToV(ctx, emojiLookup, m.content);
  let author;
  let system = false;
  let sysKind;
  if (m.webhook) {
    author = {
      username: m.webhook.name || "Webhook",
      pfp: safeUrl(m.webhook.avatar) || null,
      color: m.webhook.usercolor || null,
      webhook: true,
    };
  } else if (isSystem) {
    const pin = /^originChats:<message>\/\/\S+ pinned by @(\S+)/.exec(m.content || "");
    if (pin) {
      system = true;
      sysKind = "pin";
      body = `@${ctx.vname(pin[1])} pinned a message.`;
    } else if (/^Welcome .+ Thanks for joining/i.test(m.content || "")) {
      system = true;
      sysKind = "join";
      body = body.replace(/^Welcome (\S+)!/, (x, u) => `Welcome @${ctx.vname(u)}!`);
    }
    author = { username: st.name || "originChats", pfp: st.icon || null, webhook: true, staff: true };
  } else {
    const u = st.users.get(m.user);
    author = {
      username: ctx.vname(m.user),
      pfp: avatarFor(st, u, m.user),
      color: (u && u.color) || null,
      bot: !!(u && u.bot) || undefined,
      id: m.author_id,
    };
    if (m.alias && m.alias.name) {
      author = {
        username: m.alias.name,
        pfp: safeUrl(m.alias.avatar) || author.pfp,
        color: m.alias.usercolor || author.color,
        webhook: true,
        bridge_from: ctx.vname(m.user),
      };
    }
  }
  const embeds = (m.embeds || []).map(toVEmbed).filter(Boolean);
  const poll = (m.embeds || []).find((e) => e && e.type === "poll");
  if (poll) {
    body = [body, pollText(poll)].filter(Boolean).join("\n");
  }
  let reply = null;
  if (m.reply_to && m.reply_to.id) {
    const ru = st.users.get(m.reply_to.user);
    reply = {
      id: msgNum(m.reply_to.id, null),
      author: m.reply_to.user
        ? {
            username: ctx.vname(m.reply_to.user),
            pfp: avatarFor(st, ru, m.reply_to.user),
            color: (ru && ru.color) || null,
          }
        : null,
      body: contentToV(ctx, emojiLookup, m.reply_to.preview || ""),
    };
  }
  const ts = Number(m.timestamp) * 1000;
  return {
    id,
    body,
    author,
    created_at: ts,
    edited_at: m.edited ? (m.edited_at ? Number(m.edited_at) * 1000 : ts + 1) : null,
    reply,
    attachments: (m.attachments || []).filter((a) => a && safeUrl(a.url)).map(toVAttachment),
    embeds: embeds.length ? embeds : undefined,
    reactions: reactionsToV(ctx, emojiLookup, m.reactions),
    pinned: !!m.pinned,
    system: system || undefined,
    sys_kind: sysKind,
    channel: cidFor(ctx.url, channel),
    server: ctx.sid,
    mention_everyone: false,
    mention_roles: ((m.pings && m.pings.roles) || []).map((r) => ridFor(ctx.url, r)),
    thread_id: m.thread_id,
  };
}

function toVRole(url, role, maxPos) {
  return {
    rid: ridFor(url, role.id),
    oc_id: role.id,
    name: role.name,
    color: role.color || null,
    icon: role.icon || null,
    position: maxPos - (Number(role.position) || 0),
    permissions: bitsFromPermissions(role.permissions),
    hoist: !!role.hoisted,
    mentionable: true,
    is_default: role.name === "user",
  };
}

export {
  safeUrl,
  ALL_BITS,
  P,
  allowedBy,
  avatarFor,
  bitsFromPermissions,
  contentToOC,
  contentToV,
  eidFor,
  host,
  makeCtx,
  permissionsFromBits,
  reactionsToV,
  toVAttachment,
  toVMessage,
  toVRole,
};
