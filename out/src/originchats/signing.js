// Message signatures (OriginChats `message_signatures_v1`).
//
// A Rotur account signs each message and each edit of its own message with
// its Rotur identity key, through rotur-sdk. The server only checks a proof's
// shape and freshness, so every client verifies signatures itself before
// showing a message as signed.
// https://docs.originchats.com/clients/signing/

import * as ed from "@noble/ed25519";
import { Rotur, signingBytes } from "rotur-sdk";
import { roturAccount, roturClient } from "./rotur.js";

const MAX_SKEW = 5 * 60;

// Rotur signs and verifies with WebCrypto Ed25519, which older browsers lack
// (iOS before 17, Chrome before 137); there it falls back to JS.
let native = null;
function hasNativeEd25519() {
  // No crypto.subtle at all on insecure (plain http) origins.
  native ??= globalThis.crypto && crypto.subtle
    ? crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);
  return native;
}

const b64urlToBytes = (s) => {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const bytesToB64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function messageContent(authorId, content, attachments, timestamp, signingUrl) {
  return ["originchats.message.v1", authorId, content, attachments, timestamp, signingUrl];
}

// Whether to sign on this connection: a Rotur account (not a server
// account) on a server that takes message signatures.
function canSign(conn) {
  return !!(
    roturAccount() &&
    conn.me &&
    !conn.me.cracked &&
    conn.has("message_signatures_v1") &&
    conn.handshake &&
    conn.handshake.signing_url
  );
}

async function sign(build) {
  const rotur = roturClient();
  if (!rotur) {
    throw new Error("Sign in to Rotur first");
  }
  if (await hasNativeEd25519()) {
    return rotur.signing.sign(build);
  }
  // The SDK's privateKey() imports through WebCrypto too, so read the key
  // record directly.
  const record = await fallbackKey(rotur);
  const signature = await ed.signAsync(
    new Uint8Array(signingBytes(build(record.user_id))),
    b64urlToBytes(record.private_key_jwk.d),
  );
  return { author_id: record.user_id, key_id: record.key_id, signature: bytesToB64url(signature) };
}

// Set when Rotur refuses to sign (the sign-in lacks signing:private, or it
// expired); the chat shows a prompt to sign in again.
let blocked = false;
const blockedListeners = new Set();
function onSigningBlocked(fn) {
  blockedListeners.add(fn);
  fn(blocked);
  return () => blockedListeners.delete(fn);
}
function setBlocked(v) {
  if (blocked !== v) {
    blocked = v;
    blockedListeners.forEach((fn) => fn(v));
  }
}
const refused = (e) =>
  !!e && (e.status === 401 || e.status === 403 || e.name === "RoturPermissionError" || /scope|permission/i.test(String(e.message || "")));

let fallback = null;
function fallbackKey(rotur) {
  if (!fallback || fallback.token !== rotur.token) {
    const record = fetch("https://api.rotur.dev/v2/me/signing-key", {
      headers: { Authorization: `Bearer ${rotur.token}` },
    }).then(async (res) => {
      if (!res.ok) {
        throw Object.assign(new Error("Couldn't load your Rotur signing key"), { status: res.status });
      }
      const r = await res.json();
      if (r.algorithm !== "Ed25519") {
        throw new Error(`Unsupported signing algorithm: ${r.algorithm}`);
      }
      return r;
    });
    record.catch(() => {
      if (fallback && fallback.record === record) fallback = null;
    });
    fallback = { token: rotur.token, record };
  }
  return fallback.record;
}

const timeout = (p, ms) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("Signing timed out")), ms))]);

// Proof fields for a new message or an edit, or {} when this connection
// shouldn't (or can't) sign. A failed signature sends the message unsigned.
async function signMessage(conn, { content, attachments, after = 0 }) {
  if (!canSign(conn)) {
    return {};
  }
  const timestamp = Math.max(conn.serverNow(), after + 0.001);
  try {
    const proof = await timeout(
      sign((authorId) =>
        messageContent(authorId, content || "", attachments || [], timestamp, conn.handshake.signing_url),
      ),
      10000,
    );
    setBlocked(false);
    return { ...proof, timestamp };
  } catch (e) {
    console.warn("[originchats] sending unsigned:", e);
    if (refused(e)) setBlocked(true);
    return {};
  }
}

// Verification needs no sign-in: public keys are public.
let verifier = null;
const verifierClient = () => roturClient() || (verifier ??= new Rotur());

const fallbackKeys = new Map();
async function verifyProof(proof, content) {
  const rotur = verifierClient();
  if (await hasNativeEd25519()) {
    return rotur.signing.verify(proof, content);
  }
  const id = `${proof.author_id}:${proof.key_id}`;
  if (!fallbackKeys.has(id)) {
    const p = rotur.signing.publicKey({ user_id: proof.author_id, key_id: proof.key_id });
    fallbackKeys.set(id, p);
    p.catch(() => fallbackKeys.delete(id));
  }
  const record = await fallbackKeys.get(id);
  if (proof.username && String(record.username).toLowerCase() !== String(proof.username).toLowerCase()) {
    return false;
  }
  try {
    return await ed.verifyAsync(
      b64urlToBytes(proof.signature),
      new Uint8Array(signingBytes(content)),
      b64urlToBytes(record.public_key_jwk.x),
    );
  } catch {
    return false;
  }
}

// Only the message as shown is verified. A moderator's edit of someone
// else's message removes the signature and sets `edited_by` (the docs say to
// show it unsigned); a signed `original` next to different content proves
// nothing about what's displayed.
const authored = (m) => m;

function isSigned(m) {
  return !!(m.key_id && m.signature && m.author_id && !m.edited_by);
}

const results = new Map();
const settled = new Map();

// "verified", "invalid" or "unavailable" (the check couldn't finish).
function verifyMessage(m, signingUrl) {
  const a = authored(m);
  const key = cacheKey(m);
  if (results.has(key)) {
    return results.get(key);
  }
  let p;
  const serverTime = a.edited_at != null ? a.edited_at : m.timestamp;
  if (typeof a.signed_at !== "number" || typeof serverTime !== "number" || Math.abs(serverTime - a.signed_at) > MAX_SKEW) {
    p = Promise.resolve("invalid");
  } else {
    p = verifyProof(
      { author_id: a.author_id, key_id: a.key_id, signature: a.signature, username: m.user },
      messageContent(a.author_id, a.content || "", a.attachments || [], a.signed_at, signingUrl),
    ).then(
      (ok) => (ok ? "verified" : "invalid"),
      () => "unavailable",
    );
  }
  results.set(key, p);
  p.then((r) => settled.set(key, { r, at: Date.now() }));
  return p;
}

// The finished result for this exact signature, if there is one yet. A check
// that couldn't finish is tried again after a minute.
// Results are cached per signed payload, so an edit that keeps the signature
// but changes the content is checked again.
function cacheKey(m) {
  return JSON.stringify([m.id, m.author_id, m.key_id, m.signature, m.signed_at, m.content || "", m.attachments || []]);
}

function cachedVerification(m) {
  const key = cacheKey(m);
  const done = settled.get(key);
  if (done && done.r === "unavailable" && Date.now() - done.at > 60000) {
    settled.delete(key);
    results.delete(key);
    return null;
  }
  if (done) {
    return done.r;
  }
  // Still running: don't start another check.
  return results.has(key) ? "pending" : null;
}

// Checks up front that this sign-in can sign, so the prompt shows before
// anything goes out unsigned.
async function checkSigningAccess() {
  const rotur = roturAccount() ? roturClient() : null;
  if (!rotur) return;
  try {
    if (await hasNativeEd25519()) {
      // Loads (and caches) the signing key, throwing if Rotur refuses it.
      await rotur.signing.privateKey();
    } else {
      const res = await fetch("https://api.rotur.dev/v2/me/signing-key", {
        headers: { Authorization: `Bearer ${rotur.token}` },
      });
      if (!res.ok) throw Object.assign(new Error("signing key"), { status: res.status });
    }
    setBlocked(false);
  } catch (e) {
    if (refused(e)) setBlocked(true);
  }
}

export { canSign, cachedVerification, checkSigningAccess, isSigned, onSigningBlocked, signMessage, verifyMessage };
