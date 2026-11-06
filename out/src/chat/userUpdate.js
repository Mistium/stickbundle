// Velora's live `user_update` event (somebody changed their picture / colour / name ...): patch EVERY cached copy of that account.
// Pure: (state, event) -> new state, so it is tested without a browser (test/user-update.test.js).
//
// event = { user: { id, username, pfp_url, color, rank, banner_url, bio, pronouns ... }, changed: ['pfp', ...], previous_username?, v }
//
// What holds a copy of a person, and how it is matched:
//   me                         id, else the (old or new) username
//   people (by username)       moved to the new username key
//   friends / dms / groups     by (old or new) username - those lists are keyed by name
//   members[sid]               Velora servers: member.id === id. Instance servers: member.id === 'v:<id>' / velora_id === id
//   msgs[key] authors + replies  channel messages carry the id (same rule as members); DM / group messages only a username
//   presence / voiceStates / veloraFaces / veloraNames   by name / id
// Images: Velora gives every upload a new URL, so the cache never serves the old picture. If the SAME url comes back with
// changed: ['pfp'] (a replaced file), `?v=<v>` is added so the browser refetches it.
import { isInst } from './ids.js';

const origin = u => String(u || '').replace(/^https?:\/\/[^/]+/i, '');
const stripV = u => String(u || '').replace(/[?&]v=\d+$/, '');

// the picture to store: the new URL, cache-busted only when the same file was replaced
export function nextPfp(old, user, changed, v) {
  const nu = user?.pfp_url;
  if (nu === undefined) return old;
  if (!nu) return null;
  const same = !!old && origin(stripV(old)) === origin(nu);
  if (!same) return nu;
  if (!changed?.includes('pfp') || !v) return old;
  return `${nu}${nu.includes('?') ? '&' : '?'}v=${v}`;
}

export function applyUserUpdate(state, ev) {
  const u = ev?.user;
  if (!u?.id || !/^[1-9]\d*$/.test(String(u.id)) || !u.username) return state;
  const id = String(u.id), vid = `v:${id}`;
  const prev = ev.previous_username ? String(ev.previous_username) : null;
  const lc = s => String(s || '').toLowerCase();
  const names = new Set([lc(u.username), prev && lc(prev)].filter(Boolean)); // names this account answers to in name-keyed lists
  const byName = name => names.has(lc(name));
  const changed = ev.changed || [];
  const v = ev.v;
  const limited = !!u.limited;

  // my / their face in the shapes Ember keeps (everything restricted is only touched when the event carries it)
  const face = old => {
    const out = { ...old, username: u.username };
    if (u.pfp_url !== undefined) out.pfp = nextPfp(old?.pfp, u, changed, v);
    if (u.color !== undefined) out.color = u.color || null;
    if (u.rank !== undefined) out.rank = u.rank;
    return out;
  };
  const sameAcc = x => !!x && ((x.id != null && (String(x.id) === id || x.id === vid)) || (x.velora_id != null && String(x.velora_id) === id));
  const person = x => (sameAcc(x) ? face(x) : x);
  // a message author: channel messages have ids; DM / group ones only a username
  const author = (x, nameKeyed) => (!x ? x : x.id != null ? person(x) : nameKeyed && byName(x.username) ? face(x) : x);
  const msg = (m, nameKeyed) => {
    if (!m) return m;
    const a = author(m.author, nameKeyed), r = m.reply ? msg(m.reply, nameKeyed) : m.reply;
    return a === m.author && r === m.reply ? m : { ...m, author: a, ...(m.reply ? { reply: r } : {}) };
  };

  const next = { ...state };

  // me
  if (state.me && (String(state.me.id) === id || byName(state.me.username))) {
    const me = face(state.me);
    for (const k of ['banner_url', 'bio', 'pronouns', 'website', 'country_code', 'pfp_animated', 'banner_animated']) if (!limited && u[k] !== undefined && k in state.me) me[k] = u[k];
    next.me = me;
  }

  // people (by username): the entry moves to the new name
  if (state.people) {
    const people = { ...state.people };
    let old = null;
    for (const key of Object.keys(people)) if ((people[key]?.id != null && String(people[key].id) === id) || byName(key)) { old = { ...(old || {}), ...people[key] }; delete people[key]; }
    people[u.username] = { ...face(old || { id }), id };
    next.people = people;
  }

  // lists keyed by name
  if (state.friends?.length) next.friends = state.friends.map(f => (byName(f.friend_username) ? { ...f, friend_username: u.username, ...(u.pfp_url !== undefined ? { pfp_url: nextPfp(f.pfp_url, u, changed, v) } : {}), ...(u.color !== undefined ? { color: u.color || null } : {}), ...(u.rank !== undefined ? { rank: u.rank } : {}) } : f));
  if (state.dms?.length) next.dms = state.dms.map(c => (byName(c.username) ? { ...c, username: u.username, ...(u.pfp_url !== undefined ? { pfp: nextPfp(c.pfp, u, changed, v) } : {}) } : c));
  if (state.groups?.length && prev) next.groups = state.groups.map(g => ({ ...g, owner: lc(g.owner) === lc(prev) ? u.username : g.owner, members: Array.isArray(g.members) ? g.members.map(n => (typeof n === 'string' ? (lc(n) === lc(prev) ? u.username : n) : (lc(n?.username) === lc(prev) ? { ...n, username: u.username } : n))) : g.members }));

  // servers: members
  if (state.members) next.members = Object.fromEntries(Object.entries(state.members).map(([sid, list]) => [sid, Array.isArray(list) && list.some(sameAcc) ? list.map(person) : list]));

  // messages (authors + reply previews). c: keys carry ids; d: / g: / mm: only names
  if (state.msgs) {
    next.msgs = Object.fromEntries(Object.entries(state.msgs).map(([key, b]) => {
      if (!b?.list?.length) return [key, b];
      const nameKeyed = !key.startsWith('c:');
      let hit = false;
      const list = b.list.map(m => { const n = msg(m, nameKeyed); if (n !== m) hit = true; return n; });
      return [key, hit ? { ...b, list } : b];
    }));
  }

  // presence + typing + voice participants are keyed / listed by name
  if (prev && lc(prev) !== lc(u.username)) {
    if (state.presence && state.presence[prev] !== undefined) { const p = { ...state.presence }; p[u.username] = p[prev]; delete p[prev]; next.presence = p; }
    if (state.typing) next.typing = Object.fromEntries(Object.entries(state.typing).map(([k, t]) => [k, t && t[prev] !== undefined ? Object.fromEntries(Object.entries(t).map(([n, until]) => [n === prev ? u.username : n, until])) : t]));
    if (state.voiceStates) next.voiceStates = Object.fromEntries(Object.entries(state.voiceStates).map(([cid, users]) => [cid, Array.isArray(users) ? users.map(x => (lc(x?.username) === lc(prev) ? { ...x, username: u.username } : x)) : users]));
  }

  // Velora people on instance servers: their live face + current name
  if (state.veloraFaces) next.veloraFaces = state.veloraFaces[id] && !state.veloraFaces[id].miss ? { ...state.veloraFaces, [id]: { ...face(state.veloraFaces[id]), id } } : { ...state.veloraFaces, [id]: { ...face({ id }), id } };
  if (state.veloraNames && state.veloraNames[id] !== undefined) next.veloraNames = { ...state.veloraNames, [id]: u.username };

  return next;
}

// the instances (origins) where this Velora account is a member of a loaded server - they get a `chat_profile_refresh` nudge
export function instancesWithAccount(state, id) {
  const out = new Set();
  for (const [sid, list] of Object.entries(state.members || {})) {
    if (!isInst(sid) || !Array.isArray(list)) continue;
    if (list.some(m => String(m.velora_id) === String(id) || m.id === `v:${id}`)) out.add(sid.slice(0, sid.indexOf('|')));
  }
  return [...out];
}
