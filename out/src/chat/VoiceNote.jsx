// Recording a voice message: the recorder hook the composer drives, and the bar with the live waveform that stands in for the text box.
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { openMicrophone } from './voice.js';
import { playSound } from './store.js';
import { MAX_MS, SWIPE_CANCEL_PX, micErrorText, pickFormat, voiceFileName } from './voice-note.js';
import { fmtTime } from './MediaPlayer.jsx';

const START_CHIME_MS = 180;

// phase: idle | starting (asking for the mic) | recording | full (hit the limit; it's kept until sent or discarded)
export function useVoiceRecorder() {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const rec = useRef(null);
  const attempt = useRef(0); // a newer press or a discard makes an unfinished start give up

  function release(r) {
    clearTimeout(r.limit);
    r.stream.getTracks().forEach(t => t.stop());
    r.ctx?.close().catch(() => {});
  }
  // -> true once it's recording
  async function start() {
    if (rec.current || phase !== 'idle') return false;
    const mine = ++attempt.current;
    setError('');
    const format = typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia ? pickFormat(m => MediaRecorder.isTypeSupported(m)) : null;
    if (!format) { setError(micErrorText({ name: 'unsupported' })); return false; }
    setPhase('starting');
    let stream;
    try { stream = await openMicrophone(); } catch (e) {
      if (mine === attempt.current) { setPhase('idle'); setError(micErrorText(e)); }
      return false;
    }
    if (mine !== attempt.current) { stream.getTracks().forEach(t => t.stop()); return false; } // let go / discarded while the mic was opening
    // the chime has to be over before the recorder listens, or it ends up at the start of the message
    playSound('voice_start', 0.5);
    await new Promise(done => setTimeout(done, START_CHIME_MS));
    if (mine !== attempt.current) { stream.getTracks().forEach(t => t.stop()); return false; }
    try {
      const recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 48000 });
      const chunks = [];
      const r = { recorder, stream, chunks, started: performance.now(), ms: 0, ctx: null, analyser: null, wave: new Uint8Array(1024) };
      try { // only the waveform needs this: without it the recording still works
        r.ctx = new (window.AudioContext || window.webkitAudioContext)();
        r.ctx.resume?.().catch(() => {});
        r.analyser = r.ctx.createAnalyser();
        r.analyser.fftSize = 1024;
        r.ctx.createMediaStreamSource(stream).connect(r.analyser);
      } catch { r.analyser = null; }
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      r.done = new Promise(resolve => {
        recorder.onstop = () => {
          r.ms = performance.now() - r.started;
          const when = Date.now();
          resolve(chunks.length ? new File(chunks, voiceFileName(when, r.ms, format.ext), { type: format.type }) : null);
        };
      });
      const atLimit = () => { if (recorder.state !== 'inactive') recorder.stop(); setPhase(p => (p === 'recording' ? 'full' : p)); };
      r.limit = setTimeout(atLimit, MAX_MS);
      stream.getAudioTracks()[0]?.addEventListener('ended', atLimit); // the mic went away: keep what's there
      recorder.onerror = () => { discard(); setError(micErrorText({})); };
      rec.current = r;
      recorder.start(250);
      r.started = performance.now();
      setPhase('recording');
      return true;
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      rec.current = null;
      setPhase('idle');
      setError(micErrorText(e));
      return false;
    }
  }
  // stop and hand back the file (null if nothing was recorded)
  async function finish() {
    const r = rec.current;
    if (!r) return null;
    rec.current = null;
    attempt.current++;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    const f = await r.done;
    release(r);
    setPhase('idle');
    return f;
  }
  function discard() {
    attempt.current++;
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.recorder.ondataavailable = null;
      if (r.recorder.state !== 'inactive') { try { r.recorder.stop(); } catch { /* already stopped */ } }
      release(r);
    }
    setPhase('idle');
  }
  // 0-1: how loud the mic is right now
  const level = () => {
    const r = rec.current;
    if (!r?.analyser) return 0;
    r.analyser.getByteTimeDomainData(r.wave);
    let top = 0;
    for (const v of r.wave) { const d = Math.abs(v - 128); if (d > top) top = d; }
    return Math.min(1, top / 90);
  };
  const elapsed = () => (rec.current ? Math.min(MAX_MS, performance.now() - rec.current.started) : 0);
  useEffect(() => () => discard(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { phase, active: phase !== 'idle', error, clearError: () => setError(''), start, finish, discard, level, elapsed };
}

const STEP_MS = 70, BAR = 3, GAP = 2;
function LiveWave({ voice }) {
  const canvas = useRef(null);
  const live = useRef(voice);
  live.current = voice;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0, last = 0;
    const bars = [];
    const color = getComputedStyle(el).color;
    const draw = now => {
      raf = requestAnimationFrame(draw);
      if (now - last < STEP_MS) return;
      last = now;
      bars.push(live.current.phase === 'recording' ? live.current.level() : 0);
      const ratio = devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) { el.width = Math.round(w * ratio); el.height = Math.round(h * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const fit = Math.ceil(w / (BAR + GAP));
      if (bars.length > fit) bars.splice(0, bars.length - fit);
      bars.forEach((v, i) => {
        const bar = Math.max(2, Math.round(v * h));
        ctx.fillRect(w - (bars.length - i) * (BAR + GAP) + GAP, Math.round((h - bar) / 2), BAR, bar);
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvas} className="vc-voice-wave" aria-hidden="true" />;
}
function Elapsed({ voice }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 250); return () => clearInterval(t); }, []);
  return <span className="vc-voice-time">{fmtTime(voice.elapsed() / 1000)}</span>;
}
// mode: 'hold' (touch: let go sends, slide left deletes) | 'click' (desktop: the send button sends, the bin discards)
export function VoiceBar({ voice, mode, dragX = 0, onDiscard }) {
  const pull = Math.min(1, Math.max(0, -dragX / SWIPE_CANCEL_PX));
  return (
    <div className={`vc-voice-bar ${mode}${voice.phase === 'starting' ? ' starting' : ''}`} role="status" aria-label="Recording a voice message" style={mode === 'hold' && dragX ? { transform: `translateX(${Math.min(0, dragX) * 0.5}px)`, opacity: 1 - pull * 0.5 } : undefined}>
      {mode === 'click' && <button type="button" className="vc-ico-btn vc-voice-discard" title="Discard (Esc)" onClick={onDiscard}><Trash2 size={18} /></button>}
      <i className="vc-voice-dot" aria-hidden="true" />
      <Elapsed voice={voice} />
      {voice.phase === 'starting' ? <span className="vc-voice-hint">Starting your microphone...</span> : <LiveWave voice={voice} />}
      {voice.phase === 'full' && <span className="vc-voice-hint">5 minute limit reached</span>}
      {mode === 'hold' && voice.phase !== 'starting' && <span className={`vc-voice-hint slide${pull > 0.6 ? ' armed' : ''}`}><ChevronLeft size={14} aria-hidden="true" />{pull > 0.6 ? 'Let go to delete' : 'Slide to delete'}</span>}
    </div>
  );
}
