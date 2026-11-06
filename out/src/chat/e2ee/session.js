// End-to-end encrypted DMs in Ember: holds this device's keys, seals what goes out, opens what comes in. No store imports, store.js calls into it.
// The format is nke1.js, how it all fits together is docs/E2EE.md in the Nookara repo.
import { apiFetch } from '../../api.js';
import * as N from './nke1.js';
import * as KS from './keystore.js';

// what stretches a DM passcode. 64 MB makes guessing expensive, on a phone it takes a second or two.
const ARGON = { m: 65536, t: 3, p: 1 };
async function stretchPasscode(passcode, saltS, params = ARGON) {
  const { argon2id } = await import('hash-wasm');
  const out = await argon2id({ password: passcode, salt: N.unb64(saltS), parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 64, outputType: 'binary' });
  return N.stretched(out);
}
export const validPasscode = (type, v) => (type === 'pin' ? /^\d{6,}$/.test(v) : String(v).length >= 10);

let me = null; // { id, username }
let keys = null; // what keystore.js holds for me, when this device is unlocked
let info = null; // GET /im/keys/me
let listeners = new Set();
const status = () => (!me ? 'loading' : keys ? 'ready' : info?.has ? 'locked' : info ? 'none' : 'loading');
export const getStatus = status;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach(f => f(status()));

// the Android app shows notifications from its own native connection, so it needs the key too (it keeps it in its Keystore-locked storage)
function shareWithNative(enc_priv) {
  try { window.BonfireNotifications?.postMessage(JSON.stringify({ type: 'dm_key', kid: keys?.kid, jwk: enc_priv })); } catch { /* an older app: names only */ }
}

export async function init() {
  info = await apiFetch('/im/keys/me').catch(() => null);
  if (!info) return status();
  me = { id: String(info.user_id), username: info.username };
  const local = await KS.getKeys(me.id).catch(() => null);
  // the account has moved on to a new key since this device was unlocked: this one can't read new messages, so it unlocks again
  keys = local && info?.has && local.kid === info.kid ? local : null;
  if (keys) shareOnce();
  changed();
  return status();
}
async function shareOnce() {
  if (!window.BonfireNotifications) return;
  shareWithNative((await privateKeys()).enc_priv);
}
export const signOut = async () => { if (me) await KS.dropKeys(me.id).catch(() => {}); keys = null; try { window.BonfireNotifications?.postMessage(JSON.stringify({ type: 'dm_key', kid: '', jwk: null })); } catch { /* */ } changed(); };

// ── keeping keys on this device ──
async function holdKeys(secret) {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sealed = await N.lockBlob(secret, deviceKey);
  keys = { uid: me.id, kid: secret.kid, enc_pub: secret.enc_pub, sig_pub: secret.sig_pub, encPriv: await N.importEncPriv(secret.enc_priv), sigPriv: await N.importSigPriv(secret.sig_priv), deviceKey, sealed };
  await KS.putKeys(keys);
  shareWithNative(secret.enc_priv);
  info = await apiFetch('/im/keys/me').catch(() => info);
  changed();
  flushOutbox();
}
const privateKeys = () => N.openBlob(keys.sealed, keys.deviceKey);

// ── first setup / replacing lost keys ──
async function buildBackups(secret, type, passcode, recovery) {
  const pSalt = N.b64(N.random(16)), rSalt = N.b64(N.random(16));
  const p = await stretchPasscode(passcode, pSalt), r = await N.stretchRecovery(recovery, rSalt);
  return {
    passcode: { type, salt: pSalt, params: ARGON, ...(await N.lockBlob(secret, p.wrap)), auth: p.auth },
    recovery: { salt: rSalt, ...(await N.lockBlob(secret, r.wrap)), auth: r.auth },
  };
}
// -> the recovery code, to show once
export async function setup(type, passcode, { replace = false } = {}) {
  const secret = await N.newKeys();
  const recovery = N.newRecoveryCode();
  const b = await buildBackups(secret, type, passcode, recovery);
  await apiFetch('/im/keys', { method: 'POST', body: JSON.stringify({ enc_pub: secret.enc_pub, sig_pub: secret.sig_pub, ...b, replace }) });
  bundles.clear();
  await holdKeys(secret);
  return recovery;
}

// ── unlocking on a device that doesn't have them ──
export const passcodeInfo = () => info?.passcode || null;
export async function unlockPasscode(passcode) {
  const p = info?.passcode;
  if (!p) throw new Error('no_backup');
  const s = await stretchPasscode(passcode, p.salt, p.params);
  try {
    const blob = await apiFetch('/im/keys/unlock', { method: 'POST', body: JSON.stringify({ kind: 'passcode', auth: s.auth }) });
    await holdKeys(await N.openBlob(blob, s.wrap));
  } catch (e) { info = await apiFetch('/im/keys/me').catch(() => info); changed(); throw e; }
}
export async function unlockRecovery(code) {
  const r = info?.recovery;
  if (!r) throw new Error('no_backup');
  const s = await N.stretchRecovery(code, r.salt);
  const blob = await apiFetch('/im/keys/unlock', { method: 'POST', body: JSON.stringify({ kind: 'recovery', auth: s.auth }) });
  await holdKeys(await N.openBlob(blob, s.wrap));
}

// ── changing what locks them ──
const proof = async () => { const ts = Date.now(); return { ts, proof: await N.signProof(`backup|${me.id}|${ts}`, keys.sigPriv) }; };
export async function changePasscode(type, passcode) {
  const secret = await privateKeys(), salt = N.b64(N.random(16));
  const s = await stretchPasscode(passcode, salt);
  await apiFetch('/im/keys/backup', { method: 'PUT', body: JSON.stringify({ kind: 'passcode', type, salt, params: ARGON, ...(await N.lockBlob(secret, s.wrap)), auth: s.auth, ...(await proof()) }) });
  info = await apiFetch('/im/keys/me').catch(() => info);
  changed();
}
export async function newRecovery() {
  const secret = await privateKeys(), salt = N.b64(N.random(16)), code = N.newRecoveryCode();
  const s = await N.stretchRecovery(code, salt);
  await apiFetch('/im/keys/backup', { method: 'PUT', body: JSON.stringify({ kind: 'recovery', salt, ...(await N.lockBlob(secret, s.wrap)), auth: s.auth, ...(await proof()) }) });
  return code;
}

// ── linking ──
// This device asks. -> { code, wait(): resolves once a trusted device approved it, rejects if denied or expired, cancel() }
export async function startLink(label) {
  const k = await N.newLinkKey();
  const kid = await N.kidOf(k.enc_pub);
  const r = await apiFetch('/im/keys/link', { method: 'POST', body: JSON.stringify({ enc_pub: k.enc_pub, label }) });
  // the code is made from my key on this side too: if Nookara swapped the key, the code wouldn't match
  const code = await N.linkCode(k.enc_pub);
  if (code !== r.code) throw new Error('link_mismatch');
  let stop = false;
  const wait = (async () => {
    while (!stop) {
      await new Promise(ok => setTimeout(ok, 2500));
      if (stop) return false;
      const s = await apiFetch(`/im/keys/link/${encodeURIComponent(code)}`).catch(e => { if (e.message === 'link_not_found') throw new Error('link_expired'); return null; });
      if (s?.state === 'denied') throw new Error('link_denied');
      if (s?.state === 'approved' && s.sealed) { await holdKeys(await N.unsealJson(s.sealed, k.enc_priv, kid)); return true; }
    }
    return false;
  })();
  return { code, wait, cancel: () => { stop = true; } };
}
// A trusted device looks up a code it was given. Refuses a request whose key doesn't match the code.
export async function lookupLink(code) {
  const clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const l = await apiFetch(`/im/keys/link/${encodeURIComponent(clean)}`);
  if ((await N.linkCode(l.enc_pub)).replace('-', '') !== clean) throw new Error('link_mismatch');
  return { ...l, code: clean };
}
const myBundle = async () => { info = await apiFetch('/im/keys/me'); return info; };
const clientsDoc = () => info?.clients || { seq: 0, list: [] };
async function saveDoc(path, method, doc, extra = {}) {
  const sig = await N.signClients(me.id, keys.kid, doc, keys.sigPriv);
  await apiFetch(path, { method, body: JSON.stringify({ doc, sig, ...extra }) });
  await myBundle();
  bundles.delete(me.username.toLowerCase());
  changed();
}
// { history: true } = hand a client the old DMs as well. onProgress(n)
export async function approveLink(l, { history = false, onProgress } = {}) {
  await myBundle();
  if (l.kind === 'device') {
    const sealed = await N.sealJson(await privateKeys(), l.enc_pub, await N.kidOf(l.enc_pub));
    await apiFetch(`/im/keys/link/${encodeURIComponent(l.code)}/approve`, { method: 'POST', body: JSON.stringify({ sealed }) });
    return;
  }
  const cur = clientsDoc();
  const kid = await N.kidOf(l.enc_pub);
  const doc = { seq: Number(cur.seq || 0) + 1, list: [...(cur.list || []).filter(c => c.kid !== kid), { kid, enc_pub: l.enc_pub, sig_pub: l.sig_pub, label: l.label, app: l.app || '', added_at: Date.now(), revoked_at: 0 }] };
  await saveDoc(`/im/keys/link/${encodeURIComponent(l.code)}/approve`, 'POST', doc);
  if (history) await shareHistory(kid, l.enc_pub, onProgress);
}
export const denyLink = code => apiFetch(`/im/keys/link/${encodeURIComponent(code)}/deny`, { method: 'POST' });
async function shareHistory(kid, encPub, onProgress) {
  let before = null, total = 0;
  for (;;) {
    const d = await apiFetch(`/im/keys/history?limit=200${before ? `&before=${before}` : ''}`);
    if (!d.items.length) return total;
    const items = [];
    for (const it of d.items) {
      const k = await N.messageKey({ wraps: { [keys.kid]: it.wrap }, commit: it.commit }, keys.kid, keys.encPriv);
      if (k) items.push({ id: it.id, wrap: await N.seal(k, encPub, kid) });
    }
    if (items.length) await apiFetch('/im/keys/history', { method: 'POST', body: JSON.stringify({ kid, items }) });
    total += items.length;
    onProgress?.(total);
    before = d.items[d.items.length - 1].id;
    if (!d.has_more) return total;
  }
}
export const linkedClients = () => clientsDoc().list?.filter(c => !c.revoked_at) || [];
export async function revokeClient(kid) {
  await myBundle();
  const cur = clientsDoc();
  const doc = { seq: Number(cur.seq || 0) + 1, list: (cur.list || []).map(c => (c.kid === kid ? { ...c, revoked_at: Date.now() } : c)) };
  await saveDoc('/im/keys/clients', 'PUT', doc);
}

// ── other people's keys ──
const bundles = new Map(); // username (lower) -> { at, b } or { at, none: true }
const BUNDLE_MS = 5 * 60 * 1000;
const noticeSubs = new Set();
export const onKeyChange = fn => { noticeSubs.add(fn); return () => noticeSubs.delete(fn); };
// { b } | { none: true }. Throws what the server said for anything else (blocked, DM privacy)
export async function bundleFor(username, { fresh = false } = {}) {
  const key = String(username).toLowerCase();
  const hit = bundles.get(key);
  if (hit && !fresh && Date.now() - hit.at < BUNDLE_MS) return hit;
  let b;
  try { b = await apiFetch(`/im/keys/user/${encodeURIComponent(username)}`); }
  catch (e) {
    if (e.message !== 'no_keys') throw e;
    const none = { at: Date.now(), none: true };
    bundles.set(key, none);
    return none;
  }
  // the list of linked clients has to be signed by the key itself, or Nookara could add a reader
  const doc = b.clients || { seq: 0, list: [] };
  if (doc.list?.length && !(await N.verifyClients(b.user_id, b.kid, doc, b.clients_sig, b.sig_pub))) throw new Error('bad_key_list');
  const fp = await N.fingerprint(b.enc_pub, b.sig_pub);
  if (String(b.user_id) !== me.id) {
    const pin = await KS.getPin(me.id, b.user_id).catch(() => null);
    if (pin && pin.seq > Number(doc.seq || 0) && pin.fp === fp) throw new Error('bad_key_list'); // an older list than one I already saw
    if (pin && pin.fp !== fp) noticeSubs.forEach(f => f(b.username));
    await KS.putPin(me.id, b.user_id, { fp, seq: Number(doc.seq || 0), first: pin?.fp === fp ? pin.first : Date.now() }).catch(() => {});
  }
  const v = { at: Date.now(), b: { ...b, fp } };
  bundles.set(key, v);
  return v;
}
export const forgetBundle = username => bundles.delete(String(username).toLowerCase());
// the numbers two people compare outside Nookara
export async function safetyWith(username) {
  const v = await bundleFor(username);
  if (!v.b) return null;
  return N.safetyCode({ uid: Number(me.id), fp: await N.fingerprint(keys.enc_pub, keys.sig_pub) }, { uid: Number(v.b.user_id), fp: v.b.fp });
}

// ── sealing ──
const active = b => [{ kid: b.kid, enc_pub: b.enc_pub }, ...((b.clients?.list || []).filter(c => !c.revoked_at).map(c => ({ kid: c.kid, enc_pub: c.enc_pub })))];
// -> the envelope, or throws no_keys when they haven't set up yet. text = the message with its file links
export async function seal(username, text, { replyQuote = null, editOf = 0, fresh = false } = {}) {
  if (!keys) throw new Error('e2ee_locked');
  const to = await bundleFor(username, { fresh });
  if (to.none) throw new Error('no_keys');
  const mine = await bundleFor(me.username, { fresh });
  if (mine.none) throw new Error('e2ee_locked');
  const payload = { t: text, ...(replyQuote ? { r: replyQuote } : {}) };
  // a DM's from/to are in the message; an edit keeps them as they were
  return N.encryptMessage(payload, { from: me.id, to: to.b.user_id, recipients: [...active(to.b), ...active(mine.b)], signer: { kid: keys.kid, sigPriv: keys.sigPriv }, editOf });
}
export async function sealEdit(m, text) {
  if (!keys) throw new Error('e2ee_locked');
  const other = String(m.fromId) === me.id ? String(m.toId) : String(m.fromId);
  const peer = await bundleFor(m.peer, { fresh: true });
  if (peer.none || String(peer.b.user_id) !== other) throw new Error('no_keys');
  const mine = await bundleFor(me.username, { fresh: true });
  return N.encryptMessage({ t: text, ...(m.quote ? { r: m.quote } : {}) }, { from: m.fromId, to: m.toId, recipients: [...active(peer.b), ...active(mine.b)], signer: { kid: keys.kid, sigPriv: keys.sigPriv }, editOf: m.imId });
}

// ── opening ──
const LINK_LINE = /^https?:\/\/\S+#nke=\S+$/;
const opened = new Map(); // `${id}:${ct head}` -> what came out (a message's contents never change under the same ciphertext)
// a message from the server -> the same message with `body` = its text and `sealed` saying how it went:
//   { state: 'open' | 'locked' | 'failed', signature: 'valid' | 'invalid' | 'none' | 'unknown', converted, files: [file links] }
//   no `enc` at all = it was never encrypted (a call line, or an old DM from before)
export async function openMessage(m) {
  if (!m?.enc) return m;
  if (!keys) return { ...m, body: '', sealed: { state: 'locked' } };
  const cacheKey = `${m.id}:${String(m.enc.ct).slice(0, 44)}`;
  let got = opened.get(cacheKey);
  if (!got) {
    try {
      const k = await N.messageKey(m.enc, keys.kid, keys.encPriv);
      if (!k) got = { state: 'failed' };
      else {
        const p = await N.openWithKey(m.enc, k, { from: m.from_id, to: m.to_id });
        const lines = String(p.t ?? '').split('\n');
        const files = lines.filter(l => LINK_LINE.test(l.trim())).map(l => l.trim());
        const text = lines.filter(l => !LINK_LINE.test(l.trim())).join('\n').trimEnd();
        got = { state: 'open', text, wire: String(p.t ?? ''), files, quote: p.r || null, signature: await checkSig(m) };
      }
    } catch { got = { state: 'failed' }; }
    if (got.state === 'open') { opened.set(cacheKey, got); if (opened.size > 5000) opened.delete(opened.keys().next().value); }
  }
  if (got.state !== 'open') return { ...m, body: '', sealed: { state: got.state } };
  return {
    ...m, body: got.text,
    reply: m.reply ? { ...m.reply, body: m.reply.gone ? m.reply.body : (got.quote?.s ?? m.reply.body) } : m.reply,
    sealed: { state: 'open', signature: m.enc.converted ? 'none' : got.signature, converted: !!m.enc.converted, files: got.files, wire: got.wire, quote: got.quote },
  };
}
async function checkSig(m) {
  const enc = m.enc;
  if (!enc.sig) return 'none';
  const sender = String(m.from_id) === me.id ? me.username : m.from;
  const v = await bundleFor(sender).catch(() => null);
  if (!v?.b) return 'unknown';
  const b = v.b;
  const key = b.kid === enc.signer ? b.sig_pub : (b.clients?.list || []).find(c => c.kid === enc.signer)?.sig_pub || (b.past || []).find(p => p.kid === enc.signer)?.sig_pub;
  if (!key) return 'unknown';
  return (await N.verifyMessage(enc, key, { from: m.from_id, to: m.to_id, editOf: m.edited_at ? m.id : 0 })) ? 'valid' : 'invalid';
}

// ── files ──
export async function sealFile(file) {
  const { data, key, iv } = await N.encryptFile(await file.arrayBuffer());
  return { upload: new File([data], 'file.bin', { type: 'application/octet-stream' }), key, iv };
}
export const fileLink = N.fileLink;
export const parseFileLink = N.parseFileLink;
const blobs = new Map(); // link -> promise of an object URL
const myHost = u => { try { const x = new URL(u); return /^\/(t|uploads)\//.test(x.pathname) && /(^|\.)nookara\.cc$|ikelene\.net$|^127\.0\.0\.1$|^localhost$/.test(x.hostname) && x.hostname !== 'cdn.nookara.cc' ? location.origin + x.pathname : u; } catch { return u; } };
// a file link -> an object URL of the opened file. Rejects 'gone' when the file isn't there any more.
export function openFile(link) {
  let p = blobs.get(link);
  if (p) return p;
  const f = N.parseFileLink(link);
  if (!f) return Promise.reject(new Error('bad_link'));
  p = (async () => {
    const r = await fetch(myHost(f.url), { credentials: 'omit' });
    if (r.status === 404 || r.status === 410) throw new Error('gone');
    if (!r.ok) throw new Error('fetch_failed');
    const plain = await N.decryptFile(await r.arrayBuffer(), f.key, f.iv);
    return URL.createObjectURL(new Blob([plain], { type: f.mime }));
  })();
  blobs.set(link, p);
  p.catch(() => blobs.delete(link));
  return p;
}

// ── reports ──
// the window Nookara says a report covers -> { <mail id>: key } for each message this device can open. Only these keys ever leave it.
export async function revealWindow(messages) {
  if (!keys) throw new Error('e2ee_locked');
  const out = {};
  for (const m of messages) {
    const k = await N.messageKey(m.enc, keys.kid, keys.encPriv);
    if (k) out[String(m.id)] = N.b64(k);
  }
  return out;
}

// ── held messages: nobody to encrypt them to yet ──
let sender = null; // (store.js) sends one for real
export const setOutboxSender = fn => { sender = fn; };
export const hold = v => KS.outboxPut(v);
export const held = () => KS.outboxAll().catch(() => []);
export const release = nonce => KS.outboxDrop(nonce).catch(() => {});
// Nookara only tells someone about new keys if they've already talked (it can't know who's holding a message for a stranger, and shouldn't), so while anything is held, keep asking.
setInterval(() => { if (keys) flushOutbox(); }, 20000);
let flushing = false;
export async function flushOutbox(onlyFor = null) {
  if (flushing || !keys || !sender) return;
  flushing = true;
  try {
    for (const h of await held()) {
      if (onlyFor && String(h.to).toLowerCase() !== String(onlyFor).toLowerCase()) continue;
      const v = await bundleFor(h.to, { fresh: true }).catch(() => null);
      if (v?.b) await sender(h);
    }
  } finally { flushing = false; }
}
