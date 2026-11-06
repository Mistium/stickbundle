// Internet Radio (easter egg - it has been in every ScratchCord version, so it's in Ember too).
// Chat settings radio_enabled + radio_url. While /chat is open the stream plays and bars move along the bottom of the
// page behind the messages, in the accent colour. The audio comes through Velora (/chat/radio, signed ticket) so
// WebAudio may read it; if that fails it plays straight from the station without the bars.
// One player for the whole app: the settings tab's controls talk to the same one.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { apiFetch } from '../api.js';
import { useChat } from './store.js';

const VOL_KEY = 'bonfire_radio_volume';
const readVol = () => { try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && localStorage.getItem(VOL_KEY) !== null ? Math.min(Math.max(v, 0), 1) : 0.4; } catch { return 0.4; } };

const R = { audio: null, ctx: null, analyser: null, gain: null, node: null, url: null, token: 0, gestureWait: null, retries: 0 };
let snap = { status: 'off', volume: readVol(), paused: false, proxied: false };
const subs = new Set();
const emit = patch => { snap = { ...snap, ...patch }; subs.forEach(f => f()); };
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
const getSnap = () => snap;
export const useRadio = () => useSyncExternalStore(subscribe, getSnap, getSnap);
export const radioAnalyser = () => (snap.proxied && snap.status === 'playing' && !snap.paused ? R.analyser : null);

function teardown() {
  R.token++;
  if (R.gestureWait) { removeEventListener('pointerdown', R.gestureWait, true); removeEventListener('keydown', R.gestureWait, true); R.gestureWait = null; }
  if (R.audio) {
    try { R.audio.pause(); R.audio.removeAttribute('src'); R.audio.load(); } catch { /* gone */ }
    R.audio = null;
  }
  try { R.node?.disconnect(); } catch { /* gone */ }
  R.node = null;
}
// autoplay is blocked until the first click / key press: wait for one, then try again
function waitForGesture(token) {
  emit({ status: 'waiting' });
  if (R.gestureWait) return;
  R.gestureWait = () => {
    removeEventListener('pointerdown', R.gestureWait, true); removeEventListener('keydown', R.gestureWait, true);
    R.gestureWait = null;
    if (token === R.token && !snap.paused) playWhenAllowed(token);
  };
  addEventListener('pointerdown', R.gestureWait, true);
  addEventListener('keydown', R.gestureWait, true);
}
function playWhenAllowed(token) {
  const a = R.audio;
  if (!a) return;
  const usesCtx = snap.proxied && R.ctx;
  // the AudioContext also needs a gesture; resume() just hangs without one, so give it a moment
  const ctxOk = () => (!usesCtx || R.ctx.state === 'running' ? Promise.resolve(true)
    : Promise.race([R.ctx.resume().then(() => true, () => false), new Promise(r => setTimeout(() => r(R.ctx.state === 'running'), 400))]));
  a.play().then(ctxOk).then(ok => {
    if (token !== R.token) return;
    if (ok) emit({ status: 'playing' }); else waitForGesture(token);
  }).catch(e => {
    if (token !== R.token) return;
    if (e?.name === 'NotAllowedError') waitForGesture(token); // a load error shows up as the 'error' event
  });
}
function direct(url, token) {
  if (token !== R.token) return;
  try { R.node?.disconnect(); } catch { /* gone */ }
  R.node = null;
  const a = new Audio();
  a.preload = 'none';
  a.volume = snap.volume;
  a.src = url;
  a.addEventListener('error', () => { if (token === R.token) emit({ status: 'error' }); });
  a.addEventListener('playing', () => { if (token === R.token) emit({ status: 'playing' }); });
  R.audio = a;
  emit({ proxied: false, status: 'loading' });
  if (!snap.paused) playWhenAllowed(token); else emit({ status: 'paused' });
}
async function proxied(url, token) {
  let src;
  try { src = (await apiFetch('/chat/radio/ticket', { method: 'POST', body: JSON.stringify({ url }) })).src; } catch { return direct(url, token); }
  if (token !== R.token) return;
  const a = new Audio();
  a.crossOrigin = 'anonymous';
  a.preload = 'none';
  a.volume = 1; // loudness is the gain node, so the bars don't shrink with the volume
  a.src = src;
  let started = false;
  a.addEventListener('playing', () => { started = true; if (token === R.token && (!R.ctx || R.ctx.state === 'running')) emit({ status: 'playing' }); });
  a.addEventListener('error', () => {
    if (token !== R.token) return;
    if (!started) return direct(url, token); // proxy refused it (not audio, unreachable, busy): play it straight, no bars
    emit({ status: 'error' });
    // the stream dropped after playing: tune in again a few times (a fresh ticket each time)
    if (R.retries < 3) { R.retries++; setTimeout(() => { if (token === R.token && !snap.paused) restart(); }, 5000 * R.retries); }
  });
  R.audio = a;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!R.ctx) {
      R.ctx = new AC();
      R.analyser = R.ctx.createAnalyser();
      R.analyser.fftSize = 512;
      R.analyser.smoothingTimeConstant = 0.82;
      R.gain = R.ctx.createGain();
      R.analyser.connect(R.gain).connect(R.ctx.destination);
    }
    R.gain.gain.value = snap.volume;
    R.node = R.ctx.createMediaElementSource(a);
    R.node.connect(R.analyser);
    emit({ proxied: true, status: 'loading' });
  } catch {
    a.volume = snap.volume; // no WebAudio: it still plays
    emit({ proxied: false, status: 'loading' });
  }
  if (!snap.paused) playWhenAllowed(token); else emit({ status: 'paused' });
}
export function startRadio(url) {
  if (R.url === url) return;
  teardown();
  R.url = url;
  R.retries = 0;
  proxied(url, R.token);
}
// live radio: after a pause or a drop, start from "now" again instead of the old buffer
function restart() {
  const url = R.url;
  if (!url) return;
  teardown();
  R.url = url;
  proxied(url, R.token);
}
export function stopRadio() {
  teardown();
  R.url = null;
  emit({ status: 'off', proxied: false });
}
export function setRadioVolume(v) {
  v = Math.min(Math.max(Number(v) || 0, 0), 1);
  try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* private mode */ }
  if (R.audio) { if (snap.proxied && R.gain) R.gain.gain.value = v; else R.audio.volume = v; }
  emit({ volume: v });
}
export function toggleRadioPause() {
  const paused = !snap.paused;
  emit({ paused });
  if (!R.audio) return;
  if (paused) { R.audio.pause(); emit({ status: 'paused' }); }
  else restart();
}

// ── the player + background bars on /chat ──
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export function RadioHost() {
  const enabled = useChat(s => !!s.settings.radio_enabled);
  const url = useChat(s => s.settings.radio_url || '');
  const animations = useChat(s => s.settings.animations !== false);
  const { status, proxied: viaVelora, paused } = useRadio();
  const canvas = useRef(null);

  useEffect(() => {
    if (enabled && /^https?:\/\//i.test(url)) startRadio(url);
    else stopRadio();
  }, [enabled, url]);
  useEffect(() => () => stopRadio(), []); // leaving /chat stops it

  const drawing = enabled && viaVelora && status === 'playing' && !paused && animations;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('vc-radio', drawing);
    if (!drawing) return () => {};
    const el = canvas.current;
    if (!el) return () => root.classList.remove('vc-radio');
    const g = el.getContext('2d');
    let raf = 0, accent = '#c084fc', accentAt = 0, still = reducedMotion();
    const mq = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)'); } catch { return null; } })();
    const onMq = () => { still = reducedMotion(); if (!still) loop(); };
    mq?.addEventListener?.('change', onMq);
    let data = null;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
    };
    size();
    addEventListener('resize', size);
    function frame(now) {
      raf = 0;
      if (document.hidden || still) { g.clearRect(0, 0, el.width, el.height); return; }
      const an = radioAnalyser();
      if (!an) { g.clearRect(0, 0, el.width, el.height); return; }
      if (now - accentAt > 2000) { accentAt = now; accent = getComputedStyle(root).getPropertyValue('--accent').trim() || accent; }
      if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const W = el.width, H = el.height;
      const dpr = W / Math.max(el.clientWidth, 1);
      const gap = 3 * dpr, bw = 8 * dpr;
      const n = Math.max(8, Math.floor(W / (bw + gap)));
      const usable = Math.floor(data.length * 0.72); // the top bins are mostly empty for music
      g.clearRect(0, 0, W, H);
      g.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        // log-ish spread: more bars for the low end where music lives
        const a = Math.floor(usable * Math.pow(i / n, 1.7));
        const b = Math.max(a + 1, Math.floor(usable * Math.pow((i + 1) / n, 1.7)));
        let sum = 0;
        for (let j = a; j < b; j++) sum += data[j];
        const v = sum / (b - a) / 255;
        const h = Math.max(2 * dpr, v * v * H);
        g.globalAlpha = 0.10 + v * 0.22;
        g.fillRect(i * (bw + gap), H - h, bw, h);
      }
      g.globalAlpha = 1;
      loop();
    }
    function loop() { if (!raf && !document.hidden && !still) raf = requestAnimationFrame(frame); }
    const onVis = () => { if (!document.hidden) loop(); };
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVis);
      mq?.removeEventListener?.('change', onMq);
      g.clearRect(0, 0, el.width, el.height);
      root.classList.remove('vc-radio');
    };
  }, [drawing]);

  if (!enabled) return null;
  return <canvas ref={canvas} className="vc-radio-viz" aria-hidden="true" />;
}
