// Rotur avatar overlays (cosmetics), fetched in batches like the official
// client: POST /v2/profiles/cosmetics {usernames} -> per-user active overlay.

import { h } from "../vendor/react.js";

const API = "https://api.rotur.dev/v2/profiles/cosmetics";
const BATCH = 100;

const overlays = new Map(); // lowercased username -> image url, or null for none
const pending = new Set();
const inFlight = new Set();
const listeners = new Set();
let timer = null;

const norm = (u) => String(u || "").toLowerCase();

// Only Rotur accounts have cosmetics: not server accounts or webhooks.
function isRoturName(u) {
  return /^[\w.-]{1,40}$/.test(String(u || ""));
}

async function runBatch(keys) {
  keys.forEach((k) => inFlight.add(k));
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: keys }),
    });
    const data = res.ok ? await res.json().catch(() => null) : null;
    for (const [name, r] of Object.entries(data || {})) {
      const o = r && r.active_cosmetics && r.active_cosmetics.overlay;
      overlays.set(norm(name), (o && o.image_url) || null);
    }
  } catch {}
  for (const k of keys) {
    inFlight.delete(k);
    if (!overlays.has(k)) overlays.set(k, null);
  }
  listeners.forEach((fn) => fn());
}

function flush() {
  timer = null;
  const all = [...pending];
  pending.clear();
  for (let i = 0; i < all.length; i += BATCH) {
    runBatch(all.slice(i, i + BATCH));
  }
}

function request(username) {
  const k = norm(username);
  if (!k || overlays.has(k) || pending.has(k) || inFlight.has(k)) {
    return;
  }
  pending.add(k);
  if (!timer) {
    timer = setTimeout(flush, 50);
  }
}

// The overlay image for a user, or null. Re-renders when it arrives.
function useOverlay(user) {
  const name = user && !user.webhook && !user.cracked && isRoturName(user.username) ? user.username : null;
  const [, bump] = h.useState(0);
  h.useEffect(() => {
    if (!name) {
      return undefined;
    }
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    request(name);
    return () => listeners.delete(fn);
  }, [name]);
  return name ? overlays.get(norm(name)) || null : null;
}

export { useOverlay };
