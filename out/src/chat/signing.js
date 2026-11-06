// Message signing (bonfire-server/PROTOCOL.md §8). The Velora account's signing key (Ed25519, fetched with the SIGN_MESSAGES
// permission, imported non-extractable, kept in memory) signs what you send in velora-mode communities that allow it; every signed
// message you receive is checked here against the author's Velora key, whatever the instance says. No Ed25519 in this browser = nothing is signed.
import { apiFetch } from '../api.js';
import { patchState, getState } from './store.js';
import { serverNow } from './server-clock.js';

export const SIGN_BIT = 32768;
const enc = new TextEncoder();
const b64u = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export { canonical } from './signing-payload.js';
import { canonical, payloadOf, receivedPayload } from './signing-payload.js';
const bytesOf = payload => enc.encode(`bonfire-msg-v1\n${canonical(payload)}`);

// ── the account key ──
// One Ed25519 key per Velora account (PROTOCOL.md §2.3). Velora hands it to a token that holds SIGN_MESSAGES; it is imported here as a
// NON-extractable CryptoKey and kept in memory only. It is fetched again when it is older than KEY_AGE (so a rotation on the website
// is picked up) or when a sign attempt fails.
const KEY_AGE = 30 * 1000;
let device = null; // { kid, priv, at } once ready
let loading = null;
export const canSign = () => !!device;
export const deviceKid = () => device?.kid || null;

async function supported() {
  try { await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); return true; } catch { return false; }
}
async function fetchKey() {
  const d = await apiFetch('/bonfire/signing-key');
  if (!d?.kid || !d.private_key) throw new Error('invalid_key');
  const priv = await crypto.subtle.importKey('pkcs8', unb64u(d.private_key), { name: 'Ed25519' }, false, ['sign']); // false = non-extractable
  device = { kid: d.kid, priv, at: Date.now() };
  patchState({ signing: { state: 'ready', kid: d.kid } });
  return device;
}
// one fetch at a time; errors keep whatever key we already had
const refresh = () => (loading ||= fetchKey().finally(() => { loading = null; }));

// the instance said no to a signature (the key was probably rotated), or the tab came back to the front: fetch the current key
export const refreshSigningKey = () => (device ? refresh().catch(() => {}) : Promise.resolve());
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && device && Date.now() - device.at > 5000) refreshSigningKey(); });

// on start: with the permission, get the account key
export async function setupSigning() {
  if (__ORIGINCHATS__) { patchState({ signing: null }); return; } // the OriginChats bridge signs and checks with Rotur keys
  device = null;
  try {
    const s = await apiFetch('/bonfire/session');
    if (((Number(s?.effective) || 0) & SIGN_BIT) !== SIGN_BIT) { patchState({ signing: { state: 'no_scope' } }); return; }
    if (!(await supported())) { patchState({ signing: { state: 'unsupported' } }); return; }
    await refresh();
  } catch (e) { patchState({ signing: { state: 'error', error: e.message } }); }
}

// The signed "iss" is the account issuer the instances check against (their velora_url), not the page's address: it stays
// https://velora.ikelene.net after the move to nookara.cc / ember.nookara.cc. Checks also accept the new hosts, for messages
// signed on ember.nookara.cc before this was pinned.
const SIG_ISS = 'https://velora.ikelene.net';
const SIG_ISS_ALL = [...new Set([SIG_ISS, location.origin, 'https://nookara.cc', 'https://ember.nookara.cc'])];
// -> { kid, sig, ts, nonce } for a message about to be sent / edited
export async function signMessage(fields) {
  if (!device) throw new Error('no_key');
  if (Date.now() - device.at > KEY_AGE) await refresh().catch(() => {});
  const go = async () => {
    const ts = serverNow(); // instances refuse a time more than 5 min from theirs, so never the PC's own clock
    const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const payload = payloadOf({ iss: SIG_ISS, ...fields, ts, nonce });
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, device.priv, bytesOf(payload));
    return { kid: device.kid, sig: b64u(sig), ts, nonce };
  };
  try { return await go(); } catch { await refresh(); return go(); } // a failed attempt: get the current key once and try again
}
// the text the instance stores (and signs against): line endings normalised
export const normBody = t => String(t ?? '').replace(/\r\n/g, '\n').slice(0, 4000);

// ── checking what comes in ──
const keyCache = new Map(); // kid -> { at, key | null }
async function keyFor(kid) {
  const hit = keyCache.get(kid);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.key;
  const r = await fetch(`/bonfire/keys/kid/${encodeURIComponent(kid)}`);
  if (r.status === 404) { keyCache.set(kid, { at: Date.now(), key: null }); return null; }
  if (!r.ok) throw new Error('key_lookup');
  const key = await r.json();
  keyCache.set(kid, { at: Date.now(), key });
  return key;
}
const importCache = new Map();
const importKey = (b64) => { if (!importCache.has(b64)) importCache.set(b64, crypto.subtle.importKey('raw', unb64u(b64), { name: 'Ed25519' }, false, ['verify'])); return importCache.get(b64); };

// 'ok' | 'bad' | null (unsigned, or can't tell right now)
export async function checkMessage(m) {
  const sig = m?.signature;
  if (!sig || !m.inst || !m.author) return null;
  try {
    const key = await keyFor(sig.kid);
    if (!key) return 'bad';
    const vid = m.author.velora_id;
    if (!vid || String(key.user_id) !== String(vid)) return 'bad';
    if (key.revoked_at != null && Number(key.revoked_at) < Number(sig.ts)) return 'bad';
    const pub = await importKey(key.public_key);
    // the signature names the account issuer (pinned, see SIG_ISS) and the server's address when it was sent: try the
    // current address, then the ones it had before a move
    const insts = [m.inst, ...(getState().instances?.find(i => i.origin === m.inst)?.previousUrls || [])];
    for (const iss of SIG_ISS_ALL) {
      const payload = receivedPayload(m, iss);
      for (const instance of insts) {
        if (await crypto.subtle.verify({ name: 'Ed25519' }, pub, unb64u(sig.sig), bytesOf({ ...payload, instance }))) return 'ok';
      }
    }
    return 'bad';
  } catch (e) {
    if (e?.name === 'NotSupportedError') return null;
    return e?.message === 'key_lookup' || e instanceof TypeError ? null : 'bad';
  }
}
export const sigId = m => (m?.signature ? `${m.inst}|${m.id}|${m.signature.sig}` : '');
const pendingChecks = new Set();
// message just arrived: check its signature once, the verdict lands in state.sigs
export function watchSignature(m) {
  const id = sigId(m);
  if (!id || getState().sigs?.[id] || pendingChecks.has(id)) return;
  pendingChecks.add(id);
  checkMessage(m).then(v => { if (v) patchState(s => ({ sigs: { ...s.sigs, [id]: v } })); }).finally(() => pendingChecks.delete(id));
}
