// nke1: the end-to-end encryption format of Nookara DMs. WebCrypto only, no imports, so the same file runs in the page, in sw.js and in
// node --test. The spec other clients build against is docs/E2EE.md in the Nookara repo; Nookara's own side of it is e2ee.js there (it never
// holds a private key). P-256 because it's the one curve every browser and Android WebView can do.
//
//   account keys   ECDH (enc) + ECDSA (sig). kid = what names a key: the first 22 characters of base64url(SHA-256(enc public key))
//   a message      random 32-byte K. AES-256-GCM over the payload JSON, additional data "nke1|from|to" (user ids)
//   commit         HMAC-SHA256(K, "nke1 commit"): a report hands over K, and Nookara checks it's the K the sender used
//   wraps          K sealed once per kid (recipient, me, linked clients): a fresh ECDH key each time, HKDF-SHA256, AES-256-GCM
//   sig            ECDSA over "nke1 sig|from|to|edit_of|iv|ct|commit", so Nookara can't write a message as someone else
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();
export const VERSION = 1;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }, ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// ── bytes ──
export const b64 = bytes => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64 = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const sha256 = async bytes => new Uint8Array(await subtle.digest('SHA-256', bytes));
export const kidOf = async encPub => b64(await sha256(unb64(encPub))).slice(0, 22);

// ── keys ──
// { enc_pub, sig_pub, kid, enc_priv, sig_priv } with both private keys as JWK: only ever kept locked, or as non-extractable CryptoKeys (keystore.js)
export async function newKeys() {
  const [enc, sig] = await Promise.all([subtle.generateKey(ECDH, true, ['deriveBits']), subtle.generateKey(ECDSA, true, ['sign', 'verify'])]);
  const enc_pub = b64(await subtle.exportKey('raw', enc.publicKey)), sig_pub = b64(await subtle.exportKey('raw', sig.publicKey));
  return { enc_pub, sig_pub, kid: await kidOf(enc_pub), enc_priv: await subtle.exportKey('jwk', enc.privateKey), sig_priv: await subtle.exportKey('jwk', sig.privateKey) };
}
export const importEncPriv = (jwk, extractable = false) => subtle.importKey('jwk', jwk, ECDH, extractable, ['deriveBits']);
export const importSigPriv = (jwk, extractable = false) => subtle.importKey('jwk', jwk, ECDSA, extractable, ['sign']);
const importEncPub = raw => subtle.importKey('raw', unb64(raw), ECDH, false, []);
const importSigPub = raw => subtle.importKey('raw', unb64(raw), ECDSA, false, ['verify']);

// ── sealing a secret to someone's public key ──
async function wrapKeyFor(priv, pub, eph, kid) {
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: eph, info: te.encode(`nke1 wrap|${kid}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// -> { e, i, w }
export async function seal(secret, encPub, kid) {
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const key = await wrapKeyFor(eph.privateKey, await importEncPub(encPub), ephRaw, kid);
  const i = random(12);
  return { e: b64(ephRaw), i: b64(i), w: b64(await subtle.encrypt({ name: 'AES-GCM', iv: i }, key, secret)) };
}
export async function unseal(wrap, encPriv, kid) {
  const ephRaw = unb64(wrap.e);
  const key = await wrapKeyFor(encPriv, await subtle.importKey('raw', ephRaw, ECDH, false, []), ephRaw, kid);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.i) }, key, unb64(wrap.w)));
}

// ── messages ──
const aad = (from, to) => te.encode(`nke1|${from}|${to}`);
const sigInput = (from, to, editOf, iv, ct, commit) => te.encode(`nke1 sig|${from}|${to}|${editOf || 0}|${iv}|${ct}|${commit}`);
export async function commitOf(k) {
  const key = await subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await subtle.sign('HMAC', key, te.encode('nke1 commit')));
}
// payload: { t: text, r?: { from, s } the quoted reply, n: random }. recipients: [{ kid, enc_pub }]. signer: { kid, sigPriv: CryptoKey }
export async function encryptMessage(payload, { from, to, recipients, signer, editOf = 0 }) {
  const k = random(32), iv = random(12);
  const key = await subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
  const body = te.encode(JSON.stringify({ ...payload, n: b64(random(8)) }));
  const ct = b64(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(from, to) }, key, body));
  const ivS = b64(iv), commit = await commitOf(k);
  const wraps = {};
  for (const r of recipients) wraps[r.kid] = await seal(k, r.enc_pub, r.kid);
  const sig = b64(await subtle.sign(SIGN, signer.sigPriv, sigInput(from, to, editOf, ivS, ct, commit)));
  return { v: VERSION, ct, iv: ivS, commit, sig, signer: signer.kid, wraps };
}
// the message's K with my key, checked against the commit (null when it isn't for this key or it doesn't match)
export async function messageKey(enc, kid, encPriv) {
  const w = enc?.wraps?.[kid];
  if (!w) return null;
  try {
    const k = await unseal(w, encPriv, kid);
    return (await commitOf(k)) === enc.commit ? k : null;
  } catch { return null; }
}
export async function openWithKey(enc, k, { from, to }) {
  const key = await subtle.importKey('raw', k, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv), additionalData: aad(from, to) }, key, unb64(enc.ct));
  return JSON.parse(td.decode(plain));
}
export async function verifyMessage(enc, sigPub, { from, to, editOf = 0 }) {
  if (!enc?.sig) return false;
  try { return await subtle.verify(SIGN, await importSigPub(sigPub), unb64(enc.sig), sigInput(from, to, editOf, enc.iv, enc.ct, enc.commit)); }
  catch { return false; }
}

// ── files ──
// -> { data: encrypted bytes, key, iv }. The key travels inside the (encrypted) message. Whole files, the biggest upload is 95 MB.
export async function encryptFile(bytes) {
  const k = random(32), iv = random(12);
  const key = await subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
  return { data: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('nke1 file') }, key, bytes)), key: b64(k), iv: b64(iv) };
}
export async function decryptFile(bytes, keyS, ivS) {
  const key = await subtle.importKey('raw', unb64(keyS), 'AES-GCM', false, ['decrypt']);
  return subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivS), additionalData: te.encode('nke1 file') }, key, bytes);
}

// ── linked clients: the account's signed list ──
// doc = { seq, list: [{ kid, enc_pub, sig_pub, label, app, added_at, revoked_at? }] }. Canonical: built the same way every time by clientsText.
export const clientsText = (userId, accountKid, doc) => `nke1 clients|${userId}|${accountKid}|${doc.seq}|${(doc.list || []).map(c => [c.kid, c.enc_pub, c.sig_pub, encodeURIComponent(c.label || ''), c.app || '', c.added_at || 0, c.revoked_at || 0].join(',')).join(';')}`;
export const signClients = async (userId, accountKid, doc, sigPriv) => b64(await subtle.sign(SIGN, sigPriv, te.encode(clientsText(userId, accountKid, doc))));
export async function verifyClients(userId, accountKid, doc, sigS, sigPub) {
  try { return await subtle.verify(SIGN, await importSigPub(sigPub), unb64(sigS), te.encode(clientsText(userId, accountKid, doc))); }
  catch { return false; }
}
// a statement signed with the account key that proves the caller holds it (changing a passcode, for one)
export const signProof = async (what, sigPriv) => b64(await subtle.sign(SIGN, sigPriv, te.encode(`nke1 proof|${what}`)));

// ── comparing keys with someone ──
export const fingerprint = async (encPub, sigPub) => b64(await sha256(new Uint8Array([...unb64(encPub), ...unb64(sigPub)])));
// 12 groups of 5 digits, the same on both sides: compare it with the other person outside Nookara
export async function safetyCode(a, b) {
  const [x, y] = [a, b].sort((p, q) => (p.uid < q.uid ? -1 : 1));
  const h = await sha256(te.encode(`nke1 safety|${x.uid}|${x.fp}|${y.uid}|${y.fp}`));
  const h2 = await sha256(h);
  const all = [...h, ...h2];
  const out = [];
  for (let i = 0; i < 12; i++) out.push(String((((all[i * 4] << 24) >>> 0) + (all[i * 4 + 1] << 16) + (all[i * 4 + 2] << 8) + all[i * 4 + 3]) % 100000).padStart(5, '0'));
  return out;
}

// ── locking the account keys (backups) ──
export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
// 26 characters = 130 bits
export function newRecoveryCode() {
  const r = random(26);
  return Array.from(r, x => RECOVERY_ALPHABET[x & 31]).join('').replace(/(.{4})(?=.)/g, '$1-');
}
export const cleanRecoveryCode = s => String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
// a 64-byte secret -> { wrap: AES key for the blob, auth: what the server is shown to hand the blob over }
async function split(bytes) {
  const wrap = await subtle.importKey('raw', bytes.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { wrap, auth: b64(bytes.slice(32, 64)) };
}
export async function stretchRecovery(code, saltS) {
  const base = await subtle.importKey('raw', te.encode(cleanRecoveryCode(code)), 'HKDF', false, ['deriveBits']);
  return split(new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: unb64(saltS), info: te.encode('nke1 recovery') }, base, 512)));
}
export const stretched = split; // (a passcode's Argon2id output, kdf.js)
export async function lockBlob(secretObj, wrap) {
  const iv = random(12);
  return { iv: b64(iv), ct: b64(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('nke1 backup') }, wrap, te.encode(JSON.stringify(secretObj)))) };
}
export async function openBlob(blob, wrap) {
  return JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: te.encode('nke1 backup') }, wrap, unb64(blob.ct))));
}

// ── linking a device ──
// the code someone types on a device they already trust: it's the new device's key, so Nookara can't swap in its own without changing the code.
// 10 characters = 50 bits, good for the 10 minutes the request lives.
export async function linkCode(encPub) {
  const h = await sha256(unb64(encPub));
  const c = Array.from(h.slice(0, 10), x => RECOVERY_ALPHABET[x & 31]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}
export async function newLinkKey() {
  const enc = await subtle.generateKey(ECDH, true, ['deriveBits']);
  return { enc_pub: b64(await subtle.exportKey('raw', enc.publicKey)), enc_priv: enc.privateKey };
}
export const sealJson = (obj, encPub, kid) => seal(te.encode(JSON.stringify(obj)), encPub, kid);
export const unsealJson = async (wrap, encPriv, kid) => JSON.parse(td.decode(await unseal(wrap, encPriv, kid)));

// ── file links ──
// A DM's files travel the way they always have, as links on their own lines in the text, but inside the encrypted message, with what opens them in the #fragment:
// https://…/t/<id>/file.bin#nke=<key>.<iv>.<name>.<mime>   (the name + mime are percent-encoded, spoilers keep their name)
const enc = s => encodeURIComponent(s).replace(/[!'()*.]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const fileLink = (url, { key, iv, name, mime }) => `${url.split('#')[0]}#nke=${key}.${iv}.${enc(name || 'file')}.${enc(mime || 'application/octet-stream')}`;
export function parseFileLink(link) {
  const m = /^(https?:\/\/[^\s#]+)#nke=([\w-]+)\.([\w-]+)\.([^.\s]*)\.([^.\s]*)$/.exec(String(link || ''));
  if (!m) return null;
  try { return { url: m[1], key: m[2], iv: m[3], name: decodeURIComponent(m[4]), mime: decodeURIComponent(m[5]) }; } catch { return null; }
}
