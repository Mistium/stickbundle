import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ExternalLink, Check, ChevronDown, Paperclip, EyeOff, Loader, LayoutGrid, Plus } from 'lucide-react';
import { useChat, toast, errorText, sendInteraction, dismissEphemeral, closeInteractionModal, uploadAttachment } from './store.js';
import { bare } from './ids.js';
import { Avatar } from './Profile.jsx';
import { Dialog } from './Dialogs.jsx';
import { BotTag } from './Bots.jsx';
import { T, interactionError } from './commands.js';
import './Commands.css';

const fail = e => toast(interactionError(e) || errorText(e.message));

export function CommandPicker({ items, sel, setSel, onPick, bots = [], bot = null, onBot }) {
  useEffect(() => { if (sel >= items.length) setSel(0); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = useRef(null);
  const railOn = useRef(null);
  useEffect(() => { on.current?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  useEffect(() => { railOn.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [bot]);
  const rail = bots.length > 1 && onBot;
  if (!items.length && !rail) return null;
  const only = bot ? bots.find(b => b.id === bot) : null;
  let last = null;
  const list = (
    <div className="vc-cmd-list">
      {!items.length && <div className="vc-cmd-none">No commands from {only?.username || 'this bot'} match that.</div>}
      {items.map((it, i) => {
        const head = it.bot.id !== last ? it.bot : null;
        last = it.bot.id;
        return (
          <div key={it.key}>
            {head && <div className="vc-mentions-head vc-cmd-bot"><Avatar user={head} size={16} />{head.username}<BotTag small verified={!!head.verified} />{!head.online && <small>offline</small>}</div>}
            <button type="button" ref={i === sel ? on : null} className={`vc-mention-row vc-cmd-row${i === sel ? ' on' : ''}${it.bot.online ? '' : ' off'}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
              <b>/{it.label}</b>
              <span className="vc-cmd-sig">{it.options.map(o => <i key={o.name} className={o.required ? 'req' : ''}>{o.name}</i>)}</span>
              <small>{it.description}</small>
            </button>
          </div>
        );
      })}
    </div>
  );
  if (!rail) return <div className="vc-mentions vc-cmd-picker" onMouseDown={e => e.preventDefault()}>{list}</div>;
  return (
    <div className="vc-mentions vc-cmd-picker has-rail" onMouseDown={e => e.preventDefault()}>
      <div className="vc-cmd-rail" role="tablist" aria-label="Filter commands by bot (Alt + Up/Down)">
        <button type="button" role="tab" aria-selected={!bot} ref={!bot ? railOn : null} className={`vc-cmd-rail-btn all${!bot ? ' on' : ''}`} title="All bots (Alt + Up/Down to switch)" aria-label="All bots" onClick={() => onBot(null)}><LayoutGrid size={18} /></button>
        <span className="vc-cmd-rail-sep" />
        {bots.map(b => (
          <button type="button" role="tab" key={b.id} aria-selected={bot === b.id} ref={bot === b.id ? railOn : null} className={`vc-cmd-rail-btn${bot === b.id ? ' on' : ''}${b.online ? '' : ' off'}`} title={b.online ? b.username : `${b.username} (offline)`} aria-label={b.username} onClick={() => onBot(bot === b.id ? null : b.id)}>
            <Avatar user={b} size={28} />
          </button>
        ))}
      </div>
      {list}
    </div>
  );
}

function useChoices(o, sid, view, entry, vals, text) {
  const members = useChat(s => s.members[sid]);
  const detail = useChat(s => s.detail[sid]);
  const [auto, setAuto] = useState([]);
  const ask = useRef(0);
  useEffect(() => {
    if (!o.autocomplete) return undefined;
    const n = ++ask.current;
    const t = setTimeout(() => {
      const values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.value !== '' && v.value != null).map(([k, v]) => [k, v.value]));
      values[o.name] = text;
      sendInteraction(sid, { type: 4, channel: view.cid, command: entry.cmd.id, path: entry.path, values, focused: o.name })
        .then(d => { if (n === ask.current) setAuto(d.choices.map(c => ({ label: c.name, value: c.value }))); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [text, o.autocomplete]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const q = text.toLowerCase().replace(/^[@#]/, '');
    const has = s => !q || String(s).toLowerCase().includes(q);
    const people = () => (members || []).filter(m => has(m.username)).slice(0, 8).map(m => ({ label: `@${m.username}`, text: m.username, value: m.id, bot: m.kind === 'bot' }));
    const roles = () => (detail?.roles || []).filter(r => !r.is_default && has(r.name)).slice(0, 8).map(r => ({ label: `@${r.name}`, text: r.name, value: r.rid }));
    if (o.type === T.USER) return people();
    if (o.type === T.ROLE) return roles();
    if (o.type === T.MENTIONABLE) return [...people(), ...roles()].slice(0, 10);
    if (o.type === T.CHANNEL) return (detail?.channels || []).filter(c => (o.channel_types?.length ? o.channel_types.includes(c.type === 'voice' ? 2 : 0) : c.type !== 'voice') && has(c.name)).slice(0, 10).map(c => ({ label: `#${c.name}`, text: c.name, value: c.cid }));
    if (o.choices?.length) return o.choices.filter(c => has(c.name)).map(c => ({ label: c.name, text: c.name, value: c.value }));
    if (o.autocomplete) return auto.map(c => ({ ...c, text: c.label }));
    return [];
  }, [text, members, detail, auto, o]);
}

function OptionField({ o, field, setField, view, entry, vals, innerRef, onEnter, onBack }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const picks = o.type === T.USER || o.type === T.ROLE || o.type === T.CHANNEL || o.type === T.MENTIONABLE || o.choices?.length || o.autocomplete;
  const items = useChoices(o, view.sid, view, entry, vals, field.text);
  const file = useRef(null);
  const [up, setUp] = useState(false);
  const pick = it => { setField({ text: it.text ?? it.label, value: it.value }); setOpen(false); };
  const type = (text) => setField(picks && !o.autocomplete && !o.choices?.length ? { text, value: '' } : { text, value: o.choices?.length ? '' : text });
  const shown = open && items.length > 0;
  if (o.type === T.BOOLEAN) {
    return (
      <span className="vc-cmd-bool" ref={innerRef} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onEnter(); if (e.key === 'Backspace') { e.preventDefault(); if (field.value == null) onBack(); else setField({ text: '', value: null }); } if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setField({ text: '', value: !(field.value === true) }); } }}>
        {[true, false].map(v => <button type="button" key={String(v)} className={field.value === v ? 'on' : ''} onClick={() => setField({ text: '', value: v })}>{v ? 'True' : 'False'}</button>)}
      </span>
    );
  }
  if (o.type === T.ATTACHMENT) {
    return (
      <span className="vc-cmd-file">
        <input ref={file} type="file" hidden onChange={async e => {
          const f = e.target.files[0]; e.target.value = '';
          if (!f) return;
          setUp(true);
          try { const a = await uploadAttachment(view, f); setField({ text: f.name, value: a.url }); } catch (er) { toast(errorText(er.message)); }
          setUp(false);
        }} />
        <button type="button" ref={innerRef} onKeyDown={e => { if (e.key === 'Backspace') { e.preventDefault(); if (field.text) setField({ text: '', value: '' }); else onBack(); } }} onClick={() => file.current?.click()}>{up ? <Loader size={13} className="spin" /> : <Paperclip size={13} />} {field.text || 'Choose a file'}</button>
      </span>
    );
  }
  return (
    <span className="vc-cmd-field">
      <input
        ref={innerRef} value={field.text} placeholder={o.description} inputMode={o.type === T.INTEGER || o.type === T.NUMBER ? 'decimal' : 'text'} maxLength={o.max_length || 6000} spellCheck={o.type === T.STRING && !picks}
        onFocus={() => { setOpen(true); setSel(0); }} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => { type(e.target.value); setOpen(true); setSel(0); }}
        onKeyDown={e => {
          if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); onBack(); return; }
          if (shown) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => (x + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => (x - 1 + items.length) % items.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && (o.choices?.length || o.type !== T.STRING || sel > 0 || field.text))) {
              if (e.key === 'Enter' && o.type === T.STRING && !o.choices?.length && !items[sel]) { e.preventDefault(); onEnter(); return; }
              if (items[sel] && (e.key === 'Tab' || field.value === '' || o.autocomplete)) { e.preventDefault(); pick(items[sel]); return; }
            }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
        }} />
      {shown && (
        <span className="vc-cmd-sug" onMouseDown={e => e.preventDefault()}>
          {items.map((it, i) => <button type="button" key={`${it.label}${i}`} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}>{it.label}</button>)}
        </span>
      )}
    </span>
  );
}

export function CommandBar({ view, entry, onCancel, onSent, submitRef }) {
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);
  const refs = useRef({});
  const ghost = useRef(null);
  const all = entry.options;
  const [extra, setExtra] = useState([]); // optional options the user added
  const [menu, setMenu] = useState(false);
  const [msel, setMsel] = useState(0);
  const opts = useMemo(() => all.filter(o => o.required || extra.includes(o.name)), [all, extra]);
  const spare = all.filter(o => !o.required && !extra.includes(o.name));
  const focusOpt = name => setTimeout(() => (refs.current[name] || ghost.current)?.focus(), 0);
  const endOf = name => setTimeout(() => { const el = refs.current[name]; if (!el) return; el.focus(); if (el.setSelectionRange && el.value != null) el.setSelectionRange(el.value.length, el.value.length); }, 0);
  const back = o => {
    const i = opts.findIndex(x => x.name === o.name);
    const prev = opts[i - 1];
    if (!o.required) {
      setExtra(x => x.filter(n => n !== o.name));
      setVals(v => { const n = { ...v }; delete n[o.name]; return n; });
      const to = prev || opts[i + 1];
      if (to) endOf(to.name); else focusOpt(null);
      return;
    }
    if (prev) endOf(prev.name); else onCancel();
  };
  const add = o => {
    setExtra(x => [...x, o.name]);
    setMenu(false);
    focusOpt(o.name);
  };
  const field = o => vals[o.name] || { text: '', value: o.type === T.BOOLEAN ? null : '' };
  useEffect(() => { setTimeout(() => (refs.current[opts[0]?.name] || ghost.current)?.focus(), 20); }, [entry.key]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (busy) return;
    const values = {};
    for (const o of opts) {
      const f = field(o);
      let v = f.value;
      if (o.type === T.STRING && !o.choices?.length) v = f.text;
      const blank = v === '' || v == null || (o.type === T.USER && !v) ;
      if (blank) {
        if (o.required) { toast(`${o.name} is required.`); refs.current[o.name]?.focus(); return; }
        continue;
      }
      if (o.type === T.INTEGER || o.type === T.NUMBER) { v = Number(String(f.text || v).trim()); if (!Number.isFinite(v)) { toast(`${o.name} needs a number.`); refs.current[o.name]?.focus(); return; } }
      else if ([T.USER, T.ROLE, T.CHANNEL, T.MENTIONABLE].includes(o.type) && !f.value) { toast(`Pick ${o.name} from the list.`); refs.current[o.name]?.focus(); return; }
      values[o.name] = [T.USER, T.ROLE, T.CHANNEL, T.MENTIONABLE].includes(o.type) ? bare(v) : v;
    }
    setBusy(true);
    try { await sendInteraction(view.sid, { type: 2, channel: view.cid, command: entry.cmd.id, path: entry.path, values }); onSent(); }
    catch (e) { fail(e); setBusy(false); }
  }
  if (submitRef) submitRef.current = submit;
  const cur = opts.find(o => o.name === active);
  return (
    <div className="vc-cmdbar" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      {(cur || !opts.length) && <div className="vc-cmd-hint"><b>{cur ? cur.name : `/${entry.label}`}</b> {cur ? cur.description : all.length ? entry.description : `${entry.description} - press Enter to run it.`}</div>}
      <span className="vc-cmd-chip" title={`${entry.bot.username}: /${entry.label}`}><Avatar user={entry.bot} size={16} />/{entry.label}</span>
      {opts.map(o => (
        <label key={o.name} className={`vc-cmd-opt${active === o.name ? ' on' : ''}`} onFocus={() => setActive(o.name)} onBlur={() => setActive(a => (a === o.name ? null : a))}>
          <span className="vc-cmd-name">{o.name}{o.required && <em>*</em>}</span>
          <OptionField o={o} field={field(o)} setField={f => setVals(v => ({ ...v, [o.name]: f }))} view={view} entry={entry} vals={vals} innerRef={el => { refs.current[o.name] = el; }} onEnter={submit} onBack={() => back(o)} />
        </label>
      ))}
      {spare.length > 0 && (
        <span className="vc-cmd-more" onBlur={() => setMenu(false)}>
          <button
            type="button" className={`vc-cmd-add${menu ? ' on' : ''}`} aria-haspopup="listbox" aria-expanded={menu} title="Add an optional field"
            onClick={() => { setMenu(m => !m); setMsel(0); }}
            onKeyDown={e => {
              if (!menu) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenu(true); setMsel(0); } return; }
              if (e.key === 'ArrowDown') { e.preventDefault(); setMsel(x => (x + 1) % spare.length); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setMsel(x => (x - 1 + spare.length) % spare.length); }
              else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(spare[Math.min(msel, spare.length - 1)]); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); }
            }}><Plus size={13} strokeWidth={2.5} />optional</button>
          {menu && (
            <span className="vc-cmd-sug vc-cmd-more-list" role="listbox" onMouseDown={e => e.preventDefault()}>
              {spare.map((o, i) => <button type="button" role="option" aria-selected={i === msel} key={o.name} className={i === msel ? 'on' : ''} onMouseEnter={() => setMsel(i)} onClick={() => add(o)}><b>{o.name}</b>{o.description && <small>{o.description}</small>}</button>)}
            </span>
          )}
        </span>
      )}
      {!opts.length && <input ref={ghost} className="vc-cmd-ghost" aria-label={`Run /${entry.label}`} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Backspace') { e.preventDefault(); onCancel(); } }} />}
      <button type="button" className="vc-cmd-x" title="Clear this command (Esc)" aria-label="Clear this command" onClick={onCancel}><X size={15} strokeWidth={2.5} /><span>Clear</span></button>
    </div>
  );
}
export const canRun = (opts, vals) => opts.every(o => !o.required || vals[o.name]);

const Emoji = ({ e }) => (e?.name && !e.id ? <span className="vc-cbtn-emoji">{e.name}</span> : null);
function useOptions(def, view) {
  const members = useChat(s => s.members[view.sid]);
  const detail = useChat(s => s.detail[view.sid]);
  return useMemo(() => {
    if (def.type === 3) return def.options.map(o => ({ label: o.label, value: o.value, description: o.description, emoji: o.emoji, on: !!o.default }));
    const people = (members || []).map(m => ({ label: `@${m.username}`, value: m.id }));
    const roles = (detail?.roles || []).filter(r => !r.is_default).map(r => ({ label: `@${r.name}`, value: r.rid }));
    const chans = (detail?.channels || []).filter(c => c.type !== 'voice').map(c => ({ label: `#${c.name}`, value: c.cid }));
    return def.type === 5 ? people : def.type === 6 ? roles : def.type === 8 ? chans : [...people, ...roles];
  }, [def, members, detail]);
}
function SelectMenu({ def, m, view, busy, send }) {
  const options = useOptions(def, view);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set(options.filter(o => o.on).map(o => o.value)));
  const multi = def.max_values > 1;
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, [open]);
  const chosen = options.filter(o => picked.has(o.value));
  const toggle = o => {
    if (!multi) { setOpen(false); send(def, [o.value]); return; }
    setPicked(p => { const n = new Set(p); if (n.has(o.value)) n.delete(o.value); else if (n.size < def.max_values) n.add(o.value); return n; });
  };
  return (
    <span className="vc-csel" ref={box}>
      <button type="button" disabled={def.disabled || busy} onClick={() => setOpen(o => !o)}>
        <span>{chosen.length ? chosen.map(o => o.label).join(', ') : def.placeholder || 'Make a selection'}</span><ChevronDown size={14} />
      </button>
      {open && (
        <span className="vc-csel-list">
          {options.length === 0 && <small>Nothing to pick from.</small>}
          {options.map(o => (
            <button type="button" key={o.value} className={picked.has(o.value) && multi ? 'on' : ''} onClick={() => toggle(o)}>
              <Emoji e={o.emoji} /><span>{o.label}{o.description && <small>{o.description}</small>}</span>{multi && picked.has(o.value) && <Check size={13} />}
            </button>
          ))}
          {multi && <button type="button" className="vc-csel-done" disabled={picked.size < def.min_values} onClick={() => { setOpen(false); send(def, [...picked]); }}>Done</button>}
        </span>
      )}
    </span>
  );
}
export function MessageComponents({ m, view }) {
  const [busy, setBusy] = useState(false);
  if (!m.components?.length || view.kind !== 'channel') return null;
  const send = (def, selected) => {
    if (busy) return;
    setBusy(true);
    sendInteraction(view.sid, { type: 3, channel: view.cid, message: m.id, custom_id: def.custom_id, ...(selected ? { selected } : {}) }).catch(fail).finally(() => setTimeout(() => setBusy(false), 500));
  };
  return (
    <div className="vc-comps">
      {m.components.map((row, i) => (
        <div className="vc-comp-row" key={i}>
          {row.components.map((c, j) => (c.type === 2
            ? (c.style === 5
              ? <a key={j} className="vc-cbtn s5" href={c.url} target="_blank" rel="noopener noreferrer"><Emoji e={c.emoji} />{c.label}<ExternalLink size={12} /></a>
              : <button type="button" key={j} className={`vc-cbtn s${c.style}`} disabled={c.disabled || busy} onClick={() => send(c)}><Emoji e={c.emoji} />{c.label}</button>)
            : <SelectMenu key={j} def={c} m={m} view={view} busy={busy} send={send} />))}
        </div>
      ))}
    </div>
  );
}

export function InteractionLine({ m, sid, onUser }) {
  const i = m.interaction;
  // older rows only stored id + username, so fall back to the member list for the pfp
  const member = useChat(s => (i?.user?.username && sid ? (s.members[sid] || []).find(x => x.username === i.user.username) : null));
  if (!i?.user) return null;
  const user = { ...member, ...i.user, pfp: i.user.pfp || member?.pfp || null };
  const open = e => { e.stopPropagation(); onUser?.(user.username, e.currentTarget); };
  return (
    <div className="vc-reply-to vc-interaction">
      <span className="vc-reply-line" />
      <button type="button" className="vc-int-who" onClick={open} title={`Open ${user.username}'s profile`}>
        <Avatar user={user} size={16} />
        <b>{user.username}</b>
      </button>
      <span>used <span className="vc-cmd-used">/{i.name}</span></span>
    </div>
  );
}
export function Thinking({ m }) {
  return <div className="vc-thinking"><i /><i /><i /><span>{m.author?.username || 'The bot'} is thinking...</span></div>;
}
export function EphemeralNote({ m, view }) {
  return <div className="vc-eph-note"><EyeOff size={12} /> Only you can see this <button type="button" onClick={() => dismissEphemeral(view, m)}>Dismiss message</button></div>;
}

function ModalForm({ ev }) {
  const rows = ev.modal.components.map(r => (r.type === 18 ? { ...r.component, label: r.label || r.component.label, hint: r.description } : { ...r.components[0] }));
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.custom_id, r.value || ''])));
  const [busy, setBusy] = useState(false);
  async function submit(close) {
    for (const r of rows) if (r.required && !String(vals[r.custom_id] || '').trim()) { toast(`${r.label || 'A field'} is required.`); return; }
    setBusy(true);
    try { await sendInteraction(ev.server, { type: 5, channel: ev.channel, source: ev.interaction, fields: vals }); close(); }
    catch (e) { fail(e); setBusy(false); }
  }
  return (
    <Dialog title={ev.modal.title} onClose={closeInteractionModal}>
      {close => (
        <form onSubmit={e => { e.preventDefault(); submit(close); }}>
          {rows.map((r, i) => (
            <label key={r.custom_id} className="vc-field">
              <span>{r.label}{r.required && <em>*</em>}</span>
              {r.hint && <small>{r.hint}</small>}
              {r.style === 2
                ? <textarea className="form-input" autoFocus={i === 0} rows={4} value={vals[r.custom_id]} placeholder={r.placeholder} minLength={r.min_length} maxLength={r.max_length || 4000} onChange={e => setVals(v => ({ ...v, [r.custom_id]: e.target.value }))} />
                : <input className="form-input" autoFocus={i === 0} value={vals[r.custom_id]} placeholder={r.placeholder} minLength={r.min_length} maxLength={r.max_length || 4000} onChange={e => setVals(v => ({ ...v, [r.custom_id]: e.target.value }))} />}
            </label>
          ))}
          <div className="vc-dialog-btns">
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>Submit</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
export function InteractionModalHost() {
  const ev = useChat(s => s.interactionModal);
  return ev ? <ModalForm key={ev.interaction} ev={ev} /> : null;
}
