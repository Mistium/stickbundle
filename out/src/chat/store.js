// Ember's state + its connection (one Velora socket when signed in with Velora, the /chat, /im and /groups APIs, and one socket per server instance).
// Components read it with useChat(selector) and change it through the actions below.
import { shareLink, clientUrl, notifLinkUrl } from './hosts.js';
import { packActive, playPackSound } from './messageSounds.js';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import serverCreationPolicy from '../server-creation-policy.json';
import { apiFetch, getToken, onScopeError, onAuthLost, isWebBonfire, uploadFetch } from '../api.js';
import { endSession, startSignIn } from './session.js';
import * as E2EE from './e2ee/session.js';
import { fileKindOfMime } from './e2ee/files.js';
import { rememberedDest, TEMP_LINK, tempId } from './upload-dest.js';
import { callLinePlain } from './callText.js';
import { inviteSummary } from './gameInvite.js';
import { isVoiceAtt, voiceSummary } from './voice-note.js';
import { applyIdentity } from './identity.js';
import { applyUserUpdate, instancesWithAccount } from './userUpdate.js';
import { findPending, dropSettled, wireText, settle } from './pending.js';
import { VELORA, K, parseK, instOf, bare, isInst, normOrigin, acctKey } from './ids.js';
import { connections, sendTo, startInstances, loadInstanceData, retryInstances, renewVeloraSession, holdInstances } from './instances.js';
import { attachmentRefs } from './signing-payload.js';
import { spoilerName } from './spoiler.js';
import { prepareInstanceAttachments } from './attachment-preparation.js';
import { setupSigning, signMessage, canSign, watchSignature, normBody, refreshSigningKey } from './signing.js';
import { SHORT } from '../version.js';
import { shownName, shownPfp } from './aliases.js';

let state = {
  me: null,                // { username, pfp, color, rank } - null while signed out of Velora (web Ember works without it)
  e2eeStatus: __ORIGINCHATS__ ? 'ready' : 'loading',   // end-to-end encrypted DMs on this device: loading | none (no keys yet) | locked | ready (OriginChats DMs are plaintext)
  e2eeGate: null,          // the set up / unlock popup is open
  e2eeKeyChanged: {},      // username (lower) -> their key changed since I last saw it
  signedIn: false,         // signed in with Velora: DMs, groups, friends, modmail, legacy servers, Velora-login instances
  conn: 'connecting',      // connecting | open | closed
  connected: false,        // the home socket has been open at least once since the page loaded
  connRetryAt: 0,          // closed: when the next try is (it never gives up)
  servers: [],             // my servers
  detail: {},              // sid -> { server, channels }
  members: {},             // sid -> [member]
  membersMore: {},         // sid -> next offset, for a big Velora-hosted server whose member list comes in pages (absent: all loaded)
  presence: {},            // username -> { status, custom, activities }
  people: {},              // username -> { username, pfp, color, rank }
  msgs: {},                // key -> { list, hasMore, loading, loaded }
  typing: {},              // key -> { username: until }
  statusReplyDraft: null,  // { username, text }: the next DM to that person answers their custom status
  dms: [],                 // IM conversations
  groups: [],              // group chats
  friends: [],
  blocks: null, // people I blocked ({username, ...}); null until loaded
  unread: {},              // key -> true
  modmail: { messages: [], unread: 0 }, // Velora Moderator Chat (to me)
  staff: false,            // Velora owner / admin: can write as Velora Administrator
  view: { kind: 'home' },  // home | channel {sid, cid} | dm {username} | group {room} | instance {inst, then?} (a server that isn't connected yet)
  menu: null,              // the open right-click menu
  commands: {},            // sid -> { bots, commands, cid }: bot slash commands I can run
  interactionModal: null,  // a form a bot asked me to fill: { server, channel, interaction, modal }
  savedMedia: null,
  emojis: null,            // custom emojis from my servers: [{ sid, name, icon, emojis: [...] }]        // Saved Media (starred GIFs + files on the account), loaded on first use
  mentions: {},            // cid -> mentions that came in live (on top of the server's count)
  unreadN: {},             // cid -> { sid, n }: messages that came in live while you weren't looking (on top of the server's unread_count)
  srvMentions: {},         // sid -> the same, per server
  notify: {},              // target (cid / sid) -> { level, muted_until, push }
  toastOk: false,
  settings: { show_typing: true, share_typing: true, share_activity: true, sounds: true, notify_sound: 'short', notifications: 'mentions', dm_privacy: 'everyone', compact: false, animations: true, link_images: true, link_previews: true, developer_mode: false, allow_vc_calls: true, yt_mode: 'ask', dm_upload_dest: 'ask', radio_enabled: false, radio_url: 'https://www.clubfmserver.be/pink.mp3', strip_tracking: null },
  lastCid: {},             // sid -> cid
  error: null,
  voice: null,             // the voice channel / call I'm in: { room, info, status, users, muted, deafened, speaking, ringing }
  voiceStates: {},         // cid -> [{ username, muted, deafened }] - who's in each voice channel
  dmCalls: {},             // username (lower) -> { room, users, with } - calls going on with people
  dmCallWith: {},          // call room -> the other person
  incoming: [],            // calls ringing me: [{ callId, from, room }]
  pinsVersion: {},         // cid, d:<name> or g:<room> -> bumped when its pins change
  voicePrefs: null,
  permUpdate: null,        // "New permission updates" dialog: { version, legacy, missing: [{id, name, reason}] }
  scopePrompt: null,       // "This needs a new permission" card: { name, reason }
  scopeLack: null,         // scopes this login can't use: { ACCOUNT_WRITE: 'missing' | 'disabled' } (null = website session / not loaded = everything works)
  reauth: null,            // after "Log in again": { state: waiting | working | failed, error }
  locked: false,           // Ember and DMs are off for this account: the whole app is the notice (Gate.jsx LockedScreen)
  lockReason: null,        // why (Nookara's restriction_reason): 'staff' | 'birthday_required' (no birthday set yet) | 'under_minimum_age'
  instances: [],           // the instances I'm on: [{ origin, name, icon, mode, status, claimed, isAdmin, isOwner, user }]
  signing: null,           // this device's signing key: { state: ready | no_scope | unsupported | revoked | error, kid }
  sigs: {},                // signed message -> 'ok' | 'bad' (checked here, never taken from the instance)
  joinRequests: {},        // sid -> people waiting to be let in (live count)
  reports: {},             // sid -> open reports (live count, moderators of an instance)
  veloraNames: {},         // Velora id -> current username (instance members are v:<id>; their presence comes from the home socket by name)
  veloraFaces: {},         // Velora id -> their live public face on Velora { id, username, pfp, color, rank } (v: people on instances)
  emojiUrls: {},           // eid -> picture of an instance's custom emoji
  notifUnread: 0,          // Velora notifications not read yet (the bell's badge)
  notifs: null,            // the bell's popup while it's open: { list (unread only, newest first), cursor, loading, error }
};
const subs = new Set();
let desktopFocused = true;
const desktopActions = new Map();
function onceDesktopAction(action) {
  const key = `${action?.type || ''}:${action?.callId || action?.tag || action?.to || ''}:${action?.action || ''}:${action?.text || ''}`;
  const now = Date.now();
  for (const [k, t] of desktopActions) if (now - t > 5000) desktopActions.delete(k);
  if (desktopActions.has(key)) return false;
  desktopActions.set(key, now);
  return true;
}
const pageFocused = () => document.visibilityState === 'visible' && (window.bonfireDesktop?.isDesktop ? desktopFocused : document.hasFocus());
function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  subs.forEach(f => f());
}
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const getState = () => state;
// a custom emoji's picture: an instance's own (from its emoji list), else Velora's
export const customEmoji = (eid, animated) => state.emojiUrls[eid] || `/uploads/emojis/${eid}.${animated ? 'gif' : 'png'}`;
export const patchState = p => set(p);
// Ember desktop: games' Discord rich presence (captured by the app) becomes your status, tied to this socket
let rpcNow = null;
if (typeof window !== 'undefined' && window.bonfireDesktop?.onRpcActivity) {
  const apply = a => {
    rpcNow = a || null;
    if (rpcNow) send({ type: 'set_rich_presence', activity: { ...rpcNow, app: rpcNow.app || 'Discord RPC' } });
    else send({ type: 'clear_rich_presence' });
  };
  window.bonfireDesktop.onRpcActivity(apply);
  window.bonfireDesktop.onRpcStatus(s => set({ rpcStatus: s }));
  window.bonfireDesktop.rpcState?.().then(s => { set({ rpcStatus: s }); if (s.activity) apply(s.activity); }).catch(() => {});
}
export function useChat(sel = s => s) {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ── keys for a conversation ──
export const keyOf = v => (v.kind === 'channel' ? `c:${v.cid}` : v.kind === 'dm' ? `d:${String(v.username).toLowerCase()}` : v.kind === 'group' ? `g:${v.room}` : v.kind === 'modmail' ? `mm:${String(v.username || '').toLowerCase()}` : '');
const upd = (obj, k, fn) => ({ ...obj, [k]: fn(obj[k]) });

// timeouts on an instance (Server settings > AutoMod, or a moderator): no posting, reacting, voice or sounds until then
export const untilText = t => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export function timedOutIn(sid, st = state) { const t = sid && st.detail[sid]?.server?.timeout_until; return t && t > Date.now() ? t : null; }
export function useTimedOut(sid) {
  const until = useChat(s => (sid ? s.detail[sid]?.server?.timeout_until : null) || null);
  const [, tick] = useState(0);
  useEffect(() => { if (!until || until <= Date.now()) return undefined; const t = setTimeout(() => tick(x => x + 1), Math.min(until - Date.now() + 100, 2147483647)); return () => clearTimeout(t); }, [until]);
  return until && until > Date.now() ? until : null;
}

// ── people / presence ──
export function remember(list) {
  const add = {};
  for (const p of list) if (p?.username) add[p.username] = { ...(state.people[p.username] || {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  if (Object.keys(add).length) set(s => ({ people: { ...s.people, ...add } }));
}
const lookups = new Map();
// public profiles are cached for 5 minutes: an edit still shows at once (Velora sends user_update, which clears this)
const LOOKUP_MS = 5 * 60 * 1000, LOOKUP_BATCH = 100;
// a public Velora endpoint (no token): what signed-out Ember may still ask Velora for (public profiles)
const publicJson = path => fetch(path).then(r => r.json().then(d => (r.ok ? d : Promise.reject(Object.assign(new Error(d.error || 'request_failed'), { status: r.status })))));
const faceOfProfile = d => ({ id: d.id != null ? String(d.id) : undefined, username: d.username, pfp: d.pfp_url || null, color: d.color || null, rank: d.rank });
export function lookup(username) { // the public profile (cached for 5 minutes)
  const k = String(username).toLowerCase();
  const hit = lookups.get(k);
  if (hit && Date.now() - hit.at < LOOKUP_MS) return hit.p;
  const path = `/account/lookup/${encodeURIComponent(username)}`;
  const p = (getToken() ? apiFetch(path) : publicJson(path)).then(d => {
    remember([faceOfProfile(d)]);
    return d;
  });
  p.catch(() => lookups.delete(k));
  lookups.set(k, { at: Date.now(), p });
  return p;
}
// many public profiles in as few requests as possible (GET /account/lookup?u=a,b,c - up to 100 per request), into the
// same cache as lookup(). -> Map(lower-case username -> profile); names that don't exist (or are hidden) are left out.
export async function lookupMany(usernames) {
  const out = new Map(), ask = [];
  for (const n of new Set((usernames || []).map(x => String(x || '').trim()).filter(Boolean))) {
    const k = n.toLowerCase(), hit = lookups.get(k);
    if (hit && Date.now() - hit.at < LOOKUP_MS) out.set(k, hit.p); else ask.push(n);
  }
  for (let i = 0; i < ask.length; i += LOOKUP_BATCH) {
    const chunk = ask.slice(i, i + LOOKUP_BATCH);
    const path = `/account/lookup?u=${chunk.map(encodeURIComponent).join(',')}`;
    const batch = (getToken() ? apiFetch(path) : publicJson(path)).then(d => {
      const users = d?.users || [];
      remember(users.map(faceOfProfile));
      return new Map(users.map(u => [String(u.username).toLowerCase(), u]));
    });
    for (const n of chunk) {
      const k = n.toLowerCase();
      const p = batch.then(m => m.get(k) || Promise.reject(Object.assign(new Error('not_found'), { status: 404 })));
      p.catch(() => lookups.delete(k));
      lookups.set(k, { at: Date.now(), p });
      out.set(k, p);
    }
  }
  const done = new Map();
  await Promise.all([...out].map(([k, p]) => p.then(d => { done.set(k, d); }, () => {})));
  return done;
}
// Velora people on an instance server (v:<id>) show their live Velora face - picture, accent colour, rank - like on Velora's own
// servers. By id when signed in (/chat/identities), else by the name the instance knows, through the public profile (kept
// only if Velora says it's the same id). The instance's stored picture is only the fallback. Local accounts never get one.
const faceAsked = new Map(); // id -> when
let faceQueue = new Map(), faceTimer = null;
export function wantVeloraFaces(people) {
  for (const u of people || []) {
    const id = String(u?.velora_id || '');
    if (u?.kind !== 'velora' || !/^[1-9]\d{0,19}$/.test(id) || Date.now() - (faceAsked.get(id) || 0) < 300000) continue;
    faceAsked.set(id, Date.now()); faceQueue.set(id, u.username);
  }
  if (faceQueue.size && !faceTimer) faceTimer = setTimeout(flushFaces, 60);
}
async function flushFaces() {
  const q = faceQueue; faceQueue = new Map(); faceTimer = null;
  const got = {};
  const ids = [...q.keys()];
  if (getToken()) {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await apiFetch(`/chat/identities?ids=${ids.slice(i, i + 200).join(',')}`).catch(() => null);
      for (const u of r?.users || []) if (u.username) got[u.id] = u;
    }
  } else {
    const found = await lookupMany(ids.slice(0, 100).map(id => q.get(id))).catch(() => new Map());
    for (const id of ids.slice(0, 100)) { const d = found.get(String(q.get(id) || '').toLowerCase()); if (d && String(d.id) === id) got[id] = { id, username: d.username, pfp: d.pfp_url || null, color: d.color || null, rank: d.rank }; }
  }
  for (const id of ids) if (!got[id]) got[id] = { id, miss: true }; // nobody to show: stop holding their name colour back
  if (Object.keys(got).length) set(s => ({ veloraFaces: { ...s.veloraFaces, ...got }, veloraNames: { ...s.veloraNames, ...Object.fromEntries(Object.entries(got).filter(([, u]) => !u.miss).map(([id, u]) => [id, u.username])) } }));
}
// someone as shown in an instance server: a Velora person with their Velora face, a local account / bot as plain (no picture
// of its own for local accounts for now). Velora's own servers already carry the live face.
export function faceOf(u, s = state) {
  if (!u || !u.inst || u.inst === VELORA) return u;
  if (u.kind === 'local') return { ...u, pfp: null, color: null };
  const f = u.kind === 'velora' ? s.veloraFaces[String(u.velora_id)] : null;
  return f && !f.miss ? { ...u, pfp: f.pfp || u.pfp || null, color: f.color || null, rank: f.rank } : u;
}
export const useFace = u => { const f = useChat(s => (u?.inst && u.kind === 'velora' ? s.veloraFaces[String(u.velora_id)] : null)); return useMemo(() => faceOf(u), [u, f]); }; // eslint-disable-line react-hooks/exhaustive-deps
// a profile card / page that is open re-reads its person when Velora says they changed (user_update); fn(event) -> unsubscribe
export const onUserUpdate = fn => { const h = e => fn(e.detail); addEventListener('vc-user-update', h); return () => removeEventListener('vc-user-update', h); };
// drop the cached public profile (after you edit your own), so the next lookup is fresh
export function forgetProfile(username) { lookups.delete(String(username || '').toLowerCase()); }
export function wantPresence(username) {
  if (username) watched.add(username);
  if (!username || state.presence[username]) return;
  send({ type: 'chat_presence', username });
}
// Velora only sends presence to the people who can see it (friends, DMs, groups, small shared servers) and to the
// sockets that asked about someone: ask for a whole list at once (one chat_presence_watch per 200, answered by one
// presence_bulk), and again after every reconnect so the lists we show stay live.
const watched = new Set();
export function watchPresence(usernames) {
  const fresh = [...new Set((usernames || []).filter(Boolean))].filter(n => !watched.has(n));
  fresh.forEach(n => watched.add(n));
  for (let i = 0; i < fresh.length; i += 200) send({ type: 'chat_presence_watch', usernames: fresh.slice(i, i + 200) });
}
function rewatchPresence() {
  const me = state.me?.username;
  const names = [...new Set([...watched, ...Object.keys(state.presence)])].filter(n => n && n !== me).slice(-1000);
  for (let i = 0; i < names.length; i += 200) send({ type: 'chat_presence_watch', usernames: names.slice(i, i + 200) });
}
// Spotify's `progress` is sampled by the server, but the clock that advances
// it must begin on this device when the presence payload arrives. Using the
// server wall clock here makes even a small clock skew look like 5-second jumps.
function localizePresence(presence) {
  if (!presence?.activities?.length) return presence;
  const receivedAt = Date.now();
  return { ...presence, activities: presence.activities.map(a => (a?.app === 'Spotify' && Number.isFinite(Number(a.progress)) ? { ...a, progress_at: receivedAt } : a)) };
}

// ── the socket ──
let sock = null, retry = 0, nonce = 0;
const pendingAcks = new Map(); // nonce -> key
let lastBonfireActivity = 0;
// Keep other devices quiet for ten minutes after actual use of Ember.  This
// is intentionally not the socket's 25-second keepalive: a suspended or
// backgrounded tab must not pretend that the user is still here.
function noteBonfireActivity() {
  const now = Date.now();
  if (now - lastBonfireActivity < 30000) return;
  if (send({ type: 'chat_active' })) lastBonfireActivity = now;
}
// a frame about an instance's community / channel / voice room goes to that instance's socket, with the bare ids
function routeFrame(obj) {
  let inst = null, out = obj;
  for (const f of ['channel', 'server', 'sid', 'room']) {
    const v = obj[f];
    if (typeof v !== 'string') continue;
    const bf = f === 'room' && v.startsWith('bf_');
    const p = parseK(bf ? v.slice(3) : v);
    if (p.inst === VELORA) continue;
    if (inst && inst !== p.inst) return null;
    inst = p.inst;
    out = { ...out, [f]: bf ? `bf_${p.id}` : p.id };
  }
  return { inst: inst || VELORA, obj: out };
}
export function send(obj) {
  const r = routeFrame(obj);
  if (!r) return false;
  if (r.inst !== VELORA) return sendTo(r.inst, r.obj);
  if (sock && sock.readyState === 1) { sock.send(JSON.stringify(obj)); return true; }
  return false;
}
export function sendBinary(buf) {
  if (sock && sock.readyState === 1 && sock.bufferedAmount < 256 * 1024) sock.send(buf);
}
// voice.js listens here (voice JSON, calls, who's in which voice channel, and the audio frames)
let voiceHook = null;
export const onVoiceEvent = fn => { voiceHook = fn; };
const VOICE_EVENTS = new Set(['voice', 'voice_open', 'voice_closed', 'voice_call_incoming', 'voice_call_ringing', 'voice_call_answered', 'voice_call_accepted', 'voice_call_failed', 'voice_call_ended', 'chat_voice_state', 'chat_call_state', 'voice_sound', 'voice_sound_failed', 'chat_rtc_joined', 'chat_rtc_published', 'chat_rtc_offer', 'chat_rtc_ready', 'chat_rtc_room']);
// is this a phone (or tablet)? -> the socket says mobile: true and people see the phone mark next to you.
// 1. the desktop app is never mobile
// 2. Chromium's Client Hints say so (navigator.userAgentData.mobile) -> mobile
// 3. a phone user agent (iPhone / iPod / "Android ... Mobile" / "Mobi") -> mobile
// 4. an Android tablet / iPad (also iPadOS Safari's Mac-looking UA with touch) only counts with a touch-first
//    pointer, as the tiebreak. The window width alone never decides it (a narrow desktop window isn't a phone).
// The Android app (a WebView) is detected by the same rules.
export function isMobileDevice() {
  try {
    if (window.bonfireDesktop?.isDesktop) return false;
    if (navigator.userAgentData?.mobile === true) return true;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod|Android.*Mobile|Mobi|Windows Phone/i.test(ua)) return true;
    const tablet = /Android|iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return tablet && !!window.matchMedia?.('(pointer: coarse)').matches;
  } catch { return false; }
}
// never gives up: backoff to ~30 s (with jitter), and straight away when the network / tab comes back. A dropped
// connection never signs anyone out - only Velora rejecting the token does (auth_error invalid_token, a 401, `kicked`).
export const backoff = n => Math.min(30000, 1000 * 2 ** Math.min(n, 5)) * (0.8 + Math.random() * 0.4);
let sockTimer = null;
export function connect() {
  clearTimeout(sockTimer); sockTimer = null;
  if (sock && sock.readyState <= 1) return;
  if (!getToken()) return;
  set({ conn: 'connecting', connRetryAt: 0 });
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  sock = s;
  s.onopen = () => s.send(JSON.stringify({ type: 'auth_token', token: getToken(), mobile: isMobileDevice(), client: { version: SHORT } })); // (`client` is shown to people with Manage users)
  s.binaryType = 'arraybuffer';
  s.onmessage = e => {
    if (typeof e.data !== 'string') { voiceHook?.({ binary: e.data }); return; }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handleEvent(m);
  };
  s.onclose = () => {
    if (sock !== s) return;
    set({ conn: 'closed' });
    voiceHook?.({ type: 'voice_closed' }); // the voice link went with the socket
    const wait = backoff(retry++);
    set({ connRetryAt: Date.now() + wait });
    clearTimeout(sockTimer); sockTimer = setTimeout(connect, wait);
  };
}
// "Retry now" / the network or the tab came back: try again right away (the home socket and every instance)
export function retryNow() {
  if (state.signedIn && state.conn === 'closed') { retry = 0; connect(); }
  retryInstances();
}
if (typeof window !== 'undefined') {
  addEventListener('online', retryNow);
  addEventListener('focus', retryNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryNow(); });
}
setInterval(() => send({ type: 'ping' }), 25000);

// one event from the home socket (inst = velora) or from an instance's (already in Ember's shapes, ids namespaced)
// an instance may only say what PROTOCOL.md §7 lets it: nothing that is Velora's own (DMs, kicks, presence, calls...)
const INSTANCE_EVENTS = new Set(['chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_typing', 'chat_pins_update', 'chat_server_update', 'chat_server_removed', 'chat_roles_update', 'chat_perms_changed', 'chat_channels_update', 'chat_member_update', 'chat_presence', 'chat_members_stale', 'chat_emojis_update', 'chat_identity_update', 'chat_ack', 'chat_error', 'chat_ephemeral', 'chat_join_request', 'chat_join_result', 'chat_report', 'chat_timeout', 'chat_server_added', 'chat_starboard', 'chat_shop_update', 'chat_commands_update', 'chat_interaction_message', 'chat_interaction_modal', 'game_status', 'game_console', 'game_linked', 'game_unlinked', 'voice_sound', 'voice_sound_failed']);
const INSTANCE_VOICE = /^(chat_rtc_|chat_voice_state$)/;
const LOCKED_EVENTS = new Set(['auth_success', 'auth_error', 'restrictions', 'error', 'kicked', 'bonfire_update', 'web_build']); // (what still matters while locked)
export function handleEvent(m, inst = VELORA) {
  if (inst !== VELORA && !INSTANCE_EVENTS.has(m?.type) && !INSTANCE_VOICE.test(String(m?.type))) return;
  if (inst !== VELORA && m.type === 'chat_error' && String(m.request || '').startsWith('chat_rtc')) { voiceHook?.({ ...m, inst }); return; }
  if (inst === VELORA && (m.type === 'chat_error' || m.type === 'error') && (m.error === 'insufficient_scope' || m.error === 'scope_disabled')) scopeDenied(m); // before anything else, voice errors included
  if (state.locked && (inst !== VELORA || !LOCKED_EVENTS.has(m?.type))) return; // Ember is switched off: only what can switch it back on (or sign out) gets in
  if (VOICE_EVENTS.has(m.type) || (m.type === 'chat_error' && String(m.request || '').startsWith('chat_rtc'))) { voiceHook?.({ ...m, inst }); return; }
  onEvent(m, inst);
}
// an instance's socket closed: a voice channel on it is over
export function instanceVoiceClosed(origin) { voiceHook?.({ type: 'voice_closed', inst: origin }); }
// me, as that instance knows me
const meOn = inst => (inst === VELORA || !inst ? state.me : connections.get(inst)?.user) || state.me;
export const isMineMsg = msg => isMine(msg);
const isMine = msg => {
  const inst = msg.inst || instOf(msg.channel || '');
  if (inst === VELORA) return msg.author?.username === state.me?.username;
  const u = connections.get(inst)?.user;
  return !!u && !!msg.author && msg.author.id === u.id;
};

function onEvent(m, inst = VELORA) {
  switch (m.type) {
    case 'auth_success': {
      retry = 0;
      const was = state.locked;
      if (m.disabled_scopes !== undefined) applyDisabled(m.disabled_scopes, m.restriction_reason);
      if (state.locked) break; // (nothing to say hello for: the socket only waits to hear it's switched back on)
      if (!was) send({ type: 'chat_hello' }); // (just unlocked: unlockAccount said it)
      lastBonfireActivity = 0; // (a new socket: the server hasn't heard about this one yet)
      if (pageFocused()) noteBonfireActivity(); // a window nobody is looking at reconnecting isn't someone using Ember
      if (rpcNow) send({ type: 'set_rich_presence', activity: { ...rpcNow, app: rpcNow.app || 'Discord RPC' } }); // a game status from the desktop app, again after a reconnect
      break;
    }
    case 'restrictions': // staff changed which services this account may use, or the birthday was set (live, Nookara ws.js applyRestrictions)
      if (m.disabled_scopes !== undefined) applyDisabled(m.disabled_scopes, m.restriction_reason);
      checkPermissions(); // (the greyed-out controls follow too)
      break;
    case 'error': break; // (scope errors were handled above)
    case 'auth_error':
      if (m.error === 'invalid_token' || m.error === 'banned') { if (isWebBonfire()) authLost(); else location.href = '/login?next=/chat'; }
      break;
    // ── OriginChats bridge ──
    // The in-page bridge speaks Ember's events, with a few of its own for
    // things Ember's server would have told the socket directly.
    case 'oc_servers':
      set({ servers: m.servers.map(x => ({ ...x, inst: VELORA })) });
      break;
    case 'oc_dm_lists':
      loadDMs();
      loadGroups();
      break;
    case 'oc_read': {
      set(s => {
        const unread = { ...s.unread, [m.key]: false };
        const mentions = m.cid ? { ...s.mentions, [m.cid]: 0 } : s.mentions;
        const dd = m.sid && s.detail[m.sid];
        return {
          unread,
          mentions,
          detail: dd ? { ...s.detail, [m.sid]: { ...dd, channels: dd.channels.map(c => (c.cid === m.cid ? { ...c, unread: false, mentions: 0 } : c)) } } : s.detail,
          dms: m.dm ? s.dms.map(d => (d.username.toLowerCase() === m.dm ? { ...d, unread: 0 } : d)) : s.dms,
        };
      });
      break;
    }
    case 'oc_msg_patch':
    case 'oc_msg_remove':
      set(s => ({
        msgs: upd(s.msgs, m.key, b => b && {
          ...b,
          list: m.type === 'oc_msg_remove'
            ? b.list.filter(x => String(x.imId || x.gid || x.id) !== String(m.id))
            : b.list.map(x => (String(x.imId || x.gid || x.id) === String(m.id) ? { ...x, ...m.patch } : x)),
        }),
      }));
      break;
    case 'chat_ready':
      if (__ORIGINCHATS__) set({ e2eeStatus: 'ready' });
      else if (inst === VELORA && state.e2eeStatus === 'loading' && state.signedIn) E2EE.init().catch(() => {});
      else if (inst === VELORA) E2EE.flushOutbox();
      set(s => ({ conn: 'open', connected: true, presence: { ...s.presence, [m.you.username]: localizePresence(m.you.presence) } }));
      rewatchPresence(); // (a new socket: the server forgot what this one was watching)
      catchUp();
      loadNotifCount(); // (anything that happened while the socket was down)
      break;
    case 'chat_message': addMessage(`c:${m.message.channel}`, m.message); break;
    // Velora: somebody I can see changed their profile (picture, colour, name, bio ...): patch every cache that holds them, refresh any open
    // profile card, and ask the instances they are on to re-read it too (instances otherwise pick it up on their own 10-15 min schedule)
    case 'user_update':
      if (inst !== VELORA || !m.user?.id) break;
      lookups.clear();
      set(s => applyUserUpdate(s, m));
      dispatchEvent(new CustomEvent('vc-user-update', { detail: m }));
      if (m.previous_username && m.previous_username !== m.user.username) { loadDMs(); loadGroups(); loadFriends(); } // (name-keyed lists + conversations)
      for (const o of instancesWithAccount(state, m.user.id)) sendTo(o, { type: 'chat_profile_refresh', velora_id: String(m.user.id) });
      break;
    case 'chat_identity_update':
      if (inst !== VELORA) { if (m.user?.id) { set(s => applyIdentity(s, m.user, inst)); loadMembersOf(inst); } break; }
      lookups.clear();
      set(s => applyIdentity(s, m.user));
      break;
    // only for you (e.g. "You claimed your daily chat credits") - shows in that channel, never saved
    case 'chat_ephemeral': {
      const key = `c:${m.channel}`;
      const b = state.msgs[key];
      if (b?.loaded) set(s => ({ msgs: { ...s.msgs, [key]: { ...b, list: [...b.list, { id: `eph${Date.now()}`, ephemeral: true, system: true, sys_kind: m.kind, body: m.body, amount: m.amount, created_at: Date.now() }] } } }));
      break;
    }
    case 'chat_commands_update': loadCommands(m.server); break;
    case 'chat_interaction_modal': set({ interactionModal: m }); break;
    case 'chat_interaction_message': {
      const msg = m.message;
      set(s => ({ msgs: upd(s.msgs, `c:${msg.channel}`, b => {
        if (!b?.loaded) return b;
        if (m.op === 'delete') return { ...b, list: b.list.filter(x => x.id !== msg.id) };
        if (b.list.some(x => x.id === msg.id)) return { ...b, list: b.list.map(x => (x.id === msg.id ? msg : x)) };
        return { ...b, list: ordered([...b.list, msg]) };
      }) }));
      break;
    }
    case 'chat_message_update':
      set(s => ({ msgs: upd(s.msgs, `c:${m.message.channel}`, b => b && { ...b, list: b.list.map(x => (x.id === m.message.id ? { ...m.message, reactions: m.message.reactions || x.reactions } : x)) }) }));
      watchSignature(m.message);
      break;
    case 'modmail': { // a moderator message to me
      const viewing = keyOf(state.view) === 'mm:' && document.visibilityState === 'visible';
      set(s => ({ modmail: { messages: [...s.modmail.messages, m.message], unread: viewing ? 0 : s.modmail.unread + 1 } }));
      addMessage('mm:', mmToMsg(m.message));
      if (viewing) apiFetch('/chat/modmail/read', { method: 'POST' }).catch(() => {});
      else ping('mm:', { author: { username: 'Nookara Administrator', pfp: '/assets/icon.png' }, body: m.message.body }, true);
      break;
    }
    case 'modmail_staff': { // staff: a moderator message went out (from anyone on staff)
      const key = `mm:${String(m.username).toLowerCase()}`;
      // my own message's copy is already there (or coming back from the POST) - only add other staff members' ones
      if (state.msgs[key]?.loaded && !state.msgs[key].list.some(x => x.mmId === m.message.id) && !state.msgs[key].list.some(x => x.pending && x.body === m.message.body)) addMessage(key, mmToMsg(m.message));
      break;
    }
    case 'im_edited': // a DM was edited (m.with = the other person)
      E2EE.openMessage({ id: m.id, from_id: m.from_id, to_id: m.to_id, from: m.with, body: m.body, enc: m.enc, edited_at: m.edited_at }).then(o => {
        set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, body: o.body, sealed: o.sealed, attachments: sealedAtts(o), edited_at: m.edited_at } : x)) }) }));
        bumpPins(`d:${String(m.with).toLowerCase()}`);
      });
      break;
    case 'e2ee_keys_changed': // someone's keys or linked clients changed (or they just set up, so messages held for them can go)
      if (m.username) { E2EE.forgetBundle(m.username); E2EE.flushOutbox(m.username); }
      break;
    case 'e2ee_link_request':
      if (state.e2eeStatus === 'ready') toast(m.kind === 'device' ? 'A device is asking to read your DMs. To approve it, go to Settings, Privacy.' : `${m.label} is asking to read your DMs. To approve it, go to Settings, Privacy.`);
      break;
    case 'im_pins_update': // pinned or unpinned in a DM (m.with = the other person)
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, pinned: !!m.pinned } : x)) }) }));
      bumpPins(`d:${String(m.with).toLowerCase()}`);
      break;
    case 'im_reactions': // a reaction in a DM (m.with = the other person)
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.map(x => (x.imId === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    // Velora says something new is out: the desktop app checks + downloads now, the website offers a reload
    case 'bonfire_update':
      window.bonfireDesktop?.checkForUpdates?.();
      break;
    case 'web_build':
      dispatchEvent(new CustomEvent('vc-web-build', { detail: m.build }));
      break;
    case 'chat_reactions':
      set(s => ({ msgs: upd(s.msgs, `c:${m.channel}`, b => b && { ...b, list: b.list.map(x => (x.id === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    case 'chat_message_delete':
      set(s => ({ msgs: upd(s.msgs, `c:${m.channel}`, b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
      break;
    case 'chat_starboard': dispatchEvent(new CustomEvent('vc-starboard', { detail: m })); break; // a starboard got a post / a star count changed
    case 'chat_shop_update': dispatchEvent(new CustomEvent('vc-shop', { detail: m })); break; // an instance: my pay request for a shop role was paid / declined / expired
    // Ember Link (Minecraft): live card / console lines / links - components listen, nothing goes into state
    case 'game_status': case 'game_console': case 'game_linked': case 'game_unlinked': dispatchEvent(new CustomEvent('vc-game', { detail: m })); break;
    case 'chat_ack': {
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      signedSends.delete(m.nonce);
      if (key) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: settle(b.list, m.nonce, m.message) }) }));
      if (m.message?.signature) watchSignature(m.message);
      break;
    }
    case 'chat_error': {
      if (m.error === 'bad_signature') refreshSigningKey(); // (a rotated key: "try again" then signs with the new one)
      // the server turned the signature down: same choice as when signing fails here. The message stays pending while they decide
      const resend = SIGN_REFUSED.has(m.error) && signedSends.get(m.nonce);
      signedSends.delete(m.nonce);
      if (resend) {
        const nonce = m.nonce, box = pendingAcks.get(nonce);
        const failed = why => { pendingAcks.delete(nonce); set(s => ({ msgs: upd(s.msgs, box, b => b && { ...b, list: b.list.map(x => (x.nonce === nonce ? { ...x, failed: why } : x)) }) })); };
        askSendUnsigned().then(yes => {
          if (!yes) { failed(m.error); return; }
          set(s => ({ msgs: upd(s.msgs, box, b => b && { ...b, list: b.list.map(x => (x.nonce === nonce ? { ...x, unsigned: true } : x)) }) }));
          if (!resend()) failed('offline');
        });
        break;
      }
      // an instance session from before "Sign messages" (or uploads / voice) was approved: get a fresh one, then say what to do
      if (inst !== VELORA && m.error === 'insufficient_scope') {
        renewVeloraSession(inst).then(scopes => toast(scopes?.includes('sign') && scopes.includes('chat') ? 'Your login on this server was out of date - it is updated now, send it again.' : errorText('inst_scope')));
        const key = pendingAcks.get(m.nonce);
        if (key) { pendingAcks.delete(m.nonce); set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.error } : x)) }) })); }
        break;
      }

      const key = pendingAcks.get(m.nonce);
      if (key) {
        pendingAcks.delete(m.nonce);
        set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.error } : x)) }) }));
        if (['automod_blocked', 'timed_out', 'slow_down', 'message_too_long'].includes(m.error)) toast(errorText(m.error)); // (the server's rules: say why)
      } else if (!['chat_typing', 'chat_presence', 'chat_read'].includes(m.request)) toast(inst !== VELORA && m.error === 'insufficient_scope' ? errorText('inst_scope') : errorText(m.error));
      break;
    }
    case 'chat_typing': typingFrom(`c:${m.channel}`, m.username, m.typing, inst); break;
    case 'dm_typing': typingFrom(`d:${String(m.from).toLowerCase()}`, m.from, m.typing); break;
    case 'chat_channels_update':
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, categories: m.categories ?? d.categories, channels: m.channels.map(c => ({ ...(d.channels.find(x => x.cid === c.cid) || {}), ...c })) }) }));
      refreshServer(m.server);
      break;
    case 'chat_server_update': {
      // a broadcast copy has no "you" parts (role, permissions) - keep ours
      const keep = o => ({ role: o.role, perms: o.perms, invite: o.invite ?? m.server.invite, inst: o.inst });
      set(s => ({
        servers: s.servers.map(x => (x.sid === m.server.sid ? { ...x, ...m.server, ...keep(x) } : x)),
        detail: upd(s.detail, m.server.sid, d => d && { ...d, server: { ...d.server, ...m.server, ...keep(d.server) } }),
      }));
      break;
    }
    case 'chat_emojis_update':
      loadEmojis();
      break;
    // ── instances ──
    case 'chat_join_request': {
      const srv = state.servers.find(x => x.sid === m.sid);
      set(s => ({ joinRequests: { ...s.joinRequests, [m.sid]: (s.joinRequests[m.sid] || 0) + 1 } }));
      toast(`${m.request?.user?.username || 'Someone'} wants to join ${srv?.name || 'a server'}.`, true);
      break;
    }
    case 'chat_report': // a member reported something (moderators): Server settings > Reports listens for the list
      dispatchEvent(new CustomEvent('vc-report', { detail: m }));
      set(s => ({ reports: { ...s.reports, [m.server]: m.open } }));
      break;
    case 'chat_timeout': // AutoMod (or a moderator) timed me out, or lifted it (until: null)
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, server: { ...d.server, timeout_until: m.until || null } }) }));
      if (m.until > Date.now()) { toast(`You're timed out until ${untilText(m.until)}.`); dispatchEvent(new CustomEvent('vc-timed-out', { detail: { sid: m.server } })); }
      break;
    case 'chat_join_result': {
      const name = state.servers.find(x => x.sid === m.sid)?.name;
      if (m.accepted) toast(`You're in${name ? `: ${name}` : ''}!`, true); else toast('Your request to join was turned down.');
      loadInstanceData(inst);
      break;
    }
    case 'chat_server_added':
      set(s => ({ servers: s.servers.some(x => x.sid === m.server.sid) ? s.servers.map(x => (x.sid === m.server.sid ? { ...x, ...m.server } : x)) : [...s.servers, m.server] }));
      if (m.server?.name) toast(`You joined ${m.server.name}.`, true);
      break;
    case 'instance_update': case 'instance_restarting': break; // handled by the connection itself
    case 'chat_roles_update':
      set(s => ({ detail: upd(s.detail, m.server, d => d && { ...d, roles: m.roles }) }));
      break;
    case 'chat_perms_changed': // someone changed my roles there
      if (state.commands[m.server]) loadCommands(m.server);
      refreshServer(m.server); if (inst === VELORA) { loadServers(); loadMembers(m.server); } else loadInstanceData(inst); // (Manage users changes what the member list shows)
      break;
    case 'chat_members_stale':
      loadMembers(m.server);
      break;
    case 'chat_presence': // an instance bot went online / offline (only instances send this; Velora's own is a request). Matched by server (instance-namespaced) + principal id
      if (inst === VELORA || (m.presence !== 'online' && m.presence !== 'offline') || m.user_id == null) break;
      set(s => ({
        members: upd(s.members, m.server, list => (list ? list.map(x => (x.kind === 'bot' && String(x.id) === String(m.user_id) ? { ...x, presence: m.presence } : x)) : list)),
        commands: s.commands[m.server] ? { ...s.commands, [m.server]: { ...s.commands[m.server], bots: s.commands[m.server].bots.map(b => (String(b.id) === String(m.user_id) ? { ...b, online: m.presence === 'online' } : b)) } } : s.commands,
      }));
      break;
    case 'chat_server_removed':
      set(s => ({ servers: s.servers.filter(x => x.sid !== m.server), detail: Object.fromEntries(Object.entries(s.detail).filter(([k]) => k !== m.server)) }));
      if (state.view.sid === m.server) { go({ kind: 'home' }); toast(m.reason === 'deleted' ? 'That server was deleted.' : m.reason === 'left' ? 'You left the server.' : `You were ${m.reason === 'banned' ? 'banned' : 'removed'} from that server.`); }
      break;
    case 'chat_member_update':
      if (inst !== VELORA && state.commands[m.server] && String(m.user_id || '').startsWith('b:')) loadCommands(m.server);
      set(s => ({
        servers: s.servers.map(x => (x.sid === m.server ? { ...x, member_count: m.member_count } : x)),
        members: upd(s.members, m.server, list => {
          if (!list) return list;
          const rest = list.filter(x => m.member?.id != null ? String(x.id) !== String(m.member.id) : m.user_id != null ? String(x.id) !== String(m.user_id) : x.username !== m.username);
          const old = list.find(x => !rest.includes(x));
          const nu = inst === VELORA || !m.member ? m.member : { ...m.member, inst, joined_at: m.member.joined_at ?? old?.joined_at ?? (m.change === 'joined' ? Date.now() : undefined) };
          return m.change === 'joined' || m.change === 'role' ? [...rest, nu] : rest;
        }),
      }));
      if (m.member && inst === VELORA) remember([m.member]);
      else if (m.member) wantVeloraFaces([m.member]);
      break;
    case 'presence_update':
      set(s => ({ presence: { ...s.presence, [m.username]: localizePresence(m.presence) } }));
      break;
    case 'presence_bulk': // the answer to chat_presence_watch
      if (Array.isArray(m.presences) && m.presences.length) set(s => ({ presence: { ...s.presence, ...Object.fromEntries(m.presences.map(x => [x.username, localizePresence(x.presence)])) } }));
      break;
    case 'im_received':
    case 'im_sent': {
      E2EE.openMessage(m.message).then(opened => {
        const msg = imToMsg(opened);
        if (m.nonce || m.message.nonce) msg.nonce = m.nonce || m.message.nonce;
        const other = m.type === 'im_sent' || msg.author?.username === state.me?.username ? m.message.to : m.message.from;
        addMessage(`d:${String(other).toLowerCase()}`, msg);
        if (m.type === 'im_received') typingFrom(`d:${String(other).toLowerCase()}`, other, false);
        loadDMs();
      });
      break;
    }
    case 'im_ack': {
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      dmSends.delete(m.nonce);
      if (key) E2EE.openMessage(m.message).then(opened => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: settle(b.list, m.nonce, imToMsg(opened)) }) })));
      break;
    }
    case 'im_error': {
      // the keys I sealed to were out of date (a new client, or a new key): once more with fresh ones. No keys any more: back to waiting.
      const again = dmSends.get(m.nonce);
      if (again && (m.error === 'stale_keys' || m.error === 'recipient_no_keys') && !again.retried) { again.retried = true; E2EE.forgetBundle(again.to); E2EE.forgetBundle(state.me?.username); sendDm(again); break; }
      dmSends.delete(m.nonce);
      const key = pendingAcks.get(m.nonce);
      pendingAcks.delete(m.nonce);
      if (key) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === m.nonce ? { ...x, failed: m.request_sent ? 'dm_request_sent' : m.error } : x)) }) }));
      break;
    }
    case 'roomMessage':
      if (String(m.room || '').startsWith('grp_')) { addMessage(`g:${m.room}`, groupToMsg(m)); loadGroups(); }
      break;
    case 'room_message_deleted': // someone took back their own group message
      dropGroupMessage(m.room, m.id);
      bumpPins(`g:${m.room}`);
      loadGroups();
      break;
    case 'room_message_edited': // the author changed their group message
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, body: m.message, edited_at: m.edited_at } : x.reply?.id === `g${m.id}` ? { ...x, reply: { ...x.reply, body: String(m.message).slice(0, 200) } } : x)) }) }));
      bumpPins(`g:${m.room}`);
      loadGroups();
      break;
    case 'room_message_reactions': // a reaction in a group chat
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, reactions: m.reactions.length ? m.reactions : undefined } : x)) }) }));
      break;
    case 'room_pins_update': // pinned or unpinned in a group chat
      set(s => ({ msgs: upd(s.msgs, `g:${m.room}`, b => b && { ...b, list: b.list.map(x => (x.gid === m.id ? { ...x, pinned: !!m.pinned } : x)) }) }));
      bumpPins(`g:${m.room}`);
      break;
    case 'im_deleted': // the other side (or another device of mine) removed a DM
      set(s => ({ msgs: upd(s.msgs, `d:${String(m.with).toLowerCase()}`, b => b && { ...b, list: b.list.filter(x => x.imId !== m.id) }) }));
      bumpPins(`d:${String(m.with).toLowerCase()}`);
      loadDMs();
      break;
    case 'group_update': case 'group_removed': loadGroups(); break;
    case 'chat_pins_update': bumpPins(m.channel); break;
    case 'friend_request': case 'friend_request_accepted': loadFriends(); break;
    case 'blocks_changed': loadBlocks(); break; // I blocked / unblocked someone (here or on another device)
    case 'notification_new': notificationNew(m); break;
    case 'notifications_updated': notificationsUpdated(m); break; // read / deleted somewhere else (another tab, the site, a phone)
    case 'kicked': if (isWebBonfire()) authLost(); else location.href = '/login'; break;
    default: break;
  }
}

// ── messages ──
function addMessage(key, msg) {
  const b = state.msgs[key];
  const mine = isMine(msg);
  if (msg.signature) watchSignature(msg);
  if (b?.loaded) {
    if (msg.id && b.list.some(x => x.id === msg.id)) return;
    // my own message over the socket before the ack: replace the pending copy with the same text
    let list = b.list;
    // (a DM with files went out as text + links, so it is matched on that, or on the nonce when the server echoes it)
    const p = mine ? findPending(list, msg) : -1;
    if (mine && p >= 0) list = list.map((x, i) => (i === p ? msg : x)); else list = [...list, msg];
    set(s => ({ msgs: { ...s.msgs, [key]: { ...b, list: ordered(list) } } }));
  }
  if (msg.author) typingFrom(key, msg.author.username, false, msg.inst || VELORA);
  // The conversation only counts as "open" when Ember itself has focus.
  // A new message in the visible-but-inactive window should still notify.
  const open = keyOf(state.view) === key && pageFocused();
  const n = key.startsWith('c:') ? effectiveNotify(msg.channel, msg.server) : null;
  if (!mine && open && key.startsWith('d:')) markDmRead(state.view.username);
  if (!mine && !open && !n?.muted) {
    set(s => ({ unread: { ...s.unread, [key]: true } }));
    if (key.startsWith('c:')) {
      const sid = msg.server;
      set(s => ({ servers: s.servers.map(x => (x.sid === sid ? { ...x, unread: true } : x)), unreadN: { ...s.unreadN, [msg.channel]: { sid, n: (s.unreadN[msg.channel]?.n || 0) + 1 } } }));
    }
    if (!n || n.level !== 'none') ping(key, msg, n?.level === 'all', packActive());
    // a red count on the channel + server for mentions (replies to you count)
    if (key.startsWith('c:') && mentionsMe(msg)) {
      set(s => ({ mentions: { ...s.mentions, [msg.channel]: (s.mentions[msg.channel] || 0) + 1 }, srvMentions: { ...s.srvMentions, [msg.server]: (s.srvMentions[msg.server] || 0) + 1 } }));
    }
  }
  // message sounds (a pack replaces the normal notification sound): the conversation I'm looking at, or whatever would have pinged me
  if (packActive() && !mine && state.settings.sounds && !msg.system && !msg.ephemeral && !n?.muted && n?.level !== 'none' && state.presence[state.me?.username]?.status !== 'dnd') {
    const direct = !msg.channel || n?.level === 'all';
    // (the conversation I'm looking at counts even when the window is in the background)
    if (keyOf(state.view) === key || direct || mentionsMe(msg)) playPackSound(msg.author?.bot ? 'bot' : 'receive');
  }
  if (open && key.startsWith('c:') && msg.id) readChannel(msg.channel, msg.id);
}
// tell the server how far I've read; over HTTPS when the socket is down (a dropped chat_read left channels unread after a reload)
function readChannel(cid, id) {
  if (!cid || !id) return;
  if (!send({ type: 'chat_read', channel: cid, id })) apiFetch(`/chat/channels/${cid}/read`, { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {});
}
// a channel I've now seen: nothing left in it, and its server's dot / count only for what's left in its other channels
function channelSeen(sid, cid, lastId) {
  set(s => {
    const unread = { ...s.unread, [`c:${cid}`]: false };
    const unreadN = { ...s.unreadN };
    delete unreadN[cid];
    const d = s.detail[sid];
    const channels = d ? d.channels.map(c => (c.cid === cid ? { ...c, unread: false, unread_count: 0, last_read_id: lastId ? String(lastId) : c.last_read_id } : c)) : null;
    const servers = s.servers.map(x => {
      if (x.sid !== sid) return x;
      if (!channels) return { ...x, unread: Object.values(unreadN).some(u => u.sid === sid) };
      return { ...x, unread: channels.some(c => c.unread || unread[`c:${c.cid}`]), unread_count: channels.reduce((n, c) => n + (c.unread ? c.unread_count || 0 : 0), 0) };
    });
    return { unread, unreadN, servers, detail: d ? { ...s.detail, [sid]: { ...d, channels } } : s.detail };
  });
}
// the window came back into focus on a conversation: whatever came in while it was in the background is read now
function markViewRead() {
  noteBonfireActivity();
  const v = state.view;
  const key = keyOf(v);
  const wasUnread = !!state.unread[key];
  set(s => ({ unread: { ...s.unread, [key]: false } }));
  if (viewingDm()) markDmRead(viewingDm());
  if (v.kind !== 'channel') return;
  const ch = state.detail[v.sid]?.channels.find(c => c.cid === v.cid);
  if (!wasUnread && !state.unreadN[v.cid] && !ch?.unread && !ch?.mentions && !state.mentions[v.cid]) return;
  const last = state.msgs[key]?.list.filter(x => !x.pending && !x.ephemeral).pop();
  if (last) readChannel(v.cid, last.id);
  clearMentions(v.sid, [v.cid]);
  channelSeen(v.sid, v.cid, last?.id);
}
// everything waiting, for the tab title and icon: messages (muted servers / channels left out) and pings (mentions + DMs)
export function unreadTotals(s = state) {
  const now = Date.now();
  const muted = t => { const n = s.notify[t]; return !!(n?.muted_until && n.muted_until > now); };
  let count = 0, pings = 0;
  for (const x of s.servers) {
    if (muted(x.sid)) continue;
    pings += (x.mentions || 0) + (s.srvMentions[x.sid] || 0);
    const d = s.detail[x.sid];
    if (d) {
      for (const c of d.channels) {
        if (muted(c.cid)) continue;
        const live = s.unreadN[c.cid]?.n || 0;
        if (c.unread || s.unread[`c:${c.cid}`] || live) count += Math.max(1, (c.unread ? c.unread_count || 0 : 0) + live);
      }
    } else {
      const live = Object.values(s.unreadN).reduce((n, u) => n + (u.sid === x.sid ? u.n : 0), 0);
      if (x.unread || live) count += Math.max(1, (x.unread_count || 0) + live);
    }
  }
  for (const c of s.dms) if (c.unread) { count += c.unread; pings += c.unread; }
  for (const [k, v] of Object.entries(s.unread)) {
    if (!v) continue;
    if (k.startsWith('g:')) count += 1;
    else if (k.startsWith('d:') && !s.dms.some(c => `d:${c.username.toLowerCase()}` === k && c.unread)) { count += 1; pings += 1; }
  }
  if (s.modmail?.unread) { count += s.modmail.unread; pings += s.modmail.unread; }
  return { count, pings };
}
// is this message for me? @me, a reply to my message, @everyone / @here, or one of my roles
export function mentionsMe(msg) {
  const inst = msg.inst || instOf(msg.channel || '');
  const me = (inst === VELORA ? state.me : connections.get(inst)?.user)?.username;
  if (!me || isMine(msg)) return false;
  if (msg.reply?.author?.username === me) return true;
  if (msg.mention_everyone) return true;
  if (msg.mention_roles?.length && msg.server) {
    const mine = state.members[msg.server]?.find(x => x.username === me)?.roles || [];
    if (msg.mention_roles.some(r => mine.includes(r))) return true;
  }
  return new RegExp(`(^|\\W)@${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i').test(msg.body || '');
}
// the Hyperfocus sounds (public/assets/sounds/chat)
const SOUNDS = { message: '/assets/sounds/chat/message.mp3', mention: '/assets/sounds/chat/mention.m4a', join: '/assets/sounds/chat/joinVC.mp3', leave: '/assets/sounds/chat/leaveVC.mp3', call: '/assets/sounds/chat/call.mp3', ringtone: '/assets/sounds/chat/ringtone-deltarune.mp3?v=20261012', ringtone_epic: '/assets/sounds/chat/ringtone-epic.mp3?v=20261011', notify: '/assets/sounds/chat/notify.mp3?v=20261011', notify_short: '/assets/sounds/chat/message-new.mp3?v=20261103', voice_start: '/assets/sounds/chat/voice-start.mp3', voice_send: '/assets/sounds/chat/voice-send.mp3', voice_delete: '/assets/sounds/chat/voice-delete.mp3', notify_classic: '/assets/sounds/chat/message.mp3', mute: '/assets/sounds/chat/mute.mp3', unmute: '/assets/sounds/chat/unmute.mp3', deafen: '/assets/sounds/chat/deafen.mp3', undeafen: '/assets/sounds/chat/undeafen.mp3' };
let lastSound = 0;
export function playSound(name, volume = 0.6) {
  if (name === 'message') name = { long: 'notify', classic: 'notify_classic' }[state.settings.notify_sound] || 'notify_short'; // new-message sound (My Account > Chat > Notification sound)
  if (!state.settings.sounds || !SOUNDS[name]) return null;
  const now = Date.now();
  const burst = name === 'notify' || name === 'notify_short' || name === 'notify_classic' || name === 'mention';
  if (burst && now - lastSound < 600) return null; // a burst of messages = one sound
  if (burst) lastSound = now;
  try { const a = new Audio(SOUNDS[name]); a.volume = volume; a.play().catch(() => {}); return a; } catch { return null; }
}
// settings preview: always plays, whatever the Sounds switch says
export function previewNotifySound(kind) {
  try { const a = new Audio(SOUNDS[{ long: 'notify', classic: 'notify_classic' }[kind] || 'notify_short']); a.volume = 0.6; a.play().catch(() => {}); } catch { /* no audio */ }
}
// incoming-call ringtone: loops while a call rings; 1 in 100 calls rings the rare EPIC variant (rolled once per call)
const ringPick = new Map(); // callId -> 'ringtone' | 'ringtone_epic'
let ringAudio = null, ringKey = '';
export function syncRing(callIds) {
  const key = (callIds || []).join('|');
  if (key === ringKey) return;
  ringKey = key;
  if (!key) { if (ringAudio) { ringAudio.pause(); ringAudio = null; } ringPick.clear(); return; }
  if (ringAudio) return; // already ringing: keep looping the file chosen for the first call
  if (!state.settings.sounds || state.presence[state.me?.username]?.status === 'dnd') return;
  const id = callIds[0];
  if (!ringPick.has(id)) ringPick.set(id, Math.random() < 0.01 ? 'ringtone_epic' : 'ringtone');
  try { const a = new Audio(SOUNDS[ringPick.get(id)]); a.loop = true; a.volume = 0.7; a.play().catch(() => {}); ringAudio = a; } catch { ringAudio = null; }
}
function ping(key, msg, everyMessage = false, quiet = false) {
  if (state.presence[state.me?.username]?.status === 'dnd') return;
  // DM call lines ("[Voice call] missed call") read from my side: "You missed a call from X"
  const callText = key.startsWith('d:') ? callLinePlain(msg.body, { caller: msg.author?.username, me: state.me?.username, other: key.slice(2) }) : null;
  if (callText) msg = { ...msg, body: callText };
  const direct = !msg.channel || everyMessage; // a DM / group chat, or a channel set to "All messages"
  const mention = mentionsMe(msg);
  const hidden = !pageFocused();
  // pings in servers make the same sound as a new DM
  if ((direct || mention) && !quiet) { if (packActive()) playPackSound(msg.author?.bot ? 'bot' : 'receive'); else playSound('message'); }
  const mode = state.settings.notifications;
  if (!hidden || mode === 'none' || (mode === 'mentions' && !direct && !mention)) return;
  if (overlayToastHook?.(key, msg)) return; // Ember desktop: in a game with the overlay up -> a toast there instead
  try {
    if (key.startsWith('d:') && desktopNotify({ type: 'dm', from: msg.author?.username || 'Nookara', to: key.slice(2), body: inviteSummary(voiceSummary(String(msg.body || (msg.attachments?.some(isVoiceAtt) ? 'sent a voice message' : 'sent a picture')))).slice(0, 140), icon: msg.author?.pfp || '/assets/icon.png', tag: msg.id })) return;
    if (Notification.permission === 'granted') {
      new Notification(shownName(msg), { body: inviteSummary(voiceSummary(String(msg.body || (msg.attachments?.some(isVoiceAtt) ? 'sent a voice message' : 'sent a picture')))).slice(0, 140), icon: shownPfp(msg) || '/assets/icon.png', tag: msg.id });
    }
  } catch { /* no notifications */ }
}

// Ember desktop in-game overlay (chat/overlay.js): gets first pick of notifications while a game is in front
let overlayToastHook = null;
export const onOverlayToast = fn => { overlayToastHook = fn; };

// The browser's Notification API has no reply field. The desktop shell supplies
// an interactive popup; browsers continue with their normal system notification.
export function desktopNotify(note) {
  try {
    if (!window.bonfireDesktop?.notify) return false;
    window.bonfireDesktop.notify(note);
    return true;
  } catch { return false; }
}
const typingTimers = {};
function typingFrom(key, username, on = true, inst = VELORA) {
  if (!username || username === meOn(inst)?.username) return;
  const t = { ...(state.typing[key] || {}) };
  if (on === false) delete t[username]; else t[username] = Date.now() + 7000;
  set(s => ({ typing: { ...s.typing, [key]: t } }));
  clearTimeout(typingTimers[key]);
  typingTimers[key] = setTimeout(() => {
    const now = Date.now();
    const cur = Object.fromEntries(Object.entries(state.typing[key] || {}).filter(([, until]) => until > now));
    set(s => ({ typing: { ...s.typing, [key]: cur } }));
  }, 7100);
}
// a DM's files, from its opened message (E2EE.openMessage): their links go to Messages.jsx, which opens them on the way to the screen
function sealedAtts(m) {
  return (m.sealed?.files || []).map(link => { const f = E2EE.parseFileLink(link); return f ? { url: link, sealed: true, name: f.name, type: fileKindOfMime(f.mime) } : null; }).filter(Boolean);
}
export function imToMsg(m) {
  const meName = state.me?.username;
  const fromMe = m.from === meName;
  return {
    id: `im${m.id}`, imId: m.id, body: m.body, attachments: (m.attachments || []).length ? m.attachments : sealedAtts(m), system: !!m.from_system, sealed: m.sealed || null, notEncrypted: __ORIGINCHATS__ ? false : (!m.enc && !m.from_system && !m.from_bot && !/^\[Voice call\]/i.test(m.body || '')),
    wire: m.sealed?.wire, fromId: m.from_id, toId: m.to_id, quote: m.sealed?.quote || null,
    statusReply: m.status_reply?.text ? String(m.status_reply.text) : null,
    reply: m.reply ? { id: `im${m.reply.id}`, author: m.reply.gone ? null : { username: m.reply.from, pfp: state.people[m.reply.from]?.pfp || null }, body: m.reply.gone ? 'Original message was deleted' : m.reply.body } : null,
    author: m.from_system ? null : { username: m.from, pfp: fromMe ? state.me?.pfp : m.from_pfp, color: fromMe ? state.me?.color : state.people[m.from]?.color, rank: state.people[m.from]?.rank },
    created_at: new Date(m.sent_at).getTime(), edited_at: m.edited_at ? new Date(m.edited_at).getTime() : null, reactions: m.reactions || undefined, pinned: !!m.pinned,
  };
}
export function groupToMsg(m) {
  const p = state.people[m.user] || {};
  return {
    id: m.id ? `g${m.id}` : `g${m.timestamp}_${m.user}`, gid: m.id || null, room: m.room || null, body: m.message, attachments: [], system: !!m.system, sys_kind: m.sys_kind || undefined,
    reply: m.reply ? { id: `g${m.reply.id}`, author: { username: m.reply.user, pfp: state.people[m.reply.user]?.pfp || null }, body: m.reply.message } : null,
    author: m.system ? null : { username: m.user, pfp: p.pfp || null, color: p.color || null, rank: m.rank },
    created_at: m.timestamp, edited_at: m.edited_at || null, reactions: m.reactions?.length ? m.reactions : undefined, pinned: !!m.pinned_at,
  };
}

// a conversation's messages in time order, each once (a reconnect refetch or a late socket event can't shuffle them)
function ordered(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const k = m.imId ? `im${m.imId}` : m.gid ? `g${m.gid}` : m.id;
    if (k && !m.pending && seen.has(k)) continue;
    if (k && !m.pending) seen.add(k);
    out.push(m);
  }
  const done = out.filter(m => !m.pending && !m.failed);
  const waiting = out.filter(m => m.pending || m.failed);
  done.sort((a, b) => (Number(a.created_at) - Number(b.created_at)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return [...done, ...waiting];
}
const ADMIN_AUTHOR = { username: 'Nookara Administrator', pfp: '/assets/icon.png', webhook: true, staff: true };
const mmToMsg = m => ({ id: `mm${m.id}`, mmId: m.id, author: ADMIN_AUTHOR, body: m.body, attachments: [], created_at: m.created_at, staffBy: m.admin || undefined });
export async function loadModmail() {
  const d = await apiFetch('/chat/modmail').catch(() => null);
  if (d) set(s => ({ modmail: { messages: d.messages, unread: keyOf(s.view) === 'mm:' ? 0 : d.unread } }));
  apiFetch('/chat/modmail/staff').then(x => set(() => ({ staff: !!x.staff }))).catch(() => {});
}
export async function loadMessages(v, { older = false } = {}) {
  const key = keyOf(v);
  const b = state.msgs[key];
  if (b?.loading || (older && !b?.hasMore) || (!older && b?.loaded)) return;
  set(s => ({ msgs: { ...s.msgs, [key]: { list: [], hasMore: false, ...(s.msgs[key] || {}), loading: true } } }));
  try {
    let list = [], hasMore = false;
    const first = older ? b.list.find(x => !x.pending) : null;
    if (v.kind === 'channel') {
      const d = await apiFetch(`/chat/channels/${v.cid}/messages?limit=50${first ? `&before=${first.id}` : ''}`);
      list = d.messages; hasMore = d.has_more;
    } else if (v.kind === 'dm') {
      const d = await apiFetch(`/im/with/${encodeURIComponent(v.username)}?limit=50${first ? `&before=${first.imId}` : ''}`);
      list = (await Promise.all(d.messages.map(E2EE.openMessage))).map(imToMsg); hasMore = d.has_more;
    } else if (v.kind === 'modmail') {
      const d = await apiFetch(v.username ? `/chat/modmail/with/${encodeURIComponent(v.username)}` : '/chat/modmail');
      list = d.messages.map(mmToMsg);
    } else if (v.kind === 'group') {
      const d = await apiFetch(`/groups/${encodeURIComponent(v.room)}/messages?limit=300`);
      const names = [...new Set(d.messages.map(m => m.user).filter(Boolean))].filter(n => !state.people[n]?.pfp);
      await lookupMany(names.slice(0, 100)).catch(() => null);
      list = d.messages.map(groupToMsg);
    }
    if (v.kind === 'channel' && isInst(v.cid)) list.forEach(watchSignature); else remember(list.map(m => m.author).filter(Boolean));
    set(s => {
      const cur = s.msgs[key] || { list: [] };
      const ids = new Set(list.map(m => m.id));
      const live = dropSettled(cur.list.filter(m => !ids.has(m.id)), list, isMine);
      return { msgs: { ...s.msgs, [key]: { list: ordered(older ? [...list, ...cur.list] : [...list, ...live]), hasMore, loading: false, loaded: true } } };
    });
  } catch (e) {
    set(s => ({ msgs: { ...s.msgs, [key]: { list: [], hasMore: false, loading: false, loaded: true, error: e.message } } }));
  }
}
// after a reconnect: what came in while we were gone (inst: which socket it was)
export async function catchUp(inst = VELORA) {
  const mine = key => instOf(key.slice(2)) === inst;
  if (inst === VELORA) {
    // A rename may have happened while this socket was offline. Refresh the IDs
    // already present in cached channel history, including members who have left.
    const identityIds = new Set();
    for (const [key, buffer] of Object.entries(state.msgs)) if (key.startsWith('c:') && mine(key)) {
      for (const message of buffer.list) for (const person of [message.author, message.subject, message.reply?.author, message.reply?.subject]) {
        if (person?.id && /^[1-9]\d*$/.test(String(person.id))) identityIds.add(String(person.id));
      }
    }
    const ids = [...identityIds];
    for (let start = 0; start < ids.length; start += 200) {
      apiFetch(`/chat/identities?ids=${ids.slice(start, start + 200).join(',')}`).then(result => {
        set(s => result.users.reduce(applyIdentity, s));
      }).catch(() => {});
    }
  }
  for (const [key, b] of Object.entries(state.msgs)) {
    if (!key.startsWith('c:')) { if (inst === VELORA && b.loaded) set(s => ({ msgs: { ...s.msgs, [key]: { ...b, loaded: false } } })); continue; }
    if (!mine(key)) continue;
    if (!b.loaded) continue;
    const last = [...b.list].reverse().find(x => !x.pending && !x.failed);
    if (!last) continue;
    apiFetch(`/chat/channels/${key.slice(2)}/messages?after=${last.id}&limit=100`).then(d => d.messages.forEach(m => addMessage(key, m))).catch(() => {});
  }
  const v = state.view;
  if (v.kind !== 'home' && (v.kind !== 'channel' ? inst === VELORA : instOf(v.cid) === inst)) loadMessages(v);
  if (inst !== VELORA) return;
  loadServers();
  // presence for the people on your home page (asked before the socket was ready, or stale after a reconnect)
  const names = new Set([...state.friends.map(f => f.friend_username), ...state.dms.map(c => c.username).filter(n => n !== 'System')]);
  [...names].slice(0, 150).forEach(username => send({ type: 'chat_presence', username }));
}

// an attachment as a link (DMs / group chats are plain text). Files in Velora account storage (and old catbox ones) keep
// their real name as #n=<name>; a temporary-storage link (/t/<id>/<name>) already carries it in the path.
// my own accent colour is known right now: put it in the face cache an instance reads names through, so a message that is still
// sending shows the accent straight away (not the role colour until my Velora face loads, then a flip)
function seedMyFace(instUser) {
  if (!instUser?.velora_id || !state.me) return;
  const fid = String(instUser.velora_id), f = state.veloraFaces[fid];
  if (!f || f.miss) set(s => ({ veloraFaces: { ...s.veloraFaces, [fid]: { id: fid, username: state.me.username, pfp: state.me.pfp || null, color: state.me.color || null, rank: state.me.rank } } }));
}
// -> the pending copy's nonce (a forward watches it for the server's refusal). noStatusReply: a forward isn't the status reply being drafted
export function sendMessage(v, text, { replyTo, attachments, uploads, noStatusReply } = {}) {
  if (uploads?.length) { sendAfterUpload(v, text, { replyTo, attachments, uploads }); return undefined; }
  setTimeout(() => dispatchEvent(new CustomEvent('vc-sent', { detail: keyOf(v) })), 0); // the open conversation jumps to the bottom
  const key = keyOf(v);
  const n = `n${Date.now()}_${nonce++}`;
  const instUser = v.kind === 'channel' && isInst(v.cid) ? connections.get(instOf(v.cid))?.user : null;
  const me = instUser || state.me; // an instance knows me by its own account
  // on an instance the pending copy carries the same author data (id / kind / velora_id) and inst as the real message will, so
  // the picture and name colour resolve exactly the same way before and after the ack (no flash)
  seedMyFace(instUser);
  const temp = {
    id: n, nonce: n, pending: true, body: text, wire: v.kind === 'dm' ? wireText(text, attachments) : undefined, attachments: attachments || [], system: false,
    ...(instUser ? { inst: instOf(v.cid), unsigned: !!instUser.velora_id && !signingInfo(v.sid).can } : {}),
    author: instUser ? { id: instUser.id, username: me.username, pfp: me.pfp, color: instUser.velora_id ? (state.me?.color || me.color) : me.color, rank: me.rank, kind: instUser.kind || (instUser.velora_id ? 'velora' : 'local'), velora_id: instUser.velora_id } : { username: me.username, pfp: me.pfp, color: me.color, rank: me.rank }, created_at: Date.now(),
    reply: replyTo ? { id: replyTo.id, author: replyTo.author, alias: replyTo.alias || null, body: String(replyTo.body || '').slice(0, 200) } : null,
  };
  if (v.kind !== 'group') {
    // (not marked loaded: a forward into a conversation that was never opened must still fetch its history when it opens)
    set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, ...(b || {}), list: [...(b?.list || []), temp] })) }));
    pendingAcks.set(n, key);
  }
  if (state.settings.sounds) playPackSound('send'); // (only when a message sound pack is on)
  const sr = !noStatusReply && v.kind === 'dm' && state.statusReplyDraft && state.statusReplyDraft.username.toLowerCase() === String(v.username).toLowerCase() ? state.statusReplyDraft : null;
  if (sr) { temp.statusReply = sr.text; set({ statusReplyDraft: null }); }
  let ok;
  if (v.kind === 'modmail') { // staff writing as Velora Administrator
    apiFetch(`/chat/modmail/with/${encodeURIComponent(v.username)}`, { method: 'POST', body: JSON.stringify({ body: text }) })
      .then(d => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: ordered(b.list.map(x => (x.nonce === n ? mmToMsg(d.message) : x))) }) })))
      .catch(e => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: e.message } : x)) }) })));
    return n;
  }
  if (v.kind === 'channel') {
    const info = signingInfo(v.sid);
    const frame = signature => send({ type: 'chat_send', channel: v.cid, message: text, reply_to: replyTo?.id, attachments, signature, nonce: n });
    if (isInst(v.sid)) { // saved files must live on this instance before their hashes can be signed
      ok = true;
      (async () => {
        attachments = await prepareAttachments(v, attachments || []);
        let signature;
        if (info.can) {
          try { signature = await signMessage({ instance: instOf(v.sid), community: bare(v.sid), channel: bare(v.cid), author: connections.get(instOf(v.sid)).user.velora_id, body: normBody(text), attachments: attachmentRefs(attachments), reply_to: replyTo?.id ?? null, edit_of: null }); }
          catch { if (!(await askSendUnsigned())) throw new Error('sign_failed'); }
        }
        if (signature) signedSends.set(n, () => frame(undefined));
        else if (info.can) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, unsigned: true } : x)) }) }));
        if (!frame(signature)) throw new Error('offline');
      })().catch(e => {
        pendingAcks.delete(n);
        signedSends.delete(n);
        if (e.message !== 'sign_failed') toast(errorText(e.message)); // (they just said no: the message's own line says it)
        set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: e.message } : x)) }) }));
      });
    } else ok = frame();
  } else if (v.kind === 'dm') { // encrypted first, so it goes when that's done: failures come back the same way the server's would
    ok = true;
    sendDm({ nonce: n, to: v.username, key, wire: wireText(text, attachments), reply_to: replyTo?.imId, quote: replyTo ? { from: replyTo.author?.username || '', s: String(replyTo.body || '').slice(0, 200) } : null, status_reply: sr ? { text: sr.text } : undefined });
  } else ok = send({ type: 'roomMessage', room: v.room, message: wireText(text, attachments), reply_to: replyTo?.gid });
  if (!ok) set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? { ...x, failed: 'offline' } : x)) }) }));
  setTyping(v, false);
  return n;
}
// ── encrypted DMs going out ──
const dmSends = new Map(); // nonce -> what it was, until the server took it
export async function sendDm(d) {
  dmSends.set(d.nonce, d);
  const patch = f => set(s => ({ msgs: upd(s.msgs, d.key, b => b && { ...b, list: b.list.map(x => (x.nonce === d.nonce ? f(x) : x)) }) }));
  if (__ORIGINCHATS__) { // OriginChats DMs are plain text on the DM server (no end-to-end keys there)
    try {
      if (!send({ type: 'im_send', to: d.to, message: d.wire, reply_to: d.reply_to, status_reply: d.status_reply, nonce: d.nonce })) throw new Error('offline');
      pendingAcks.set(d.nonce, d.key);
      patch(x => (x.waiting ? { ...x, waiting: false } : x));
    } catch (e) {
      dmSends.delete(d.nonce);
      pendingAcks.delete(d.nonce);
      patch(x => ({ ...x, failed: e.message }));
    }
    return;
  }
  try {
    const enc = await E2EE.seal(d.to, d.wire, { replyQuote: d.quote, fresh: !!d.retried });
    if (!send({ type: 'im_send', to: d.to, enc, reply_to: d.reply_to, status_reply: d.status_reply, nonce: d.nonce })) throw new Error('offline');
    pendingAcks.set(d.nonce, d.key);
    patch(x => (x.waiting ? { ...x, waiting: false } : x));
    E2EE.release(d.nonce);
  } catch (e) {
    dmSends.delete(d.nonce);
    if (e.message === 'no_keys') { // they haven't set up encrypted DMs: it stays on this device and goes by itself when they have
      const { key, retried, ...keep } = d;
      E2EE.hold({ ...keep, created_at: Date.now() }).catch(() => {});
      patch(x => ({ ...x, waiting: true }));
      return;
    }
    pendingAcks.delete(d.nonce);
    patch(x => ({ ...x, failed: e.message }));
  }
}
E2EE.setOutboxSender(h => sendDm({ ...h, key: `d:${String(h.to).toLowerCase()}` }));
// held messages show in their conversation again after a reload
async function showHeld() {
  for (const h of await E2EE.held()) {
    const key = `d:${String(h.to).toLowerCase()}`;
    if (state.msgs[key]?.list.some(x => x.nonce === h.nonce)) continue;
    const lines = String(h.wire).split('\n');
    const links = lines.filter(l => E2EE.parseFileLink(l.trim()));
    const temp = { id: h.nonce, nonce: h.nonce, pending: true, waiting: true, body: lines.filter(l => !E2EE.parseFileLink(l.trim())).join('\n'), wire: h.wire, attachments: sealedAtts({ sealed: { files: links.map(l => l.trim()) } }), system: false, author: { username: state.me?.username, pfp: state.me?.pfp, color: state.me?.color, rank: state.me?.rank }, created_at: h.created_at };
    set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, ...(b || {}), list: [...(b?.list || []), temp] })) }));
  }
}
E2EE.onChange(st => {
  const was = state.e2eeStatus;
  set({ e2eeStatus: st });
  if (st === 'ready' && was !== 'ready') { // what was locked can be opened now
    set(s => ({ msgs: Object.fromEntries(Object.entries(s.msgs).filter(([k]) => !k.startsWith('d:'))) }));
    if (state.view?.kind === 'dm') loadMessages(state.view);
    loadDMs();
    showHeld();
  }
  if (st === 'none' || st === 'locked') { // says so once a visit, and "Later" is always there
    let seen = true; try { seen = !!sessionStorage.getItem('ember.e2eeAsked'); sessionStorage.setItem('ember.e2eeAsked', '1'); } catch { /* private mode: ask each load */ seen = false; }
    if (!seen && !was.startsWith('r')) set({ e2eeGate: 'auto' });
  }
});
E2EE.onKeyChange(username => set(s => ({ e2eeKeyChanged: { ...s.e2eeKeyChanged, [String(username).toLowerCase()]: true } })));
export const openE2eeGate = (mode = 'auto') => set({ e2eeGate: mode });
export const closeE2eeGate = () => set({ e2eeGate: null });
export const dismissKeyChange = username => set(s => { const k = { ...s.e2eeKeyChanged }; delete k[String(username).toLowerCase()]; return { e2eeKeyChanged: k }; });
const SIGN_REFUSED = new Set(['bad_signature', 'signing_unavailable']);
const signedSends = new Map(); // nonce -> send it again without a signature (until the instance has answered)
export function dropFailed(v, n) {
  const m = state.msgs[keyOf(v)]?.list.find(x => x.nonce === n);
  if (m?.waiting) E2EE.release(n);
  if (m?.uploads) { uploadAborts.get(n)?.abort(); uploadAborts.delete(n); m.attachments.forEach(a => a.local && URL.revokeObjectURL(a.url)); }
  set(s => ({ msgs: upd(s.msgs, keyOf(v), b => b && { ...b, list: b.list.filter(x => x.nonce !== n) }) }));
}

// Files picked in the composer upload only once the message is sent. Meanwhile the message sits at the bottom of the
// conversation with the files' previews and a progress bar (the composer is free for other messages); when every file is
// up, the placeholder goes and the real message (text + files) is sent the normal way.
// uploads: [{ file, spoiler }]
const uploadAborts = new Map(); // nonce -> AbortController
export const fileKind = f => (/^image\/gif$/.test(f.type) ? 'gif' : /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : 'file');
function sendAfterUpload(v, text, { replyTo, attachments = [], uploads }) {
  setTimeout(() => dispatchEvent(new CustomEvent('vc-sent', { detail: keyOf(v) })), 0);
  const key = keyOf(v);
  const n = `u${Date.now()}_${nonce++}`;
  const instUser = v.kind === 'channel' && isInst(v.cid) ? connections.get(instOf(v.cid))?.user : null;
  const me = instUser || state.me;
  const total = uploads.reduce((t, u) => t + u.file.size, 0) || 1;
  const previews = uploads.map(u => ({ url: URL.createObjectURL(u.file), type: fileKind(u.file), name: spoilerName(u.file.name, u.spoiler), size: u.file.size, local: true }));
  seedMyFace(instUser);
  const temp = {
    id: n, nonce: n, pending: true, uploading: { sent: 0, total }, uploads, ready: attachments, body: text, attachments: [...attachments, ...previews], system: false,
    ...(instUser ? { inst: instOf(v.cid) } : {}),
    author: instUser ? { id: instUser.id, username: me.username, pfp: me.pfp, color: instUser.velora_id ? (state.me?.color || me.color) : me.color, rank: me.rank, kind: instUser.kind || (instUser.velora_id ? 'velora' : 'local'), velora_id: instUser.velora_id } : { username: me.username, pfp: me.pfp, color: me.color, rank: me.rank }, created_at: Date.now(),
    reply: replyTo ? { id: replyTo.id, author: replyTo.author, alias: replyTo.alias || null, body: String(replyTo.body || '').slice(0, 200) } : null, replyTo,
  };
  const patch = f => set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.map(x => (x.nonce === n ? f(x) : x)) }) }));
  set(s => ({ msgs: upd(s.msgs, key, b => ({ list: [], hasMore: false, loaded: true, ...(b || {}), list: [...(b?.list || []), temp] })) }));
  setTyping(v, false);
  const ctrl = new AbortController();
  uploadAborts.set(n, ctrl);
  (async () => {
    const done = [];
    let before = 0, shown = -1;
    for (const u of uploads) {
      const file = u.spoiler ? new File([u.file], spoilerName(u.file.name, true), { type: u.file.type }) : u.file;
      const a = await uploadAttachment(v, file, {
        dest: u.dest,
        expires: u.expires, // a Velora Pro member's picked expiry (days or 'max'), temporary storage only
        signal: ctrl.signal,
        onProgress: sent => {
          const pct = Math.floor(((before + Math.min(sent, u.file.size)) / total) * 100);
          if (pct !== shown) { shown = pct; patch(x => ({ ...x, uploading: { sent: before + sent, total } })); }
        },
      });
      // the spoiler marker is in the name the server was told: make sure it survives whatever the server did to it
      done.push(u.spoiler ? { ...a, name: spoilerName(a.name || u.file.name, true) } : a);
      before += u.file.size;
    }
    return done;
  })().then(done => {
    uploadAborts.delete(n);
    if (ctrl.signal.aborted) return; // cancelled (a reload that dropped the placeholder doesn't stop the send)
    previews.forEach(p => URL.revokeObjectURL(p.url));
    set(s => ({ msgs: upd(s.msgs, key, b => b && { ...b, list: b.list.filter(x => x.nonce !== n) }) }));
    sendMessage(v, text, { replyTo, attachments: [...attachments, ...done] });
  }).catch(e => {
    uploadAborts.delete(n);
    if (e.name === 'AbortError') return;
    toast(errorText(e.message));
    patch(x => ({ ...x, uploading: null, failed: e.message || 'upload_failed' }));
  });
}
let lastTyping = 0;
export function setTyping(v, on = true) {
  if (state.settings.share_typing === false) return;
  const now = Date.now();
  if (on && now - lastTyping < 3000) return;
  lastTyping = on ? now : 0;
  if (v.kind === 'channel') send({ type: 'chat_typing', channel: v.cid, typing: on });
  else if (v.kind === 'dm') send({ type: 'dm_typing', to: v.username, typing: on });
}
// a message that couldn't be signed: the person decides, it's never dropped or sent unsigned behind their back
export const askSendUnsigned = (edit = false) => ask({
  title: edit ? "This edit couldn't be signed" : "This message couldn't be signed",
  text: `Signing shows people it really came from your Nookara account, and it didn't work this time. You can ${edit ? 'save it' : 'send it'} without a signature, but people here will see it marked as unsigned.`,
  confirm: edit ? 'Save unsigned' : 'Send unsigned',
}).then(Boolean);
// can this device sign in that community? (instances in Velora mode: signing is always allowed there, never required)
export function signingInfo(sid) {
  const inst = instOf(sid || '');
  const c = inst === VELORA ? null : connections.get(inst);
  const allow = c?.info?.accounts_mode === 'velora';
  return { allow, can: allow && canSign() && !!c.user?.velora_id };
}
// a conversation's pin list changed: an open panel loads it again (a channel by its cid, a DM by d:<name>, a group by g:<room>)
function bumpPins(key) { set(s => ({ pinsVersion: { ...s.pinsVersion, [key]: (s.pinsVersion[key] || 0) + 1 } })); }
export async function editMessage(id, text, m) {
  // a group message: everyone gets room_message_edited
  if (m?.gid && m?.room) { await apiFetch(`/groups/${encodeURIComponent(m.room)}/messages/${encodeURIComponent(m.gid)}`, { method: 'PATCH', body: JSON.stringify({ message: text }) }); return; }
  // a DM (im<id>): its own route; both people get im_edited
  if (/^im\d+$/.test(String(id))) {
    const wire = [text, ...(m?.sealed?.files || [])].filter(Boolean).join('\n'); // (the text changes, the files stay)
    const peer = String(m.fromId) === String(m.toId) ? state.me?.username : (m.author?.username === state.me?.username ? state.view?.username : m.author?.username);
    const enc = await E2EE.sealEdit({ fromId: m.fromId, toId: m.toId, imId: m.imId, peer, quote: m.quote }, wire);
    await apiFetch(`/im/${String(id).slice(2)}/edit`, { method: 'PATCH', body: JSON.stringify({ enc }) });
    return;
  }
  const inst = m?.channel ? instOf(m.channel) : VELORA;
  let signature;
  const info = m?.channel ? signingInfo(m.server) : null;
  if (info?.can) {
    try { signature = await signMessage({ instance: inst, community: bare(m.server), channel: bare(m.channel), author: connections.get(inst).user.velora_id, body: normBody(text), attachments: attachmentRefs(m.attachments || []), reply_to: m.reply_to ?? m.reply?.id ?? null, edit_of: id }); }
    catch { if (!(await askSendUnsigned(true))) throw new Error('sign_failed'); }
  }
  const patch = sig => apiFetch(`/chat/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ message: text, signature: sig }), inst: inst === VELORA ? undefined : inst });
  try { await patch(signature); } catch (e) {
    if (!signature || !SIGN_REFUSED.has(e.message)) throw e;
    refreshSigningKey();
    if (!(await askSendUnsigned(true))) throw new Error('sign_failed');
    await patch(undefined);
  }
}
export async function deleteMessage(v, m) {
  if (v.kind === 'channel') await apiFetch(`/chat/messages/${m.id}`, { method: 'DELETE', inst: isInst(v.cid) ? instOf(v.cid) : undefined });
  else if (v.kind === 'dm') {
    await apiFetch(`/im/${m.imId}`, { method: 'DELETE' });
    set(s => ({ msgs: upd(s.msgs, keyOf(v), b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
  } else if (v.kind === 'group' && m.gid) {
    await apiFetch(`/groups/${encodeURIComponent(v.room)}/messages/${encodeURIComponent(m.gid)}`, { method: 'DELETE' }); // everyone gets room_message_deleted
    dropGroupMessage(v.room, m.gid);
  }
}
function dropGroupMessage(room, gid) {
  const id = `g${gid}`;
  set(s => ({ msgs: upd(s.msgs, `g:${room}`, b => b && { ...b, list: b.list.filter(x => x.id !== id).map(x => (x.reply?.id === id ? { ...x, reply: null } : x)) }) }));
}
// a picture / video / audio file -> your Velora storage (it shows up in Saved Media too)
export async function uploadMedia(file) {
  const fd = new FormData();
  fd.append('file', file);
  const d = await uploadFetch('/chat/media/upload', fd);
  if (state.savedMedia) loadMedia();
  return d.attachment;
}
export const upload = uploadMedia;
// the real upload limits (MB), asked from Velora once: a file sent in a conversation / a file kept on your Velora account
let uploadLimits = { server_mb: 95, saved_mb: 60 };
let limitsAsked = null;
export const getUploadLimits = () => uploadLimits;
export function loadUploadLimits() {
  return (limitsAsked ||= apiFetch('/chat/media/limits')
    .then(d => { if (d?.server_mb) uploadLimits = { server_mb: d.server_mb, saved_mb: d.saved_mb || uploadLimits.saved_mb }; return uploadLimits; })
    .catch(() => { limitsAsked = null; return uploadLimits; }));
}
// files straight into Saved Media (your Velora storage), not into a message
export async function saveFilesToMedia(files) {
  const cap = uploadLimits.saved_mb;
  let n = 0;
  for (const f of [...files].slice(0, 10)) {
    if (f.size > cap * 1024 * 1024) { toast(`${f.name} is too big - files kept on your account go up to ${cap} MB.`); continue; }
    try { await uploadMedia(f); n++; } catch (e) { toast(errorText(e.message)); }
  }
  if (n) { toast(n === 1 ? 'Saved to Saved Media.' : `Saved ${n} files to Saved Media.`, true); loadMedia(); }
  return n;
}
// any picture / GIF / video / sound in a message -> Saved Media (Klipy GIFs as a link, Velora files as your own copy)
const SAVE_ERR = { cant_save_that: "That can't be saved - only pictures, videos and sounds sent in Ember can.", storage_limit_exceeded: "That doesn't fit in your Nookara storage." };
export async function saveToMedia(url, name) {
  try {
    if (/^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(url)) await apiFetch('/chat/media/gif', { method: 'POST', body: JSON.stringify({ url, preview: url, title: name || '' }) });
    else {
      const d = await apiFetch('/chat/media/save', { method: 'POST', body: JSON.stringify({ url, name }) });
      if (d.status === 'already') { toast("It's already in your Saved Media.", true); return; }
    }
    toast('Saved to Saved Media.', true);
    loadMedia();
  } catch (e) { toast(SAVE_ERR[e.message] || errorText(e.message)); }
}
// A file sent in a DM / group chat (anything not on an Ember instance) goes to one of two places on Velora:
//   'temp'    Velora's temporary storage (/t/<id>/<name>): free, deleted on a fixed date (opening it never moves it)
//   'account' your Velora account storage: counts toward your storage, stays until you delete it
// (pictures / videos / sounds show inline, the rest is a download card). Which one: the chat setting dm_upload_dest
// ('ask' | 'account' | 'temp', synced to the account) with a copy in localStorage, or the picker below when it's 'ask'.
// opts.expires: a picked expiry (days, or 'max') - Velora Pro only, the server refuses it otherwise (pro_required).
// Every file's date is fixed when it is sent and opening it never moves it. Left out = the normal lifetime for the file.
export async function uploadTemp(file, opts = {}) {
  const fd = new FormData();
  if (opts.expires != null && opts.expires !== 'default') fd.append('expires_in_days', String(opts.expires));
  fd.append('file', file);
  const d = await uploadFetch('/chat/media/temp', fd, opts);
  return d.attachment;
}
export async function uploadAccount(file, opts = {}) {
  const fd = new FormData();
  fd.append('file', file);
  const d = await uploadFetch('/chat/media/account', fd, opts);
  if (state.savedMedia && /^(image|gif|video|audio)$/.test(d.attachment?.type)) loadMedia();
  return d.attachment;
}
export const uploadExternal = uploadTemp; // (old name)
const DEST_KEY = 'ember.dmUploadDest';
const readLocalDest = () => { try { const v = localStorage.getItem(DEST_KEY); return v === 'account' || v === 'temp' ? v : null; } catch { return null; } };
// the remembered destination ('account' | 'temp'), or null = ask
export function rememberedUploadDest() {
  return rememberedDest({ fromServer: !!state.settingsFromServer, setting: state.settings.dm_upload_dest, local: readLocalDest() });
}
export async function setUploadDest(v) {
  const dest = v === 'account' || v === 'temp' ? v : 'ask';
  try { await saveSettings({ dm_upload_dest: dest }); } catch (e) { toast(errorText(e.message)); } // (saveSettings keeps this device's copy too)
}
// what the picker shows (space left in account storage, the temporary storage rules); cached for a minute
let destInfo = null, destInfoAt = 0;
export function loadUploadDestinations(force) {
  if (!force && destInfo && Date.now() - destInfoAt < 60e3) return destInfo;
  destInfoAt = Date.now();
  destInfo = apiFetch('/chat/media/destinations').catch(() => { destInfoAt = 0; return null; });
  return destInfo;
}
// where these files go: the remembered choice, else the picker (resolves 'account' | 'temp', or null = cancelled).
// files: the File list (the picker greys out account storage when they don't fit)
export function chooseUploadDest(files) {
  const known = rememberedUploadDest();
  if (known) return Promise.resolve(known);
  if (state.uploadAsk) state.uploadAsk.resolve(null);
  const list = [...files];
  return new Promise(resolve => set({ uploadAsk: { total: list.reduce((t, f) => t + (f.size || 0), 0), biggest: list.reduce((m, f) => Math.max(m, f.size || 0), 0), count: list.length, resolve } }));
}
export function answerUploadAsk(dest, remember) {
  const a = state.uploadAsk;
  if (!a) return;
  set({ uploadAsk: null });
  if (dest && remember) setUploadDest(dest);
  a.resolve(dest || null);
}
// a temporary-storage link (/t/ or cdn.nookara.cc/temp/): { expires_in (seconds), ttl_days (null), at (when we asked) }, or 'gone' when it
// expired / was deleted, or null when that couldn't be found out. Answers are kept 10 minutes (a 'gone'
// forever), asked at most 4 at a time, and the same file in many messages is one request.
export { TEMP_LINK };
const TEMP_INFO_MS = 10 * 60 * 1000;
const tempInfos = new Map(); // id -> { p: Promise, at: when it was asked, v: the answer once there is one }
const tempWaiting = [];
let tempBusy = 0;
const tempSubs = new Set();
const tempPump = () => {
  while (tempBusy < 4 && tempWaiting.length) { tempBusy++; tempWaiting.shift()(); }
};
const tempAsk = id => new Promise(resolve => {
  tempWaiting.push(() => {
    const at = Date.now();
    fetch(`/t/info/${id}`, { credentials: 'omit', cache: 'no-store' })
      .then(r => (r.status === 404 ? 'gone' : r.ok ? r.json().then(d => ({ ...d, at })) : null))
      .catch(() => null)
      .then(v => { tempBusy--; tempPump(); resolve(v); });
  });
  tempPump();
});
function tempLoad(id) {
  const prev = tempInfos.get(id);
  const e = { at: Date.now(), v: prev?.v }; // an older answer stays on screen while the new one is on its way
  e.p = tempAsk(id).then(v => {
    if (v === null) { if (tempInfos.get(id) === e) { if (prev?.v !== undefined) tempInfos.set(id, prev); else tempInfos.delete(id); } return prev?.v ?? null; }
    e.v = v;
    tempSubs.forEach(f => f(id));
    return v;
  });
  tempInfos.set(id, e);
  return e;
}
export function tempFileInfo(url) {
  const id = tempId(url);
  if (!id) return Promise.resolve(null);
  const e = tempInfos.get(id);
  if (e && (e.v === 'gone' || Date.now() - e.at < TEMP_INFO_MS)) return e.p;
  return tempLoad(id).p;
}
// the answer we already have for a link (undefined = not asked / still asking), without asking
export const tempFileInfoNow = url => { const e = tempInfos.get(tempId(url)); return e && (e.v === 'gone' || Date.now() - e.at < TEMP_INFO_MS) ? e.v : undefined; };
export const onTempInfo = fn => { tempSubs.add(fn); return () => tempSubs.delete(fn); };
async function prepareAttachments(v, attachments) {
  return prepareInstanceAttachments(attachments, instOf(v.sid), location.origin, a =>
    apiFetch(`/chat/media/import?sid=${v.sid}&cid=${v.cid}`, {
      method: 'POST', body: JSON.stringify({ url: a.url, name: a.name || 'attachment' }),
    }));
}
// a file for the conversation you're in: an instance community keeps it on that instance (and hashes it for signing), the rest goes through Velora
// opts: { onProgress(sent, total), signal }
export async function uploadAttachment(v, file, opts = {}) {
  if (v.kind === 'channel' && isInst(v.sid)) {
    const fd = new FormData();
    fd.append('file', file);
    const d = await uploadFetch(`/chat/media/upload?sid=${v.sid}&cid=${v.cid}`, fd, opts);
    return { url: d.url, type: d.type, name: d.name, size: d.size, width: d.width, height: d.height, sha256: d.sha256 };
  }
  // DMs / group chats: opts.dest picked in the composer (a file without one, e.g. a command option, follows the setting)
  const dest = opts.dest || rememberedUploadDest() || 'temp';
  if (v.kind === 'dm' && __ORIGINCHATS__) { // plaintext DM server: a normal upload, its link goes in the message
    return dest === 'account' ? uploadAccount(file, opts) : uploadTemp(file, opts);
  }
  if (v.kind === 'dm') { // encrypted here first: Nookara stores a file it can't open, its key travels inside the encrypted message
    const { upload, key, iv } = await E2EE.sealFile(file);
    const a = await (dest === 'account' ? uploadAccount(upload, opts) : uploadTemp(upload, opts));
    return { url: E2EE.fileLink(a.url, { key, iv, name: file.name, mime: file.type }), sealed: true, type: fileKindOfMime(file.type), name: file.name, size: file.size };
  }
  return dest === 'account' ? uploadAccount(file, opts) : uploadTemp(file, opts);
}
// custom emojis of my Velora servers + every connected instance's (each listed under its own namespaced sid)
let emojiLoad = 0;
export async function loadEmojis() {
  const mine = ++emojiLoad; // an older answer must not replace a newer one (instances connect while the first load is still running)
  const open = [...connections.values()].filter(c => c.session && c.status === 'open').map(c => c.origin);
  const [home, ...more] = await Promise.all([state.signedIn ? apiFetch('/chat/emojis').catch(() => null) : null, ...open.map(o => apiFetch('/chat/emojis', { inst: o }).catch(() => null))]);
  const lists = [...(home?.servers || []), ...more.flatMap(d => d?.servers || [])];
  if (mine !== emojiLoad || (!home && !more.some(Boolean))) return;
  const urls = {};
  for (const sv of lists) for (const e of sv.emojis || []) if (e.url && !urls[e.eid]) urls[e.eid] = e.url;
  set({ emojis: lists, emojiUrls: urls });
}
export async function loadMedia() {
  const d = await apiFetch('/chat/media').catch(() => null);
  if (d) set({ savedMedia: d.items });
}
export async function saveGif(g) {
  const d = await apiFetch('/chat/media/gif', { method: 'POST', body: JSON.stringify({ url: g.url, preview: g.preview, width: g.width, height: g.height, title: g.title || g.name || '' }) });
  set(s => ({ savedMedia: [{ id: d.id, kind: 'gif', url: g.url, preview: g.preview || g.url, width: g.width, height: g.height, name: g.title || g.name || '', saved: true, at: Date.now() }, ...(s.savedMedia || []).filter(m => m.url !== g.url)] }));
  toast('Saved to Saved Media.', true);
}
export async function unsaveGif(url) {
  await apiFetch(`/chat/media?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
  set(s => ({ savedMedia: (s.savedMedia || []).filter(m => m.url !== url) }));
}
export async function deleteMedia(m) {
  await apiFetch(`/chat/media/${m.id}`, { method: 'DELETE' });
  set(s => ({ savedMedia: (s.savedMedia || []).filter(x => x.id !== m.id) }));
}

// ── lists ──
export async function loadServers() {
  const d = await apiFetch('/chat/servers').catch(() => null);
  // a fresh count for a server whose channels aren't loaded already has what came in live
  if (d) set(s => ({ servers: [...d.servers.map(x => ({ ...x, inst: VELORA })), ...s.servers.filter(x => x.inst && x.inst !== VELORA)], unreadN: Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => s.detail[u.sid] || !d.servers.some(x => x.sid === u.sid))) }));
  return d?.servers || [];
}
// my communities on one instance (or everywhere): after joining / creating one
export async function loadServersOf(sid) { if (isInst(sid)) await loadInstanceData(instOf(sid)); else await loadServers(); }
export async function refreshServer(sid) {
  const d = await apiFetch(`/chat/servers/${sid}`).catch(() => null);
  if (d) set(s => ({ detail: { ...s.detail, [sid]: d }, voiceStates: { ...s.voiceStates, ...(d.voice || {}) }, unreadN: Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => u.sid !== sid)) }));
  return d;
}
export async function loadMembers(sid) {
  const d = await apiFetch(`/chat/servers/${sid}/members`).catch(() => null);
  if (!d) return;
  if (isInst(sid)) { // instances don't relay presence: Velora accounts' status comes from the home socket, the rest has none
    d.members = d.members.map(m => ({ ...m, inst: instOf(sid) }));
    set(s => ({ members: { ...s.members, [sid]: d.members } }));
    wantVeloraFaces(d.members);
    if (!state.signedIn) return;
    const ids = [...new Set(d.members.filter(m => m.kind === 'velora' && /^[1-9]\d*$/.test(String(m.velora_id))).map(m => String(m.velora_id)))].slice(0, 200);
    const names = await apiFetch(`/chat/identities?ids=${ids.join(',')}`).then(r => Object.fromEntries(r.users.map(u => [String(u.id), u.username]))).catch(() => ({})); // their name now (the instance knows the one from their last login)
    if (Object.keys(names).length) set(s => ({ veloraNames: { ...s.veloraNames, ...names } }));
    watchPresence(d.members.filter(m => m.kind === 'velora').slice(0, 400).map(m => names[m.velora_id] || m.username));
    return;
  }
  remember(d.members);
  const pres = Object.fromEntries(d.members.map(m => [m.username, localizePresence(m.presence)]));
  set(s => ({ members: { ...s.members, [sid]: d.members }, presence: { ...s.presence, ...pres }, membersMore: pagedMore(s.membersMore, sid, d) }));
  if (d.next_offset != null) watchPresence(d.members.map(m => m.username)); // a big server: its members' presence isn't pushed to everyone
}
const pagedMore = (all, sid, d) => { const next = { ...all }; if (d.next_offset != null) next[sid] = d.next_offset; else delete next[sid]; return next; };
// a big Velora-hosted server answers its member list in pages (Velora chat.js memberList): the next one, as you scroll
const loadingMore = new Set();
export async function loadMoreMembers(sid) {
  const from = state.membersMore[sid];
  if (from == null || loadingMore.has(sid) || isInst(sid)) return;
  loadingMore.add(sid);
  try {
    const d = await apiFetch(`/chat/servers/${sid}/members?offset=${from}&limit=200`).catch(() => null);
    if (!d || state.membersMore[sid] !== from) return;
    remember(d.members);
    const pres = Object.fromEntries(d.members.map(m => [m.username, localizePresence(m.presence)]));
    set(s => {
      const have = new Set((s.members[sid] || []).map(m => m.username));
      return { members: { ...s.members, [sid]: [...(s.members[sid] || []), ...d.members.filter(m => !have.has(m.username))] }, presence: { ...s.presence, ...pres }, membersMore: pagedMore(s.membersMore, sid, d) };
    });
    watchPresence(d.members.map(m => m.username));
  } finally { loadingMore.delete(sid); }
}
export async function loadCommands(sid, cid) {
  if (!isInst(sid)) return;
  const want = cid || state.commands[sid]?.cid || null;
  const d = await apiFetch(`/chat/servers/${sid}/commands${want ? `?channel=${encodeURIComponent(bare(want))}` : ''}`).catch(() => null);
  if (d) set(s => ({ commands: { ...s.commands, [sid]: { ...d, cid: want } } }));
}
export const sendInteraction = (sid, body) => {
  return apiFetch(`/chat/servers/${sid}/interactions`, { method: 'POST', body: JSON.stringify({ ...body, channel: bare(body.channel) }) });
};
export function dismissEphemeral(view, m) {
  set(s => ({ msgs: upd(s.msgs, keyOf(view), b => b && { ...b, list: b.list.filter(x => x.id !== m.id) }) }));
  apiFetch(`/chat/servers/${view.sid}/interactions/messages/${m.id}`, { method: 'DELETE' }).catch(() => {});
}
export const closeInteractionModal = () => set({ interactionModal: null });
// online / idle / dnd / offline for a member list row; null = this account has no presence (an instance's own accounts and bots, or signed out of Velora)
// an instance bot's presence ('online' | 'offline', set by the instance from its bot gateway connections); null when the instance doesn't say
export const botPresenceOf = m => (m?.kind === 'bot' && (m.presence === 'online' || m.presence === 'offline') ? m.presence : null);
export function statusOf(sid, m, s = state) {
  if (!isInst(sid)) return s.presence[m.username]?.status || m.presence?.status || 'offline';
  if (m.kind === 'bot') return botPresenceOf(m);
  if (m.kind !== 'velora' || !s.signedIn) return null;
  return s.presence[s.veloraNames[m.velora_id] || m.username]?.status || 'offline';
}
export const presenceFor = (sid, m, s = state) => (isInst(sid) ? (m.kind === 'bot' ? (botPresenceOf(m) ? { status: botPresenceOf(m) } : null) : m.kind === 'velora' && s.signedIn ? s.presence[s.veloraNames[m.velora_id] || m.username] : null) : s.presence[m.username] || m.presence);
function loadMembersOf(inst) { Object.keys(state.members).filter(k => instOf(k) === inst).forEach(loadMembers); }
// the id a member route wants: an instance names people by their principal (v:2), Velora by username
export function memberRef(sid, username) {
  if (!isInst(sid)) return encodeURIComponent(username);
  const m = state.members[sid]?.find(x => x.username === username);
  return encodeURIComponent(m?.id || username);
}
// the DM you're looking at: read on the server too, so leaving it doesn't show what you already saw as new
let dmReadTimer = null;
function markDmRead(username) {
  if (!username) return;
  set(s => ({ dms: s.dms.map(c => (c.username.toLowerCase() === username.toLowerCase() ? { ...c, unread: 0 } : c)), unread: { ...s.unread, [`d:${username.toLowerCase()}`]: false } }));
  clearTimeout(dmReadTimer);
  dmReadTimer = setTimeout(() => apiFetch(`/im/with/${encodeURIComponent(username)}/read`, { method: 'POST' }).catch(() => {}), 400);
}
const viewingDm = () => (state.view.kind === 'dm' && document.visibilityState === 'visible' ? state.view.username : null);
export async function loadDMs() {
  const d = await apiFetch('/im/conversations').catch(() => null);
  if (!d) return;
  d.conversations = await Promise.all(d.conversations.map(async c => {
    if (!c.last_message?.enc) return c;
    const o = await E2EE.openMessage(c.last_message);
    return { ...c, last_message: { ...o, body: o.sealed?.state === 'open' ? (o.body || (o.sealed.files?.length ? 'Sent a file' : '')) : 'Encrypted message' } };
  }));
  const here = viewingDm();
  if (here) d.conversations = d.conversations.map(c => (c.username.toLowerCase() === here.toLowerCase() && c.unread ? (markDmRead(here), { ...c, unread: 0 }) : c));
  remember(d.conversations.filter(c => c.username !== 'System').map(c => ({ username: c.username, pfp: c.pfp || undefined })));
  set(s => {
    const unread = { ...s.unread };
    d.conversations.forEach(c => { const k = `d:${c.username.toLowerCase()}`; if (c.unread && keyOf(s.view) !== k) unread[k] = true; });
    return { dms: d.conversations, unread };
  });
}
export async function loadGroups() {
  const d = await apiFetch('/groups').catch(() => null);
  if (d) set({ groups: d.groups });
}
export async function loadFriends() {
  const d = await apiFetch('/friends').catch(() => null);
  if (!d) return;
  remember(d.friends.map(f => ({ username: f.friend_username, pfp: f.pfp_url, color: f.color, rank: f.rank })));
  set({ friends: d.friends });
  watchPresence(d.friends.map(f => f.friend_username));
}
export async function loadBlocks() {
  const d = await apiFetch('/account/blocks').catch(() => null);
  if (d?.blocks) set({ blocks: d.blocks });
}
// the people I blocked as { ids, names } (names lowercased), built once per loaded list. Velora gives their ids (older servers only names).
const blockSetCache = new WeakMap();
function blockSets(list) {
  let b = blockSetCache.get(list);
  if (!b) {
    b = { ids: new Set(list.filter(x => x.id != null).map(x => String(x.id))), names: new Set(list.map(x => String(x.username || '').toLowerCase())) };
    blockSetCache.set(list, b);
  }
  return b;
}
// Is this person (a message / reply author, a member) somebody I blocked? Only for people I blocked, never the other way round.
// inst: the instance the person is shown on (falsy / VELORA = Velora's own servers). On an instance only its Velora people count,
// by their Velora id (a local account or bot there with the same name is somebody else). Webhooks / bridged names never count.
export function isBlockedPerson(u, inst, s = state) {
  if (!u || !s.blocks?.length || u.webhook || u.bridge) return false;
  const b = blockSets(s.blocks);
  if (inst && inst !== VELORA) {
    if (u.kind !== 'velora' || !u.velora_id) return false;
    const vid = String(u.velora_id);
    return b.ids.has(vid) || b.names.has(String(s.veloraNames[vid] || '').toLowerCase());
  }
  if (u.id != null && b.ids.size) return b.ids.has(String(u.id));
  return b.names.has(String(u.username || '').toLowerCase());
}
// the same for a bare name in a server (typing, @mentions): looked up among that server's members, so an instance's names work
export function isBlockedName(sid, username, s = state) {
  if (!username || !s.blocks?.length) return false;
  const inst = sid && isInst(sid) ? instOf(sid) : VELORA;
  const m = sid ? s.members[sid]?.find(x => x.username === username) : null;
  if (m) return isBlockedPerson(m, inst, s);
  return inst === VELORA && blockSets(s.blocks).names.has(String(username).toLowerCase());
}
export const useBlocked = (u, inst) => useChat(s => isBlockedPerson(u, inst, s));
// how somebody I blocked is shown in a server: no name, no picture (the default letter one), no colour
export const BLOCKED_NAME = 'Blocked User';
export const blockedFace = u => ({ ...u, username: BLOCKED_NAME, pfp: null, pfp_url: null, color: null });
// Block / unblock a Velora account, asking first; returns true when it went through
export async function toggleBlock(username, blocked) {
  const ok = await ask(blocked
    ? { title: `Unblock ${username}?`, text: 'They will be able to message you, send you credits and send friend requests again.', confirm: 'Unblock' }
    : { title: `Block ${username}?`, text: "They won't be able to message you, call you, send you credits or friend requests, and your profile will look missing to them. They aren't told.", confirm: 'Block', danger: true });
  if (!ok) return false;
  try {
    await apiFetch(blocked ? `/account/blocks/${encodeURIComponent(username)}` : '/account/blocks', blocked ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ username }) });
    await loadBlocks();
    if (!blocked) loadFriends();
    toast(blocked ? `Unblocked ${username}.` : `Blocked ${username}.`, true);
    return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}

// ── where you are (also in the address: /chat#/s/<sid>/<cid>, #/dm/<name>, #/g/<room>) ──
// #/s/<sid>/<cid> for Velora's own servers, #/i/<instance>/s/<sid>/<cid> and #/i/<instance>/invite/<code> for instances
export function hashFor(v) {
  const at = k => { const p = parseK(k); return p.inst === VELORA ? '' : `#/i/${encodeURIComponent(p.inst)}`; };
  if (v.kind === 'channel') return at(v.sid) ? `${at(v.sid)}/s/${bare(v.sid)}/${bare(v.cid)}` : `#/s/${v.sid}/${v.cid}`;
  if (v.kind === 'server') return at(v.sid) ? `${at(v.sid)}/s/${bare(v.sid)}` : `#/s/${v.sid}`;
  if (v.kind === 'instance') return `#/i/${encodeURIComponent(v.inst)}`;
  if (v.kind === 'invite') return v.inst && v.inst !== VELORA ? `#/i/${encodeURIComponent(v.inst)}/invite/${v.code}` : `#/invite/${v.code}`;
  if (v.kind === 'dm') return `#/dm/${encodeURIComponent(v.username)}`;
  if (v.kind === 'group') return `#/g/${v.room}`;
  if (v.kind === 'modmail') return `#/modmail${v.username ? `/${encodeURIComponent(v.username)}` : ''}`;
  return '#/home';
}
export const linkFor = v => shareLink(hashFor(v));
export function go(v, { replace = false } = {}) {
  const hash = hashFor(v);
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', clientUrl(hash));
  open(v);
}
export function readHash() {
  const parts = location.hash.split('/');
  if (parts[1] === 'i' && parts[2]) {
    let inst = null;
    try { inst = decodeURIComponent(parts[2]); } catch { /* bad */ }
    const [, , , a, b, c] = parts;
    inst = normOrigin(inst); // only a proper, normalised origin is an instance
    if (!inst || inst.includes('|')) return { kind: 'home' };
    if (a === 's' && b) return { kind: c ? 'channel' : 'server', sid: K(inst, b), cid: c ? K(inst, c) : undefined };
    if (a === 'invite' && b) return { kind: 'invite', code: b, inst };
    return a ? { kind: 'home' } : { kind: 'instance', inst };
  }
  const [, a, b, c] = parts;
  if (a === 's' && b) return { kind: c ? 'channel' : 'server', sid: b, cid: c };
  if (a === 'dm' && b) return { kind: 'dm', username: decodeURIComponent(b) };
  if (a === 'g' && b) return { kind: 'group', room: b };
  if (a === 'invite' && b) return { kind: 'invite', code: b };
  if (a === 'modmail') return b ? { kind: 'modmail', username: decodeURIComponent(b) } : { kind: 'modmail' };
  return { kind: 'home' };
}
// where "new messages" start when a conversation opens with unread in it (MessageList scrolls there once)
const jumpPoints = new Map(); // key -> { after: message id } | { count: n }
// go to a message anywhere (search results): open its conversation, load older pages until it's there, flash it
export async function jumpToMessage(v, id) {
  const key = keyOf(v);
  if (keyOf(state.view) !== key) go(v);
  const settle = async () => { for (let i = 0; i < 50 && !(state.msgs[key]?.loaded && !state.msgs[key]?.loading); i++) await new Promise(r => setTimeout(r, 100)); };
  await settle();
  for (let i = 0; i < 20; i++) {
    const b = state.msgs[key];
    if (!b || b.list.some(m => String(m.id) === String(id)) || !b.hasMore) break;
    await loadMessages(v, { older: true });
    await settle();
  }
  setTimeout(() => {
    const el = document.querySelector(`.vc-msg[data-id="${id}"]`);
    if (!el) { toast('That message is gone - it may have been deleted.'); return; }
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
  }, 120);
}
export function takeJump(key) { const j = jumpPoints.get(key); jumpPoints.delete(key); return j || null; }
// the community of an instance I'm in, once its list is loaded: leave the "connecting" box for it
export function resumeInstanceView(origin) {
  const v = state.view;
  if (v.kind !== 'instance' || v.inst !== origin) return;
  const srv = state.servers.find(x => x.inst === origin);
  if (srv && connections.get(origin)?.status === 'open') open(v.then && instOf(v.then.sid || '') === origin ? v.then : { kind: 'server', sid: srv.sid });
}
export async function open(v) {
  // Velora-only places (DMs, groups, modmail, Velora's own servers) need the Velora sign-in
  if (!state.signedIn && (['dm', 'group', 'modmail'].includes(v.kind) || ((v.kind === 'server' || v.kind === 'channel') && !isInst(v.sid)))) { set({ view: { kind: 'home' } }); return; }
  const io = (v.kind === 'server' || v.kind === 'channel') && isInst(v.sid) ? instOf(v.sid) : v.kind === 'instance' ? v.inst : null;
  if (io) {
    const c = connections.get(io);
    if (c) retryInstances(io); // opening a server that isn't connected tries again right away
    if (!c) { // not in my list: an address of one opens the add-a-server box, anything else goes home
      set({ view: { kind: 'home' } });
      if (v.kind === 'instance') dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: io } }));
      return;
    }
    // not connected (yet): the sidebar and channels stay out of it until the instance's socket is up and signed in
    if (v.kind === 'instance' || (c.status !== 'open' && !state.detail[v.sid])) {
      set({ view: v.kind === 'instance' ? v : { kind: 'instance', inst: io, then: v } });
      try { localStorage.setItem('velora_chat_last', location.hash); } catch { /* fine */ }
      resumeInstanceView(io);
      return;
    }
  }
  if (v.kind === 'invite') {
    // stay where you were; the invite shows as a pop-up
    const back = ['channel', 'dm', 'group'].includes(state.view.kind) ? hashFor(state.view) : '#/home';
    history.replaceState(null, '', clientUrl(back));
    dispatchEvent(new CustomEvent('vc-invite', { detail: { code: v.code, inst: v.inst } }));
    if (!state.view.kind || state.view.kind === 'home') set(s => ({ view: s.view }));
    return;
  }
  if (v.kind === 'server') {
    let d = state.detail[v.sid] || await refreshServer(v.sid);
    if (!d) { go({ kind: 'home' }, { replace: true }); return; }
    const cid = state.lastCid[v.sid] && d.channels.some(c => c.cid === state.lastCid[v.sid]) ? state.lastCid[v.sid] : (d.channels.find(c => c.name === 'general') || d.channels[0])?.cid;
    if (cid) go({ kind: 'channel', sid: v.sid, cid }, { replace: true });
    return;
  }
  set(s => ({ view: v, unread: { ...s.unread, [keyOf(v)]: false }, lastCid: v.kind === 'channel' ? { ...s.lastCid, [v.sid]: v.cid } : s.lastCid }));
  try { localStorage.setItem('velora_chat_last', location.hash); } catch { /* fine */ }
  if (v.kind === 'channel') {
    if (!state.detail[v.sid]) await refreshServer(v.sid);
    const ch = state.detail[v.sid]?.channels.find(c => c.cid === v.cid);
    if (ch && (ch.unread || ch.mentions) && ch.last_read_id) jumpPoints.set(keyOf(v), { after: ch.last_read_id });
    clearMentions(v.sid, [v.cid]);
    if (!state.members[v.sid]) loadMembers(v.sid);
    await loadMessages(v);
    const b = state.msgs[keyOf(v)];
    const last = b?.list.filter(x => !x.pending && !x.ephemeral).pop();
    if (last) readChannel(v.cid, last.id);
    // still here? (clicking through channels quickly: a later one is open now, and this one's read is done above)
    if (keyOf(state.view) === keyOf(v)) clearMentions(v.sid, [v.cid]); // pings that came in while the messages loaded
    channelSeen(v.sid, v.cid, last?.id);
  } else if (v.kind === 'dm') {
    if (v.username !== 'System') { wantPresence(v.username); lookup(v.username).catch(() => {}); }
    const n = state.dms.find(c => c.username.toLowerCase() === v.username.toLowerCase())?.unread || 0;
    if (n > 0) jumpPoints.set(keyOf(v), { count: n });
    await loadMessages(v);
    apiFetch(`/im/with/${encodeURIComponent(v.username)}/read`, { method: 'POST' }).catch(() => {});
    set(s => ({ dms: s.dms.map(c => (c.username.toLowerCase() === v.username.toLowerCase() ? { ...c, unread: 0 } : c)) }));
  } else if (v.kind === 'group') {
    await loadMessages(v);
  } else if (v.kind === 'modmail') {
    await loadMessages(v);
    if (!v.username) { apiFetch('/chat/modmail/read', { method: 'POST' }).catch(() => {}); set(s => ({ modmail: { ...s.modmail, unread: 0 } })); }
  }
}

// ── presence (mine) ──
export async function setStatus(status) {
  send({ type: 'set_status', status, persist: true });
  set(s => ({ presence: { ...s.presence, [s.me.username]: { ...(s.presence[s.me.username] || {}), status } } }));
}
export async function setCustom(text) {
  await apiFetch('/chat/presence/custom', { method: 'POST', body: JSON.stringify({ text }) });
  set(s => ({ presence: { ...s.presence, [s.me.username]: { ...(s.presence[s.me.username] || {}), custom: text.trim() || null } } }));
}

// ── little pop-up notes at the bottom ──
let toastT;
export const SCOPE_TEXT = 'This needs a new permission - log in again to use it.';
export const RESTRICTED_TEXT = 'Ember is switched off for your account.';
export function toast(text, ok = false) {
  if (text === SCOPE_TEXT) return; // the "log in again" prompt (PermissionPrompts) already says it
  if (text === RESTRICTED_TEXT) return; // the server's notice (RestrictedBox / RestrictedBar) already says it
  if (state.locked) return; // (the lockout screen is all there is)
  set({ error: text, toastOk: ok });
  clearTimeout(toastT);
  toastT = setTimeout(() => set({ error: null }), 4200);
}
// reply to someone's custom status: can I (server checks bot / own / no status / their DM privacy) and send it
const srCache = new Map();
export function statusReplyInfo(username, custom) {
  const key = `${String(username).toLowerCase()}
${custom}`;
  const hit = srCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = apiFetch(`/im/status-reply/${encodeURIComponent(username)}`).catch(() => ({ can: false, reason: 'error' }));
  srCache.set(key, { at: Date.now(), p });
  return p;
}
export function forgetStatusReply(username) {
  const pre = `${String(username).toLowerCase()}
`;
  [...srCache.keys()].forEach(k => { if (k.startsWith(pre)) srCache.delete(k); });
}
export function startStatusReply(username, text) {
  set({ statusReplyDraft: { username, text } });
  go({ kind: 'dm', username });
  setTimeout(() => dispatchEvent(new CustomEvent('vc-focus-composer')), 60);
}
export function clearStatusReply() { if (state.statusReplyDraft) set({ statusReplyDraft: null }); }
// a DM that didn't go through because of blocking or the other person's DM privacy: one text for both (the server never says which)
export const DM_FAIL_TEXT = 'Failed to send this message due to the users privacy settings';
export const DM_REQUEST_TEXT = 'Your message request was sent. You can message them once they accept.';
export const dmErrorText = code => (code === 'dm_request_sent' ? DM_REQUEST_TEXT : code === 'user_blocked' || code === 'dm_privacy' ? DM_FAIL_TEXT : errorText(code));
export function errorText(code) {
  if (code === 'cannot_dm_persona') return "This account doesn't take DMs.";
  if (code === 'e2ee_locked') return 'Unlock your DMs on this device first.';
  if (code === 'bad_key_list') return "That person's encryption keys don't check out, so nothing was sent. Try again later.";
  if (code === 'server_creation_paused') return `${serverCreationPolicy.title}. ${serverCreationPolicy.notice.join(' ')}`;
  return ({
    operator_terms_required: 'Accept the Ember Server Operator Terms first.', dm_privacy: DM_FAIL_TEXT, user_blocked: "You can't do that with this person - one of you has blocked the other.", cannot_block_self: "You can't block yourself.", cannot_block_staff: "Nookara staff can't be blocked.",
    channel_locked: 'Only admins can post in this channel.', channel_full: 'That voice channel is full.', not_in_server: "They're not in this server.", voice_not_connected: 'Voice is not connected.', need_a_category: 'Every channel has to be in a category.', category_required: 'Pick a category for the channel.', insufficient_balance: "You don't have enough credits for that.", price_changed: 'The price just changed - have another look.', shop_admin_role: "Roles with Administrator can't go in a shop.", bad_link: "That link doesn't look right (it needs https://).", no_webhooks_here: 'Webhooks only work in text and logs channels.', too_many_webhooks: 'A server can have up to 30 webhooks.', not_a_shop: "That channel isn't a roles shop.", purchase_failed: "That didn't go through - you weren't charged.", webhook_not_found: "That webhook doesn't exist any more.", rate_limited: 'Slow down a little!', not_a_member: "You're not in that server.",
    too_many_servers: "You've made as many servers as you can.", too_many_joined: "You're in too many servers.", invalid_invite: "That invite doesn't work.",
    invite_required: 'That server needs an invite.', banned_from_server: "You're banned from that server.", owner_cannot_leave: "You own this server - delete it instead of leaving.",
    storage_limit_exceeded: 'Your Nookara storage is full.', images_only: 'Only pictures (PNG, JPG, GIF, WebP) can be attached.', upload_suspended: 'Uploads are suspended on your account.',
    media_import_failed: "Couldn't download that media. Try downloading it and attaching the file.", invalid_media_url: 'Media links must use HTTPS without login credentials.', upload_failed: "Couldn't upload that file. Please try again.", external_upload_failed: "The file host didn't take that file. Please try again.", file_type_blocked: "That kind of file can't be uploaded.", temp_daily_quota: "You've sent as much to temporary storage as you can today - try again tomorrow, or use your account storage.", temp_storage_full: "Nookara's temporary storage is full right now - try again later, or use your account storage.", pro_required: 'Picking when a temporary file expires comes with Nookara Pro.', invalid_expiry: "That expiry doesn't work - pick another one.", uploads_disabled: 'File uploads are disabled in this server.',
    file_too_large: 'That file exceeds the upload size limit.', dms_friends_only: 'They only take messages from friends.', status_changed: 'Their status changed - take another look.', cannot_reply_own_status: "That's your own status.", cannot_dm_bot: "Bots can't be messaged.", unsupported_file: 'Only pictures, videos (MP4, WebM, MOV) and audio files can be saved.', gifs_not_configured: "GIF search isn't set up yet.", too_many_saved: 'Saved Media is full (500 GIFs).', too_many_emojis: 'This server has as many emojis as it can have (50).', bad_gif: "That GIF can't be saved.", no_send_permission: "You don't have permission to send messages here.", no_attach_permission: "You can't attach files here.", role_too_high: "That role is above your own highest role.", role_not_found: "That role doesn't exist any more.", too_many_roles: 'A server can have up to 100 roles.', user_not_found: "That person doesn't exist.", mailbox_full: 'Their inbox is full.', message_too_long: 'That message is too long.',
    last_channel: "A server needs at least one channel.", not_allowed: "You can't do that here.", owner_only: 'Only the owner can do that.', offline: "You're offline - it wasn't sent.",
    scope_disabled: 'An admin has turned this off for your account.', account_restricted: RESTRICTED_TEXT, insufficient_scope: SCOPE_TEXT, name_required: 'It needs a name.',
    instance_not_linked: "That Minecraft server isn't linked to this Ember server.", already_linked: 'That Minecraft server is already linked.', too_many_instances: 'An Ember server can link up to 10 Minecraft servers.',
    cl_bad_url: 'That CloudLink address needs to start with wss:// (or ws://).', cl_bad_port: 'CloudLink bridges can only use the normal ports (80 / 443).', cl_private_address: "That address is on a private network - Ember can't connect to it.", too_many_cloudlink_bridges: 'A server can have up to 3 CloudLink bridges.', not_a_cloudlink_bridge: "That channel isn't a CloudLink bridge.",
    sign_failed: "Not sent - it couldn't be signed.", bad_signature: "This server turned down the message's signature.",
    voice_unavailable: "Voice isn't set up on this server yet - ask its admins.", voice_cap_reached: 'This server used up its free voice minutes for the month - ask its admins.', sound_too_long: 'Sounds can be up to 5 seconds long.', not_in_voice: 'Join a voice channel first.', too_fast: 'Slow down a little!',
    velora_required: 'Paid roles need a Nookara account - this account only exists on this server.', payment_unavailable: "This server can't take credit payments right now.", not_subscribed: 'Add this server to your Ember list (signed in with Nookara) to pay for roles.', payee_unavailable: "The server owner can't receive credits right now.", too_many_requests: 'You have too many payments waiting - finish or cancel one first.',
    youtube_unavailable: "This server can't play YouTube videos.", invalid_token: "That bot token didn't work.", platform_unreachable: "Couldn't reach that platform - try again in a bit.", owner_not_velora: 'The owner has to be a Nookara account for that.', not_owner: "Nookara says you aren't this server's owner.", not_registered: "This server isn't registered with Nookara yet.", invalid_attestation: "That proof didn't check out - try again.", unknown_instance: "Nookara doesn't know this server yet - register it first.", instance_banned: 'Nookara has blocked this server.', not_connected: "That game server isn't connected any more.", bad_signature: "Your message's signature didn't check out - try again.", signing_unavailable: "Signing isn't available on this instance.", uploads_disabled: 'Uploads are turned off in this server.',
    inst_scope: "This instance login is missing a permission (uploads, voice or signing). Log in to Ember again to approve it.", instance_unreachable: "Couldn't reach that instance.", instance_not_connected: "You're not connected to that instance.", not_an_instance: "That address isn't an Ember instance.", bad_instance_url: "That doesn't look like an address.", invalid_code: "That setup code isn't right.", already_claimed: 'This instance already has an owner.',
    invalid_credentials: 'Wrong username or password.', invalid_username: 'Usernames are 2-32 letters, numbers, _ or .', invalid_password: 'Passwords are 8-200 characters.', username_taken: 'That username is taken.', registration_closed: 'This instance is closed for new accounts.', velora_unreachable: "The instance couldn't reach Nookara.", wrong_accounts_mode: "That doesn't work in this instance's account mode.", request_not_found: 'That request is gone.', server_full: 'That server is full.', invalid_join_policy: "That isn't a join setting.", invalid_upload_max_mb: 'Upload size must be 1-500 MB.', cannot_remove_owner: "The owner can't be removed.", mixed_instances: "That mixes two instances' servers.", not_on_instances: "That isn't something instances do.", invalid_export: "That isn't an Ember export.", payload_too_large: 'That is too big.', server_not_found: 'That server is gone.', banned: "You're banned from this instance.",
    console_needs_bonfire: 'Commands can only be run from Ember itself.', bad_purpose: 'Pick what the channel is for.', not_linked: "That server isn't linked any more.", claim_not_found: 'That code is gone - get a new one.',
    plan_feature: "Not included in this server's plan - upgrade the plan or self-host to get it.", plan_limit: "This server's plan limit is reached - upgrade the plan or self-host for more.", member_cap_reached: "This server is full for its plan.", read_only: 'This server is read-only right now.',
    password_required: 'This server needs a password to join.', wrong_password: "That password isn't right.", invite_only: 'This server only lets people in with an invite link.', not_on_allowlist: "You're not on this server's list of people who can join.", server_full: 'This server is full.',
    bot_offline: "That bot isn't online right now.", unknown_command: "That command isn't available here (any more).", unknown_component: "That button doesn't work any more.", unknown_interaction: 'That form expired - run the command again.',
    timed_out: "You're timed out here for now - try again later.", automod_blocked: "AutoMod blocked that message: it has a word this server doesn't allow.", slow_down: "You're sending messages too fast - wait a moment.",
    upload_rate_limited: "You're uploading too fast - wait a minute.", upload_quota: "You've stored as many files as this server lets each member keep. Delete some first.", file_type_not_allowed: "This server doesn't take that kind of file.", storage_full: "This server's storage is full.", image_too_large: 'That picture is too big to process.',
    instance_admin_only: 'Only the instance admins can change that setting.', join_password_required: 'Set a password first.', invalid_join_password: 'Passwords are 4-200 characters.', cannot_report_yourself: "You can't report yourself.", nothing_to_report: 'Pick a message or a member to report.', report_not_found: "That report doesn't exist any more.",
    invalid_allowlist: 'Allowlist names are up to 64 letters, numbers, _ . : or -.', invalid_max_members: 'Pick a member limit from 1 up.', invalid_roles: "One of those roles doesn't exist any more.", invalid_max_length: 'Pick a message length from 1 to 4000.', invalid_search_results: 'Pick 1 to 100 search results.', invalid_max_reactions: 'Pick 1 to 50 reactions.',
    invalid_preview_proxy: 'The preview proxy needs an http:// or https:// address.', invalid_words: 'Blocked words are up to 64 characters (1000 at most).', invalid_word_file: 'The word list file has to be inside the server\'s data folder.', invalid_timeout: 'Timeouts are 0 seconds to 28 days.', invalid_spam_limits: "Those spam limits don't look right.",
    invalid_retention: 'Keep entries for 1 to 3650 days.', invalid_uploads_per_minute: 'Pick 1 to 600 uploads a minute.', invalid_files_per_member: 'Pick how many files each member can keep (1 up).', invalid_file_types: 'Pick at least one kind of file.', invalid_expire_days: 'Files expire after 1 to 3650 days.', invalid_plans: 'Plan names are letters, numbers, _ or -.', invalid_storage_mb: 'Pick a storage limit from 1 MB up.', invalid_image_size: "Those picture sizes don't look right.", invalid_jpeg_quality: 'JPEG quality is 1 to 100.', local_admin_required: 'Make a local admin account first, or you could lock yourself out.',
  })[code] || 'Something went wrong.';
}

export async function loadSettings() {
  const d = await apiFetch('/chat/settings').catch(() => null);
  if (!d) return;
  // the account's upload destination is the real one; this device's copy follows it (it only counts while the account
  // can't say, e.g. before the settings load or on a Velora that doesn't have the setting)
  const dest = d.settings?.dm_upload_dest;
  if (dest !== undefined) { try { if (dest === 'account' || dest === 'temp') localStorage.setItem(DEST_KEY, dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  set({ settings: d.settings, settingsFromServer: dest !== undefined });
}
export async function saveSettings(patch) {
  set(s => ({ settings: { ...s.settings, ...patch } }));
  if (patch.dm_upload_dest !== undefined) { try { if (patch.dm_upload_dest === 'account' || patch.dm_upload_dest === 'temp') localStorage.setItem(DEST_KEY, patch.dm_upload_dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  const d = await apiFetch('/chat/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  set({ settings: d.settings });
  return d.settings;
}
// "Remove tracking from links": asked the first time a link with tracking junk is pasted / sent. Resolves true / false
// (the answer is saved as chat setting strip_tracking, so it is only ever asked once); closing the box counts as No.
let stripAsking = null;
export function askStripTracking() {
  const cur = state.settings.strip_tracking;
  if (cur === true || cur === false) return Promise.resolve(cur);
  if (stripAsking) return stripAsking;
  stripAsking = ask({
    title: 'Remove tracking from links?',
    text: 'This link has tracking junk in it (like ?si=). Want Ember to automatically remove tracking from links you paste? You can change this later in Settings.',
    confirm: 'Yes', cancel: 'No',
  }).then(yes => {
    stripAsking = null;
    saveSettings({ strip_tracking: !!yes }).catch(() => {});
    return !!yes;
  });
  return stripAsking;
}
// a link to somewhere in Ember: go there (or open the invite) without leaving the page
export function openLink(hash) {
  history.pushState(null, '', clientUrl(hash));
  open(readHash());
}

// ── Velora notifications (the bell next to your name; they replaced the DMs from "System") ──
// GET /account/notifications(?unread=1) + /unread-count, POST /account/notifications/read; live over the home socket as
// notification_new / notifications_updated. The popup only ever lists unread ones: the full history is /me#notifications.
const notifKey = id => String(id);
const byNewest = (a, b) => (Number(b.id) - Number(a.id)) || (new Date(b.created_at) - new Date(a.created_at));
export const notifPlain = t => String(t || '').replace(/\*\*/g, '');
export async function loadNotifCount() {
  const d = await apiFetch('/account/notifications/unread-count').catch(() => null);
  if (typeof d?.unread === 'number') set({ notifUnread: d.unread });
}
// the popup opened (more = "Load more" with the cursor); anything that arrived live while loading is kept
export async function loadNotifs({ more = false } = {}) {
  const cur = state.notifs;
  if (cur?.loading || (more && !cur?.cursor)) return;
  set(s => ({ notifs: { list: [], cursor: null, ...(s.notifs || {}), loading: true, error: false } }));
  try {
    const d = await apiFetch(`/account/notifications?unread=1&limit=20${more ? `&cursor=${encodeURIComponent(cur.cursor)}` : ''}`);
    set(s => {
      if (!s.notifs) return {}; // closed meanwhile
      const seen = new Set(s.notifs.list.map(n => notifKey(n.id)));
      const list = [...s.notifs.list, ...(d.notifications || []).filter(n => !n.read && !seen.has(notifKey(n.id)))].sort(byNewest);
      return { notifs: { list, cursor: d.next_cursor ?? null, loading: false, error: false }, notifUnread: typeof d.unread === 'number' ? d.unread : s.notifUnread };
    });
  } catch { set(s => (s.notifs ? { notifs: { ...s.notifs, loading: false, error: true } } : {})); }
}
export const closeNotifs = () => set({ notifs: null });
// ids = [id, ...] or 'all': gone from the popup straight away, the server's count wins after
export async function readNotifs(ids) {
  const all = ids === 'all';
  const drop = new Set(all ? [] : ids.map(notifKey));
  set(s => ({ notifs: s.notifs && { ...s.notifs, list: all ? [] : s.notifs.list.filter(n => !drop.has(notifKey(n.id))) }, notifUnread: all ? 0 : Math.max(0, s.notifUnread - drop.size) }));
  try {
    const d = await apiFetch('/account/notifications/read', { method: 'POST', body: JSON.stringify(all ? { all: true } : { ids }) });
    if (typeof d?.unread === 'number') set({ notifUnread: d.unread });
  } catch { loadNotifCount(); }
}
// a notification's link: /chat#... stays in Ember, anything else opens in the browser
export function followNotifLink(link) {
  const l = typeof link === 'string' ? link.trim() : '';
  if (!l) return;
  if (l.startsWith('/chat#')) { openLink(l.slice(5)); return; }
  const url = notifLinkUrl(l);
  if (!url) return;
  const d = window.bonfireDesktop;
  if (d?.openExternal) Promise.resolve(d.openExternal(url)).catch(() => {});
  else window.open(url, '_blank', 'noopener,noreferrer');
}
function notificationNew(m) {
  const n = m.notification;
  if (!n || n.id == null) return;
  set(s => ({
    notifUnread: typeof m.unread === 'number' ? m.unread : s.notifUnread + (n.read ? 0 : 1),
    notifs: s.notifs && !n.read && !s.notifs.list.some(x => notifKey(x.id) === notifKey(n.id)) ? { ...s.notifs, list: [n, ...s.notifs.list].sort(byNewest) } : s.notifs,
  }));
  if (!n.read) notifPing(n);
}
function notificationsUpdated(m) {
  const read = m.read === 'all' ? 'all' : new Set((m.read || []).map(notifKey));
  const gone = new Set((m.deleted || []).map(notifKey));
  const stillUnread = new Set((m.unread_ids || []).map(notifKey));
  set(s => {
    const patch = typeof m.unread === 'number' ? { notifUnread: m.unread } : {};
    if (!s.notifs) return patch;
    const list = s.notifs.list.filter(n => { const k = notifKey(n.id); return !gone.has(k) && (stillUnread.has(k) || (read === 'all' ? false : !read.has(k))); });
    return { ...patch, notifs: { ...s.notifs, list } };
  });
  // something became unread again that the open popup doesn't have: fetch the list again
  if (state.notifs && [...stillUnread].some(k => !state.notifs.list.some(n => notifKey(n.id) === k))) { set(s => ({ notifs: s.notifs && { ...s.notifs, list: [], cursor: null } })); loadNotifs(); }
}
// a new one: the DM sound, and a system notification while Ember is in the background (same rules as a DM: not in
// Do Not Disturb, not with Notifications set to "Nothing"). The desktop app's own notify() only knows DMs and calls, so this
// uses the web Notification API there too, behind the app's "notifications" switch.
function notifPing(n) {
  if (state.presence[state.me?.username]?.status === 'dnd') return;
  if (packActive()) { if (state.settings.sounds) playPackSound('receive'); } else playSound('message');
  if (pageFocused() || state.settings.notifications === 'none') return;
  const show = () => {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const note = new Notification(notifPlain(n.title) || 'Nookara', { body: notifPlain(n.body).slice(0, 140), icon: n.actor?.pfp_url || '/assets/icon.png', tag: `notif${n.id}` });
      note.onclick = () => {
        try { window.focus(); } catch { /* fine */ }
        note.close();
        readNotifs([n.id]);
        followNotifLink(n.link);
      };
    } catch { /* no notifications */ }
  };
  const d = window.bonfireDesktop;
  if (d?.isDesktop && d.notificationStatus) d.notificationStatus().then(st => { if (st?.enabled) show(); }).catch(() => {});
  else show();
}

// Velora's token is no good any more (web Ember): start over signed out, with a note about it
export function authLost() {
  if (!isWebBonfire() || authLost.done) return;
  authLost.done = true;
  endSession('ended');
}
onAuthLost(authLost);
// what the signed-in account holds (on start, and again when a lockout is lifted)
function loadAccount() { loadServers(); loadDMs(); loadGroups(); loadFriends(); loadBlocks(); loadModmail(); loadMedia(); loadNotifCount(); }

// ── lockout: staff switched Ember and DMs off for the account (users.disabled_scopes), or Nookara's birthday gate did ──
// (no birthday set yet, or under the minimum age for their region: the same bits, told apart by restriction_reason, so the
// notice can say "set your birthday" with a link to the account settings instead of "switched off by staff")
// The "Ember and DMs" switch sets 2048 (Ember and group chat) with 64 | 128 (DMs); any of them locks, so it works before and
// after Nookara merged the two switches. Locked, the app is one calm notice (Gate.jsx LockedScreen): the instances are held
// (no connects, no retries), events are dropped and nothing toasts. The Nookara socket stays up - its `restrictions` push
// (or an instance's account_restored) is how it comes back, without a reload. Nookara's own word (/bonfire/session,
// auth_success, `restrictions`, a 403 scope_disabled) settles it; an instance's account_restricted locks at once and is
// then checked with Nookara - if Nookara says it's on, only that server keeps its per-server notice (InstanceGate).
export const LOCK_BITS = 64 | 128 | 2048;
const LOCK_KEY = () => acctKey('bonfire_locked');
function lockAccount() {
  if (state.locked) return;
  set({ locked: true, error: null, scopePrompt: null, permUpdate: null });
  clearTimeout(toastT);
  try { localStorage.setItem(LOCK_KEY(), state.lockReason || '1'); } catch { /* fine */ }
  voiceHook?.({ type: 'voice_closed' }); // (a DM call or voice channel is over)
  holdInstances(true);
}
function unlockAccount() {
  if (!state.locked) return;
  set({ locked: false });
  try { localStorage.removeItem(LOCK_KEY()); } catch { /* fine */ }
  holdInstances(false);
  if (!state.signedIn) return;
  if (sock && sock.readyState === 1) send({ type: 'chat_hello' }); else { retry = 0; connect(); } // (chat_ready catches up on what was dropped)
  loadAccount();
}
const LOCK_REASONS = ['staff', 'birthday_required', 'under_minimum_age'];
export function applyDisabled(disabled, reason) {
  const locked = !!((Number(disabled) || 0) & LOCK_BITS);
  const why = locked ? (LOCK_REASONS.includes(reason) ? reason : 'staff') : null; // (older Nookara: no reason = staff)
  if (state.lockReason !== why) {
    set({ lockReason: why });
    if (locked && state.locked) { try { localStorage.setItem(LOCK_KEY(), why); } catch { /* fine */ } } // (already locked: the reason changed)
  }
  if (locked) lockAccount(); else unlockAccount();
}
// an instance said account_restricted / account_restored: lock now (restriction is account-wide), and ask Nookara
let lockCheck = null;
const askNookara = () => (lockCheck ||= apiFetch('/bonfire/session').then(d => { if (d?.disabled !== undefined) applyDisabled(d.disabled, d.restriction_reason); }).catch(() => {}).finally(() => { lockCheck = null; }));
export function instanceRestricted() {
  if (!state.signedIn) return; // (signed out: only that server's own notice)
  lockAccount();
  askNookara();
}
export function instanceRestored() { if (state.locked) askNookara(); }

// me = null: signed out of Velora (web Ember without a token) - only local-account instances work then
export function init(me) {
  set({ me, signedIn: !!me });
  if (me) { try { const was = localStorage.getItem(LOCK_KEY()); if (was) { if (LOCK_REASONS.includes(was)) set({ lockReason: was }); lockAccount(); } } catch { /* fine */ } } // (locked last time: no flash of the app before /bonfire/session answers)
  window.bonfireDesktop?.onSignIn?.(s => set({ reauth: s.state === 'failed' ? { state: 'failed', error: s.error } : { state: 'working' } }));
  if (me) { checkPermissions(); loadSettings(); loadNotify(); loadEmojis(); connect(); }
  window.bonfireDesktop?.isFocused?.().then(v => { desktopFocused = !!v; }).catch(() => {});
  window.bonfireDesktop?.onWindowFocus?.(v => { desktopFocused = v; if (v) markViewRead(); });
  startInstances(); // (held while locked: nothing connects until it's lifted)
  if (me) setupSigning();
  if (me && !state.locked) loadAccount();
  try { if (me && Notification.permission === 'default') setTimeout(() => Notification.requestPermission().catch(() => {}), 8000); } catch { /* fine */ }
  window.addEventListener('popstate', () => open(readHash()));
  const markFocusedViewRead = () => {
    if (pageFocused()) markViewRead();
  };
  document.addEventListener('visibilitychange', markFocusedViewRead);
  window.addEventListener('focus', markFocusedViewRead);
  // settings saved from My Account > Chat (or another tab/device) apply live
  window.addEventListener('vc-settings', e => {
    if (!e.detail) return;
    set({ settings: e.detail, ...(e.detail.dm_upload_dest !== undefined ? { settingsFromServer: true } : {}) });
    const dest = e.detail.dm_upload_dest; // (this device's copy of the upload destination follows the account)
    if (dest !== undefined) { try { if (dest === 'account' || dest === 'temp') localStorage.setItem(DEST_KEY, dest); else localStorage.removeItem(DEST_KEY); } catch { /* private mode */ } }
  });
  let settingsAt = Date.now();
  const refreshSettings = () => { if (document.visibilityState !== 'visible' || Date.now() - settingsAt < 30000) return; settingsAt = Date.now(); loadSettings(); };
  document.addEventListener('visibilitychange', refreshSettings);
  window.addEventListener('focus', refreshSettings);
  // Interaction refreshes the ten-minute active period.  The 30-second rate
  // limit in noteBonfireActivity makes pointer movement inexpensive.
  const reportBonfireActivity = () => {
    if (document.visibilityState === 'visible' && pageFocused()) noteBonfireActivity();
  };
  ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart'].forEach(type => window.addEventListener(type, reportBonfireActivity, { passive: true, capture: true }));
  reportBonfireActivity();
  window.bonfireDesktop?.onNotificationAction?.(action => {
    if (!action || !onceDesktopAction(action)) return;
    if (action?.type === 'dm') {
      const username = String(action.to || '');
      if (!username) return;
      go({ kind: 'dm', username });
      if (action.action === 'reply' && String(action.text || '').trim()) sendMessage({ kind: 'dm', username }, String(action.text).trim());
    } else if (action?.type === 'call') {
      dispatchEvent(new CustomEvent('bonfire:notification-action', { detail: action }));
    }
  });
}

// ── permissions: the apps sign in with a scoped token (Velora's approve-this-app screen) ──
// /bonfire/scopes.json = what Ember asks for (versioned, one list on the server); /bonfire/session = which of those
// THIS token is missing. Website sessions have everything, so only the apps ever see these prompts.
//  - permUpdate: "New permission updates" dialog (on start / page load, when a required permission is missing)
//  - scopePrompt: a feature was refused for a missing permission ("This needs a new permission - log in again")
let scopeCatalog = null;
const getCatalog = () => (scopeCatalog ||= fetch('/bonfire/scopes.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ scopes: [] })));
let scopeAt = 0;
function markLack(id, how) {
  if (!id || state.scopeLack?.[id] === how) return;
  set(s => ({ scopeLack: { ...(s.scopeLack || {}), [id]: how } }));
}
export async function scopeDenied(info) {
  const bit = Number(info?.required_scope) || 0;
  const byAdmin = !!info?.disabled_by_admin || info?.error === 'scope_disabled';
  // remember it, so the control greys out from now on (the up-front check below normally already did)
  if (bit) getCatalog().then(cat => markLack((cat.scopes || []).find(x => x.bit === bit)?.id, byAdmin ? 'disabled' : 'missing'));
  if (byAdmin && bit & LOCK_BITS) { if (LOCK_REASONS.includes(info?.reason) && state.lockReason !== info.reason) set({ lockReason: info.reason }); lockAccount(); } // Ember or DMs switched off: the whole app locks
  if (byAdmin) return; // an admin switched it off: logging in again won't change that
  if (Date.now() - scopeAt < 6000) return; // one prompt, not one per refused request
  scopeAt = Date.now();
  const cat = await getCatalog();
  const sc = (cat.scopes || []).find(x => x.bit === bit);
  set({ scopePrompt: { name: sc?.name || null, reason: sc?.reason || '' } });
}
// What THIS login can do, known up front: '' = fine (website sessions always), 'missing' = log in again to approve it,
// 'disabled' = an admin turned it off for the account. Both return primitives, so they are stable selectors.
export function useScopeStatus(id) { return useChat(s => s.scopeLack?.[id] || ''); }
export function useScope(id) { return useChat(s => !s.scopeLack?.[id]); }
export function scopeTip(status, what) {
  if (!status) return undefined;
  return status === 'disabled' ? 'An admin turned this off for your account.' : `${what || 'This'} needs a new permission. Click to log in again.`;
}
// click handler for a locked control: shows the "needs a new permission" prompt (no 6 s debounce, the user asked for it)
export async function scopeBlocked(id) {
  const lack = state.scopeLack?.[id];
  if (!lack) return false;
  if (lack === 'disabled') { toast('An admin turned this off for your account.'); return true; }
  const cat = await getCatalog();
  const sc = (cat.scopes || []).find(x => x.id === id);
  scopeAt = Date.now();
  set({ scopePrompt: { name: sc?.name || null, reason: sc?.reason || '' } });
  return true;
}
onScopeError(scopeDenied);
// raw fetch() uploads (avatars, emojis, files...) don't go through apiFetch: watch their answers too
if (typeof window !== 'undefined' && !window.__bfScopeWatch) {
  window.__bfScopeWatch = true;
  const real = window.fetch.bind(window);
  window.fetch = (...a) => real(...a).then(r => {
    if (r.status === 403) r.clone().json().then(d => { if (d?.error === 'insufficient_scope' || d?.error === 'scope_disabled') scopeDenied(d); }).catch(() => {});
    return r;
  });
}
// after "Log in again" the page reloads with the new token: sign the old app token out, and keep the saved-accounts list pointing at the new one
async function afterReauth() {
  let prev = null;
  try { prev = localStorage.getItem('bf_prev_token'); localStorage.removeItem('bf_prev_token'); } catch { /* fine */ }
  const cur = getToken();
  if (!prev || !cur || prev === cur) return;
  try { // the saved-accounts list: the website's velora_saved, or web Ember's own bonfire_saved
    const key = isWebBonfire() ? 'bonfire_saved' : 'velora_saved';
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved) && saved.some(a => a && a.token === prev)) localStorage.setItem(key, JSON.stringify(saved.map(a => (a && a.token === prev ? { ...a, token: cur } : a))));
  } catch { /* fine */ }
  await apiFetch('/bonfire/replace-token', { method: 'POST', body: JSON.stringify({ old: prev }) }).catch(() => {});
}
export async function checkPermissions() {
  try {
    await afterReauth();
    const d = await apiFetch('/bonfire/session');
    if (d?.disabled !== undefined) applyDisabled(d.disabled, d.restriction_reason); // (website sessions too: the lockout is the account's, not the token's)
    if (!d?.app) { set({ permUpdate: null, scopeLack: null }); return; }
    try { // which scopes this token lacks (granted) or an admin switched off (disabled), by id
      const cat = await getCatalog();
      const lack = {};
      for (const sc of cat.scopes || []) {
        if (((Number(d.disabled) || 0) & sc.bit) === sc.bit) lack[sc.id] = 'disabled';
        else if (((Number(d.granted) || 0) & sc.bit) !== sc.bit) lack[sc.id] = 'missing';
      }
      if (JSON.stringify(lack) !== JSON.stringify(state.scopeLack || {})) set({ scopeLack: Object.keys(lack).length ? lack : null });
    } catch { /* fine */ }
    const missing = d.missing || [];
    let later = false;
    try { later = sessionStorage.getItem('bf_perm_later') === `${d.version}:${missing.map(x => x.id).join(',')}`; } catch { /* fine */ }
    set({ permUpdate: missing.length && !later ? { version: d.version, legacy: !!d.legacy, missing } : null });
  } catch { /* offline / old server: nothing to ask */ }
}
export function permLater() {
  const p = state.permUpdate;
  if (p) { try { sessionStorage.setItem('bf_perm_later', `${p.version}:${p.missing.map(x => x.id).join(',')}`); } catch { /* fine */ } }
  set({ permUpdate: null });
}
export function dismissScopePrompt() { set({ scopePrompt: null }); }
// "Log in again": the apps open Velora's approve-this-app page in the browser; the old login keeps working until the new one is approved
export function loginAgain() {
  try { const t = getToken(); if (t) localStorage.setItem('bf_prev_token', t); } catch { /* fine */ }
  set({ permUpdate: null, scopePrompt: null, reauth: { state: 'waiting' } });
  if (window.bonfireDesktop?.signIn) { window.bonfireDesktop.signIn(); return; }
  if (isWebBonfire()) { startSignIn(); return; } // the web has its own sign-in (a token of its own, not the website's session)
  location.href = '/login?next=%2Fchat'; // (apps only) the Android app turns this into its own browser sign-in screen
}
export function clearReauth() { set({ reauth: null }); }

// in-app "are you sure?" (instead of the browser's confirm / prompt):
//   await ask({ title, text, confirm: 'Delete', danger: true, match: 'type this to confirm' }) -> true / false
export function ask(opts) {
  if (state.ask) state.ask.resolve(false);
  return new Promise(resolve => set({ ask: { ...opts, resolve } }));
}
export function answerAsk(v) {
  const a = state.ask;
  if (!a) return;
  set({ ask: null });
  a.resolve(v);
}

// ── right-click menus ──
export function setMenu(m) { set({ menu: m }); }

// ── per channel / server notification settings ──
export async function loadNotify() {
  const d = await apiFetch('/chat/notify').catch(() => null);
  if (d) set(s => ({ notify: { ...Object.fromEntries(Object.entries(s.notify).filter(([k]) => isInst(k))), ...d.notify } }));
}
export function notifyOf(target) { return state.notify[target] || { level: null, muted_until: null, push: true }; }
export async function setNotify(target, patch) {
  try {
    const d = await apiFetch(`/chat/notify/${target}`, { method: 'PUT', body: JSON.stringify(patch) });
    set(s => ({ notify: { ...s.notify, [target]: d.notify } }));
    if (patch.mute_minutes !== undefined) toast(patch.mute_minutes === 0 ? 'Unmuted.' : 'Muted.', true);
  } catch (e) { toast(errorText(e.message)); }
}
// the channel's setting, else its server's, else "only @mentions"
export function effectiveNotify(cid, sid) {
  const now = Date.now();
  const ch = state.notify[cid] || {}, sv = state.notify[sid] || {};
  const muted = !!((ch.muted_until && ch.muted_until > now) || (sv.muted_until && sv.muted_until > now));
  const level = ch.level && ch.level !== 'default' ? ch.level : (sv.level && sv.level !== 'default' ? sv.level : 'mentions');
  return { muted, level };
}
export function isMuted(target) { const n = state.notify[target]; return !!(n?.muted_until && n.muted_until > Date.now()); }
export function clearMentions(sid, cids) {
  set(s => {
    const mentions = { ...s.mentions };
    let live = s.srvMentions[sid] || 0, fromServer = 0;
    cids.forEach(cid => { live -= mentions[cid] || 0; delete mentions[cid]; fromServer += s.detail[sid]?.channels.find(c => c.cid === cid)?.mentions || 0; });
    const dd = s.detail[sid];
    const channels = dd ? dd.channels.map(c => (cids.includes(c.cid) ? { ...c, mentions: 0 } : c)) : null;
    // with the server's channels loaded, its badge = what's left on its channels (a stale count can't get stuck)
    if (channels) {
      live = channels.reduce((n, c) => n + (mentions[c.cid] || 0), 0);
      const left = channels.reduce((n, c) => n + (c.mentions || 0), 0);
      return {
        mentions,
        srvMentions: { ...s.srvMentions, [sid]: live },
        servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: left } : x)),
        detail: { ...s.detail, [sid]: { ...dd, channels } },
      };
    }
    return {
      mentions,
      srvMentions: { ...s.srvMentions, [sid]: Math.max(0, live) },
      servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: Math.max(0, (x.mentions || 0) - fromServer) } : x)),
    };
  });
}
// a new sidebar layout, drawn straight away (Manage channels drag and drop)
export function setDetailLayout(sid, categories, order) {
  set(s => {
    const d = s.detail[sid];
    if (!d) return {};
    let channels = d.channels;
    if (order) channels = order.map((c, i) => ({ ...(d.channels.find(x => x.cid === c.cid) || c), category: c.category || '', position: i }));
    else channels = channels.map(c => (c.category && !categories.includes(c.category) ? { ...c, category: '' } : c));
    return { detail: { ...s.detail, [sid]: { ...d, categories, channels } } };
  });
}
export async function markChannelRead(cid, sid) {
  clearMentions(sid, [cid]);
  const d = state.detail[sid];
  const c = d?.channels.find(x => x.cid === cid);
  await apiFetch(`/chat/channels/${cid}/read`, { method: 'POST', body: JSON.stringify({ id: c?.last_message_id }) }).catch(() => {});
  channelSeen(sid, cid);
}
export async function markServerRead(sid) {
  const d = state.detail[sid] || await refreshServer(sid);
  if (!d) return;
  clearMentions(sid, d.channels.map(c => c.cid));
  set(s => ({ servers: s.servers.map(x => (x.sid === sid ? { ...x, mentions: 0 } : x)) }));
  await Promise.all(d.channels.filter(c => c.unread || state.unread[`c:${c.cid}`]).map(c => apiFetch(`/chat/channels/${c.cid}/read`, { method: 'POST', body: JSON.stringify({ id: c.last_message_id }) }).catch(() => {})));
  set(s => {
    const unread = { ...s.unread };
    d.channels.forEach(c => { unread[`c:${c.cid}`] = false; });
    const dd = s.detail[sid];
    const unreadN = Object.fromEntries(Object.entries(s.unreadN).filter(([, u]) => u.sid !== sid));
    return { unread, unreadN, servers: s.servers.map(x => (x.sid === sid ? { ...x, unread: false, unread_count: 0 } : x)), detail: dd ? { ...s.detail, [sid]: { ...dd, channels: dd.channels.map(c => ({ ...c, unread: false, unread_count: 0 })) } } : s.detail };
  });
}
