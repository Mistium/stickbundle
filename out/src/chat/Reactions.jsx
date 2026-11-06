// Reactions under a message (server channels): chips with counts, click to add / remove yours, + to pick a new one.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../api.js';
import { instOpt, instOf } from './ids.js';
import { toast, errorText, customEmoji, getState, useChat, timedOutIn, untilText } from './store.js';
import { frequentReactions, recordReaction } from './reactionUsage.js';
import { reactionId, reactionBase } from './msg-actions.js';
import EmojiPicker, { emojiDataSync } from './EmojiPicker.jsx';
import { Twemoji, nameOfChar } from './emoji.jsx';
import './Reactions.css';

const CUSTOM = /^<(a?):(\w+):(e[0-9a-f]{10})>$/;
const customId = emoji => /^c:(e[0-9a-f]{10})$/.exec(emoji)?.[1] || CUSTOM.exec(emoji)?.[3];
const stableKey = emoji => customId(emoji) ? `c:${customId(emoji)}` : emoji;
function accountOf(inst) {
  const s = getState(), user = inst ? s.instances.find(i => i.origin === inst)?.user : s.me;
  return `${inst || 'velora'}|${user?.id || user?.username || 'anonymous'}`;
}
function communityOf(id, inst) {
  for (const b of Object.values(getState().msgs)) {
    const m = b?.list?.find(x => x.id === id && (!inst || instOf(x.channel) === inst));
    if (m?.server) return m.server;
  }
  const v = getState().view;
  return v.kind === 'channel' && (!inst || instOf(v.sid) === inst) ? v.sid : null;
}
function customInfo(emoji, sid, groups = getState().emojis) {
  const eid = customId(emoji);
  if (!eid) return null;
  return (groups || []).filter(s => !sid || s.sid === sid).flatMap(s => s.emojis).find(e => e.eid === eid);
}
const ERR = { too_many_reactions: 'That message has as many different reactions as it can (20).', unknown_emoji: "That emoji can't be used as a reaction." };
export async function setReaction(id, emoji, on, inst) {
  const account = accountOf(inst);
  const c = CUSTOM.exec(emoji);
  // id: a channel message id, dm:<id> for a DM, g:<room>:<id> for a group message; inst: the instance a message lives on (none = Velora)
  const base = reactionBase(id);
  const nookaraOnly = /^(dm|g):/.test(String(id)); // these keep a custom emoji's whole token, like a DM message does
  const out = on && inst && timedOutIn(getState().servers.find(x => x.inst === inst)?.sid); // (one instance = one server)
  if (out) { toast(`You're timed out until ${untilText(out)} - no reactions until then.`); return; }
  try {
    await apiFetch(`${base}/reactions/${encodeURIComponent(inst ? stableKey(emoji) : c && !nookaraOnly ? c[3] : emoji)}`, { method: on ? 'PUT' : 'DELETE', inst });
    if (on) recordReaction(account, inst ? stableKey(emoji) : emoji);
    return true;
  } catch (e) { toast(ERR[e.message] || errorText(e.message)); return false; }
}
export function openReactionPicker(id, el, inst) {
  const r = el?.getBoundingClientRect ? el.getBoundingClientRect() : el;
  const rect = r && Number.isFinite(r.top) ? { top: r.top, bottom: r.bottom, right: r.right, left: r.left } : { top: 0, bottom: 0, right: innerWidth / 2, left: innerWidth / 2 };
  dispatchEvent(new CustomEvent('vc-react-pick', { detail: { id, inst, rect } }));
}
function EmojiNode({ emoji, info, sid }) {
  const c = CUSTOM.exec(emoji), eid = customId(emoji);
  const meta = info || customInfo(emoji, sid);
  if (eid) {
    const name = meta?.name || c?.[2] || 'deleted_emoji';
    const url = meta ? meta.url : c ? customEmoji(c[3], c[1]) : null;
    return url ? <><img className="vc-react-img" src={url} alt={`:${name}:`} draggable={false} onError={e => { e.currentTarget.hidden = true; e.currentTarget.nextSibling.hidden = false; }} /><span className="vc-react-missing" hidden>:{name}:</span></> : <span className="vc-react-missing">:{name}:</span>;
  }
  return <Twemoji char={emoji} className="vc-react-img" />;
}
const nameOf = (emoji, info, sid) => { const c = CUSTOM.exec(emoji), meta = info || customInfo(emoji, sid); return customId(emoji) ? `:${meta?.name || c?.[2] || 'deleted_emoji'}:` : `:${nameOfChar(emoji, emojiDataSync()) || emoji}:`; };

export function QuickReactions({ id, inst, selected = [], onDone, limit = 6, className = 'vc-quick-reactions', sid: sidIn }) {
  const account = accountOf(inst);
  const groups = useChat(s => s.emojis);
  const sid = sidIn !== undefined ? sidIn : communityOf(id, inst);
  const [emojis, setEmojis] = useState(() => frequentReactions(account, limit));
  useEffect(() => {
    const sync = () => setEmojis(frequentReactions(account, limit));
    addEventListener('vc-reaction-usage', sync); addEventListener('storage', sync);
    return () => { removeEventListener('vc-reaction-usage', sync); removeEventListener('storage', sync); };
  }, [account]);
  return <div className={className} role="group" aria-label="Quick reactions">
    {emojis.filter(e => !customId(e) || customInfo(e, sid, groups)).map(emoji => <button type="button" key={emoji} aria-label={`${selected.some(e => stableKey(e) === stableKey(emoji)) ? 'Remove' : 'React with'} ${nameOf(emoji, null, sid)}`} aria-pressed={selected.some(e => stableKey(e) === stableKey(emoji))} title={nameOf(emoji, null, sid)} onClick={() => { onDone(); setReaction(id, emoji, !selected.some(e => stableKey(e) === stableKey(emoji)), inst); }}>
<EmojiNode emoji={emoji} sid={sid} /></button>)}
  </div>;
}

export function Reactions({ m, me, canReact }) {
  if (!m.reactions?.length) return null;
  const rid = reactionId(m);
  return (
    <div className="vc-reacts">
      {m.reactions.map(r => {
        const mine = r.users.includes(me);
        const others = r.count - r.users.length;
        const who = `${r.users.slice(0, 8).join(', ')}${r.users.length > 8 || others > 0 ? ` and ${r.count - Math.min(8, r.users.length)} more` : ''}`;
        return (
          <button type="button" key={r.emoji} className={`vc-react${mine ? ' on' : ''}`} disabled={!canReact} title={`${who} reacted with ${nameOf(r.emoji, r.emoji_id ? r : null, m.server)}`} onClick={() => setReaction(rid, r.emoji, !mine, instOpt(m.channel))}>
            <EmojiNode emoji={r.emoji} info={r.emoji_id ? r : null} sid={m.server} /><span>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// one picker for the whole page, opened from a message's + / hover button / right-click menu
export function ReactionPickerHost() {
  const [at, setAt] = useState(null); // { id, rect }
  useEffect(() => {
    const on = e => setAt(e.detail);
    addEventListener('vc-react-pick', on);
    return () => removeEventListener('vc-react-pick', on);
  }, []);
  if (!at) return null;
  const r = at.rect;
  const W = 352, H = 430;
  const style = { left: Math.max(8, Math.min(r.right - W, innerWidth - W - 8)), top: r.top - H - 8 > 8 ? r.top - H - 8 : Math.min(r.bottom + 8, innerHeight - H - 8) };
  return createPortal(
    <div className="vc-react-pop" style={style}>
      <EmojiPicker reactionSid={at.inst ? communityOf(at.id, at.inst) : undefined} onPick={emoji => { setReaction(at.id, emoji, true, at.inst); setAt(null); }} onClose={() => setAt(null)} />
    </div>,
    document.body,
  );
}
