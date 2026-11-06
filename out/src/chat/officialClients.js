// Velora's official clients list (staff set it in Velora's Admin > Official clients): which apps and pages a message's
// `via` names, and which get the verified badge. Fetched once from GET /api/clients/official (Velora, public) and cached
// in memory + localStorage for CACHE_MS; used for Velora DMs/servers and for Ember servers alike.
// matchClient is the same function as Velora's official-clients.js (keep the two in step; tests in
// test/official-clients.test.js here and tests/official-clients.test.js on Velora):
//   - app id: via.app / via.token equals one of the entry's app_ids (case-insensitive)         -> strongest
//   - origin + kind: via.url's host matches one of the entry's origins and via.kind is in kinds  -> next
//   - origin only: the entry has no kinds                                                         -> weakest
//   A named third-party token (via.token) only matches by app id. Ties: the first entry (Velora's sort order) wins.

export const ENDPOINT = '/api/clients/official';
export const CACHE_MS = 6 * 60 * 60 * 1000; // a fresh copy is fetched in the background after this
const STORE_KEY = 'ember_official_clients';

// "https://Velora.ikelene.net/chat" -> "velora.ikelene.net"; keeps a port and a leading "*."
export function normHost(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/\.$/, '');
}
export function hostMatches(pattern, host) {
  const p = normHost(pattern), h = normHost(host);
  if (!p || !h) return false;
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}
export function hostOfVia(via) {
  try { return via && via.url ? new URL(String(via.url)).host.toLowerCase() : ''; } catch { return ''; }
}
export function matchClient(via, list) {
  if (!via || typeof via !== 'object' || !Array.isArray(list)) return null;
  const app = String(via.app || via.token || '').trim().toLowerCase();
  const host = hostOfVia(via);
  const kind = String(via.kind || '');
  let best = null, bestScore = 0;
  for (const c of list) {
    if (!c) continue;
    let score = 0;
    if (app && (c.app_ids || []).some(a => String(a).trim().toLowerCase() === app)) score = 3;
    else if (!via.token && host && (c.origins || []).some(o => hostMatches(o, host))) {
      const kinds = c.kinds || [];
      if (!kinds.length) score = 1;
      else if (kind && kinds.includes(kind)) score = 2;
    }
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// what the chip shows: { name, verified, icon, domain, known }
//   list = the official clients (null = not loaded yet: Velora's own `official` flag stands in, as before)
export function describeVia(via, list) {
  if (!via) return null;
  const domain = via.url ? String(via.url).replace(/^https?:\/\//, '') : '';
  const hit = matchClient(via, list);
  if (hit) return { name: hit.name, verified: !!hit.verified, icon: /^(https:\/\/|\/(?!\/))/.test(hit.icon_url || '') ? hit.icon_url : null, domain, known: true };
  if (!list && via.official) return { name: via.name || 'Ember', verified: true, icon: null, domain, known: true };
  // a registered app that isn't verified: its own logo, no badge. Only from Nookara's upload folder: an instance can write any `via` it likes
  const icon = /^https:\/\/(nookara\.cc|velora\.ikelene\.net)\/uploads\/app-logos\/[\w.-]+$/.test(via.icon || '') ? via.icon : null;
  return { name: via.token || domain || 'Unknown client', verified: false, icon, domain: via.token ? domain : '', known: false };
}

// ── the cached list ─────────────────────────────────────────────────────────

let list = null, fetchedAt = 0, inflight = null;
const subs = new Set();
const cleanList = x => (Array.isArray(x) ? x.filter(c => c && typeof c.name === 'string').map(c => ({
  id: c.id, name: c.name.slice(0, 48), origins: Array.isArray(c.origins) ? c.origins.map(String) : [], kinds: Array.isArray(c.kinds) ? c.kinds.map(String) : [],
  app_ids: Array.isArray(c.app_ids) ? c.app_ids.map(String) : [], icon_url: typeof c.icon_url === 'string' ? c.icon_url : null, verified: !!c.verified,
})) : null);
function readStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && Array.isArray(s.clients)) { list = cleanList(s.clients); fetchedAt = Number(s.at) || 0; }
  } catch { /* private mode / bad json */ }
}
function set(next) {
  list = next; fetchedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ at: fetchedAt, clients: list })); } catch { /* full / private mode */ }
  subs.forEach(fn => fn(list));
}
// loads the list if it isn't fresh; resolves to it (or the stale copy / null when Velora can't be reached)
export function loadOfficialClients({ force = false } = {}) {
  if (!list && !fetchedAt) readStore();
  if (!force && list && Date.now() - fetchedAt < CACHE_MS) return Promise.resolve(list);
  if (inflight) return inflight;
  inflight = fetch(ENDPOINT, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(d => { const l = cleanList(d && d.clients); if (l) set(l); return list; })
    .catch(() => list)
    .finally(() => { inflight = null; });
  return inflight;
}
export const officialClients = () => { if (!list && !fetchedAt) readStore(); return list; };
// calls fn(list) whenever a new copy arrives; returns the unsubscribe (ClientVia.jsx useOfficialClients)
export function onOfficialClients(fn) { subs.add(fn); return () => { subs.delete(fn); }; }
