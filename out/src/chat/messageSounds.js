// "Message sounds": optional sound packs for sending / receiving messages (My Account > Chat > Extras).
// Kept on this device (a pack and a volume are a per-device taste), so it needs nothing from the server.
const BASE = '/assets/sounds/chat/packs';
const V = '?v=20261023';
// files per pack: send / receive / bot (a pack without one just stays quiet for it)
export const SOUND_PACKS = [
  { id: 'scratchcord-v2', name: 'ScratchCord V2', files: ['send', 'receive', 'bot'] },
  { id: 'aol', name: 'AOL', files: ['send', 'receive', 'bot'] },
  { id: 'playstation', name: 'Playstation', files: ['send', 'receive', 'bot'] },
];
const KEY = 'bf_message_sounds';
const DEFAULTS = { pack: 'none', volume: 0.6 };
let cfg = null;
const listeners = new Set();
function load() {
  if (cfg) return cfg;
  cfg = { ...DEFAULTS };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.pack === 'ps4') s.pack = 'playstation'; // pack renamed
    // a removed pack (e.g. iMessage) isn't in the list, so it falls back to no sounds
    if (SOUND_PACKS.some(p => p.id === s.pack)) cfg.pack = s.pack;
    if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) cfg.volume = s.volume;
  } catch { /* no storage: defaults */ }
  return cfg;
}
export const getMessageSounds = () => load();
export function setMessageSounds(patch) {
  cfg = { ...load(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
  warm();
  listeners.forEach(f => f(cfg));
}
export function subscribeMessageSounds(f) { listeners.add(f); return () => listeners.delete(f); }
export const packActive = () => load().pack !== 'none';

const cache = new Map(); // url -> HTMLAudioElement (loaded once, cloned per play so quick repeats overlap)
function url(pack, kind) {
  const p = SOUND_PACKS.find(x => x.id === pack);
  return p && p.files.includes(kind) ? `${BASE}/${p.id}/${kind}.mp3${V}` : null;
}
function audioFor(u) {
  let a = cache.get(u);
  if (!a) { a = new Audio(u); a.preload = 'auto'; cache.set(u, a); }
  return a;
}
// fetch the chosen pack ahead of time so the first send / receive isn't late
function warm() {
  if (!packActive()) return;
  try { for (const k of ['send', 'receive', 'bot']) { const u = url(load().pack, k); if (u) audioFor(u); } } catch { /* no audio */ }
}
if (typeof window !== 'undefined') addEventListener('pointerdown', warm, { once: true, capture: true });

const lastAt = {};
// kind: 'send' | 'receive' | 'bot'. Returns true when the pack took the sound (even if the browser then blocks autoplay),
// so callers know not to play the normal notification sound as well.
export function playPackSound(kind, { pack, volume, force } = {}) {
  const c = load();
  const u = url(pack || c.pack, kind);
  if (!pack && c.pack === 'none') return false;
  if (!u) return true; // this pack has no such sound: nothing is played
  const now = Date.now();
  if (!force && now - (lastAt[kind] || 0) < 250) return true; // a burst of messages = one sound
  lastAt[kind] = now;
  try {
    const a = audioFor(u).cloneNode();
    a.volume = Math.min(1, Math.max(0, volume ?? c.volume));
    a.play().catch(() => {}); // autoplay blocked until the page has been clicked / typed in: stay quiet
  } catch { /* no audio */ }
  return true;
}
