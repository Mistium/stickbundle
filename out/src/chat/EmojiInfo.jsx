// Click an emoji in a message: its name, and for a custom one the server it's from (join it if it's in Discover).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Lock } from 'lucide-react';
import { apiFetch } from '../api.js';
import { go, loadServersOf, toast, errorText, customEmoji, getState } from './store.js';
import { instOpt } from './ids.js';
import { Twemoji, nameOfChar } from './emoji.jsx';
import { emojiDataSync, loadEmojiData } from './EmojiPicker.jsx';

export function EmojiInfoHost() {
  const [info, setInfo] = useState(null); // { char } | { eid, name, animated, server? } + rect
  const [srv, setSrv] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const on = e => {
      const d = e.detail;
      setInfo(d); setSrv(null);
      // an instance's emoji is asked about on that instance (the one whose emoji list has it), the rest on Velora
      const from = getState().emojis?.find(sv => sv.emojis?.some(x => x.eid === d.eid))?.sid;
      if (d.eid) apiFetch(`/chat/emojis/${encodeURIComponent(d.eid)}/info`, { inst: instOpt(from) }).then(x => setSrv(x.server || false)).catch(() => setSrv(false));
      else if (!emojiDataSync()) loadEmojiData().then(() => setInfo(x => (x ? { ...x } : x)));
    };
    addEventListener('vc-emoji-info', on);
    return () => removeEventListener('vc-emoji-info', on);
  }, []);
  useEffect(() => {
    if (!info) return undefined;
    const off = e => { if (box.current && !box.current.contains(e.target)) setInfo(null); };
    const key = e => { if (e.key === 'Escape') setInfo(null); };
    const t = setTimeout(() => addEventListener('mousedown', off), 0);
    addEventListener('keydown', key);
    addEventListener('resize', () => setInfo(null), { once: true });
    return () => { clearTimeout(t); removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [info]);
  if (!info) return null;
  const r = info.rect;
  const below = innerHeight - r.bottom > 200;
  const style = { left: Math.max(8, Math.min(r.left + r.width / 2 - 140, innerWidth - 288)), ...(below ? { top: r.bottom + 8 } : { bottom: innerHeight - r.top + 8 }) };
  const name = info.eid ? info.name : nameOfChar(info.char, emojiDataSync());
  async function join() {
    setBusy(true);
    try { await apiFetch(`/chat/servers/${srv.sid}/join`, { method: 'POST', body: JSON.stringify({}) }); await loadServersOf(srv.sid); setInfo(null); go({ kind: 'server', sid: srv.sid }); }
    catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return createPortal(
    <div className="vc-eminfo vl-rise" ref={box} style={style}>
      <div className="vc-eminfo-top">
        {info.eid ? <img className="vc-eminfo-big" src={customEmoji(info.eid, info.animated)} alt="" /> : <Twemoji char={info.char} className="vc-eminfo-big" />}
        <div className="vc-eminfo-txt">
          <b>{name ? `:${name}:` : info.char}</b>
          <small>{info.eid ? 'Custom server emoji' : 'A standard emoji'}</small>
        </div>
      </div>
      {info.eid && srv && (
        <div className="vc-eminfo-srv">
          <span className="vc-srv-ico">{srv.icon ? <img src={srv.icon} alt="" /> : srv.name.slice(0, 2)}</span>
          <div className="grow"><b>{srv.name}</b><small>{srv.discoverable ? <><Users size={11} /> {srv.member_count} members</> : <><Lock size={11} /> Invite only</>}</small></div>
          {srv.joined ? <button type="button" className="btn btn-surface btn-sm" onClick={() => { setInfo(null); go({ kind: 'server', sid: srv.sid }); }}>Open</button>
            : srv.discoverable ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={join}>Join</button> : null}
        </div>
      )}
    </div>,
    document.body,
  );
}
