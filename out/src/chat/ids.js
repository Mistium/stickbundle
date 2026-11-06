// Ids across instances. Every server / channel id that came from an instance is kept as `origin|id` everywhere in Ember's
// state (a hostile instance can pick any sid / cid, so two instances' ids must never meet). Velora's own (legacy) ids stay
// bare: they never contain '|', so they can't collide with a namespaced one. Only the code that talks to an instance
// turns a key back into the bare id, and the origin comes out of the key itself - a request for community X can only
// ever go to the instance X was loaded from.
import { onWebClientPath, hostedAlias } from './hosts.js';
export const VELORA = 'velora';

export function normOrigin(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${/^(localhost|127\.|\[::1\]|10\.|192\.168\.)/i.test(s) ? 'http' : 'https'}://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
    const alias = hostedAlias(u.hostname); // e_<slug>.nookara.cc -> e-<slug>.nookara.cc
    if (alias !== u.hostname) u.hostname = alias;
    return u.origin;
  } catch { return null; }
}
export const K = (inst, id) => (id == null ? id : !inst || inst === VELORA ? String(id) : `${inst}|${id}`);
export function parseK(k) {
  k = String(k ?? '');
  const i = k.indexOf('|');
  return i > 0 ? { inst: k.slice(0, i), id: k.slice(i + 1) } : { inst: VELORA, id: k };
}
export const instOf = k => parseK(k).inst;
export const bare = k => parseK(k).id;
export const isInst = k => instOf(k) !== VELORA;
export const instOpt = k => (k && isInst(k) ? instOf(k) : undefined); // apiFetch's opts.inst for something that came from an instance (a message's channel...)

// ── the instances this page is connected to (set by instances.js; api.js reads it) ──
export const registry = new Map(); // origin -> { origin, session }
export const hooks = { refresh: null, restricted: null }; // refresh(origin) -> Promise<boolean>: a new session after a 401; restricted(origin, message): the instance said account_restricted (Ember switched off for this account)

// Everything Ember keeps per account on this device (its server list, the sessions it opened on instances) is stored under the
// signed-in Velora account's name, so switching accounts shows that account's servers and not the previous one's.
// web Ember remembers the name at sign-in (localStorage['bonfire_user']); the apps read it from the cached /account/me
export function acct() {
  try {
    const web = onWebClientPath() && !window.bonfireDesktop && !window.bonfireMobile && !/\bBonfireAndroid\//.test(navigator.userAgent);
    const u = web ? localStorage.getItem('bonfire_user') : JSON.parse(localStorage.getItem('velora_me_cache_v2') || 'null')?.d?.account?.username;
    return u ? String(u).toLowerCase() : '';
  } catch { return ''; }
}
export const acctKey = base => { const a = acct(); return a ? `${base}:${a}` : base; };
const SESSIONS = 'bonfire_instance_sessions';
// (keys go through normOrigin: a session saved under e_<slug>.nookara.cc is the e-<slug> server's)
const byOrigin = v => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, s]) => [normOrigin(k) || k, s])) : {});
export function loadSessions() { try { return byOrigin(JSON.parse(localStorage.getItem(acctKey(SESSIONS)) || '{}')); } catch { return {}; } }
export function saveSession(origin, session, tag) {
  try { const all = loadSessions(); if (session) all[origin] = session; else delete all[origin]; localStorage.setItem(acctKey(SESSIONS), JSON.stringify(all)); } catch { /* private mode */ }
  try { const t = loadSessionTags(); if (session && tag) t[origin] = tag; else delete t[origin]; localStorage.setItem(acctKey(SESSION_TAGS), JSON.stringify(t)); } catch { /* private mode */ }
}
// which Ember sign-in a Velora-login session came from: signing in again (e.g. now with "Sign messages" approved) must
// trade a fresh instance token, or the instance keeps the old session's permissions
const SESSION_TAGS = 'bonfire_instance_session_tags';
export function loadSessionTags() { try { return byOrigin(JSON.parse(localStorage.getItem(acctKey(SESSION_TAGS)) || '{}')); } catch { return {}; } }
export function tokenTag(token) { let h = 0; for (let i = 0; i < (token || '').length; i++) h = (h * 31 + token.charCodeAt(i)) | 0; return token ? (h >>> 0).toString(36) : ''; }


// ── urls an instance sends: relative ones belong to that instance, only http(s) is ever a link ──
const URL_KEYS = new Set(['icon', 'banner', 'pfp', 'url', 'icon_url', 'banner_url', 'avatar', 'author_avatar', 'preview', 'thumbnail', 'image', 'src', 'download', 'public_url']);
function fixUrl(origin, v) {
  if (typeof v !== 'string' || !v) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return origin + v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:/i.test(v)) return null; // javascript: / data: ...
  return v;
}
export function fixUrls(origin, v, key) {
  if (Array.isArray(v)) return v.map(x => fixUrls(origin, x, key));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = fixUrls(origin, x, k); return o; }
  return key && URL_KEYS.has(key) ? fixUrl(origin, v) : v;
}

// ── instance payloads -> Ember's shapes (ids namespaced) ──
export const nsServer = (inst, s) => ({ ...s, sid: K(inst, s.sid), inst, ...(Array.isArray(s.unread_channels) ? { unread_channels: s.unread_channels.map(c => K(inst, c)) } : {}) });
export const nsChannel = (inst, c) => ({ ...c, cid: K(inst, c.cid), server: c.server != null ? K(inst, c.server) : c.server, inst });
export const nsMessage = (inst, m) => ({ ...m, inst, channel: K(inst, m.channel), server: m.server != null ? K(inst, m.server) : m.server, author: m.author ? { ...m.author, inst } : m.author });
const mapKeys = (o, f) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [f(k), v]));
export function nsTop(inst, d, path = '') {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
  const o = { ...d };
  if (Array.isArray(o.servers)) o.servers = o.servers.map(s => nsServer(inst, s));
  if (o.server != null) o.server = typeof o.server === 'string' ? K(inst, o.server) : nsServer(inst, o.server);
  if (Array.isArray(o.channels)) o.channels = o.channels.map(c => nsChannel(inst, c));
  if (o.channel != null) o.channel = typeof o.channel === 'string' ? K(inst, o.channel) : nsChannel(inst, o.channel);
  if (Array.isArray(o.messages)) o.messages = o.messages.map(m => nsMessage(inst, m));
  if (o.message && typeof o.message === 'object') o.message = nsMessage(inst, o.message);
  if (typeof o.sid === 'string') o.sid = K(inst, o.sid);
  if (o.voice && typeof o.voice === 'object' && !Array.isArray(o.voice) && !path.startsWith('/instance')) o.voice = mapKeys(o.voice, k => K(inst, k));
  if (typeof o.room === 'string' && /^bf_/.test(o.room)) o.room = `bf_${K(inst, o.room.slice(3))}`;
  if (/^\/notify$/.test(path) && o.notify) o.notify = mapKeys(o.notify, k => K(inst, k));
  if (/^\/settings$/.test(path) && o.settings && Array.isArray(o.settings.server_order)) o.settings = { ...o.settings, server_order: o.settings.server_order.map(x => K(inst, x)) };
  return o;
}
// one instance event / response, ready for Ember's own handlers
export const fromInstance = (inst, data, path = '') => (/^\/(instance|auth|me)\b/.test(path) ? fixUrls(inst, data) : nsTop(inst, fixUrls(inst, data), path));

// where a request goes: the instance named by the ids in the path (or opts.inst), the path without the namespacing
const COMPOSITE = /(https?:\/\/[^\s|/?#]+)\|([^/?#&"]*)/g;
export function routePath(path, optInst) {
  const found = new Set();
  const clean = String(path).replace(COMPOSITE, (_, inst, id) => { found.add(inst); return encodeURIComponent(id); });
  if (found.size > 1) throw Object.assign(new Error('mixed_instances'), { status: 400 });
  const inst = [...found][0] || optInst || VELORA;
  if (optInst && found.size && inst !== optInst) throw Object.assign(new Error('mixed_instances'), { status: 400 });
  return { inst, path: clean };
}
const BODY_KEYS = new Set(['sid', 'cid', 'channel', 'server']);
export function unNsBody(inst, body) {
  if (typeof body !== 'string' || inst === VELORA) return body;
  let v; try { v = JSON.parse(body); } catch { return body; }
  const pre = `${inst}|`;
  const walk = (x, k) => (Array.isArray(x) ? x.map(y => walk(y, k)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([a, b]) => [a, walk(b, a)])) : typeof x === 'string' && BODY_KEYS.has(k) && x.startsWith(pre) ? x.slice(pre.length) : x);
  return JSON.stringify(walk(v));
}
// a path like /chat/servers/x -> /api/v1/servers/x on an instance (a /chat path is the compatibility layer; nothing else leaves)
export function instPath(path) {
  if (/^\/api\/v1\//.test(path)) return path;
  if (/^\/chat\//.test(path)) return `/api/v1/${path.slice(6)}`;
  throw Object.assign(new Error('not_on_instances'), { status: 400 });
}
