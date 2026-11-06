// Voice UI: who's in each voice channel (sidebar), the "voice connected" panel, the voice channel
// view, the DM call bar and incoming call popups. Voice settings live in right-click / long-press menus on
// the mic (input), deafen (output + soundboard) and camera buttons. Speaking rings: data-vlevel (levels.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Phone, PhoneIncoming, UserPlus, Volume2, Search, AudioLines, Video, VideoOff, MonitorUp, MonitorOff, MonitorPlay, Eye, Maximize2, X } from 'lucide-react';
import { useChat, getState, go, syncRing, isBlockedName, BLOCKED_NAME } from './store.js';
import { Avatar, BlockedMark } from './Profile.jsx';
import { joinVoice, leaveVoice, setMute, setDeafen, answer, callDm, callInto, cancelCall, prefs, setPrefs, toggleCamera, toggleScreen, desktopScreenSources, canSelectOutput, watchStream, unwatchStream, refreshDevices, knownDevices, micMeter, micProcessing, sensLabel } from './voice.js';
import { levelKey } from './levels.js';
import { openMenu } from './Menu.jsx';
import { Dialog } from './Dialogs.jsx';
import { SoundboardButton } from './Soundboard.jsx';

const roomOf = cid => `bf_${cid}`;
// your own picture comes from `me` (nothing puts you in `people` until a message of yours is seen, e.g. right after a reload);
// the components below subscribe to `people` so a picture that arrives late still shows
// in a server's voice channel, somebody I blocked shows as "Blocked User" with the default picture (sid null = a DM call: as is)
const maskedIn = (sid, name) => !!sid && isBlockedName(sid, name);
const faceIn = (sid, name) => (maskedIn(sid, name) ? { username: BLOCKED_NAME, pfp: null } : { username: name, pfp: pfpOf(name) });
const pfpOf = name => { const s = getState(); return s.people[name]?.pfp || (s.me?.username === name ? s.me.pfp : null) || null; };

// ── voice control menus ──
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const moreHint = what => `${coarse() ? 'Hold' : 'Right-click'} for ${what}`;
function deviceItems(kind, chosen, pick, fallbackName) {
  const list = knownDevices()[kind] || [];
  const ok = chosen && list.some(d => d.deviceId === chosen);
  const hint = chosen && !ok && list.length ? 'Your pick is unplugged' : !list.length ? 'Allow access to list devices' : '';
  return [
    { label: 'Default', hint, radio: true, checked: !ok, onClick: () => pick('') },
    ...list.map((d, i) => ({ label: d.label || `${fallbackName} ${i + 1}`, radio: true, checked: ok && d.deviceId === chosen, onClick: () => pick(d.deviceId) })),
  ];
}
// device lists come from enumerateDevices (async), so remember where the click was and open right after
async function voiceMenu(e, build) {
  e.preventDefault?.();
  e.stopPropagation?.();
  const at = { clientX: e.clientX, clientY: e.clientY, touch: !!e.touch, preventDefault() {}, stopPropagation() {} };
  await refreshDevices();
  openMenu(at, build(prefs()));
}
export function micMenu(e) {
  voiceMenu(e, p => {
    const live = micProcessing();
    return [
      { type: 'head', label: 'Input device' },
      ...deviceItems('audioinput', p.input, id => setPrefs({ input: id }), 'Microphone'),
      'sep',
      { type: 'slider', label: 'Input volume', min: 0, max: 200, value: p.inVol ?? 100, format: v => `${v}%`, onChange: v => setPrefs({ inVol: v }), hint: live ? '' : "Applies once you're connected (needs a browser with Web Audio)." },
      { type: 'slider', label: 'Mic sensitivity', min: 0, max: 100, value: p.sens ?? 0, format: sensLabel, meter: micMeter, onChange: v => setPrefs({ sens: v }), hint: 'Quieter than the marker is not sent, so background noise stays out. All the way left = off.' },
      { label: 'Noise suppression', checked: p.noiseSuppression !== false, onClick: () => setPrefs({ noiseSuppression: p.noiseSuppression === false }) },
    ];
  });
}
export function outputMenu(e) {
  voiceMenu(e, p => [
    ...(canSelectOutput() ? [{ type: 'head', label: 'Output device' }, ...deviceItems('audiooutput', p.output, id => setPrefs({ output: id }), 'Speakers'), 'sep'] : []),
    { type: 'slider', label: 'Output volume', min: 0, max: 100, value: p.outVol ?? 100, format: v => `${v}%`, onChange: v => setPrefs({ outVol: v }) },
    { type: 'slider', label: 'Soundboard volume', min: 0, max: 100, value: p.board ?? 60, format: v => (v ? `${v}%` : 'Off'), onChange: v => setPrefs({ board: v }), hint: "How loud other people's soundboard sounds are for you." },
  ]);
}
export function cameraMenu(e) {
  voiceMenu(e, p => [
    { type: 'head', label: 'Camera' },
    ...deviceItems('videoinput', p.camera, id => setPrefs({ camera: id }), 'Camera'),
  ]);
}
// a voice control button: left-click as before, right-click (or a long press on touch) opens its menu
function VBtn({ className, tip, menu, onClick, children }) {
  const h = useRef({ t: 0, x: 0, y: 0, fired: 0 }).current;
  const cancel = () => { clearTimeout(h.t); h.t = 0; };
  const recent = () => Date.now() - h.fired < 800;
  return (
    <button type="button" className={className} data-tip={tip} aria-label={tip}
      onClick={e => { if (recent()) { e.preventDefault(); return; } onClick(e); }}
      onContextMenu={e => {
        if (recent()) { e.preventDefault(); e.stopPropagation(); return; }
        const touch = !!h.t; // the browser's own long-press beat our timer
        cancel();
        if (touch) h.fired = Date.now();
        menu(touch ? { clientX: e.clientX, clientY: e.clientY, touch, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() } : e);
      }}
      onPointerDown={e => {
        if (e.pointerType !== 'touch') return;
        cancel();
        h.x = e.clientX; h.y = e.clientY;
        h.t = setTimeout(() => { h.t = 0; h.fired = Date.now(); navigator.vibrate?.(12); menu({ clientX: h.x, clientY: h.y, touch: true }); }, 480);
      }}
      onPointerMove={e => { if (h.t && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) cancel(); }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
      {children}
    </button>
  );
}
function MicBtn({ v, big, bar }) {
  const s = big ? 20 : 17;
  return <VBtn className={`${bar ? 'vc-ico-btn' : big ? 'vc-vbig' : 'vc-vbtn'}${v.muted ? ' off' : ''}`} tip={`${v.muted ? 'Unmute' : 'Mute'} (${moreHint('mic settings')})`} menu={micMenu} onClick={() => setMute(!v.muted)}>{v.muted ? <MicOff size={s} /> : <Mic size={s} />}</VBtn>;
}
function DeafenBtn({ v, big, bar }) {
  const s = big ? 20 : 17;
  return <VBtn className={`${bar ? 'vc-ico-btn' : big ? 'vc-vbig' : 'vc-vbtn'}${v.deafened ? ' off' : ''}`} tip={`${v.deafened ? 'Undeafen' : 'Deafen'} (${moreHint('sound settings')})`} menu={outputMenu} onClick={() => setDeafen(!v.deafened)}>{v.deafened ? <HeadphoneOff size={s} /> : <Headphones size={s} />}</VBtn>;
}
function CameraBtn({ v, big }) {
  const s = big ? 20 : 17;
  return <VBtn className={`${big ? 'vc-vbig' : 'vc-vbtn'}${v.camera ? ' on' : ''}`} tip={`${v.camera ? 'Turn camera off' : 'Turn camera on'} (${moreHint('camera settings')})`} menu={cameraMenu} onClick={() => toggleCamera().catch(() => {})}>{v.camera ? <Video size={s} /> : <VideoOff size={s} />}</VBtn>;
}

// under a voice channel in the list: the people in it (speaking ring = how loud they are, while you're in a call)
export function VoiceChannelUsers({ cid, sid, onUser }) {
  useChat(s => s.people);
  useChat(s => s.blocks);
  const users = useChat(s => s.voiceStates[cid]);
  if (!users?.length) return null;
  return (
    <div className="vc-vusers">
      {users.map(u => {
        return (
          <div key={u.username} className={`vc-vuser${onUser ? ' clickable' : ''}`} role={onUser ? 'button' : undefined} tabIndex={onUser ? 0 : undefined}
            onClick={onUser ? e => onUser(u.username, e.currentTarget) : undefined} onKeyDown={onUser ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUser(u.username, e.currentTarget); } } : undefined}>
            <span className="vc-vuser-av vc-vlvl" data-vlevel={levelKey(u.username)}><Avatar user={faceIn(sid, u.username)} size={20} /></span>
            {maskedIn(sid, u.username) ? <span className="vc-vuser-name vc-blocked-name">{BLOCKED_NAME}<BlockedMark size={11} /></span> : <span className="vc-vuser-name">{u.username}</span>}
            {u.deafened ? <HeadphoneOff size={13} /> : u.muted ? <MicOff size={13} /> : null}
          </div>
        );
      })}
    </div>
  );
}

// the mute / deafen pair in your user bar (next to the settings cog): always there, in a call or not; out of a call they set what you join with
// only while in a voice channel or call: outside one they just squeezed your name next to the bell + settings
export function QuickVoiceBtns() {
  const v = useChat(s => s.voice);
  if (!v) return null;
  return <><MicBtn v={v} bar /><DeafenBtn v={v} bar /></>;
}

// bottom left, above your name: where you're connected + mute / deafen / hang up
export function VoicePanel() {
  const v = useChat(s => s.voice);
  const [callIn, setCallIn] = useState(false);
  const [shareSources, setShareSources] = useState(null);
  const startShare = async () => { if (v.screen) return toggleScreen().catch(() => {}); if (!window.bonfireDesktop?.isDesktop) return toggleScreen().catch(() => {}); try { setShareSources(await desktopScreenSources()); } catch { setShareSources([]); } };
  if (!v) return null;
  const where = v.info.kind === 'call' ? `Call with ${v.info.with}` : `${v.info.name}${v.info.server ? ` / ${v.info.server}` : ''}`;
  return (
    <div className={`vc-vpanel ${v.status}`}>
      <div className="vc-vpanel-top">
        <span className="vc-vpanel-sig"><Volume2 size={15} /></span>
        <button type="button" className="vc-vpanel-where" onClick={() => (v.info.kind === 'channel' && v.info.sid ? go({ kind: 'channel', sid: v.info.sid, cid: v.info.cid }) : v.info.with && go({ kind: 'dm', username: v.info.with }))}>
          <b>{v.status === 'connected' ? 'Voice connected' : 'Connecting...'}</b>
          <small>{where}</small>
        </button>
        <button type="button" className="vc-ico-btn danger" title="Disconnect" onClick={() => leaveVoice()}><PhoneOff size={17} /></button>
      </div>
      {v.ringing?.length > 0 && (
        <div className="vc-vpanel-ring">
          {v.ringing.map(r => <span key={r.callId}><PhoneIncoming size={13} /> Ringing {r.to}... <button type="button" onClick={() => cancelCall(r.callId)}>Cancel</button></span>)}
        </div>
      )}
      <div className="vc-vpanel-btns">
        <CameraBtn v={v} />
        <button type="button" className={`vc-vbtn${v.screen ? ' on' : ''}`} title={v.screen ? 'Stop sharing screen' : 'Share screen'} onClick={startShare}>{v.screen ? <MonitorUp size={17} /> : <MonitorOff size={17} />}</button>
        {v.info.kind === 'channel' && v.info.allowCallIn && <button type="button" className="vc-vbtn" title="Call someone in" onClick={() => setCallIn(true)}><UserPlus size={17} /></button>}
        <SoundboardButton />
      </div>
      {callIn && <CallInDialog sid={v.info.sid} onClose={() => setCallIn(false)} />}
      {shareSources && <ScreenSharePicker sources={shareSources} onClose={() => setShareSources(null)} onChoose={source => { setShareSources(null); toggleScreen(source).catch(() => {}); }} />}
    </div>
  );
}

function ScreenSharePicker({ sources, onClose, onChoose }) {
  const monitors = sources.filter(s => s.kind === 'screen');
  const windows = sources.filter(s => s.kind === 'window');
  const renderSources = list => list.map(s => <button type="button" key={s.id} className="vc-share-source" onClick={() => onChoose(s)}><img src={s.thumbnail} alt="" /><span><b>{s.name || (s.kind === 'screen' ? 'Screen' : 'Window')}</b><small>{s.kind === 'screen' ? 'Entire screen' : 'Window'}</small></span></button>);
  return <Dialog title="Share your screen" onClose={onClose}>{() => <div className="vc-share-picker">{sources.length ? <>{monitors.length > 0 && <section className="vc-share-group"><h4>Monitors</h4><div className="vc-share-picker-grid">{renderSources(monitors)}</div></section>}{windows.length > 0 && <section className="vc-share-group"><h4>Windows</h4><div className="vc-share-picker-grid">{renderSources(windows)}</div></section>}</> : <p className="vc-empty-note">No shareable windows or screens found.</p>}</div>}</Dialog>;
}

function CallInDialog({ sid, onClose }) {
  const members = useChat(s => s.members[sid]);
  const presence = useChat(s => s.presence);
  const inRoom = useChat(s => s.voice?.users);
  const [q, setQ] = useState('');
  const me = getState().me?.username;
  const list = useMemo(() => (members || [])
    .filter(m => m.username !== me && !inRoom?.some(u => u.name === m.username) && m.username.toLowerCase().includes(q.toLowerCase()))
    .map(m => ({ ...m, status: presence[m.username]?.status || m.presence?.status || 'offline' }))
    .sort((a, b) => ((b.status !== 'offline') - (a.status !== 'offline')) || a.username.localeCompare(b.username)).slice(0, 50), [members, presence, inRoom, q, me]);
  return (
    <Dialog title="Call someone in" onClose={onClose}>
      {close => (
        <>
          <p className="vc-dialog-sub">They get a call; answering drops them straight into this voice channel. People can turn this off in their Ember settings.</p>
          <label className="vc-search"><Search size={15} /><input autoFocus placeholder="Find someone" value={q} onChange={e => setQ(e.target.value)} /></label>
          <div className="vc-callin-list">
            {list.map(m => (
              <div key={m.username} className="vc-callin-row">
                <Avatar user={m} size={30} status={m.status} />
                <b>{m.username}</b>
                <span className="grow" />
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { callInto(m.username); close(); }}><Phone size={13} /> Call</button>
              </div>
            ))}
            {!list.length && <div className="vc-empty-note">Nobody to call.</div>}
          </div>
        </>
      )}
    </Dialog>
  );
}

// one tile per person, even if an old connection of theirs is still on its way out
function dedupeTiles(all) {
  return Object.values(all.reduce((acc, t) => {
    const k = String(t.name).toLowerCase();
    const had = acc[k];
    acc[k] = had ? { ...had, me: had.me || t.me, speaking: had.speaking || t.speaking } : t;
    return acc;
  }, {}));
}

function useScreenShare(v) {
  const [sources, setSources] = useState(null);
  const start = async () => {
    if (v?.screen) return toggleScreen().catch(() => {});
    if (!window.bonfireDesktop?.isDesktop) return toggleScreen().catch(() => {});
    try { setSources(await desktopScreenSources()); } catch { setSources([]); }
  };
  const picker = sources && <ScreenSharePicker sources={sources} onClose={() => setSources(null)} onChoose={source => { setSources(null); toggleScreen(source).catch(() => {}); }} />;
  return [start, picker];
}

const Vid = ({ stream, muted = false }) => <video autoPlay playsInline muted={muted} ref={el => { if (el && el.srcObject !== stream) el.srcObject = stream; }} />;

// who is watching a stream (the streamer sees this on their own card)
function StreamViewers({ watchers, mine, names }) {
  useChat(s => s.people);
  if (!watchers?.length) return mine ? <span className="vc-stream-viewers none"><Eye size={13} /> Nobody is watching yet</span> : null;
  return (
    <span className="vc-stream-viewers">
      <Eye size={13} />
      <span className="vc-stream-avs">{watchers.slice(0, 6).map(w => <span key={w.userId} title={w.username}><Avatar user={{ username: w.username, pfp: pfpOf(w.username) }} size={20} /></span>)}</span>
      <span>{names ? watchers.map(w => w.username).join(', ') : `${watchers.length} watching`}</span>
    </span>
  );
}

// Discord-style stage: people as tiles, each screen share is its own "click to watch" card.
// Watching one pops it into a big focus area with everybody else in a strip below.
function CallStage({ v, tiles, compact, sid }) {
  useChat(s => s.people);
  useChat(s => s.blocks);
  const flash = useChat(s => s.boardFlash);
  const p = useChat(s => s.voicePrefs);
  const [focused, setFocused] = useState(null);
  const [preview, setPreview] = useState(false);
  const stageRef = useRef(null);
  const vols = (p || prefs()).volumes;
  const myName = getState().me?.username || 'You';
  const myId = v?.myId;
  const watching = v?.watching || [];
  const remote = v?.remoteVideo || [];
  const screens = new Map(remote.filter(x => x.kind === 'screen').map(x => [x.userId, x.stream]));
  const cameras = new Map(remote.filter(x => x.kind === 'camera').map(x => [String(x.name).toLowerCase(), { stream: x.stream }]));
  if (v?.cameraVideo) cameras.set(String(myName).toLowerCase(), { stream: v.cameraVideo, mine: true });

  const streams = [...(v?.streams || [])];
  if (v?.screen && !streams.some(s => s.userId === myId)) streams.push({ userId: myId, name: myName, watchers: [] }); // shown before the server confirms
  const entries = streams.map(s => {
    const mine = s.userId === myId;
    const active = mine ? preview && !!v?.screenVideo : watching.includes(s.userId);
    return { ...s, mine, active, stream: mine ? (active ? v.screenVideo : null) : (active ? screens.get(s.userId) : null) };
  });
  const focus = entries.find(e => e.userId === focused && e.active) || entries.find(e => e.active) || null;
  useEffect(() => { if (!v?.screen) setPreview(false); }, [v?.screen]);

  const stop = e => { if (e.mine) setPreview(false); else unwatchStream(e.userId); if (focused === e.userId) setFocused(null); };
  const fullscreen = () => { const el = stageRef.current?.querySelector('.vc-stage-focus'); if (el?.requestFullscreen) el.requestFullscreen().catch(() => {}); };

  const streamCard = e => {
    if (e.active) { // thumbnail of a stream you are already watching (not the one in focus)
      return (
        <div key={`s${e.userId}`} className="vc-vtile vc-stream-thumb" onClick={() => setFocused(e.userId)} role="button" tabIndex={0}>
          {e.stream ? <Vid stream={e.stream} muted /> : <span className="vc-stream-wait">Connecting...</span>}
          <b className="vc-vtile-name"><MonitorPlay size={12} /> {e.mine ? 'Your stream' : `${maskedIn(sid, e.name) ? BLOCKED_NAME : e.name}'s stream`}</b>
        </div>
      );
    }
    if (e.mine) {
      return (
        <div key={`s${e.userId}`} className="vc-vtile vc-stream-card mine">
          <span className="vc-stream-live">LIVE</span>
          <Avatar user={{ username: myName, pfp: pfpOf(myName) }} size={compact ? 44 : 60} />
          <b>You're streaming</b>
          <StreamViewers watchers={e.watchers} mine names />
          <span className="vc-stream-actions">
            <button type="button" className="btn btn-sm" onClick={() => setPreview(true)}>Preview</button>
            <button type="button" className="btn btn-danger-solid btn-sm" onClick={() => toggleScreen().catch(() => {})}>Stop</button>
          </span>
        </div>
      );
    }
    return (
      <button key={`s${e.userId}`} type="button" className="vc-vtile vc-stream-card" onClick={() => { watchStream(e.userId); setFocused(e.userId); }}>
        <span className="vc-stream-live">LIVE</span>
        <Avatar user={faceIn(sid, e.name)} size={compact ? 44 : 60} />
        <b>{maskedIn(sid, e.name) ? BLOCKED_NAME : e.name}'s stream</b>
        <span className="vc-stream-cta"><MonitorPlay size={15} /> Click to watch</span>
        <StreamViewers watchers={e.watchers} />
      </button>
    );
  };

  const userTile = t => {
    const cam = cameras.get(String(t.name).toLowerCase());
    return (
      <div key={t.name} className={`vc-vtile${cam ? ' vc-video vc-vlvl' : ''}${flash && flash.by === t.name ? ' sb-flash' : ''}`} data-vlevel={cam && v ? levelKey(t.name) : undefined}>
        {flash && flash.by === t.name && <span className="vc-vtile-sound" key={flash.at}><AudioLines size={12} /><span>{flash.name}</span></span>}
        {cam ? <Vid stream={cam.stream} muted={!!cam.mine} /> : <span className="vc-vlvl-av vc-vlvl" data-vlevel={v ? levelKey(t.name) : undefined}><Avatar user={t.me ? { username: t.name, pfp: pfpOf(t.name) } : faceIn(sid, t.name)} size={compact ? 48 : 72} /></span>}
        {!t.me && maskedIn(sid, t.name) ? <b className="vc-vtile-name vc-blocked-name">{BLOCKED_NAME}<BlockedMark size={12} /></b> : <b className="vc-vtile-name">{t.name}{t.me ? ' (you)' : ''}</b>}
        <span className="vc-vtile-state">{t.deafened ? <HeadphoneOff size={15} /> : t.muted ? <MicOff size={15} /> : null}</span>
        {v && !t.me && (
          <label className="vc-vtile-vol" title={`${maskedIn(sid, t.name) ? BLOCKED_NAME : t.name}'s volume`}>
            <Volume2 size={13} />
            <input type="range" min={0} max={200} value={vols[t.name] ?? 100} onChange={ev => setPrefs({ volumes: { ...vols, [t.name]: Number(ev.target.value) } })} />
          </label>
        )}
      </div>
    );
  };

  return (
    <div ref={stageRef} className={`vc-stage${focus ? ' has-focus' : ''}${compact ? ' compact' : ''}`}>
      {focus && (
        <div className="vc-stage-focus">
          {focus.stream ? <Vid stream={focus.stream} muted /> : <span className="vc-stream-wait">Connecting to stream...</span>}
          <div className="vc-stage-bar">
            <span className="vc-stage-title"><MonitorPlay size={15} /> <b>{focus.mine ? 'Your stream' : `${focus.name}'s stream`}</b></span>
            <StreamViewers watchers={focus.watchers} mine={focus.mine} names={focus.mine} />
            <span className="grow" />
            <button type="button" className="vc-stage-btn" title="Fullscreen" onClick={fullscreen}><Maximize2 size={16} /></button>
            <button type="button" className="vc-stage-btn stop" title={focus.mine ? 'Hide preview' : 'Stop watching'} onClick={() => stop(focus)}><X size={16} /> {focus.mine ? 'Hide preview' : 'Stop watching'}</button>
          </div>
        </div>
      )}
      <div className="vc-vtiles">
        {entries.filter(e => e !== focus).map(streamCard)}
        {tiles.map(userTile)}
        {!tiles.length && !entries.length && <div className="vc-vempty"><Volume2 size={40} /><b>No one's here yet</b><span>Hop in - people see you in the channel list.</span></div>}
      </div>
    </div>
  );
}

// the main area of a voice channel: the stage + your controls
export function VoiceView({ channel, sid }) {
  const room = roomOf(channel.cid);
  const v = useChat(s => (s.voice?.room === room ? s.voice : null));
  const others = useChat(s => s.voiceStates[channel.cid]);
  const [startShare, picker] = useScreenShare(v);
  const flags = name => (others || []).find(o => String(o.username).toLowerCase() === String(name).toLowerCase());
  const tiles = dedupeTiles(v ? v.users.map(u => ({ name: u.name, muted: u.id === v.myId ? !!v.muted : !!flags(u.name)?.muted, deafened: u.id === v.myId ? !!v.deafened : !!flags(u.name)?.deafened, speaking: u.id === v.myId ? v.speaking : u.speaking, me: u.id === v.myId }))
    : (others || []).map(u => ({ name: u.username, muted: u.muted, deafened: u.deafened })));
  return (
    <div className="vc-voiceview">
      <CallStage v={v} tiles={tiles} sid={sid} />
      <div className="vc-vview-foot">
        {v ? (
          <>
            <MicBtn v={v} big />
            <DeafenBtn v={v} big />
            <CameraBtn v={v} big />
            <button type="button" className={`vc-vbig${v.screen ? ' on' : ''}`} title={v.screen ? 'Stop sharing screen' : 'Share screen'} onClick={startShare}>{v.screen ? <MonitorUp size={20} /> : <MonitorOff size={20} />}</button>
            <button type="button" className="vc-vbig hang" title="Disconnect" onClick={() => leaveVoice()}><PhoneOff size={20} /></button>
          </>
        ) : (
          <button type="button" className="btn btn-primary vc-vjoin" onClick={() => joinVoice(room, { kind: 'channel', sid, cid: channel.cid })}><Volume2 size={16} /> Join voice</button>
        )}
      </div>
      {picker}
    </div>
  );
}

// top of a DM: start a call / join the one going on / who's in it
export function DmCallBar({ username }) {
  useChat(s => s.people);
  const call = useChat(s => s.dmCalls[String(username).toLowerCase()]);
  const v = useChat(s => s.voice);
  const inIt = v && call && v.room === call.room;
  const [startShare, picker] = useScreenShare(inIt ? v : null);
  if (!call) return null;
  const showStage = inIt && (v.streams?.length || v.remoteVideo?.length || v.camera || v.screen);
  const tiles = inIt ? dedupeTiles(v.users.map(u => ({ name: u.name, muted: u.muted, deafened: u.deafened, speaking: u.id === v.myId ? v.speaking : u.speaking, me: u.id === v.myId }))) : [];
  return (
    <>
      <div className={`vc-dmcall${inIt ? ' in' : ''}`}>
        <div className="vc-dmcall-people">
          {call.users.filter((u, i, a) => a.findIndex(x => String(x.username).toLowerCase() === String(u.username).toLowerCase()) === i).map(u => {
            return <span key={u.username} className="vc-dmcall-av vc-vlvl" data-vlevel={inIt ? levelKey(u.username) : undefined} title={u.username}><Avatar user={{ username: u.username, pfp: pfpOf(u.username) }} size={44} />{u.muted && <MicOff size={12} />}</span>;
          })}
        </div>
        <span className="vc-dmcall-txt">{inIt ? (call.users.length > 1 ? 'In a call' : `Calling ${username}...`) : `${username} is in a call with you`}</span>
        {inIt && (
          <span className="vc-dmcall-ctl">
            <MicBtn v={v} />
            <CameraBtn v={v} />
            <button type="button" className={`vc-vbtn${v.screen ? ' on' : ''}`} title={v.screen ? 'Stop sharing screen' : 'Share screen'} onClick={startShare}>{v.screen ? <MonitorUp size={17} /> : <MonitorOff size={17} />}</button>
          </span>
        )}
        {inIt
          ? <button type="button" className="btn btn-danger-solid btn-sm" onClick={() => leaveVoice()}><PhoneOff size={14} /> Hang up</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => joinVoice(call.room, { kind: 'call', with: username })}><Phone size={14} /> Join call</button>}
      </div>
      {showStage && <CallStage v={v} tiles={tiles} compact />}
      {picker}
    </>
  );
}
export function DmCallButton({ username }) {
  const call = useChat(s => s.dmCalls[String(username).toLowerCase()]);
  const v = useChat(s => s.voice);
  if (username === 'System') return null;
  return (
    <button type="button" className="vc-ico-btn" title={call ? 'Join the call' : `Call ${username}`} disabled={!!(call && v?.room === call.room)}
      onClick={() => (call ? joinVoice(call.room, { kind: 'call', with: username }) : callDm(username))}><Phone size={18} /></button>
  );
}

// a call ringing me (top of the window)
export function IncomingCalls() {
  useChat(s => s.people);
  const list = useChat(s => s.incoming);
  const ringIds = list.map(c => c.callId).join('|');
  useEffect(() => { syncRing(ringIds ? ringIds.split('|') : []); return () => syncRing([]); }, [ringIds]);
  if (!list.length) return null;
  return (
    <div className="vc-incoming-wrap">
      {list.map(c => {
        const m = /^bf_(c[0-9a-f]{10})$/.exec(c.room);
        let where = null;
        if (m) for (const d of Object.values(getState().detail)) { const ch = d?.channels.find(x => x.cid === m[1]); if (ch) where = `${ch.name} in ${d.server.name}`; }
        return (
          <div key={c.callId} className="vc-incoming">
            <span className="vc-incoming-av"><Avatar user={{ username: c.from, pfp: pfpOf(c.from) }} size={46} /></span>
            <div className="vc-incoming-txt">
              <b>{c.from}</b>
              <span>{m ? `wants you in ${where || 'a voice channel'}` : 'is calling you'}</span>
            </div>
            <button type="button" className="vc-incoming-btn no" title="Decline" onClick={() => answer(c, false)}><PhoneOff size={18} /></button>
            <button type="button" className="vc-incoming-btn yes" title="Answer" onClick={() => answer(c, true)}><Phone size={18} /></button>
          </div>
        );
      })}
    </div>
  );
}
