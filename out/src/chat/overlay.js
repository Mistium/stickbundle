// Ember desktop: feeds the in-game overlay (the app's transparent window over your game, see bonfire-desktop
// lib/overlay.js). Does nothing in a normal browser. Only works while the app says the overlay is up (`active`):
//   - every 150 ms a small snapshot of the call (who's in it, speaking / muted / deafened, LIVE), the video tiles,
//     streams you aren't watching and incoming calls -> sent only when it changed,
//   - JPEG frames of the video tiles the overlay is drawing, at the size + fps it asks for (cameras 15, screens 10),
//     read straight off the WebRTC track (MediaStreamTrackProcessor, a <video> fallback) - nothing while hidden,
//   - message toasts: store.js asks us first (onOverlayToast) once it has decided a notification is due, so mutes,
//     DND and your notification setting still apply.
// Streams stay opt-in: only the screens you clicked Watch on have frames; others are "X is streaming" chips.
// Speaking + loudness come from levels.js (one WebAudio meter per mic track, also drives the web UI's rings).
import { getState, onOverlayToast } from './store.js';
import { pollLevels, levelOf } from './levels.js';
import { inviteSummary } from './gameInvite.js';
import { shownName, shownPfp } from './aliases.js';

const D = typeof window !== 'undefined' ? window.bonfireDesktop?.overlay : null;
let voiceApi = null; // voice.js hands us its mute / deafen / watch functions
export function registerOverlayVoice(api) { voiceApi = api; }

let active = false;
let notesOn = true;
let timer = null;
let lastSig = '';
let lastSent = 0;
let wants = [];           // [{ id, w, h, fps }] tiles the overlay draws
const feeds = new Map();  // tile id -> frame pump
const abs = u => { if (!u || typeof u !== 'string') return ''; try { return new URL(u, location.origin).href; } catch { return ''; } };
const kindOf = k => (k === 'screen' ? 'screen' : 'camera');

// ── who's speaking: levels.js measures everyone's mic (shared with the speaking rings in the web UI) ──
function speaking() {
  pollLevels();
  return name => levelOf(name);
}

// ── the snapshot the overlay draws ──
function snapshot() {
  const s = getState(), v = s.voice, me = s.me;
  const pfp = n => abs(s.people?.[n]?.pfp || (me && n === me.username ? me.pfp : ''));
  const incoming = (s.incoming || []).map(c => ({ callId: c.callId, from: c.from, pfp: pfp(c.from), where: /^bf_/.test(c.room || '') ? 'wants you in a voice channel' : 'is calling you' }));
  if (!v) return { voice: null, tiles: [], streams: [], incoming };
  const talk = speaking();
  const myName = String(me?.username || '').toLowerCase();
  // others' mute / deafen as the server reports them (voice channel list / DM call state)
  const others = v.info?.kind === 'call' ? s.dmCalls?.[String(v.info.with || '').toLowerCase()]?.users : v.info?.cid ? s.voiceStates?.[v.info.cid] : null;
  const stateOf = n => (others || []).find(x => String(x.username).toLowerCase() === String(n).toLowerCase()) || {};
  const live = new Set((v.streams || []).map(x => (/^\d+$/.test(String(x.userId)) ? Number(x.userId) : String(x.userId))));
  if (v.screen) live.add(/^\d+$/.test(String(v.myId)) ? Number(v.myId) : String(v.myId));
  const seen = new Set(), users = [];
  for (const u of v.users || []) {
    const key = String(u.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = u.id === v.myId || key === myName;
    users.push({
      id: u.id, name: u.name, pfp: pfp(u.name), me: mine,
      muted: mine ? !!v.muted : !!(u.muted || stateOf(u.name).muted),
      deafened: mine ? !!v.deafened : !!(u.deafened || stateOf(u.name).deafened),
      speaking: talk(u.name) > 0,
      level: Math.round(talk(u.name) * 4) / 4, // ring width in px (0 silent, ~1.5 speaking, ~4.75 loud), rounded so the snapshot changes less
      live: live.has(Number(u.id)),
    });
  }
  const where = v.info?.kind === 'call' ? `Call with ${v.info.with || ''}` : `${v.info?.name || 'Voice'}${v.info?.server ? ` / ${v.info.server}` : ''}`;
  const tiles = [], ids = new Set();
  for (const x of v.remoteVideo || []) {
    const id = `${x.userId}:${kindOf(x.kind)}`;
    if (ids.has(id)) continue;
    ids.add(id);
    tiles.push({ id, userId: x.userId, name: x.name, kind: kindOf(x.kind) });
  }
  if (v.cameraVideo) tiles.push({ id: 'me:camera', name: me?.username || 'You', kind: 'camera', mine: true });
  const watching = new Set((v.watching || []).map(Number));
  const streams = (v.streams || []).filter(x => Number(x.userId) !== Number(v.myId) && !watching.has(Number(x.userId))).map(x => ({ userId: x.userId, name: x.name }));
  return { voice: { where, status: v.status, muted: !!v.muted, deafened: !!v.deafened, users }, tiles, streams, incoming };
}

// ── video frames ──
function streamFor(id) {
  const v = getState().voice;
  if (!v) return null;
  if (id === 'me:camera') return v.cameraVideo || null;
  return (v.remoteVideo || []).find(x => `${x.userId}:${kindOf(x.kind)}` === id)?.stream || null;
}
function startFeed(id, track, w) {
  const f = { track, w: w.w, h: w.h, fps: w.fps, stopped: false, busy: false, last: 0, stop: () => {} };
  const canvas = new OffscreenCanvas(16, 9), cx = canvas.getContext('2d');
  const draw = (src, sw, sh) => {
    const sc = Math.min(1, f.w / sw, f.h / sh);
    const W = Math.max(2, Math.round(sw * sc)), H = Math.max(2, Math.round(sh * sc));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    cx.drawImage(src, 0, 0, W, H);
  };
  const ship = async () => {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    const buf = await blob.arrayBuffer();
    if (!f.stopped) D.frame(id, canvas.width, canvas.height, buf);
  };
  if (typeof MediaStreamTrackProcessor === 'function') {
    // reads frames straight off the track: no <video>, keeps working while Ember's window is hidden in the tray
    const clone = track.clone();
    const reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 }).readable.getReader();
    f.stop = () => { f.stopped = true; reader.cancel().catch(() => {}); clone.stop(); };
    (async () => {
      while (!f.stopped) {
        let r;
        try { r = await reader.read(); } catch { break; }
        if (r.done) break;
        const frame = r.value, now = performance.now();
        if (f.busy || now - f.last < 1000 / f.fps) { frame.close(); continue; }
        f.busy = true; f.last = now;
        try { draw(frame, frame.displayWidth, frame.displayHeight); } catch { /* fine */ }
        frame.close();
        ship().catch(() => {}).finally(() => { f.busy = false; });
      }
    })();
  } else {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([track]);
    video.play().catch(() => {});
    const t = setInterval(() => {
      if (f.busy || video.readyState < 2 || !video.videoWidth) return;
      f.busy = true;
      try { draw(video, video.videoWidth, video.videoHeight); } catch { /* fine */ }
      ship().catch(() => {}).finally(() => { f.busy = false; });
    }, Math.round(1000 / f.fps));
    f.stop = () => { f.stopped = true; clearInterval(t); video.pause(); video.srcObject = null; };
  }
  return f;
}
function syncFeeds() {
  const keep = new Set();
  if (active && D) {
    for (const w of wants) {
      const track = streamFor(w.id)?.getVideoTracks?.()[0];
      if (!track || track.readyState === 'ended') continue;
      keep.add(w.id);
      const f = feeds.get(w.id);
      if (f && f.track === track) { f.w = w.w; f.h = w.h; f.fps = w.fps; continue; }
      f?.stop();
      feeds.set(w.id, startFeed(w.id, track, w));
    }
  }
  for (const [id, f] of feeds) if (!keep.has(id)) { f.stop(); feeds.delete(id); }
}

// ── loop ──
function tick() {
  const snap = snapshot(), sig = JSON.stringify(snap), now = Date.now();
  if (sig !== lastSig || now - lastSent > 3000) { lastSig = sig; lastSent = now; D.post({ type: 'state', ...snap }); }
  syncFeeds();
}
function setActive(on) {
  if (on === active) return;
  active = on;
  if (on) { lastSig = ''; tick(); timer = setInterval(tick, 150); }
  else { clearInterval(timer); timer = null; syncFeeds(); }
}
const cleanText = t => String(t || '')
  .replace(/<a?:(\w+):[\w-]+>/g, ':$1:')
  .replace(/<@&[\w-]+>/g, '@role')
  .replace(/<t:(\d+)(:\w)?>/g, (_, n) => new Date(Number(n) * 1000).toLocaleString())
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200);

if (D) {
  D.onState(st => { notesOn = st?.notifications !== false; setActive(!!st?.active); });
  D.onMessage(m => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') { lastSig = ''; if (active) tick(); return; }
    if (m.type === 'want') {
      wants = (Array.isArray(m.tiles) ? m.tiles : []).slice(0, 12).map(t => ({
        id: String(t.id), w: Math.max(32, Math.min(1280, Number(t.w) || 480)), h: Math.max(18, Math.min(720, Number(t.h) || 270)), fps: Math.max(1, Math.min(20, Number(t.fps) || 10)),
      }));
      syncFeeds();
      return;
    }
    if (m.type === 'action' && voiceApi && getState().voice) {
      if (m.action === 'mute') voiceApi.setMute(!!m.on);
      else if (m.action === 'deafen') voiceApi.setDeafen(!!m.on);
      else if (m.action === 'watch') voiceApi.watchStream(Number(m.userId));
      else if (m.action === 'unwatch') voiceApi.unwatchStream(Number(m.userId));
    }
  });
  // store.js has already checked DND, mutes and your notification setting before asking
  onOverlayToast((key, msg) => {
    if (!active || !notesOn) return false;
    const s = getState();
    let kind = 'dm', where = 'Direct message';
    if (key.startsWith('c:')) {
      kind = 'message';
      const d = s.detail?.[msg.server], ch = d?.channels?.find(c => c.cid === msg.channel);
      where = ch ? `#${ch.name}${d?.server?.name ? ` in ${d.server.name}` : ''}` : 'Server message';
    } else if (key.startsWith('g:')) {
      kind = 'group';
      const g = (s.groups || []).find(x => `g:${x.room}` === key);
      where = g?.name || g?.title || 'Group chat';
    }
    D.post({ type: 'toast', toast: { kind, title: shownName(msg), body: cleanText(inviteSummary(msg.body)) || 'sent an attachment', where, icon: abs(shownPfp(msg)) } });
    return true;
  });
}
