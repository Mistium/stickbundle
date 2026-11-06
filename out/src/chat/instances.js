// Ember instances (bonfire-server): one connection per instance next to the Velora "home" socket. An instance is one
// community, so each connection is one icon on the rail.
// connections: origin -> { origin, info (/.well-known/bonfire), session, user, ws, conn, retry, acks, isAdmin, isOwner }
// Velora mode: Velora signs a short instance token, the instance trades it for a session. Local mode: username + password.
// Sessions live in localStorage['bonfire_instance_sessions']. The list of instances is always kept locally; signed in
// with Velora it is merged with (and saved to) /bonfire/instances.
import { apiFetch, getToken } from '../api.js';
import { K, acctKey, registry, hooks, normOrigin, instOf, loadSessions, loadSessionTags, tokenTag, saveSession, fromInstance, parseK } from './ids.js';
import { getState, patchState, toast, handleEvent, RESTRICTED_TEXT, instanceVoiceClosed, loadEmojis, go, catchUp, resumeInstanceView, backoff, instanceRestricted, instanceRestored } from './store.js';

export const connections = new Map();
const LIST_CACHE = () => acctKey('bonfire_instance_list'); // (per account: an alt must not inherit the main's servers)

const rawOrigin = u => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; } };
export const hostOf = o => { try { return new URL(o).host; } catch { return String(o).replace(/^https?:\/\//, ''); } };
export const instView = c => ({
  origin: c.origin, host: hostOf(c.origin), name: c.info?.name || hostOf(c.origin), icon: c.info?.icon_url || null, description: c.info?.description || '',
  community: c.info?.community || null, mode: c.info?.accounts_mode || null, status: c.status, claimed: c.info?.claimed !== false, features: c.info?.features || {},
  registration: c.info?.registration || 'closed', isAdmin: !!c.isAdmin, isOwner: !!c.isOwner, user: c.user || null, error: c.error || null, restricted: c.restricted || null,
  needsVelora: c.info?.accounts_mode === 'velora' && !getToken(), pending: !!c.pending, failed: !!c.failed,
  loaded: !!c.loaded, // this account's communities on it have been fetched (so "not in it" is known)
  prefs: c.prefs || null, // Velora's push consent for it ({ muted, push }), signed in only
  retryAt: c.retryAt || 0, // not connected: when the next try is (it never gives up)
  voiceQuota: c.voiceQuota || null, // its admins: this month's voice minutes from Velora { cap_minutes, used_minutes } (cap null = no cap)
  serverInfo: c.isAdmin ? (c.serverInfo || null) : null, // its admins: /instance/info (build, runtime, stats, update)
  managed: c.info?.managed || null, // hosted by Velora: { plan, limits, host }
  readOnly: !!(c.info?.read_only || c.info?.community?.read_only), // hosted by Velora and its paid time ran out
  // addresses it had before (old signatures name them): exact origins, NOT normOrigin (that reads e_<x> as e-<x>, but a message signed
  // while the server was e_<x>.nookara.cc names e_<x>)
  previousUrls: Array.isArray(c.info?.previous_urls) ? c.info.previous_urls.map(rawOrigin).filter(Boolean) : [],

});
const mirror = () => patchState({ instances: [...connections.values()].map(instView) });
function setStatus(c, status, error = null) {
  if (c.restricted && ['connecting', 'closed', 'error'].includes(status)) return mirror(); // Ember is switched off for this account: the notice stays until the server says otherwise
  c.status = status; c.error = error; mirror();
}
// Staff switched Ember off for this account (account_restricted, from the gateway, a REST 403 or Nookara refusing the instance token):
// the server's view becomes a calm notice, voice is over, and nothing retries quickly - a socket that is still open hears account_restored
const RESTRICTED_RETRY = 120000;
function restrict(c, message) {
  if (!connections.has(c.origin)) return;
  const text = typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : RESTRICTED_TEXT;
  if (c.restricted === text && c.status === 'restricted') return;
  c.restricted = text;
  clearTimeout(c.timer); c.retry = 0; c.retryAt = 0; c.failed = false;
  instanceVoiceClosed(c.origin);
  const v = getState().view;
  const here = (v.sid && instOf(v.sid) === c.origin) || v.inst === c.origin;
  setStatus(c, 'restricted');
  if (here && v.kind !== 'instance') go({ kind: 'instance', inst: c.origin, then: v.sid ? { kind: 'server', sid: v.sid } : undefined }, { replace: true });
  instanceRestricted(); // (account-wide: the whole app locks, store.js checks with Nookara)
}
// The whole account is locked (store.js lockAccount): nothing connects or retries. Open sockets stay up but quiet (their
// events are dropped) so a restricted one can still say account_restored. Lifted: the open ones say hello again (chat_ready
// reloads what was missed), the rest connect; one that still says restricted keeps its own notice until it says restored.
let held = false;
export function holdInstances(on) {
  held = !!on;
  for (const c of connections.values()) {
    clearTimeout(c.timer); c.retryAt = 0;
    if (held) { instanceVoiceClosed(c.origin); continue; }
    c.retry = 0;
    if (c.restricted) { if (!c.ws) scheduleRetry(c, RESTRICTED_RETRY); continue; } // (as before the lockout: slow tries)
    if (c.ws?.readyState === 1) { setStatus(c, 'connecting'); sendTo(c.origin, { type: 'chat_hello' }); } else if (!c.ws) connect(c.origin);
  }
  mirror();
}
hooks.restricted = (origin, message) => { const c = connections.get(origin); if (c) restrict(c, message); };
const restrictedErr = e => e?.status === 403 && ['account_restricted', 'scope_disabled'].includes(e.error);

// ── talking to an instance without a session (discovery, login) ──
async function plain(origin, path, body, method = 'POST') {
  let res;
  try { res = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Object.assign(new Error('instance_unreachable'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, ...data });
  return data;
}
// what an address is: the instance's public face, or why it isn't one.
// A Nookara-hosted server that moved (e-<name>.nookara.cc; before that e_<name>, <name>-bonfire.ikelene.net) redirects its old address for two weeks: then the answer is the new
// origin plus movedFrom, and callers keep the new one (the server says the same in public_url).
export async function discover(input) {
  const origin = normOrigin(input);
  if (!origin) throw new Error('bad_instance_url');
  let res;
  try { res = await fetch(`${origin}/.well-known/bonfire`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); } catch { throw new Error('instance_unreachable'); }
  const info = await res.json().catch(() => null);
  if (!res.ok || info?.software !== 'bonfire-server' || !info.accounts_mode) throw new Error('not_an_instance');
  const landed = res.redirected ? normOrigin(res.url) : null;
  const moved = landed && landed !== origin && normOrigin(info.public_url) === landed ? landed : null;
  if (moved) return { origin: moved, movedFrom: origin, info: fromInstance(moved, info, '/instance') };
  return { origin, info: fromInstance(origin, info, '/instance') };
}

// ── sessions ──
function adopt(c, { session, user, instance_admin, instance_owner }) {
  c.session = session;
  if (user) c.user = user;
  if (instance_admin !== undefined) { c.isAdmin = !!instance_admin; c.isOwner = !!instance_owner; }
  registry.set(c.origin, c);
  saveSession(c.origin, session, c.info?.accounts_mode === 'velora' ? tokenTag(getToken()) : null);
}
// -> { session, user } (nothing is stored until the instance is added or adopts it)
export async function veloraSession(origin) {
  let t;
  try { t = await apiFetch('/bonfire/instance-token', { method: 'POST', body: JSON.stringify({ instance: origin }) }); }
  catch (e) { throw restrictedErr(e) ? Object.assign(new Error('account_restricted'), { status: 403, restricted: true, text: e.error === 'account_restricted' ? e.message : '' }) : e; } // (Nookara won't sign new instance tokens while Ember is off for the account)
  return plain(origin, '/api/v1/auth/velora', { token: t.token });
}
export const localSession = (origin, kind, username, password) => plain(origin, `/api/v1/auth/${kind === 'register' ? 'register' : 'login'}`, { username, password });
async function authVelora(c) {
  try { const r = await veloraSession(c.origin); adopt(c, r); return r; }
  catch (e) { if (e.restricted) restrict(c, e.text); throw e; }
}
// forget this instance's session (and tell it)
function dropSession(c) {
  if (c.session) fetch(`${c.origin}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${c.session}` }, keepalive: true }).catch(() => {});
  c.session = null; registry.delete(c.origin); saveSession(c.origin, null);
}
// Velora sign-out: Velora-login instances lose their session (local-account ones keep theirs)
export function dropVeloraSessions() { for (const c of connections.values()) if (c.info?.accounts_mode === 'velora') dropSession(c); }
// an existing (logged out) local-mode instance: log in again
export async function loginInstance(origin, kind, username, password) {
  const c = connections.get(origin);
  if (!c) throw new Error('instance_not_connected');
  adopt(c, await localSession(origin, kind, username, password));
  await me(c).catch(() => {});
  if (!c.ws) openSocket(c); else mirror();
}
async function me(c) {
  const d = await apiFetch('/api/v1/me', { inst: c.origin });
  c.user = d.user; c.isAdmin = !!d.instance_admin; c.isOwner = !!d.instance_owner;
  return d;
}
const refreshing = new Map();
// a 401 from the instance: a new session (automatic in Velora mode, a login in local mode)
hooks.refresh = origin => {
  const c = connections.get(origin);
  if (!c) return Promise.resolve(false);
  if (!refreshing.has(origin)) {
    const p = (async () => {
      c.session = null; registry.delete(origin); saveSession(origin, null);
      if (c.info?.accounts_mode !== 'velora' || !getToken()) { setStatus(c, 'login'); return false; }
      // Velora rejecting the token signs out (api.js); anything else (Velora / the instance unreachable) is retried
      try { await authVelora(c); return true; } catch (e) { c.failed = true; setStatus(c, getToken() ? 'closed' : 'login', e.message); if (getToken()) scheduleRetry(c, e.restricted ? RESTRICTED_RETRY : 0); return false; }
    })().finally(() => refreshing.delete(origin));
    refreshing.set(origin, p);
  }
  return refreshing.get(origin);
};
async function ensureSession(c) {
  if (c.info.accounts_mode === 'velora' && !getToken()) { dropSession(c); setStatus(c, 'login'); return false; } // Velora-login instances need the Velora sign-in
  if (c.session && c.info.accounts_mode === 'velora' && loadSessionTags()[c.origin] !== tokenTag(getToken())) dropSession(c); // from an older Ember sign-in
  if (c.session) {
    registry.set(c.origin, c);

    try { await me(c); return true; } catch (e) { if (e.status !== 401 && e.message !== 'instance_not_connected') throw e; }
    c.session = null; registry.delete(c.origin); saveSession(c.origin, null);
  }
  if (c.info.accounts_mode === 'velora') { await authVelora(c); await me(c).catch(() => {}); return true; }
  setStatus(c, 'login');
  return false;
}

// ── the gateway ──
function openSocket(c) {
  if (c.ws && c.ws.readyState <= 1) return;
  setStatus(c, 'connecting');
  const ws = new WebSocket(`${c.origin.replace(/^http/, 'ws')}/gateway`);
  c.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', session: c.session }));
  ws.onmessage = e => {
    if (c.ws !== ws || typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    onFrame(c, m);
  };
  ws.onclose = ev => {
    if (c.ws !== ws) return;
    c.ws = null;
    instanceVoiceClosed(c.origin);
    if (!connections.has(c.origin)) return;
    if (ev.code === 4003) { setStatus(c, 'banned'); return; }
    if (ev.code === 4001) { // the session was rejected: get a fresh one
      hooks.refresh(c.origin).then(ok => { if (ok) openSocket(c); });
      return;
    }
    c.failed = true;
    setStatus(c, 'closed');
    scheduleRetry(c, c.restricted ? RESTRICTED_RETRY : ev.code === 4010 ? 3000 : 0);
  };
  ws.onerror = () => {};
}
function scheduleRetry(c, min = 0) {
  clearTimeout(c.timer);
  if (held) { c.retryAt = 0; mirror(); return; } // (locked: holdInstances(false) connects it)
  const wait = Math.max(min, backoff(c.retry++));
  c.retryAt = Date.now() + wait; mirror();
  c.timer = setTimeout(() => { if (connections.get(c.origin) === c) connect(c.origin); }, wait);
}
// the network / tab came back, or the server was opened: every instance that isn't connected tries again now
export function retryInstances(origin) {
  if (held) return;
  for (const c of connections.values()) {
    if ((origin && c.origin !== origin) || c.busy || (c.ws && c.ws.readyState <= 1) || !['closed', 'error'].includes(c.status)) continue;
    clearTimeout(c.timer); c.retry = 0;
    connect(c.origin);
  }
}
export const sendTo = (origin, obj) => {
  const c = connections.get(origin);
  if (c?.ws?.readyState === 1) { c.ws.send(JSON.stringify(obj)); return true; }
  return false;
};
setInterval(() => connections.forEach(c => { if (c.ws?.readyState === 1) c.ws.send('{"type":"ping"}'); }), 25000);

// the instance's build / stats / update status (admins only: the rest of the call is public build info); on connect and every ~30 min
export async function loadServerInfo(c) {
  if (!c.isAdmin) return;
  try { const d = await apiFetch('/api/v1/instance/info', { inst: c.origin }); c.serverInfo = d?.admin ? { ...d, fetchedAt: Date.now() } : null; mirror(); } catch { /* fine */ }
}
setInterval(() => connections.forEach(c => { if (c.isAdmin && c.status === 'open') loadServerInfo(c); }), 30 * 60 * 1000);

function onFrame(c, m) {
  switch (m.type) {
    case 'pong': return;
    case 'auth_success':
      c.user = m.user; c.isAdmin = !!m.instance_admin; c.isOwner = !!m.instance_owner;
      c.ws.send(JSON.stringify({ type: 'chat_hello' }));
      mirror();
      return;
    case 'account_restricted':
      restrict(c, m.message);
      return;
    case 'account_restored': // Ember is on again: say hello as after any connect (chat_ready then reloads the server list)
      c.restricted = null; c.retry = 0; c.failed = false;
      setStatus(c, 'connecting');
      sendTo(c.origin, { type: 'chat_hello' });
      instanceRestored(); // (the app's lockout too, once Nookara agrees)
      return;
    case 'chat_error':
      if (m.error === 'account_restricted') { restrict(c, m.message); return; } // (any chat_ / voice_ frame after the notice: no toast per request)
      break;
    case 'chat_ready':
      if (held) return; // (the account is locked: holdInstances(false) says hello again)
      c.restricted = null;
      c.retry = 0; c.failed = false; c.retryAt = 0;
      setStatus(c, 'open');
      loadInstanceData(c.origin).then(() => { catchUp(c.origin); if (autoJoin.has(c.origin)) joinOnce(c); });

      if (c.isAdmin) loadServerInfo(c);
      if (c.isAdmin) apiFetch('/api/v1/instance/settings', { inst: c.origin }).then(d => { c.voiceQuota = d.velora?.voice || null; mirror(); }).catch(() => {});
      return;
    case 'instance_restarting':
      toast('Instance restarting…');
      return;
    case 'instance_update':
      c.info = { ...c.info, ...fromInstance(c.origin, m.settings || {}, '/instance') };
      if (m.voice_quota !== undefined) c.voiceQuota = m.voice_quota;

      mirror();
      return;
    default: break;
  }
  handleEvent(fromInstance(c.origin, m), c.origin);
}

// ── what an instance holds for me ──
export async function loadInstanceData(origin) {
  const c = connections.get(origin);
  if (!c?.session) return;
  try {
    const [srv, notify] = await Promise.all([apiFetch('/chat/servers', { inst: origin }), apiFetch('/chat/notify', { inst: origin }).catch(() => null)]);
    c.loaded = true; mirror();
    patchState(s => ({ servers: [...s.servers.filter(x => x.inst !== origin), ...srv.servers], notify: { ...s.notify, ...(notify?.notify || {}) } }));
    loadEmojis();
    for (const [key] of Object.entries(getState().detail)) if (parseK(key).inst === origin && !srv.servers.some(x => x.sid === key)) patchState(s => { const detail = { ...s.detail }; delete detail[key]; return { detail }; });
    if (srv.servers.length && c.pending) { c.pending = false; mirror(); }
    resumeInstanceView(origin);
  } catch (e) { if (e.status === 401) hooks.refresh(origin); }
}

// ── the list ──
const newConn = (origin, info) => ({ origin, info: info || null, session: loadSessions()[origin] || null, user: null, ws: null, status: 'connecting', retry: 0, acks: new Map(), isAdmin: false, isOwner: false });
function addConnection(origin, info) {
  let c = connections.get(origin);
  if (c) return c;
  c = newConn(origin, info);
  connections.set(origin, c);
  mirror();
  return c;
}
export async function connect(origin) {
  const c = connections.get(origin);
  if (!c || c.busy || held) return;
  c.busy = true;
  clearTimeout(c.timer); c.retryAt = 0;
  let movedTo = null;
  try {
    if (c.ws && c.ws.readyState <= 1) return;
    setStatus(c, 'connecting');
    const hung = new Promise((_, no) => setTimeout(() => no(new Error('instance_unreachable')), 25000)); // a request that never answers is a failed try
    const found = await Promise.race([discover(origin), hung]);
    if (found.movedFrom) { movedTo = found.origin; return; } // (followed below, once this try is over)
    c.info = found.info;
    if (await Promise.race([ensureSession(c), hung])) openSocket(c); else mirror();
  } catch (e) {
    if (e.message === 'instance_moved' && e.moved_to) { movedTo = normOrigin(e.moved_to); return; } // Velora: that address moved

    c.failed = true;
    setStatus(c, e.message === 'insufficient_scope' ? 'error' : 'closed', e.message);
    scheduleRetry(c, e.restricted ? RESTRICTED_RETRY : 0);
  } finally { c.busy = false; if (movedTo) moveInstance(origin, movedTo); }
}
// A server moved to a new address: the rail entry, its session (same server, same database) and the saved list follow, and the
// old address is dropped. Velora rewrote the synced list already; this is for this device's copy (and an open tab).
const moved = new Set();
export async function moveInstance(from, to) {
  const c = connections.get(from);
  if (!c || !to || from === to || moved.has(from)) return;
  moved.add(from);
  try {
    const session = loadSessions()[from], tag = loadSessionTags()[from];
    clearTimeout(c.timer);
    const ws = c.ws; c.ws = null; try { ws?.close(); } catch { /* gone */ }
    instanceVoiceClosed(from);
    registry.delete(from); saveSession(from, null);
    const view = getState().view;
    const wasHere = (view.sid && parseK(view.sid).inst === from) || view.inst === from;
    const order = [...connections.keys()];
    const old = new Map(connections);
    connections.clear();
    for (const o of order) {
      if (o === from) { if (!old.has(to)) connections.set(to, { ...newConn(to), session: session || null, prefs: c.prefs }); }
      else connections.set(o, old.get(o));
    }
    if (session && !old.has(to)) saveSession(to, session, tag);
    const gone = k => parseK(k).inst === from;
    patchState(s => {
      const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => !gone(k.replace(/^(c|d|g|mm):/, ''))));
      return {
        servers: s.servers.filter(x => x.inst !== from), detail: pick(s.detail), members: pick(s.members), msgs: pick(s.msgs), unread: pick(s.unread), unreadN: pick(s.unreadN), typing: pick(s.typing),
        mentions: pick(s.mentions), srvMentions: pick(s.srvMentions), notify: pick(s.notify), voiceStates: pick(s.voiceStates), lastCid: pick(s.lastCid),
        emojis: (s.emojis || []).filter(x => !gone(x.sid)), instances: [...connections.values()].map(instView),
      };
    });
    toast(`${hostOf(from)} moved to ${hostOf(to)}.`, true);
    await saveList();
    await connect(to);
    if (wasHere) go({ kind: 'instance', inst: to });
  } finally { moved.delete(from); }
}
// the instance refused something for a missing permission (e.g. signing): trade a fresh instance token from the current
// Ember sign-in (which may have been approved for more since) and reconnect. -> the new session's scopes, or null
const renewing = new Map();
export function renewVeloraSession(origin) {
  const c = connections.get(origin);
  if (!c || c.info?.accounts_mode !== 'velora' || !getToken()) return Promise.resolve(null);
  if (!renewing.has(origin)) {
    renewing.set(origin, (async () => {
      try {
        dropSession(c);
        await authVelora(c);
        const d = await me(c).catch(() => null);
        const ws = c.ws; c.ws = null; try { ws?.close(); } catch { /* gone */ }
        openSocket(c);
        return d?.scopes || null;
      } catch (e) { scheduleRetry(c, e.restricted ? RESTRICTED_RETRY : 0); return null; }
    })().finally(() => setTimeout(() => renewing.delete(origin), 30000))); // (at most one try per half minute)
  }
  return renewing.get(origin);
}
// "Retry": start over right now

export function reconnect(origin) {
  const c = connections.get(origin);
  if (!c) return;
  clearTimeout(c.timer); c.retry = 0; c.failed = false; c.retryAt = 0;
  const ws = c.ws; c.ws = null; try { ws?.close(); } catch { /* gone */ }
  connect(origin);
}
const readList = () => { try { const v = JSON.parse(localStorage.getItem(LIST_CACHE()) || '[]'); return Array.isArray(v) ? v.map(normOrigin).filter(Boolean) : []; } catch { return []; } };
// always saved here; signed in with Velora it goes there too (the same list on every device)
const saveList = () => {
  const urls = [...connections.keys()];
  try { localStorage.setItem(LIST_CACHE(), JSON.stringify(urls)); } catch { /* fine */ }
  return getToken() ? apiFetch('/bonfire/instances', { method: 'PUT', body: JSON.stringify({ instances: urls.map(url => ({ url })) }) }).then(d => { applyPrefs(d); followMoves(d); }).catch(() => {}) : Promise.resolve();
};
// Velora saw an old address of a server that moved (PUT /bonfire/instances answers { moved: { old: new } })
function followMoves(d) {
  for (const [from, to] of Object.entries(d?.moved || {})) { const f = normOrigin(from), t = normOrigin(to); if (f && t && connections.has(f)) moveInstance(f, t); }
}
function applyPrefs(d) {
  for (const i of d?.instances || []) { const c = connections.get(normOrigin(i.url)); if (c) c.prefs = { muted: !!i.muted, push: i.push !== false }; }
  mirror();
}
// signed in: Velora's list and this device's, together (Velora's order first); whatever only this device had goes back to Velora
async function mergeWithVelora() {
  const d = await apiFetch('/bonfire/instances').catch(() => null);
  if (!d?.instances) return;
  const remote = [...new Set(d.instances.map(i => normOrigin(i.url)).filter(Boolean))];
  const order = [...new Set([...remote, ...connections.keys()])];
  const old = new Map(connections);
  connections.clear();
  order.forEach(o => connections.set(o, old.get(o) || newConn(o)));
  applyPrefs(d);
  // Velora's official server is added to every account once, flagged auto_join: join its community once connected
  for (const i of d.instances) if (i.auto_join) autoJoin.add(normOrigin(i.url));
  order.filter(o => !old.has(o)).forEach(o => connect(o));
  autoJoin.forEach(o => { const c = connections.get(o); if (c?.status === 'open') joinOnce(c); });
  try { localStorage.setItem(LIST_CACHE(), JSON.stringify(order)); } catch { /* fine */ }
  if (order.join() !== remote.join()) saveList();
}
const autoJoin = new Set();
async function joinOnce(c) {
  if (!autoJoin.delete(c.origin)) return;
  try {
    if (c.info?.community && !getState().servers.some(s => s.inst === c.origin)) await joinCommunity(c.origin);
  } catch { /* banned / full / request-only: Velora still marks it done, the gate shows the rest */ }
  apiFetch('/bonfire/instances/default-joined', { method: 'POST', body: JSON.stringify({ url: c.origin }) }).catch(() => {});
}
// on start: this device's list connects right away, then (signed in) Velora's list is merged in
export function startInstances() {
  readList().forEach(o => addConnection(o));
  mirror();
  [...connections.keys()].forEach(o => connect(o));
  if (getToken()) mergeWithVelora();
}
// the dialog finished (it holds a session): the instance goes on the rail and the list is saved
export async function addInstance(origin, info, got) {
  const c = addConnection(origin, info);
  c.info = info || c.info;
  if (got) adopt(c, got);
  await saveList();
  if (c.session) { await me(c).catch(() => {}); if (!c.ws) openSocket(c); } else await connect(origin);
  mirror();
  return c;
}
export async function removeInstance(origin) {
  const c = connections.get(origin);
  if (!c) return;
  if (c.session) await fetch(`${origin}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${c.session}` } }).catch(() => {});
  clearTimeout(c.timer);
  connections.delete(origin);
  registry.delete(origin);
  saveSession(origin, null);
  const ws = c.ws; c.ws = null; try { ws?.close(); } catch { /* gone */ }
  instanceVoiceClosed(origin);
  const gone = k => parseK(k).inst === origin;
  const view = getState().view;
  patchState(s => {
    const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => !gone(k.replace(/^(c|d|g|mm):/, ''))));
    return {
      servers: s.servers.filter(x => x.inst !== origin), detail: pick(s.detail), members: pick(s.members), msgs: pick(s.msgs), unread: pick(s.unread), unreadN: pick(s.unreadN), typing: pick(s.typing),
      mentions: pick(s.mentions), srvMentions: pick(s.srvMentions), notify: pick(s.notify), voiceStates: pick(s.voiceStates), lastCid: pick(s.lastCid),
      emojis: (s.emojis || []).filter(x => !gone(x.sid)), instances: [...connections.values()].map(instView),
    };
  });
  if ((view.sid && gone(view.sid)) || view.inst === origin) go({ kind: 'home' });
  await saveList();
  loadEmojis();
}
// drag and drop on the rail: `from` goes before / after `to`
export async function reorderInstances(from, to, after) {
  if (from === to || !connections.has(from) || !connections.has(to)) return;
  const order = [...connections.keys()].filter(o => o !== from);
  order.splice(order.indexOf(to) + (after ? 1 : 0), 0, from);
  const old = new Map(connections);
  connections.clear();
  order.forEach(o => connections.set(o, old.get(o)));
  mirror();
  await saveList();
}
// join the instance's community (or ask to, per its join policy) - or use an invite code -> { sid } | { pending: true }
// password: for a server that asks for one (join_policy 'password'); an invite code always gets in
export async function joinCommunity(origin, code, password) {
  const c = connections.get(origin);
  const sid = c?.info?.community?.sid;
  const d = code
    ? await apiFetch(`/chat/join/${encodeURIComponent(String(code).trim().split(/[/#?]/).filter(Boolean).pop())}`, { method: 'POST', inst: origin })
    : await apiFetch(`/chat/servers/${K(origin, sid)}/join`, { method: 'POST', body: JSON.stringify(password ? { password } : {}) });
  if (d.pending) { c.pending = true; mirror(); return { pending: true }; }
  await loadInstanceData(origin);
  return { sid: d.server.sid };
}
export const instanceConn = origin => connections.get(origin);
// Velora's per-server push consent (PROTOCOL §12.3): may this server push to me through Velora, and is it muted
export async function setInstancePrefs(origin, patch) {
  const c = connections.get(origin);
  try {
    const d = await apiFetch('/bonfire/instances/prefs', { method: 'PATCH', body: JSON.stringify({ url: origin, ...patch }) });
    if (c) { c.prefs = { muted: !!d?.muted, push: d?.push !== false }; mirror(); }
    toast(patch.muted !== undefined ? (patch.muted ? 'Muted - this server can\'t push to you.' : 'Unmuted.') : patch.push ? 'Push notifications from this server are on.' : 'Push notifications from this server are off.', true);
  } catch (e) { toast(e.message === 'instance_not_in_list' ? "This server isn't in your synced list yet - try again in a moment." : "Couldn't save that."); }
}
// after claiming / changing settings: who I am there now, and what it calls itself
export async function refreshInstance(origin) {
  const c = connections.get(origin);
  if (!c) return;
  try { c.info = (await discover(origin)).info; await me(c); } catch { /* keep what we had */ }
  mirror();
}

