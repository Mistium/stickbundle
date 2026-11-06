// Pronouns shown in message headers.
// Message author objects are broadcast to everyone in a channel, so pronouns are NOT put in them (friends-only
// profiles hide pronouns from non-friends). Each viewer fetches them through GET /account/lookup, which already
// applies that rule per viewer, via the shared (5 min) lookup cache in store.js - in batches (lookupMany: one request
// for up to 100 names), not one request per author.
import { useEffect, useState } from 'react';
import { lookupMany, forgetProfile } from './store.js';

const vals = new Map();      // lowercase username -> pronouns string ('' = none / hidden)
const subs = new Map();      // lowercase username -> Set of setState callbacks
const pending = new Set();   // names being fetched
const queue = [];
let running = 0, flushTimer = null;
let timer = null;
const REFRESH_MS = 60000, MAX_REFRESH = 100, CONCURRENT = 2, BATCH = 100;

const key = n => String(n || '').toLowerCase();
function set(k, v) {
  if (vals.get(k) === v) return;
  vals.set(k, v);
  subs.get(k)?.forEach(fn => fn(v));
}
// names asked for within a few ms go out together
function pump() {
  if (flushTimer || running >= CONCURRENT || !queue.length) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const ks = queue.splice(0, BATCH);
    running++;
    lookupMany(ks).then(got => ks.forEach(k => { const d = got.get(k); if (d) set(k, typeof d.pronouns === 'string' ? d.pronouns.trim() : ''); else if (!vals.has(k)) set(k, ''); }),
      () => ks.forEach(k => { if (!vals.has(k)) set(k, ''); }))
      .finally(() => { running--; ks.forEach(k => pending.delete(k)); pump(); });
  }, 25);
}
function want(k) {
  if (!k || pending.has(k)) return;
  pending.add(k); queue.push(k); pump();
}
function refreshAll() {
  if (document.hidden) return;
  [...subs.keys()].slice(0, MAX_REFRESH).forEach(want);
}
function ensureTimer() {
  if (timer) return;
  timer = setInterval(refreshAll, REFRESH_MS);
  document.addEventListener('visibilitychange', refreshAll);
  // your own edit (ProfileEditor) shows up straight away
  addEventListener('vc-profile-changed', e => {
    const k = key(e.detail?.username);
    if (!k) return;
    forgetProfile(k);
    want(k);
  });
}

// the pronouns text for a username ('' when unset or hidden from you)
export function usePronouns(username, enabled = true) {
  const k = enabled ? key(username) : '';
  const [v, setV] = useState(() => (k ? vals.get(k) || '' : ''));
  useEffect(() => {
    if (!k) { setV(''); return undefined; }
    ensureTimer();
    let set_ = subs.get(k);
    if (!set_) subs.set(k, (set_ = new Set()));
    set_.add(setV);
    setV(vals.get(k) || '');
    if (!vals.has(k)) want(k);
    return () => { set_.delete(setV); if (!set_.size) subs.delete(k); };
  }, [k]);
  return v;
}
