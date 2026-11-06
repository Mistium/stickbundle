// Ember's own video + audio players (instead of the browser's): seek bar with buffered part and
// a time preview, volume (remembered), speed, picture-in-picture, fullscreen, keyboard keys
// (space / k play, arrows seek + volume, m mute, f fullscreen). Only one thing plays at a time.
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, Volume1, VolumeX, Maximize, Minimize, PictureInPicture2, Loader2, RotateCcw, Music } from 'lucide-react';
import { peaksOf, seededPeaks, voiceSeconds } from './voice-note.js';

const VOL_KEY = 'bonfire_media_volume';
const savedVol = () => { try { const v = JSON.parse(localStorage.getItem(VOL_KEY) || 'null'); return v && typeof v.volume === 'number' ? v : { volume: 0.8, muted: false }; } catch { return { volume: 0.8, muted: false }; } };
const saveVol = (volume, muted) => { try { localStorage.setItem(VOL_KEY, JSON.stringify({ volume, muted })); } catch { /* fine */ } };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const fmtTime = s => {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

function useMedia(ref) {
  const [st, setSt] = useState({ playing: false, time: 0, duration: 0, buffered: 0, waiting: false, ended: false, rate: 1, ...savedVol() });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const v = savedVol();
    el.volume = v.volume; el.muted = v.muted;
    const up = () => setSt(s => ({
      ...s, playing: !el.paused, time: el.currentTime, duration: el.duration || 0, rate: el.playbackRate, volume: el.volume, muted: el.muted, ended: el.ended,
      buffered: el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0,
    }));
    const onPlay = () => { dispatchEvent(new CustomEvent('bonfire-media-play', { detail: el })); up(); };
    const others = e => { if (e.detail !== el && !el.paused) el.pause(); };
    const ev = { timeupdate: up, seeked: up, durationchange: up, progress: up, pause: up, ended: up, ratechange: up, loadedmetadata: up, play: onPlay,
      volumechange: () => { saveVol(el.volume, el.muted); up(); }, waiting: () => setSt(s => ({ ...s, waiting: true })), playing: () => setSt(s => ({ ...s, waiting: false })), canplay: () => setSt(s => ({ ...s, waiting: false })) };
    Object.entries(ev).forEach(([k, f]) => el.addEventListener(k, f));
    addEventListener('bonfire-media-play', others);
    up();
    return () => { Object.entries(ev).forEach(([k, f]) => el.removeEventListener(k, f)); removeEventListener('bonfire-media-play', others); };
  }, [ref]);
  const el = () => ref.current;
  return {
    st,
    toggle: () => { const m = el(); if (!m) return; if (m.paused || m.ended) m.play().catch(() => {}); else m.pause(); },
    seek: t => { const m = el(); if (m && Number.isFinite(m.duration)) m.currentTime = Math.max(0, Math.min(m.duration, t)); },
    setVolume: v => { const m = el(); if (!m) return; m.volume = Math.max(0, Math.min(1, v)); m.muted = m.volume === 0; },
    toggleMute: () => { const m = el(); if (!m) return; if (m.muted && m.volume === 0) m.volume = 0.5; m.muted = !m.muted; },
    setRate: r => { const m = el(); if (m) m.playbackRate = r; },
  };
}

function SeekBar({ st, seek }) {
  const bar = useRef(null);
  const [hover, setHover] = useState(null);
  const [drag, setDrag] = useState(null);
  const at = e => { const r = bar.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const pct = st.duration ? (drag ?? st.time / st.duration) * 100 : 0;
  return (
    <div className="vc-mp-seek" ref={bar}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)); }}
      onPointerMove={e => { setHover(at(e)); if (drag != null) setDrag(at(e)); }}
      onPointerUp={e => { if (drag != null) { seek(at(e) * st.duration); setDrag(null); } }}
      onPointerLeave={() => setHover(null)}>
      <i className="vc-mp-buf" style={{ width: `${st.duration ? (st.buffered / st.duration) * 100 : 0}%` }} />
      <i className="vc-mp-done" style={{ width: `${pct}%` }} />
      <i className="vc-mp-knob" style={{ left: `${pct}%` }} />
      {hover != null && st.duration > 0 && <span className="vc-mp-tip" style={{ left: `${hover * 100}%` }}>{fmtTime(hover * st.duration)}</span>}
    </div>
  );
}
function VolumeCtl({ st, setVolume, toggleMute }) {
  const v = st.muted ? 0 : st.volume;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <span className="vc-mp-vol">
      <button type="button" className="vc-mp-btn" title={st.muted ? 'Unmute (m)' : 'Mute (m)'} onClick={toggleMute}><Icon size={17} /></button>
      <input type="range" min={0} max={1} step={0.02} value={v} onChange={e => setVolume(Number(e.target.value))} style={{ '--v': `${v * 100}%` }} aria-label="Volume" />
    </span>
  );
}
function SpeedCtl({ st, setRate }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="vc-mp-speed">
      <button type="button" className="vc-mp-btn txt" title="Playback speed" onClick={() => setOpen(o => !o)}>{st.rate}x</button>
      {open && <span className="vc-mp-menu" onMouseLeave={() => setOpen(false)}>{SPEEDS.map(r => <button type="button" key={r} className={r === st.rate ? 'on' : ''} onClick={() => { setRate(r); setOpen(false); }}>{r}x</button>)}</span>}
    </span>
  );
}
function keys(e, m, media, extra) {
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') { e.preventDefault(); m.toggle(); }
  else if (k === 'arrowright') { e.preventDefault(); m.seek(media.currentTime + 5); }
  else if (k === 'arrowleft') { e.preventDefault(); m.seek(media.currentTime - 5); }
  else if (k === 'arrowup') { e.preventDefault(); m.setVolume(media.volume + 0.1); }
  else if (k === 'arrowdown') { e.preventDefault(); m.setVolume(media.volume - 0.1); }
  else if (k === 'm') m.toggleMute();
  else if (k === 'f') extra?.fullscreen?.();
}

export function VideoPlayer({ src, poster, autoPlay, className = '', onError }) {
  const box = useRef(null);
  const ref = useRef(null);
  const m = useMedia(ref);
  const { st } = m;
  const [idle, setIdle] = useState(false);
  const [fs, setFs] = useState(false);
  const [started, setStarted] = useState(!!autoPlay);
  const timer = useRef(null);
  const wake = () => { setIdle(false); clearTimeout(timer.current); timer.current = setTimeout(() => setIdle(true), 2500); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // fullscreen: the player itself (so our controls come along) where the browser allows it; phones / WebViews that only fullscreen
  // the <video> (iPhone Safari: webkitEnterFullscreen, some Android WebViews: video.requestFullscreen) get that instead.
  useEffect(() => {
    const f = () => setFs((document.fullscreenElement || document.webkitFullscreenElement) === box.current);
    const vid = ref.current;
    const off = () => setFs(false);
    document.addEventListener('fullscreenchange', f); document.addEventListener('webkitfullscreenchange', f);
    vid?.addEventListener('webkitendfullscreen', off);
    return () => { document.removeEventListener('fullscreenchange', f); document.removeEventListener('webkitfullscreenchange', f); vid?.removeEventListener('webkitendfullscreen', off); };
  }, []);
  const fullscreen = async () => {
    const el = box.current, v = ref.current;
    if (!el || !v) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* already out */ } return; }
    if (v.webkitDisplayingFullscreen) { v.webkitExitFullscreen?.(); return; }
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) { try { await fn.call(el); return; } catch { /* try the video itself */ } }
    if (v.requestFullscreen) { try { await v.requestFullscreen(); return; } catch { /* next */ } }
    if (v.webkitRequestFullscreen) { try { v.webkitRequestFullscreen(); return; } catch { /* next */ } }
    if (!v.webkitEnterFullscreen) return;
    try { v.webkitEnterFullscreen(); return; } catch { /* iPhone: nothing loaded yet (it ignores preload), see below */ }
    // iPhone Safari throws until the video has its metadata, and it only starts loading on play: start it (we're inside the tap),
    // then go fullscreen the moment the size is known
    const go = () => { clearTimeout(t); v.removeEventListener('loadedmetadata', go); try { v.webkitEnterFullscreen(); } catch { /* give up */ } };
    const t = setTimeout(() => v.removeEventListener('loadedmetadata', go), 10000);
    v.addEventListener('loadedmetadata', go);
    v.play().catch(() => {});
  };
  const pip = () => { const v = ref.current; if (!v) return; if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); else v.requestPictureInPicture?.().catch(() => {}); };
  const hide = st.playing && idle && !st.waiting;
  return (
    <div ref={box} tabIndex={0} className={`vc-mp video${hide ? ' idle' : ''}${fs ? ' fs' : ''} ${className}`}
      onMouseMove={wake} onMouseLeave={() => st.playing && setIdle(true)} onKeyDown={e => keys(e, m, ref.current, { fullscreen })}>
      <video ref={ref} src={src} poster={poster} autoPlay={autoPlay} playsInline preload="metadata" onError={onError}
        onClick={() => { setStarted(true); m.toggle(); }} onDoubleClick={fullscreen} onPlay={() => setStarted(true)} />
      {st.waiting && <span className="vc-mp-wait"><Loader2 size={34} className="vc-spin" /></span>}
      {!started && !st.playing && <button type="button" className="vc-mp-big" title="Play" onClick={() => { setStarted(true); m.toggle(); }}><Play size={28} fill="currentColor" /></button>}
      <div className="vc-mp-bar" onClick={e => e.stopPropagation()}>
        <SeekBar st={st} seek={m.seek} />
        <div className="vc-mp-row">
          <button type="button" className="vc-mp-btn" title={st.playing ? 'Pause (k)' : 'Play (k)'} onClick={() => { setStarted(true); m.toggle(); }}>{st.ended ? <RotateCcw size={17} /> : st.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
          <VolumeCtl st={st} setVolume={m.setVolume} toggleMute={m.toggleMute} />
          <span className="vc-mp-time">{fmtTime(st.time)} / {fmtTime(st.duration)}</span>
          <span className="grow" />
          <SpeedCtl st={st} setRate={m.setRate} />
          {document.pictureInPictureEnabled && <button type="button" className="vc-mp-btn" title="Picture in picture" onClick={pip}><PictureInPicture2 size={17} /></button>}
          <button type="button" className="vc-mp-btn" title={fs ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} onClick={fullscreen}>{fs ? <Minimize size={17} /> : <Maximize size={17} />}</button>
        </div>
      </div>
    </div>
  );
}

// ── voice messages ──
// bars for a file: decoded here (read once, two at a time), or steady made-up ones when the file can't be read from this page
const VOICE_BARS = 44;
const peakCache = new Map();
const peakQueue = [];
let peakBusy = 0;
function nextPeak() {
  if (peakBusy >= 2 || !peakQueue.length) return;
  peakBusy++;
  const { src, resolve } = peakQueue.shift();
  (async () => {
    const r = await fetch(src, { credentials: 'omit' });
    if (!r.ok) throw new Error('fetch');
    const buf = await new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 8000).decodeAudioData(await r.arrayBuffer());
    return peaksOf(buf.getChannelData(0), VOICE_BARS);
  })().catch(() => seededPeaks(src, VOICE_BARS)).then(resolve).finally(() => { peakBusy--; nextPeak(); });
}
const peaksFor = src => {
  if (!peakCache.has(src)) { peakCache.set(src, new Promise(resolve => { peakQueue.push({ src, resolve }); nextPeak(); })); }
  return peakCache.get(src);
};
export function VoicePlayer({ src, name }) {
  const box = useRef(null);
  const ref = useRef(null);
  const m = useMedia(ref);
  const { st } = m;
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  const [peaks, setPeaks] = useState(() => seededPeaks(src, VOICE_BARS));
  useEffect(() => { // nothing is read until it's near the screen: a long history of voice messages stays cheap
    if (seen || !box.current) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return undefined;
    let live = true;
    peaksFor(src).then(p => { if (live) setPeaks(p); });
    return () => { live = false; };
  }, [seen, src]);
  // a recorded webm doesn't say how long it is. Asking for a spot past the end makes the browser work it out, and only then can it seek
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const meta = () => {
      if (el.duration !== Infinity) return;
      const back = () => { if (el.duration !== Infinity) { el.removeEventListener('durationchange', back); el.currentTime = 0; } };
      el.addEventListener('durationchange', back);
      el.currentTime = 1e7;
    };
    el.addEventListener('loadedmetadata', meta);
    return () => el.removeEventListener('loadedmetadata', meta);
  }, []);
  const duration = Number.isFinite(st.duration) && st.duration > 0 ? st.duration : voiceSeconds(name);
  const done = duration ? Math.min(1, st.time / duration) : 0;
  const seekAt = e => {
    const el = ref.current, r = e.currentTarget.getBoundingClientRect();
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  return (
    <div ref={box} className="vc-mp voice" tabIndex={0} onKeyDown={e => keys(e, m, ref.current)}>
      <audio ref={ref} src={seen ? src : undefined} preload="metadata" />
      <button type="button" className="vc-mp-play" title={st.playing ? 'Pause' : 'Play voice message'} onClick={m.toggle}>{st.waiting ? <Loader2 size={18} className="vc-spin" /> : st.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
      <div className="vc-mp-vwave" role="slider" aria-label="Voice message position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(st.time)} onPointerDown={seekAt}>
        {peaks.map((p, i) => <i key={i} className={(i + 0.5) / peaks.length <= done ? 'on' : ''} style={{ height: `${Math.round(p * 100)}%` }} />)}
      </div>
      <span className="vc-mp-time">{fmtTime(st.time > 0 ? st.time : duration)}</span>
      <SpeedCtl st={st} setRate={m.setRate} />
    </div>
  );
}

export function AudioPlayer({ src, name }) {
  const ref = useRef(null);
  const m = useMedia(ref);
  const { st } = m;
  return (
    <div className="vc-mp audio" tabIndex={0} onKeyDown={e => keys(e, m, ref.current)}>
      <audio ref={ref} src={src} preload="metadata" />
      <button type="button" className="vc-mp-play" title={st.playing ? 'Pause' : 'Play'} onClick={m.toggle}>{st.waiting ? <Loader2 size={18} className="vc-spin" /> : st.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
      <div className="vc-mp-audio-main">
        <div className="vc-mp-audio-top"><span className="vc-mp-name"><Music size={13} /> {name || 'Audio'}</span><span className="vc-mp-time">{fmtTime(st.time)} / {fmtTime(st.duration)}</span></div>
        <SeekBar st={st} seek={m.seek} />
      </div>
      <SpeedCtl st={st} setRate={m.setRate} />
      <VolumeCtl st={st} setVolume={m.setVolume} toggleMute={m.toggleMute} />
    </div>
  );
}
