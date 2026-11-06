// Soundboard: the picker in a call (sounds from every server you're in) and Server settings > Soundboard.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Upload, Trash2, Volume2, AudioLines, Search } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { toast, errorText, customEmoji, useChat } from './store.js';
import { instOpt, isInst, registry } from './ids.js';
import { playBoardSound, previewBoardSound, stopBoardSounds } from './voice.js';
import { Twemoji } from './emoji.jsx';
import { usePlan, PlanGate, PlanNotice, PlanUsage } from './PlanGate.jsx';

const SoundIcon = ({ s }) => {
  if (!s.emoji) return <AudioLines size={16} />;
  const c = /^<(a?):(\w+):(e[0-9a-f]{10})>$/.exec(s.emoji);
  return c ? <img className="vc-sb-emo" src={customEmoji(c[3], c[1])} alt="" /> : <Twemoji char={s.emoji} className="vc-sb-emo" />;
};

// the button + floating picker (voice panel / voice channel)
export function SoundboardButton({ className = 'vc-vbtn', size = 17 }) {
  const [open, setOpen] = useState(null); // rect
  return (
    <>
      <button type="button" className={`${className}${open ? ' on' : ''}`} title="Soundboard" onClick={e => {
        // React may run the state updater after currentTarget has been cleared.
        const rect = e.currentTarget.getBoundingClientRect();
        setOpen(o => (o ? null : rect));
      }}><AudioLines size={size} /></button>
      {open && <SoundboardPicker rect={open} onClose={() => setOpen(null)} />}
    </>
  );
}
function SoundboardPicker({ rect, onClose }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const box = useRef(null);
  // sounds from every server you're in (Velora's and each instance you're signed in to). The call's own server plays by id; another
  // server's sound is sent as its public view and the call's server relays the URL (see "Cross-server sounds" in the Ember protocol)
  const room = useChat(st => st.voice?.room);
  const here = /^bf_/.test(room || '') ? instOpt(room.slice(3)) : undefined;
  const origins = [...registry.keys()].join(' ');
  useEffect(() => {
    let live = true;
    const sources = [undefined, ...(origins ? origins.split(' ') : [])];
    Promise.all(sources.map(inst => apiFetch('/chat/sounds', { inst }).then(d => (d.servers || []).map(sv => ({ ...sv, inst, key: `${inst || ''}|${sv.sid}` }))).catch(() => []))).then(all => live && setData({ servers: all.flat() }));
    return () => { live = false; stopBoardSounds({ previewsOnly: true }); }; // closing the picker stops a preview
  }, [origins]);
  useEffect(() => {
    const off = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-vbtn, .vc-ico-btn')) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    const timer = setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    return () => { clearTimeout(timer); removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [onClose]);
  const W = 340, H = 380;
  const style = { left: Math.max(8, Math.min(rect.left, innerWidth - W - 8)), top: rect.top - H - 8 > 8 ? rect.top - H - 8 : Math.min(rect.bottom + 8, innerHeight - H - 8) };
  const t = q.trim().toLowerCase();
  return createPortal(
    <div className="vc-sb" ref={box} style={style}>
      <label className="vc-search vc-picker-search"><Search size={15} /><input autoFocus placeholder="Find a sound" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="vc-sb-body">
        {!data && <div className="vc-loading"><i /><i /><i /></div>}
        {data && !data.servers.length && <div className="vc-empty-note">No sounds yet. Add some in Server settings &gt; Soundboard.</div>}
        {data?.servers.map(s => {
          const list = s.sounds.filter(x => !t || x.name.toLowerCase().includes(t));
          if (!list.length) return null;
          return (
            <div key={s.key}>
              <div className="vc-em-sec vc-sb-sec">{s.icon ? <img className="vc-sb-ico" src={s.icon} alt="" /> : <span className="vc-sb-ico">{(s.name || '?').trim().slice(0, 1).toUpperCase()}</span>}{s.name}</div>
              <div className="vc-sb-grid">
                {list.map(x => (
                  <div key={x.id} className="vc-sb-item">
                    <button type="button" className="vc-sb-play" title={`Play ${x.name} for everyone in the call`} onClick={() => playBoardSound(s.inst === here ? x.id : x)}>
                      <SoundIcon s={x} /><span>{x.name}</span>
                    </button>
                    <button type="button" className="vc-sb-prev" title="Preview (only you hear it)" onClick={() => previewBoardSound(x)}><Volume2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

// Server settings > Soundboard (Manage server)
const ERR = { too_many_sounds: 'This server has as many sounds as it can (30).', not_audio: "That doesn't look like a sound file.", file_too_large: 'Sound files can be up to 8 MB.', sound_too_long: 'Sounds can be up to 5 seconds long - trim it first.' };
export function SoundManager({ sid }) {
  const [list, setList] = useState(null);
  const [max, setMax] = useState(30);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const file = useRef(null);
  const plan = usePlan('sounds', list ? list.length : undefined);
  const reload = () => plan.gate ? setList([]) : apiFetch(`/chat/servers/${sid}/sounds`).then(d => { setList(d.sounds); setMax(d.max); }).catch(e => { plan.catchPlan(e); setList([]); });
  useEffect(() => { reload(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopBoardSounds({ previewsOnly: true }), []); // leaving this tab / closing settings stops a preview
  async function add(f) {
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('name', name.trim() || f.name.replace(/\.[^.]+$/, ''));
    try {
      await uploadFetch(`/chat/servers/${sid}/sounds`, fd);
      setName(''); reload();
    } catch (e) { if (!plan.catchPlan(e)) toast(ERR[e.message] || errorText(e.message)); }
    setBusy(false);
  }
  const patch = (x, body) => apiFetch(`/chat/servers/${sid}/sounds/${x.id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(reload).catch(e => toast(errorText(e.message)));
  return (
    <PlanGate block={plan.gate}>
    <div className="vc-emoji-man">
      {!plan.gate && <PlanUsage what="sounds" used={list ? list.length : undefined} />}
      <PlanNotice block={plan.full} />
      <p className="vc-dialog-sub">Short sounds anyone here can play in a voice channel or call, from any server - everyone in the call hears them. {isInst(sid) ? 'Use an MP3, WAV, OGG, FLAC or M4A file of up to 5 seconds.' : "Any audio or video file works; it's trimmed to the first 5 seconds."} {list ? `${list.length} / ${max} used.` : ''}</p>
      <div className="vc-row">
        <input className="form-input" maxLength={32} placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={busy || !!plan.full || !!plan.gate || (list && list.length >= max)} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? 'Adding...' : 'Add sound'}</button>
        <input ref={file} type="file" hidden accept={isInst(sid) ? '.mp3,.wav,.ogg,.flac,.m4a,audio/*' : 'audio/*,video/*'} onChange={e => { add(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <div className="vc-emoji-list">
        {list === null && <div className="vc-loading"><i /><i /><i /></div>}
        {list?.map((x, i) => (
          <div key={x.id} className="vc-emoji-row vc-sound-row vl-rise" style={{ '--i': Math.min(i, 12) }}>
            <button type="button" className="vc-ico-btn" title="Preview" onClick={() => previewBoardSound(x)}><Play size={16} /></button>
            <input className="form-input" defaultValue={x.name} maxLength={32} onBlur={ev => ev.target.value.trim() && ev.target.value !== x.name && patch(x, { name: ev.target.value })} />
            <input className="form-input vc-sound-emo" defaultValue={x.emoji || ''} maxLength={40} placeholder="Emoji" title="An emoji for the button (optional)" onBlur={ev => ev.target.value !== (x.emoji || '') && patch(x, { emoji: ev.target.value })} />
            <label className="vc-sound-vol" title={`Volume ${x.volume}%`}><Volume2 size={14} /><input type="range" min={5} max={100} defaultValue={x.volume} onMouseUp={ev => patch(x, { volume: Number(ev.target.value) })} onTouchEnd={ev => patch(x, { volume: Number(ev.target.value) })} /></label>
            <small className="vc-muted">{(x.duration / 1000).toFixed(1)}s</small>
            <button type="button" className="vc-ico-btn danger" title="Delete" onClick={() => apiFetch(`/chat/servers/${sid}/sounds/${x.id}`, { method: 'DELETE' }).then(reload).catch(e => toast(errorText(e.message)))}><Trash2 size={15} /></button>
          </div>
        ))}
        {list?.length === 0 && <div className="vc-empty-note">No sounds yet.</div>}
      </div>
    </div>
    </PlanGate>
  );
}
