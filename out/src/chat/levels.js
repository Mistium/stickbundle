// Live voice levels for the speaking rings. One AnalyserNode per call audio track (people's mics, not
// stream audio) + your own mic as it is sent (after volume / noise gate, nothing while muted), polled
// ~30 times a second only while you're in a call. Levels are smoothed and written straight to CSS
// (--vlvl, an outline width) on every element with data-vlevel="<lowercase username>", so React
// doesn't re-render per frame. The desktop overlay feed (overlay.js) reads levelOf() for its ring.
let ctx = null;
let source = null;   // voice.js: () => [{ key, stream, muted }]
let timer = null;
let lastPoll = 0;
const meters = new Map(); // `${key}|${stream.id}` -> { key, stream, src, an, buf, w, hold }
const widths = new Map(); // key -> ring width in px (loudest of that person's tracks)
const swidths = new Map(); // key -> ring width in px from a soundboard sound they played (shown blue)

const THRESHOLD = 0.02; // RMS that counts as speaking (about -34 dBFS)
const LOUD = 0.25;      // RMS that gets the thickest ring (about -12 dBFS)
const MIN_W = 1.5, MAX_W = 4.75, HOLD_MS = 300;

export const levelKey = name => String(name || '').toLowerCase();
export function registerLevelSource(fn) { source = fn; }

// one AudioContext for the whole voice engine (levels + the mic chain in voice.js)
export function sharedAudioContext() {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function dropMeter(id) {
  const m = meters.get(id);
  if (!m) return;
  try { m.src.disconnect(); } catch { /* fine */ }
  meters.delete(id);
}
function meterFor(id, key, stream) {
  let m = meters.get(id);
  if (m) return m;
  if (!stream?.getAudioTracks?.().length) return null;
  try {
    const c = sharedAudioContext();
    if (!c) return null;
    const src = c.createMediaStreamSource(stream), an = c.createAnalyser();
    an.fftSize = 512;
    src.connect(an); // an analyser is pulled without being connected to the speakers
    m = { key, stream, src, an, buf: new Float32Array(an.fftSize), w: 0, hold: 0 };
    meters.set(id, m);
    return m;
  } catch { return null; }
}
function targetWidth(rms, m, now) {
  if (rms >= THRESHOLD) {
    m.hold = now + HOLD_MS; // short hold so the ring doesn't flicker between words
    const t = Math.min(1, Math.log(rms / THRESHOLD) / Math.log(LOUD / THRESHOLD));
    return MIN_W + (MAX_W - MIN_W) * t;
  }
  return m.hold > now ? MIN_W : 0;
}

// measure every track once (also called by the overlay feed, so it stays fresh if timers are throttled)
export function pollLevels() {
  const now = Date.now();
  if (now - lastPoll < 25) return;
  lastPoll = now;
  const list = source?.() || [];
  const live = new Set();
  widths.clear(); swidths.clear();
  for (const s of list) {
    if (s?.fixed != null) { swidths.set(s.key, MIN_W + (MAX_W - MIN_W) * Math.max(0, Math.min(1, s.fixed))); continue; }
    if (!s?.stream) continue;
    const id = `${s.key}|${s.id || s.stream.id}`;
    live.add(id);
    const m = meterFor(id, s.key, s.stream);
    if (!m) continue;
    let rms = 0;
    if (!s.muted) {
      m.an.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
      rms = Math.sqrt(sum / m.buf.length);
    } else m.hold = 0;
    const t = targetWidth(rms, m, now);
    m.w += (t - m.w) * (t > m.w ? 0.55 : 0.2); // quick attack, gentle release
    if (t === 0 && m.w < 0.25) m.w = 0;
    // a sound stays lit for as long as it plays, even through quiet stretches of the clip
    const bucket = s.sound ? swidths : widths, w = s.sound ? Math.max(m.w, MIN_W) : m.w;
    if (w > (bucket.get(s.key) || 0)) bucket.set(s.key, w);
  }
  for (const id of [...meters.keys()]) if (!live.has(id)) dropMeter(id);
}
// ring width in px for a person (0 = silent)
export const levelOf = key => widths.get(levelKey(key)) || 0;

function paint() {
  if (typeof document === 'undefined' || document.hidden) return;
  for (const el of document.querySelectorAll('[data-vlevel]')) {
    const k = el.getAttribute('data-vlevel'), sw = swidths.get(k) || 0, w = sw || widths.get(k) || 0; // a sound they played wins, in blue
    const v = w ? `${w.toFixed(2)}px` : '0px';
    if (el.style.getPropertyValue('--vlvl') !== v) el.style.setProperty('--vlvl', v);
    if (el.hasAttribute('data-vsnd') !== !!sw) el.toggleAttribute('data-vsnd', !!sw);
  }
}
function tick() { pollLevels(); paint(); }

export function startLevels() {
  if (timer) return;
  sharedAudioContext();
  timer = setInterval(tick, 33);
}
export function stopLevels() {
  clearInterval(timer);
  timer = null;
  for (const id of [...meters.keys()]) dropMeter(id);
  widths.clear(); swidths.clear();
  paint();
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); // let go of the audio device between calls
}
