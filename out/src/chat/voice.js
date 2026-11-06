// Ember voice uses Cloudflare Realtime SFU. Media never travels over Velora's WebSocket.
import { apiFetch } from '../api.js';
import { getState, patchState, send, onVoiceEvent, playSound, toast, errorText, dmErrorText, timedOutIn, untilText } from './store.js';
import { VELORA, instOf, isInst, registry } from './ids.js';
import { connections } from './instances.js';
import { registerOverlayVoice } from './overlay.js';
import { sharedAudioContext, startLevels, stopLevels, registerLevelSource, levelKey } from './levels.js';

const PREFS_KEY = 'bonfire_voice_prefs';
// input/output/camera = deviceId ('' = system default), inVol 0-200 %, outVol 0-100 %, sens = mic sensitivity 0-100
// muted / deafened = the always-visible buttons by the settings cog: remembered, and applied when you join
// (0 = off; the old engine's `gate` key is ignored on purpose), board = soundboard volume, volumes = per person
const DEFAULT_PREFS = { input: '', output: '', camera: '', volumes: {}, inVol: 100, outVol: 100, sens: 0, board: 60, noiseSuppression: true, muted: false, deafened: false };
export function prefs() { try { const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; p.volumes = p.volumes || {}; return p; } catch { return { ...DEFAULT_PREFS, volumes: {} }; } }
export function setPrefs(p) { const before = prefs(), n = { ...before, ...p }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch {} patchState({ voicePrefs: n }); applyVolumes(); applyOutputs(); applyMicParams(); if (n.input !== before.input || n.noiseSuppression !== before.noiseSuppression) queueDevice(swapMic).catch(() => toast("Couldn't switch your microphone.")); if (n.camera !== before.camera) queueDevice(swapCamera).catch(() => toast("Couldn't switch your camera.")); return n; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));

// ── devices (cached so the right-click menus open instantly; refreshed on devicechange) ──
let devices = { audioinput: [], audiooutput: [], videoinput: [] };
const realDevices = list => list.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
export async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return devices;
  try { const list = await navigator.mediaDevices.enumerateDevices(); devices = { audioinput: realDevices(list.filter(d => d.kind === 'audioinput')), audiooutput: realDevices(list.filter(d => d.kind === 'audiooutput')), videoinput: realDevices(list.filter(d => d.kind === 'videoinput')) }; } catch { /* keep the old list */ }
  return devices;
}
export const knownDevices = () => devices;
const present = (kind, id) => devices[kind].some(d => d.deviceId === id);
let deviceSerial = Promise.resolve();
const queueDevice = fn => (deviceSerial = deviceSerial.catch(() => {}).then(fn));
const missingDevice = e => ['OverconstrainedError', 'NotFoundError'].includes(e?.name);
// open the saved device; if it's gone (unplugged), fall back to the system default
async function openDevice(constraints, id) { try { return await navigator.mediaDevices.getUserMedia(constraints(id)); } catch (e) { if (id && missingDevice(e)) return navigator.mediaDevices.getUserMedia(constraints('')); throw e; } }
const micConstraints = id => ({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: prefs().noiseSuppression !== false, autoGainControl: true, channelCount: 1 }, video: false });
// a separate stream of the chosen mic (voice messages): stopping it leaves a call's own stream alone
export const openMicrophone = () => openDevice(micConstraints, prefs().input);
const camConstraints = id => ({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 854, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: false });

// ── mic chain: raw mic -> input volume + noise gate (AudioWorklet) -> the track we send ──
// Falls back to sending the raw mic (no volume / gate) if the browser can't run it.
const GATE_SRC = `registerProcessor('bf-gate', class extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4 }, { name: 'threshold', defaultValue: 0, minValue: 0, maxValue: 1 }]; }
  constructor() { super(); this.g = 1; this.hold = 0; this.n = 0; this.peak = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0][0];
    if (!out) return true;
    const ch = inp && inp[0];
    if (!ch) { out.fill(0); return true; }
    const gain = p.gain[0], thr = p.threshold[0];
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length) * gain;
    if (thr <= 0 || rms >= thr) this.hold = sampleRate * 0.25; else this.hold = Math.max(0, this.hold - ch.length);
    const target = thr <= 0 || this.hold > 0 ? 1 : 0;
    let g = this.g;
    for (let i = 0; i < ch.length; i++) { g += (target - g) * (target > g ? 0.02 : 0.0015); out[i] = ch[i] * gain * g; }
    this.g = g;
    this.peak = Math.max(this.peak, rms);
    if (++this.n >= 8) { this.port.postMessage(this.peak); this.n = 0; this.peak = 0; }
    return true;
  }
});`;
let mic = null, micRms = 0, gateLoaded = null;
const sensToRms = s => (s > 0 ? Math.pow(10, (-70 + s * 0.6) / 20) : 0);
export const sensLabel = s => (s > 0 ? `${Math.round(-70 + s * 0.6)} dB` : 'Off');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function buildMicChain(stream) {
  try {
    const c = sharedAudioContext();
    if (!c?.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
    if (c.state !== 'running') await Promise.race([c.resume(), sleep(400)]);
    if (c.state !== 'running') return null; // a suspended context would send silence
    gateLoaded = gateLoaded || c.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE_SRC], { type: 'application/javascript' })));
    await gateLoaded;
    const src = c.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(c, 'bf-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const dest = c.createMediaStreamDestination();
    src.connect(node).connect(dest);
    node.port.onmessage = e => { micRms = Number(e.data) || 0; };
    const chain = { src, node, dest, track: dest.stream.getAudioTracks()[0] };
    applyMicParams(chain);
    return chain;
  } catch { gateLoaded = null; return null; }
}
function applyMicParams(c = mic) { if (!c) return; const p = prefs(), t = c.node.context.currentTime; c.node.parameters.get('gain').setValueAtTime(clamp(p.inVol ?? 100, 0, 200) / 100, t); c.node.parameters.get('threshold').setValueAtTime(sensToRms(clamp(p.sens, 0, 100)), t); }
function disposeChain(c) { if (!c) return; try { c.src.disconnect(); c.node.disconnect(); c.node.port.onmessage = null; } catch { /* fine */ } c.track?.stop(); }
function dropMicChain() { disposeChain(mic); mic = null; micRms = 0; }
const micOutTrack = () => (mic ? mic.track : micStream?.getAudioTracks()[0]);
// true while volume + sensitivity actually apply (in a call, browser supports it)
export const micProcessing = () => !!mic;
// your mic level on the sensitivity slider's 0..1 scale (before the gate), null when not measurable
export function micMeter() { if (!mic || !micStream) return null; const db = micRms > 0 ? 20 * Math.log10(micRms) : -100; return clamp((db + 70) / 60, 0, 1); }
// a voice room is bf_<cid> (an instance's channel id carries its origin, so the room can only be on that instance's socket); DM calls (bfc_...) stay on Velora
const roomInst = r => (/^bf_/.test(r || '') ? instOf(String(r).slice(3)) : VELORA);
const meFor = r => (roomInst(r) === VELORA ? getState().me : connections.get(roomInst(r))?.user) || getState().me;
const roomInfo = room => { const st = getState(), m = /^bf_(.+)$/.exec(room || ''); if (m) for (const [sid, d] of Object.entries(st.detail)) { const c = d?.channels.find(x => x.cid === m[1]); if (c) return { kind: 'channel', sid, cid: c.cid, name: c.name, server: d.server.name, allowCallIn: !!c.config?.allow_call_in }; } return /^bfc_/.test(room || '') ? { kind: 'call', with: st.dmCallWith?.[room] || '' } : { kind: 'channel', name: 'voice channel', server: '' }; };
let senders = {}, watching = new Set(), appliedSig = '', pubSerial = Promise.resolve(), producer, consumer, micStream, cameraStream, screenStream, iceServers = [], room = null, serial = Promise.resolve(), turnRefresh, recoveryTimer, recovering = false, recoveryAttempts = 0, lastPeople = [], announcedConnection = false;
const pending = new Map(), receiveMids = new Map(), media = new Map();
const request = (type, data = {}) => new Promise((resolve, reject) => { const nonce = `rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`, timer = setTimeout(() => { pending.delete(nonce); reject(new Error('rtc_timeout')); }, 20000); pending.set(nonce, { resolve, reject, timer }); if (!send({ type, nonce, ...data })) { clearTimeout(timer); pending.delete(nonce); reject(new Error('offline')); } });
const settle = (m, fail) => { const p = pending.get(m.nonce); if (!p) return false; clearTimeout(p.timer); pending.delete(m.nonce); fail ? p.reject(Object.assign(new Error(m.error || 'rtc_error'), { cap_minutes: m.cap_minutes, used_minutes: m.used_minutes })) : p.resolve(m); return true; };
// Cloudflare's SFU is ICE-lite: it never needs our candidates in the SDP, the
// browser finds it and runs the checks.  Waiting for gathering to "complete" with
// 8 STUN/TURN urls (some unreachable) cost seconds per peer connection, so only
// give host/srflx candidates a moment to show up and move on.
const waitIce = (pc, cap = 350) => new Promise(done => { if (pc.iceGatheringState === 'complete') return done(); let t; const finish = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', f); done(); }, f = () => { if (pc.iceGatheringState === 'complete') finish(); }; pc.addEventListener('icegatheringstatechange', f); t = setTimeout(finish, cap); });
const setVoice = patch => patchState(s => ({ voice: s.voice ? { ...s.voice, ...(typeof patch === 'function' ? patch(s.voice) : patch) } : s.voice }));
const newPc = () => new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
const streamsOf = people => (people || []).filter(p => (p.tracks || []).some(t => t.trackName === 'screen')).map(p => ({ userId: p.userId, name: p.username, audio: p.tracks.some(t => t.trackName === 'screen_audio'), watchers: p.watchers || [] }));
// others joining or leaving the call you are in: the join / leave sound (not for yourself, not for the first list after you connect)
let knownPeople = null;
function peopleSounds(people) {
  const mine = String(meFor(room)?.username || '').toLowerCase(), now = new Map();
  for (const p of people || []) if (String(p.username).toLowerCase() !== mine) now.set(String(p.userId), p);
  const before = knownPeople; knownPeople = now;
  if (!before) return;
  if ([...now.keys()].some(k => !before.has(k))) playSound('join', .5);
  else if ([...before.keys()].some(k => !now.has(k))) playSound('leave', .5);
}
function setPeople(people) { const ids = new Set(streamsOf(people).map(x => uid(x.userId))); for (const id of [...watching]) if (!ids.has(id)) watching.delete(id); setVoice({ users: usersFor(people), streams: streamsOf(people), watching: [...watching] }); }
const uid = x => (/^\d+$/.test(String(x)) ? Number(x) : String(x)); // Velora's user ids are numbers, an instance's are principals (v:2)
const usersFor = people => { const users = (people || []).map(p => ({ id: p.userId, name: p.username, muted: false, deafened: false, speaking: false })), me = meFor(room); if (me?.username && !users.some(u => String(u.name).toLowerCase() === String(me.username).toLowerCase())) users.push({ id: me.id, name: me.username, muted: false, deafened: false, speaking: false }); return users; };
const trackName = t => t === micOutTrack() || t === micStream?.getAudioTracks()[0] ? 'audio' : t === cameraStream?.getVideoTracks()[0] ? 'camera' : screenStream?.getAudioTracks().includes(t) ? 'screen_audio' : 'screen';
async function microphone() { if (micStream) return micStream; const got = await openDevice(micConstraints, prefs().input); if (!room) { got.getTracks().forEach(t => t.stop()); throw new Error('left'); } micStream = got; { const t = got.getAudioTracks()[0]; if (t) t.enabled = !getState().voice?.muted; } watchMicTrack(); void refreshDevices(); return micStream; }
// the mic got unplugged: carry on with the default one instead of dropping the call
function watchMicTrack() { const t = micStream?.getAudioTracks()[0]; if (t) t.onended = () => { if (room && micStream?.getAudioTracks()[0] === t) queueDevice(swapMic).catch(() => toast('Your microphone disconnected.')); }; }
async function swapMic() {
  if (!room || !micStream) return; // not in a call (or the mic never opened): the new choice applies next time
  const fresh = await openDevice(micConstraints, prefs().input);
  if (!room || !micStream) { fresh.getTracks().forEach(t => t.stop()); return; }
  const track = fresh.getAudioTracks()[0];
  track.enabled = !getState().voice?.muted;
  const old = micStream;
  micStream = fresh;
  watchMicTrack();
  if (mic) { try { mic.src.disconnect(); } catch { /* fine */ } mic.src = mic.node.context.createMediaStreamSource(fresh); mic.src.connect(mic.node); } // same sent track, no renegotiation
  else if (senders.audio) await senders.audio.replaceTrack(track);
  old.getTracks().forEach(t => t.stop());
  void refreshDevices();
}
function watchCamTrack() { const t = cameraStream?.getVideoTracks()[0]; if (t) t.onended = () => { if (room && cameraStream?.getVideoTracks()[0] === t) queueDevice(swapCamera).catch(() => { if (cameraStream) toggleCamera().catch(() => {}); }); }; }
// switch the camera live: replaceTrack on the camera's existing sender (no new transceiver, no renegotiation)
async function swapCamera() {
  if (!room || !cameraStream || !senders.camera) return;
  const fresh = await openDevice(camConstraints, prefs().camera);
  if (!room || !cameraStream || !senders.camera) { fresh.getTracks().forEach(t => t.stop()); return; }
  const track = fresh.getVideoTracks()[0];
  track.contentHint = 'motion';
  await senders.camera.replaceTrack(track);
  const old = cameraStream;
  cameraStream = fresh;
  watchCamTrack();
  old.getTracks().forEach(t => t.stop());
  setVoice({ cameraVideo: fresh }); // the stage + the desktop overlay feed pick the new track up from here
  void refreshDevices();
}
// devices plugged in / out: follow the saved choice when it's back, outputs fall back to default when gone
async function onDeviceChange() {
  await refreshDevices();
  applyOutputs();
  if (!room) return;
  const p = prefs();
  const micT = micStream?.getAudioTracks()[0], camT = cameraStream?.getVideoTracks()[0];
  if (micT && p.input && present('audioinput', p.input) && micT.getSettings?.().deviceId !== p.input) queueDevice(swapMic).catch(() => {});
  if (camT && p.camera && present('videoinput', p.camera) && camT.getSettings?.().deviceId !== p.camera) queueDevice(swapCamera).catch(() => {});
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => { void onDeviceChange(); });
async function tuneSender(sender, track) { if (track.kind !== 'video') return; const name = trackName(track), screen = name === 'screen'; track.contentHint = screen ? 'detail' : 'motion'; try { const p = sender.getParameters(); p.encodings = p.encodings?.length ? p.encodings : [{}]; p.encodings[0] = { ...p.encodings[0], maxBitrate: screen ? 2_500_000 : 750_000, maxFramerate: screen ? 15 : 24 }; await sender.setParameters(p); } catch {} }
async function publish(tracks) { if (!producer) return; const added = tracks.map(t => ({ sender: producer.addTransceiver(t, { direction: 'sendonly' }).sender, track: t })); for (const x of added) senders[trackName(x.track)] = x.sender; await Promise.all(added.map(x => tuneSender(x.sender, x.track))); const offer = await producer.createOffer(); await producer.setLocalDescription(offer); await waitIce(producer); const local = [...producer.getTransceivers()].filter(x => x.sender.track && tracks.includes(x.sender.track)).map(x => ({ mid: x.mid, trackName: trackName(x.sender.track) })); const out = await request('chat_rtc_publish', { room, sessionDescription: producer.localDescription, tracks: local }); await producer.setRemoteDescription(out.sessionDescription); }
const queuePublish = tracks => (pubSerial = pubSerial.catch(() => {}).then(() => publish(tracks)));
function applyVolumes() { const p = prefs(), master = clamp(p.outVol ?? 100, 0, 100) / 100; for (const x of media.values()) if (x.audio) x.audio.volume = clamp(((p.volumes[x.name] ?? 100) / 100) * master, 0, 1); }
export const canSelectOutput = () => typeof Audio !== 'undefined' && typeof Audio.prototype.setSinkId === 'function';
const sinkId = () => { const id = prefs().output; return id && (!devices.audiooutput.length || present('audiooutput', id)) ? id : 'default'; };
async function applyOutput(audio) { if (!canSelectOutput() || !audio) return; try { await audio.setSinkId(sinkId()); } catch { try { await audio.setSinkId('default'); } catch { /* fine */ } } }
function applyOutputs() { for (const x of media.values()) if (x.audio) void applyOutput(x.audio); }
function syncVideoState() { setVoice(() => ({ remoteVideo: [...media.values()].filter(x => x.stream).map(x => ({ name: x.name, userId: x.userId, kind: x.kind, stream: x.stream })) })); }
const isScreen = n => n === 'screen' || n === 'screen_audio';
const wanted = (userId, name) => !isScreen(name) || watching.has(uid(userId)); // streams only flow once you click Watch
const remoteKey = x => `${uid(x?.userId)}:${String(x?.trackName || '')}`;
function discardUnavailableMedia(people) { const alive = new Set((people || []).flatMap(p => (p.tracks || []).filter(t => wanted(p.userId, t.trackName)).map(t => remoteKey({ userId: p.userId, trackName: t.trackName })))); for (const [mid, source] of receiveMids) if (!alive.has(remoteKey(source))) receiveMids.delete(mid); for (const [id, x] of media) if (x.remoteKey && !alive.has(x.remoteKey)) { x.audio?.pause(); if (x.audio) x.audio.srcObject = null; media.delete(id); } syncVideoState(); }
function output(track, owner) { const stream = new MediaStream([track]), name = owner?.username || 'Someone', key = remoteKey(owner); if (track.kind === 'audio') { const audio = new Audio(); audio.autoplay = true; audio.muted = !!getState().voice?.deafened; audio.srcObject = stream; media.set(track.id, { audio, name, remoteKey: key, kind: owner?.trackName || 'audio' }); applyVolumes(); void applyOutput(audio); audio.play().catch(() => {}); } else { media.set(track.id, { stream, name, userId: uid(owner?.userId), kind: owner?.trackName || 'camera', remoteKey: key }); syncVideoState(); } track.onended = () => { const ended = media.get(track.id); ended?.audio?.pause(); if (ended?.audio) ended.audio.srcObject = null; media.delete(track.id); for (const [mid, source] of receiveMids) if (remoteKey(source) === key) receiveMids.delete(mid); syncVideoState(); }; }
async function subscribe(people) { if (!consumer || !room) return; const mine = String(meFor(room)?.username || '').toLowerCase(), unique = new Map(); for (const person of people || []) for (const track of person.tracks || []) { const source = { userId: person.userId, username: person.username, trackName: track.trackName }; const key = remoteKey(source); if (String(person.username).toLowerCase() !== mine && wanted(person.userId, track.trackName) && !unique.has(key)) unique.set(key, source); } const sources = [...unique.values()], sig = [...unique.keys()].sort().join('|'); if (sig === appliedSig) return; const out = await request('chat_rtc_subscribe', { room, sources }); if (!out.sessionDescription) { appliedSig = sig; return; } for (const t of out.tracks || []) { if (t?.mid == null) continue; const source = sources.find(s => s.userId === t.userId && s.trackName === t.trackName) || t; receiveMids.set(String(t.mid), { ...source, userId: t.userId ?? source?.userId, trackName: t.trackName || source?.trackName, username: t.username || source?.username }); } await consumer.setRemoteDescription(out.sessionDescription); const answer = await consumer.createAnswer(); await consumer.setLocalDescription(answer); await waitIce(consumer); await request('chat_rtc_answer', { room, session: 'receive', sessionDescription: consumer.localDescription }); appliedSig = sig; }
// every subscribe (the first one at join included) goes through this one chain: two at once both renegotiate the single
// receive PC (the second setRemoteDescription throws) and recoverSoon() then tears the call down and rejoins
function queueSubscribe(people) { lastPeople = people || []; return (serial = serial.catch(() => {}).then(() => subscribe(lastPeople)).catch(e => { if (room && e?.message !== 'realtime_track_rejected') recoverSoon(); })); }
function recoverSoon() { if (!room || recovering || recoveryTimer || recoveryAttempts >= 2) return; recoveryTimer = setTimeout(async () => { recoveryTimer = null; const next = room, info = getState().voice?.info; if (!next || recovering) return; recovering = true; recoveryAttempts += 1; toast('Voice connection dropped - reconnecting…'); leaveVoice(true); try { await joinVoice(next, info || {}); } finally { recovering = false; } }, 1000); }
// tell the others in the call whether you are muted / deafened (they show the red icon; instances broadcast it in chat_voice_state)
function shareMuteState() { if (!room || !announcedConnection) return; const p = prefs(); send({ type: 'chat_voice_mute', room, muted: !!(p.muted || p.deafened), deafened: !!p.deafened }); }
function announceConnected() { if (!room || announcedConnection) return; announcedConnection = true; send({ type: 'chat_rtc_connected', room }); shareMuteState(); ringPending(); }
export async function joinVoice(next, info = {}) { if (room === next) return; const out = info.kind === 'channel' && timedOutIn(info.sid); if (out) { toast(`You're timed out until ${untilText(out)} - you can't join voice until then.`); return; } leaveVoice(true); room = next; serial = Promise.resolve(); announcedConnection = false; if (!window.RTCPeerConnection) { toast('This browser does not support WebRTC voice.'); room = null; return; } patchState({ voice: { room, info: { ...roomInfo(room), ...info }, myId: meFor(room)?.id, status: 'connecting', users: [], muted: prefs().muted || prefs().deafened, deafened: prefs().deafened, speaking: false, ringing: [], remoteVideo: [], streams: [], watching: [] } }); watching = new Set(); senders = {}; appliedSig = ''; pubSerial = Promise.resolve(); startLevels(); const micReady = microphone().then(async s => { const chain = await buildMicChain(s); if (room !== next || micStream !== s) { disposeChain(chain); return room === next && micStream ? [micOutTrack()] : []; } mic = chain; return [micOutTrack()]; }, () => { if (room === next) toast("Ember couldn't use your microphone - you can still listen."); return []; }); try { const joined = await request('chat_rtc_join', { room }); iceServers = joined.iceServers || []; producer = newPc(); consumer = newPc(); consumer.ontrack = e => output(e.track, receiveMids.get(String(e.transceiver.mid))); const activeProducer = producer, activeConsumer = consumer; let announced = false; activeProducer.onconnectionstatechange = () => { if (activeProducer !== producer) return; if (activeProducer.connectionState === 'connected') { recoveryAttempts = 0; setVoice({ status: 'connected' }); announceConnected(); if (!announced) { announced = true; playSound('join', .5); } } if (activeProducer.connectionState === 'failed') recoverSoon(); }; activeProducer.oniceconnectionstatechange = () => { if (activeProducer === producer && activeProducer.iceConnectionState === 'failed') recoverSoon(); }; activeConsumer.onconnectionstatechange = () => { if (activeConsumer !== consumer) return; if (activeConsumer.connectionState === 'connected') announceConnected(); if (activeConsumer.connectionState === 'failed') recoverSoon(); }; activeConsumer.oniceconnectionstatechange = () => { if (activeConsumer === consumer && activeConsumer.iceConnectionState === 'failed') recoverSoon(); }; lastPeople = joined.people || []; knownPeople = null; peopleSounds(lastPeople); setPeople(lastPeople); const published = (await Promise.all([micReady.then(async tracks => { if (!tracks.length) return false; await queuePublish(tracks); return true; }), queueSubscribe(lastPeople)]))[0]; if (!published && room === next) { setVoice({ status: 'connected' }); announceConnected(); } turnRefresh = setInterval(() => request('chat_rtc_ice', { room }).then(x => { iceServers = x.iceServers || iceServers; producer?.setConfiguration({ iceServers }); consumer?.setConfiguration({ iceServers }); }).catch(() => {}), 3 * 60 * 60 * 1000); } catch (e) { toast(e.message === 'realtime_not_configured' ? 'Voice service is not configured.' : e.message === 'voice_cap_reached' ? `This server used up its voice minutes for the month${e.cap_minutes ? ` (${e.used_minutes ?? e.cap_minutes} of ${e.cap_minutes})` : ''} - ask its admins.` : ['voice_unavailable', 'channel_full', 'insufficient_scope', 'timed_out'].includes(e.message) ? errorText(e.message) : "Couldn't start voice."); leaveVoice(true); } }
// timed out on a server while in one of its voice channels: the server already let go of us
if (typeof window !== 'undefined') addEventListener('vc-timed-out', e => { if (room && getState().voice?.info?.sid === e.detail?.sid) { leaveVoice(true); } });
export function leaveVoice(quiet = false) { const old = room; pendingRing = null; room = null; knownPeople = null; announcedConnection = false; clearInterval(turnRefresh); clearTimeout(recoveryTimer); recoveryTimer = null; if (old) send({ type: 'chat_rtc_leave', room: old }); for (const s of [micStream, cameraStream, screenStream]) s?.getTracks().forEach(t => t.stop()); micStream = cameraStream = screenStream = null; dropMicChain(); senders = {}; stopLevels(); producer?.close(); consumer?.close(); producer = consumer = null; media.forEach(x => { x.audio?.pause(); if (x.audio) x.audio.srcObject = null; }); media.clear(); receiveMids.clear(); lastPeople = []; watching = new Set(); appliedSig = ''; if (getState().voice) { patchState({ voice: null }); if (!quiet) playSound('leave', .5); } }
export function setMute(muted) { const t = micStream?.getAudioTracks()[0]; if (t) t.enabled = !muted; setPrefs({ muted }); setVoice({ muted }); shareMuteState(); playSound(muted ? 'mute' : 'unmute', .5); }
export function setDeafen(deafened) { for (const x of media.values()) if (x.audio) x.audio.muted = deafened; if (deafened) setMute(true); setPrefs({ deafened }); setVoice({ deafened }); shareMuteState(); playSound(deafened ? 'deafen' : 'undeafen', .5); }
export async function toggleCamera() { if (!room) return; if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; delete senders.camera; await request('chat_rtc_close', { room, tracks: ['camera'] }); return setVoice({ camera: false, cameraVideo: null }); } cameraStream = await openDevice(camConstraints, prefs().camera); watchCamTrack(); void refreshDevices(); await queuePublish(cameraStream.getVideoTracks()); setVoice({ camera: true, cameraVideo: cameraStream }); }
// Streams are opt-in (like Discord): nothing is subscribed until you click Watch.
export function watchStream(userId) { userId = uid(userId); if (!room || watching.has(userId)) return; watching.add(userId); setVoice({ watching: [...watching] }); queueSubscribe(lastPeople); }
export function unwatchStream(userId) { userId = uid(userId); if (!watching.delete(userId)) return; setVoice({ watching: [...watching] }); discardUnavailableMedia(lastPeople); queueSubscribe(lastPeople); }
export async function desktopScreenSources() { return window.bonfireDesktop?.screenSources ? window.bonfireDesktop.screenSources() : []; }
export async function toggleScreen(source = null) { if (!room) return; if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; await request('chat_rtc_close', { room, tracks: ['screen', 'screen_audio'] }); return setVoice({ screen: false, screenVideo: null }); } const video = source ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: 15, maxWidth: 1920, maxHeight: 1080 } } : { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 15, max: 20 } }; if (source && window.bonfireDesktop?.screenPick) { await window.bonfireDesktop.screenPick(source.id); try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 15 }, width: { max: 1920 }, height: { max: 1080 } }, audio: { restrictOwnAudio: true } }); } catch { screenStream = null; } } if (!screenStream && source) { const audio = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } }; try { screenStream = await navigator.mediaDevices.getUserMedia({ video, audio }); } catch { screenStream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); } } if (!screenStream) screenStream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true }); screenStream.getVideoTracks()[0].onended = () => { if (screenStream) toggleScreen().catch(() => {}); }; await queuePublish(screenStream.getTracks()); setVoice({ screen: true, screenVideo: screenStream }); }
export async function callDm(username) { try { const d = await apiFetch('/chat/calls', { method: 'POST', body: JSON.stringify({ to: username }) }); patchState(s => ({ dmCallWith: { ...s.dmCallWith, [d.room]: username } })); await joinVoice(d.room, { kind: 'call', with: username }); if (room === d.room) { pendingRing = { room: d.room, to: username }; ringPending(); } } catch (e) { toast(dmErrorText(e.message)); } }
let pendingRing = null;
// the server ends an unanswered ring after 30 s; if that never arrives (server restart, dropped socket) stop ringing anyway
const INCOMING_MAX_MS = 45000;
function ringPending() {
  if (!announcedConnection || !pendingRing || pendingRing.room !== room || pendingRing.sent) return;
  pendingRing.sent = send({ type: 'voice_call', to: pendingRing.to, room });
}
function updateDmCall(m) {
  patchState(s => {
    const key = String(m.with).toLowerCase(), dmCalls = { ...s.dmCalls }, dmCallWith = { ...s.dmCallWith };
    if (m.ended || !m.users?.length) {
      if (dmCalls[key]?.room === m.room) delete dmCalls[key];
      delete dmCallWith[m.room];
    } else {
      dmCalls[key] = { room: m.room, users: m.users, with: m.with };
      dmCallWith[m.room] = m.with;
    }
    return { dmCalls, dmCallWith };
  });
  if (m.ended && room === m.room) leaveVoice(true);
} export function callInto(username) { if (room) send({ type: 'voice_call', to: username, room }); } export function cancelCall(callId) { send({ type: 'voice_call_cancel', callId }); } export function answer(call, accept) { send({ type: 'voice_call_answer', callId: call.callId, accept }); patchState(s => ({ incoming: s.incoming.filter(c => c.callId !== call.callId) })); }
// a sound is its id (one of the room's own server) or, from another server, its public view (the room's instance relays the URL)
export function playBoardSound(sound) { if (!room) return toast('Join a voice channel first.'); send({ type: 'voice_sound', sound: typeof sound === 'object' ? { name: sound.name, emoji: sound.emoji, volume: sound.volume, duration: sound.duration, url: sound.url } : sound, room }); }
// a sound another server's soundboard sent into this call is only played from an origin you already use (Velora, an instance you are signed in to, this call's instance)
const trustedSoundOrigin = url => { try { const o = new URL(url).origin; return o === location.origin || o === 'https://nookara.cc' || o === 'https://velora.ikelene.net' || registry.has(o) || (isInst(String(room).slice(3)) && instOf(String(room).slice(3)) === o); } catch { return false; } };
// sounds playing in the call right now: they light the player's avatar blue (levels.js reads them through the level source below)
const boardNow = new Map(); // n -> { key, audio, gain }
let boardN = 0;
// a sound that is sent from this room's instance is fetched from that instance, whatever host it believes it has
const soundUrl = (sound, by) => { if (by == null || sound.external || !room || roomInst(room) === VELORA) return sound.url; try { const o = roomInst(room); return registry.has(o) ? new URL(new URL(sound.url).pathname, o).href : sound.url; } catch { return sound.url; } };
// heard = a sound the call is playing (volume from your soundboard / output settings; deafened = silent but still shown); by = who played it
export function previewBoardSound(sound, heard = false, by = null) {
  if (heard && sound.external && !trustedSoundOrigin(sound.url)) return;
  const p = prefs(), own = heard ? Math.max(5, Math.min(100, Number(sound.volume) || 100)) / 100 : 1;
  const vol = heard ? (clamp(p.board ?? 60, 0, 100) / 100) * (clamp(p.outVol ?? 100, 0, 100) / 100) * own : .6;
  const key = heard && by ? levelKey(by) : '', n = ++boardN;
  const done = () => { boardNow.delete(n); };
  if (key) { boardNow.set(n, { key, audio: null, gain: own }); const silent = vol <= 0 || getState().voice?.deafened && heard; setTimeout(done, silent ? Math.min(5500, (Number(sound.duration) || 3000) + 600) : 15000); } // a sound you hear lasts until it ends; a silent one by its length
  if (vol <= 0 || getState().voice?.deafened && heard) return;
  const a = new Audio(soundUrl(sound, heard ? by : null)); a.volume = vol; void applyOutput(a);
  if (key) { const e = boardNow.get(n); if (e) e.audio = a; a.addEventListener('ended', done); a.addEventListener('error', done); }
  a.play().catch(() => { done(); });
}
export function stopBoardSounds() {}
onVoiceEvent(m => { if (m.type === 'chat_error' && String(m.request || '').startsWith('chat_rtc')) return void settle(m, true); if (['chat_rtc_joined', 'chat_rtc_published', 'chat_rtc_offer', 'chat_rtc_ready'].includes(m.type)) return void settle(m); if (m.type === 'chat_rtc_room' && m.room === room) { peopleSounds(m.people); setPeople(m.people); discardUnavailableMedia(m.people); queueSubscribe(m.people); return; } const v = getState().voice;
  if (m.type === 'voice_closed') {
    if (m.inst && m.inst !== VELORA) { if (room && roomInst(room) === m.inst) leaveVoice(true); return; } // an instance's socket went: only a call on it ends
    if (room && isInst(String(room).slice(3))) { patchState({ dmCalls: {}, dmCallWith: {}, incoming: [] }); return; } // the home socket going doesn't end a call on an instance
    leaveVoice(true);
    patchState({ dmCalls: {}, dmCallWith: {}, incoming: [] });
    return;
  }
  if (['voice_call_ended', 'voice_call_answered'].includes(m.type)) {
    patchState(s => ({ incoming: s.incoming.filter(c => c.callId !== m.callId) }));
    setVoice(x => ({ ringing: (x.ringing || []).filter(c => c.callId !== m.callId) }));
    if (pendingRing?.callId === m.callId) {
      if (m.type === 'voice_call_answered' && m.accepted) pendingRing = null;
      else leaveVoice(true);
    }
    return;
  }
  if (m.type === 'voice_call_failed') {
    toast(['offline', 'unavailable'].includes(m.reason) ? 'They cannot be reached right now.' : errorText(m.reason));
    if (pendingRing?.to?.toLowerCase() === String(m.to).toLowerCase()) leaveVoice(true);
    return;
  }
  if (m.type === 'voice_sound_failed') return void toast(m.reason === 'not_found' ? 'That sound is gone.' : errorText(m.reason));
  if (m.type === 'voice_sound') return void previewBoardSound(m.sound, true, m.by); if (m.type === 'chat_voice_state') return void patchState(s => ({ voiceStates: { ...s.voiceStates, [m.channel]: m.users } })); if (m.type === 'chat_call_state') return void updateDmCall(m); if (m.type === 'voice_call_incoming') { patchState(s => ({ incoming: [...s.incoming.filter(c => c.callId !== m.callId), { ...m, at: Date.now() }] })); setTimeout(() => patchState(s => ({ incoming: s.incoming.filter(c => c.callId !== m.callId) })), INCOMING_MAX_MS); return; } if (m.type === 'voice_call_accepted') return void joinVoice(m.room, /^bfc_/.test(m.room) ? { kind: 'call', with: m.from } : {}); if (m.type === 'voice_call_ringing' && v) { if (pendingRing?.room === m.room) pendingRing.callId = m.callId; setVoice(x => ({ ringing: [...(x.ringing || []).filter(c => c.callId !== m.callId), { callId: m.callId, to: m.to }] })); } if (m.type === 'voice_call_answered' && pendingRing?.room === room && m.accepted) pendingRing = null; });
addEventListener('beforeunload', () => { if (room) send({ type: 'chat_rtc_leave', room }); });
// Ember desktop in-game overlay: the audio streams (speaking meters) + the buttons it offers in edit mode
registerOverlayVoice({ setMute, setDeafen, watchStream, unwatchStream });
// speaking rings (levels.js): your mic as it is sent (after volume + gate; nothing while muted) + everyone's mic track
registerLevelSource(() => {
  const st = getState(), v = st.voice, out = [];
  if (!room || !v) return out;
  const mine = mic ? mic.dest.stream : micStream;
  if (mine && st.me?.username) out.push({ key: levelKey(st.me.username), stream: mine, muted: !!v.muted });
  for (const x of media.values()) if (x.audio?.srcObject && x.kind === 'audio') out.push({ key: levelKey(x.name), stream: x.audio.srcObject });
  for (const [n, b] of boardNow) { // soundboard sounds: measured from the sound itself when the browser lets us, else a steady glow at its volume
    let stream = null;
    try { if (b.stream === undefined && b.audio) b.stream = b.audio.captureStream?.() || b.audio.mozCaptureStream?.() || null; stream = b.stream || null; } catch { b.stream = null; }
    out.push({ key: b.key, sound: true, ...(stream?.getAudioTracks?.().length ? { stream, id: `sb${n}` } : { fixed: b.gain }) });
  }
  return out;
});
