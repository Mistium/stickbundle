// The emoji picker (smiley button by Send): recent, custom emojis from every server you're in
// (usable anywhere), then all the standard emoji by group. Custom emojis go into text as <:name:eid>.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Clock, Smile, Users, Cat, Apple, Plane, Trophy, Lightbulb, Heart, Flag, Upload, Trash2 } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, getState, loadEmojis, toast, errorText, customEmoji } from './store.js';
import { Twemoji, shortName, allNames } from './emoji.jsx';
import { usePlan, PlanGate, PlanNotice, PlanUsage } from './PlanGate.jsx';

const GROUPS = [
  [0, 'Smileys', Smile], [1, 'People', Users], [3, 'Animals and nature', Cat], [4, 'Food and drink', Apple],
  [5, 'Travel and places', Plane], [6, 'Activities', Trophy], [7, 'Objects', Lightbulb], [8, 'Symbols', Heart], [9, 'Flags', Flag],
];
let dataP = null;
let dataSync = null;
const loadData = () => (dataP ||= fetch('/assets/emoji/emoji.json').then(r => r.json()).then(d => { dataSync = d; return d; }).catch(() => { dataP = null; return []; }));
export const loadEmojiData = loadData;
export const emojiDataSync = () => dataSync;
export const emojiToken = e => `<${e.animated ? 'a' : ''}:${e.name}:${e.eid}>`;
export const emojiUrl = customEmoji;

function recents() { try { return JSON.parse(localStorage.getItem('velora_chat_emoji_recent') || '[]'); } catch { return []; } }
function addRecent(item) {
  try { localStorage.setItem('velora_chat_emoji_recent', JSON.stringify([item, ...recents().filter(x => x.k !== item.k)].slice(0, 24))); } catch { /* fine */ }
}

// a section of the grid that only draws its emojis once it's near the visible part (opening the picker stays instant)
function LazyGrid({ items, render, root }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || on) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setOn(true); return undefined; }
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { setOn(true); io.disconnect(); } }, { root: root.current, rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [on, root]);
  const rows = Math.ceil(items.length / 9);
  return <div ref={ref} className="vc-em-grid" style={on ? undefined : { height: rows * 38 }}>{on && items.map(render)}</div>;
}

export default function EmojiPicker({ onPick, onClose, reactionSid }) {
  const [data, setData] = useState(dataSync);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState(null);
  const allCustom = useChat(s => s.emojis);
  const custom = useMemo(() => reactionSid === undefined ? allCustom : (allCustom || []).filter(s => s.sid === reactionSid), [allCustom, reactionSid]);
  const box = useRef(null);
  const scroller = useRef(null);
  useEffect(() => { if (!data) loadData().then(setData); if (!getState().emojis) loadEmojis(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const off = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-emoji-btn')) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    const attach = setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    return () => { clearTimeout(attach); removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [onClose]);
  const t = q.trim().toLowerCase().replace(/^:|:$/g, '');
  const found = useMemo(() => {
    if (!t || !data) return null;
    const cus = (custom || []).flatMap(s => s.emojis.map(e => ({ ...e, server: s.name }))).filter(e => e.name.toLowerCase().includes(t)).slice(0, 40);
    const words = t.replace(/_/g, ' ');
    const uni = data.filter(e => allNames(e).some(n => n.includes(t)) || e[1].includes(words) || String(e[3] || '').includes(words)).slice(0, 120);
    return { cus, uni };
  }, [t, data, custom]);
  const groups = useMemo(() => (data ? GROUPS.map(([g, label, Icon]) => [g, label, Icon, data.filter(e => e[2] === g)]) : []), [data]);
  function pickUni(e) { addRecent({ k: e[0], u: e[0], label: e[1], n: shortName(e) }); onPick(e[0]); }
  function pickCustom(e) { addRecent({ k: e.eid, c: e }); onPick(emojiToken(e)); }
  const jump = id => scroller.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ block: 'start' });
  const rec = recents().filter(r => !r.c || reactionSid === undefined || (custom || []).some(s => s.emojis.some(e => e.eid === r.c.eid)));
  const cell = (e, c) => (c
    ? <button type="button" key={e.eid} className="vc-em" onClick={() => pickCustom(e)} onMouseEnter={() => setHover({ name: `:${e.name}:`, img: e.url, sub: e.server })}><img src={e.url} alt={e.name} loading="lazy" /></button>
    : <button type="button" key={e[0]} className="vc-em" onClick={() => pickUni(e)} onMouseEnter={() => setHover({ name: `:${shortName(e)}:`, char: e[0] })}><Twemoji char={e[0]} className="vc-em-tw" lazy /></button>);
  return (
    <div className="vc-picker vc-emoji-picker" ref={box}>
      <label className="vc-search vc-picker-search"><Search size={15} /><input autoFocus placeholder="Find an emoji" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="vc-em-body">
        {!t && (
          <nav className="vc-em-nav">
            {rec.length > 0 && <button type="button" title="Recent" onClick={() => jump('recent')}><Clock size={16} /></button>}
            {(custom || []).map(s => <button type="button" key={s.sid} title={s.name} onClick={() => jump(s.sid)}>{s.icon ? <img src={s.icon} alt="" /> : <span>{s.name.slice(0, 2)}</span>}</button>)}
            {GROUPS.map(([g, label, Icon]) => <button type="button" key={g} title={label} onClick={() => jump(`g${g}`)}><Icon size={16} /></button>)}
          </nav>
        )}
        <div className="vc-em-scroll" ref={scroller}>
          {!data && <div className="vc-loading"><i /><i /><i /></div>}
          {found && (
            <>
              {found.cus.length > 0 && <div className="vc-em-sec">Custom</div>}
              <div className="vc-em-grid">{found.cus.map(e => cell(e, true))}</div>
              <div className="vc-em-grid">{found.uni.map(e => cell(e))}</div>
              {!found.cus.length && !found.uni.length && <div className="vc-empty-note">No emoji found.</div>}
            </>
          )}
          {!found && data && (
            <>
              {rec.length > 0 && <><div className="vc-em-sec" data-sec="recent">Recent</div>
                <div className="vc-em-grid">{rec.map(r => (r.c ? cell(r.c, true) : cell([r.u, r.label, 0, '', r.n ? [r.n] : undefined])))}</div></>}
              {(custom || []).map(s => (
                <div key={s.sid}><div className="vc-em-sec" data-sec={s.sid}>{s.name}</div>
                  <LazyGrid root={scroller} items={s.emojis.map(e => ({ ...e, server: s.name }))} render={e => cell(e, true)} /></div>
              ))}
              {groups.map(([g, label, , list]) => (
                <div key={g}><div className="vc-em-sec" data-sec={`g${g}`}>{label}</div>
                  <LazyGrid root={scroller} items={list} render={e => cell(e)} /></div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="vc-em-foot">
        {hover ? <>{hover.img ? <img src={hover.img} alt="" /> : <Twemoji char={hover.char} className="vc-em-big" />}<b>{hover.name}</b>{hover.sub && <small>from {hover.sub}</small>}</> : <small>{reactionSid === undefined ? 'Custom emojis from your servers work everywhere.' : 'React with this community’s custom emojis.'}</small>}
      </div>
    </div>
  );
}

// Server settings > Emojis (Manage server)
export function EmojiManager({ sid }) {
  const [list, setList] = useState(null);
  const [max, setMax] = useState(100);
  const [busy, setBusy] = useState(0);
  const file = useRef(null);
  const plan = usePlan('emojis', list ? list.length : undefined);
  const reload = () => plan.gate ? setList([]) : apiFetch(`/chat/servers/${sid}/emojis`).then(d => { setList(d.emojis); setMax(d.max); }).catch(e => { plan.catchPlan(e); setList([]); });
  useEffect(() => { reload(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add(files) {
    for (const f of [...files].slice(0, 20)) {
      setBusy(n => n + 1);
      const fd = new FormData();
      fd.append('file', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      try { await uploadFetch(`/chat/servers/${sid}/emojis`, fd); } catch (e) { if (plan.catchPlan(e)) { setBusy(n => n - 1); break; } toast(e.message === 'invalid_emoji' ? 'That emoji could not be read. Try another PNG, JPG, GIF or WebP file.' : e.message === 'file_too_large' ? 'Emoji files can be up to 2 MB.' : errorText(e.message)); }
      setBusy(n => n - 1);
    }
    reload(); loadEmojis();
  }
  async function rename(e, name) {
    if (!name.trim() || name === e.name) return;
    await apiFetch(`/chat/servers/${sid}/emojis/${e.eid}`, { method: 'PATCH', body: JSON.stringify({ name }) }).catch(() => {});
    reload(); loadEmojis();
  }
  async function del(e) {
    await apiFetch(`/chat/servers/${sid}/emojis/${e.eid}`, { method: 'DELETE' }).catch(() => {});
    reload(); loadEmojis();
  }
  return (
    <PlanGate block={plan.gate}>
    <div className="vc-emoji-man">
      {!plan.gate && <PlanUsage what="emojis" used={list ? list.length : undefined} />}
      <PlanNotice block={plan.full} />
      <p className="vc-dialog-sub">Upload PNG, JPG, WebP or GIF emojis, up to 2 MB. GIFs and animated WebP keep their animation; images are resized to 128 px. Everyone in Ember can use your server's emojis anywhere. {list ? `${list.length} / ${max} used.` : ''}</p>
      <button type="button" className="btn btn-primary" disabled={busy > 0 || !!plan.full || !!plan.gate || (list && list.length >= max)} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? 'Uploading...' : 'Upload emoji'}</button>
      <input ref={file} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      <div className="vc-emoji-list" data-drop-own onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        {list === null && <div className="vc-loading"><i /><i /><i /></div>}
        {list?.map((e, i) => (
          <div key={e.eid} className="vc-emoji-row vl-rise" style={{ '--i': Math.min(i, 12) }}>
            <img src={e.url} alt="" />
            <span className="vc-emoji-colon">:</span>
            <input className="form-input" defaultValue={e.name} maxLength={32} onBlur={ev => rename(e, ev.target.value)} />
            <span className="vc-emoji-colon">:</span>
            {e.animated && <small className="vc-chip">animated</small>}
            <button type="button" className="vc-ico-btn" title="Delete" onClick={() => del(e)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
    </PlanGate>
  );
}
