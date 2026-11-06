// Server settings pages backed by an instance's /servers/:sid/settings (PROTOCOL §6.4): Dashboard, Joining, Message rules,
// Reports, AutoMod, Audit log and the upload rules. Each page edits a draft of its sections and saves with the unsaved bar;
// numbers a Velora hosting plan caps show the plan's number and a lock.
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid, DoorOpen, MessageSquare, Flag, ShieldAlert, ScrollText, Upload, Users, Ban, HardDrive, Activity, Hash, Lock, X, Plus,
  KeyRound, Link2, Trash2, UserMinus, ArrowUpRight, Check, RotateCcw, Timer, Image, Bot,
} from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, toast, errorText, refreshServer, jumpToMessage, loadMembers } from './store.js';
import { instOf, K } from './ids.js';
import { Toggle, P, has, modRights, moderate, RoleAddMenu } from './roles.jsx';
import { Avatar } from './Profile.jsx';
import { stampOf } from './text.jsx';
import { Card } from './SettingsShell.jsx';
import { useUnsaved, UnsavedBar } from './unsaved.jsx';
import { JoinInvites, UploadsTab } from './Community.jsx';
import { OperatorTermsNotice } from './OperatorTerms.jsx';

const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = e => toast(errorText(e.message));
const url = sid => `/chat/servers/${sid}/settings`;
export const fmtBytes = n => { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`; };
const fmtUptime = s => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

// one page's draft of some settings sections. keys: section names, or 'join_policy'. extra: { changed, body(), reset() } for
// fields that aren't settings (a new join password)
function useRules(sid, onDirty, keys, extra = {}) {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = v => Object.fromEntries(keys.map(k => [k, v[k]]));
  useEffect(() => {
    let off = false;
    setS(null);
    apiFetch(url(sid)).then(d => { if (!off) { setS(d.settings); setDraft(clone(pick(d.settings))); } }).catch(e => { if (!off) { fail(e); setS(false); } });
    return () => { off = true; };
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !!s && !!draft && (!same(draft, pick(s)) || !!extra.changed);
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  const set = (sec, k, v) => setDraft(d => (k == null ? { ...d, [sec]: v } : { ...d, [sec]: { ...d[sec], [k]: v } }));
  const reset = () => { setDraft(clone(pick(s))); extra.reset?.(); };
  async function patch(body) {
    const d = await apiFetch(url(sid), { method: 'PATCH', body: JSON.stringify(body) });
    setS(d.settings); setDraft(clone(pick(d.settings))); refreshServer(sid);
    return d.settings;
  }
  async function save(clean = x => x) {
    const want = clean(clone(draft)), body = { ...(extra.body?.() || {}) };
    for (const k of keys) {
      if (typeof want[k] !== 'object' || want[k] === null) { if (want[k] !== s[k]) body[k] = want[k]; continue; }
      const diff = {};
      for (const [f, v] of Object.entries(want[k])) if (!same(v, s[k][f])) diff[f] = v;
      if (Object.keys(diff).length) body[k] = diff;
    }
    setBusy(true);
    try { await patch(body); extra.reset?.(); flashSaved(); } catch (e) { fail(e); }
    setBusy(false);
  }
  const ui = s && draft ? <UnsavedBar changed={changed} bar={bar} busy={busy} onReset={reset} onSave={() => save(extra.clean)} /> : null;
  return { s, draft, set, patch, ui, loading: s === null || (s && !draft), failed: s === false };
}
const Loading = () => <div className="vc-loading"><i /><i /><i /></div>;

// a whole number; nullable: an "Unlimited" switch beside it (blank = unlimited). cap: the plan's most (locks Unlimited off)
function NumField({ label, hint, value, onChange, min = 1, max, nullable, cap, unit, disabled, placeholder, fallback }) {
  const top = cap != null ? Math.min(max ?? cap, cap) : max;
  const unlimited = nullable && cap == null && value == null;
  const [last, setLast] = useState(value ?? fallback ?? cap ?? min); // the number the box shows while Unlimited is on
  useEffect(() => { if (value != null) setLast(value); }, [value]);
  const set = v => { if (v === '') { onChange(nullable && cap == null ? null : value); return; } const n = Math.round(Number(v)); if (Number.isFinite(n)) onChange(n); };
  const bad = !unlimited && value != null && (value < min || (top != null && value > top));
  return (
    <div className={`vc-field bf-sr-num${disabled ? ' off' : ''}`}>
      <span>{label}</span>
      <div className="bf-sr-num-row">
        <input className={`form-input vc-narrow${bad ? ' vc-err' : ''}`} type="number" min={min} max={top ?? undefined} disabled={disabled || unlimited} aria-label={label}
          placeholder={placeholder ?? (cap != null ? String(cap) : undefined)} value={unlimited ? last : value ?? ''} onChange={e => set(e.target.value)} />
        {unit && <small className="vc-hint">{unit}</small>}
        {nullable && (
          <label className={`bf-sr-unl${cap != null ? ' locked' : ''}`} data-tip={cap != null ? 'Managed by your hosting plan' : undefined}>
            <button type="button" role="switch" aria-checked={unlimited} aria-label={`${label}: unlimited`} disabled={disabled || cap != null} className={`cs-switch${unlimited ? ' on' : ''}`}
              onClick={() => onChange(unlimited ? last : null)}><i /></button>
            Unlimited
          </label>
        )}
        {cap != null && <span className="bf-sr-plan" data-tip="Managed by your hosting plan"><Lock size={12} /> Plan: up to {cap.toLocaleString()}</span>}
      </div>
      {hint && <small className="vc-hint">{hint}</small>}
    </div>
  );
}
// an optional number shown as its default when blank (spam limits)
const optNum = (v, set) => ({ value: v ?? '', onChange: e => set(e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0)) });

// non-default roles as chips (the profile card's look: colour, icon), picked from the same list as "give a role", several at a time
function RolePicker({ sid, value, onChange, label, hint }) {
  const roles = useChat(s => s.detail[sid]?.roles) || [];
  const [open, setOpen] = useState(false);
  const list = roles.filter(r => !r.is_default).sort((a, b) => b.position - a.position);
  const byId = new Map(list.map(r => [r.rid, r]));
  const toggle = rid => onChange(value.includes(rid) ? value.filter(x => x !== rid) : [...value, rid]);
  return (
    <div className="vc-field">
      <span>{label}</span>
      <div className="vc-role-chips bf-sr-roles">
        {value.map(rid => { const r = byId.get(rid); return (
          <span key={rid} className="vc-role-chip" style={{ '--rc': r?.color || 'var(--dim)' }}>
            <button type="button" title={`Remove ${r?.name || 'role'}`} onClick={() => toggle(rid)}><X size={10} /></button>
            {r?.icon && <img src={r.icon} alt="" />}{r?.name || 'Deleted role'}
          </span>
        ); })}
        {list.length > 0 && (
          <span className="vc-role-add-wrap">
            <button type="button" className="vc-role-chip add" onClick={() => setOpen(o => !o)} title="Add roles" aria-expanded={open}><Plus size={12} />{!value.length && ' Add roles'}</button>
            {open && <RoleAddMenu roles={list} picked={value} onPick={r => toggle(r.rid)} onClose={() => setOpen(false)} />}
          </span>
        )}
        {!list.length && <small className="vc-hint">This server has no roles yet.</small>}
      </div>
      {hint && <small className="vc-hint">{hint}</small>}
    </div>
  );
}

// ───────────────────────────── Dashboard ─────────────────────────────
const SLICE = ['var(--accent)', '#6f9e7c', '#d6a64c', '#7a8fd6', '#c47ab8', '#d45c5c', '#5cb8c4', '#b88a5c', '#9a9aa0', '#6c6c72'];
function Donut({ parts, total }) {
  const r = 52, c = 2 * Math.PI * r;
  let at = 0;
  return (
    <svg className="bf-sr-donut" viewBox="0 0 140 140" role="img" aria-label="Storage by kind">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="18" />
      {total > 0 && parts.map((p, i) => {
        const len = (p.bytes / total) * c, el = <circle key={p.key} cx="70" cy="70" r={r} fill="none" stroke={SLICE[i % SLICE.length]} strokeWidth="18" strokeDasharray={`${Math.max(0, len - (parts.length > 1 ? 1.5 : 0))} ${c}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"><title>{`${p.label}: ${fmtBytes(p.bytes)}`}</title></circle>;
        at += len; return el;
      })}
      <text x="70" y="66" textAnchor="middle" className="bf-sr-donut-big">{fmtBytes(total)}</text>
      <text x="70" y="84" textAnchor="middle" className="bf-sr-donut-sub">in total</text>
    </svg>
  );
}
export function DashboardPage({ sid, goTo }) {
  const [d, setD] = useState(null);
  const [by, setBy] = useState('messages');
  const canMod = useChat(s => { const p = s.detail[sid]?.server?.perms; return has(p, P.KICK) || has(p, P.BAN) || has(p, P.MANAGE_MESSAGES) || has(p, P.MANAGE_SERVER); });
  useEffect(() => { apiFetch(`/chat/servers/${sid}/dashboard`).then(setD).catch(e => { fail(e); setD(false); }); }, [sid]);
  if (d === null) return <div className="bf-ss-page"><Loading /></div>;
  if (!d) return <div className="bf-ss-page"><Card title="Dashboard" icon={LayoutGrid}><p className="vc-hint">The dashboard needs a newer version of this server.</p></Card></div>;
  const top = by === 'messages' ? d.channels.by_messages : d.channels.by_storage;
  const most = Math.max(1, ...top.map(x => (by === 'messages' ? x.messages : x.bytes)));
  const tiles = [
    [Users, 'Members', d.members.toLocaleString(), d.bots ? `+ ${d.bots} bot${d.bots === 1 ? '' : 's'}` : 'people', () => goTo('members')],
    [Ban, 'Banned', d.banned.toLocaleString(), d.timeouts ? `${d.timeouts} timed out` : 'members', () => goTo('members')],
    [MessageSquare, 'Messages', d.messages.toLocaleString(), `in ${d.channels.with_messages} channel${d.channels.with_messages === 1 ? '' : 's'}`],
    [HardDrive, 'Disk', fmtBytes(d.disk), 'used by this server'],
  ];
  return (
    <div className="bf-ss-page">
      <OperatorTermsNotice sid={sid} />
      <div className="bf-sr-tiles">
        {tiles.map(([I, label, big, small, onClick]) => {
          const T = onClick ? 'button' : 'div';
          return <T key={label} type={onClick ? 'button' : undefined} className="bf-sr-tile" onClick={onClick}><span><I size={14} /> {label}</span><b>{big}</b><small>{small}</small></T>;
        })}
      </div>
      {canMod && d.open_reports > 0 && <button type="button" className="bf-ss-reg warn bf-sr-reports-note" onClick={() => goTo('reports')}><Flag size={14} /><span><b>{d.open_reports} open report{d.open_reports === 1 ? '' : 's'}</b> waiting for a moderator.</span><ArrowUpRight size={14} /></button>}
      <Card title="Server health" icon={Activity}>
        <div className="bf-sr-health">
          <div><small>Runtime</small><b>{d.health.runtime}</b></div>
          <div><small>Memory</small><b>{fmtBytes(d.health.memory)}</b></div>
          <div><small>Uptime</small><b>{fmtUptime(d.health.uptime_s || 0)}</b></div>
          <div><small>Version</small><b>{d.health.version}{d.health.commit_short ? ` (${d.health.commit_short})` : ''}</b></div>
        </div>
      </Card>
      <Card title="Storage" icon={HardDrive}>
        <div className="bf-sr-storage">
          <Donut parts={d.storage} total={d.disk} />
          <ul className="bf-sr-legend">
            {d.storage.map((p, i) => <li key={p.key}><i style={{ background: SLICE[i % SLICE.length] }} /><span>{p.label}</span><b>{fmtBytes(p.bytes)}</b><small>{d.disk ? Math.round((p.bytes / d.disk) * 100) : 0}%</small></li>)}
            {!d.storage.length && <li className="vc-hint">Nothing stored yet.</li>}
          </ul>
        </div>
      </Card>
      <Card title="Top channels" icon={Hash}>
        <div className="vc-tabs inline bf-sr-seg">
          <button type="button" className={by === 'messages' ? 'on' : ''} onClick={() => setBy('messages')}>By messages</button>
          <button type="button" className={by === 'storage' ? 'on' : ''} onClick={() => setBy('storage')}>By storage</button>
        </div>
        {!top.length && <p className="vc-hint">No messages yet.</p>}
        <ol className="bf-sr-bars">
          {top.map(x => { const v = by === 'messages' ? x.messages : x.bytes; return <li key={x.cid}><span className="bf-sr-bar-name"><Hash size={13} />{x.name}</span><span className="bf-sr-bar"><i style={{ width: `${Math.max(2, (v / most) * 100)}%` }} /></span><b>{by === 'messages' ? v.toLocaleString() : fmtBytes(v)}</b></li>; })}
        </ol>
        <small className="vc-hint">{d.channels.with_messages} channel{d.channels.with_messages === 1 ? ' has' : 's have'} messages, {d.channels.empty} {d.channels.empty === 1 ? 'is' : 'are'} empty.</small>
      </Card>
    </div>
  );
}

// ───────────────────────────── Joining ─────────────────────────────
const POLICIES = [
  ['open', 'Anyone', 'People who find the server can join straight away.'],
  ['request', 'People you approve', 'People ask to join and a moderator lets them in.'],
  ['password', 'With a password', 'People type the server password to join.'],
  ['allowlist', 'People on a list', 'Only the usernames you list can join.'],
  ['invite', 'Invite link only', 'Only people with an invite link can join.'],
];
export function JoiningPage({ sid, onDirty, goTo, instAdmin }) {
  const [pass, setPass] = useState('');
  const [who, setWho] = useState('');
  const r = useRules(sid, onDirty, ['join_policy', 'join'], { changed: !!pass, body: () => (pass ? { join_password: pass } : {}), reset: () => setPass('') });
  const people = useChat(s => s.members[sid]);
  useEffect(() => { loadMembers(sid); }, [sid]);
  if (r.failed) return <div className="bf-ss-page"><JoinInvites sid={sid} /></div>;
  if (r.loading) return <div className="bf-ss-page"><Loading /></div>;
  const { s, draft, set } = r, j = draft.join, cap = s.plan?.member_cap ?? null;
  const addWho = () => { const t = who.trim().replace(/^@/, '').toLowerCase(); if (t && !j.allowlist.includes(t)) set('join', 'allowlist', [...j.allowlist, t]); setWho(''); };
  return (
    <div className="bf-ss-page">
      <Card title="Who can join" icon={DoorOpen}>
        <div className="bf-sr-modes" role="radiogroup" aria-label="Who can join">
          {POLICIES.map(([id, label, hint]) => (
            <button key={id} type="button" role="radio" aria-checked={draft.join_policy === id} className={`bf-sr-mode${draft.join_policy === id ? ' on' : ''}`} onClick={() => set('join_policy', null, id)}>
              <b>{label}</b><small>{hint}</small>
            </button>
          ))}
        </div>
        {draft.join_policy === 'password' && (
          <label className="vc-field vc-gap-top"><span>{s.has_password ? 'Change the password' : 'Server password'}</span>
            <input className="form-input" type="password" autoComplete="new-password" maxLength={200} placeholder={s.has_password ? 'Leave blank to keep the current one' : 'At least 4 characters'} value={pass} onChange={e => setPass(e.target.value)} />
            <small className={`vc-hint${!s.has_password && pass.length < 4 ? ' vc-err' : ''}`}>{s.has_password ? 'A password is set. Members who already joined stay in when it changes.' : 'Set a password before saving.'}</small></label>
        )}
        {draft.join_policy === 'allowlist' && (
          <div className="vc-field vc-gap-top"><span>Allowed usernames - {j.allowlist.length}</span>
            <form className="vc-row" onSubmit={e => { e.preventDefault(); addWho(); }}>
              <input className="form-input" maxLength={64} placeholder="username" value={who} onChange={e => setWho(e.target.value)} />
              <button type="submit" className="btn btn-surface" disabled={!who.trim()}><Plus size={14} /> Add</button>
            </form>
            <div className="bf-sr-chips">{j.allowlist.map(u => <span key={u} className="vc-chip bf-sr-chip">{u}<button type="button" aria-label={`Remove ${u}`} onClick={() => set('join', 'allowlist', j.allowlist.filter(x => x !== u))}><X size={12} /></button></span>)}</div>
            <small className="vc-hint">Their username on this server (or their account id). An invite link still lets anyone in.</small>
          </div>
        )}
        <small className="vc-hint vc-gap-top">An invite link always lets someone in, whatever this is set to.</small>
      </Card>
      <Card title="Members" icon={Users}>
        <NumField label="Member limit" value={j.max_members} nullable fallback={100} cap={cap} max={10000000} onChange={v => set('join', 'max_members', v)}
          hint={`${people ? (n => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'} now. `)(people.filter(m => !m.bot).length) : ''}When the server is full, no one else can join until someone leaves. Bots don't count.`} />
        <RolePicker sid={sid} label="Roles new members get" value={j.default_roles} onChange={v => set('join', 'default_roles', v)} hint="Given to everyone who joins from now on (not bots). You can only pick roles below your own." />
        {instAdmin && <div className="cs-row"><div className="cs-text"><b>Sign-in methods</b><span>Nookara accounts, this server's own accounts and who can register.</span></div><button type="button" className="btn btn-surface" onClick={() => goTo('accounts')}><KeyRound size={14} /> Accounts</button></div>}
      </Card>
      <Card title="Requests & invites" icon={Link2}><JoinInvites sid={sid} requestsOnly /></Card>
      {r.ui}
    </div>
  );
}

// ───────────────────────────── Message rules ─────────────────────────────
export function MessageRulesPage({ sid, onDirty, goTo }) {
  const r = useRules(sid, onDirty, ['messages']);
  if (r.failed) return <div className="bf-ss-page"><Card title="Message rules" icon={MessageSquare}><p className="vc-hint">This server can't change its message rules yet - it needs an update.</p></Card></div>;
  if (r.loading) return <div className="bf-ss-page"><Loading /></div>;
  const { s, draft, set } = r, m = draft.messages;
  return (
    <div className="bf-ss-page">
      <Card title="Messages" icon={MessageSquare}>
        <NumField label="Longest message (characters)" min={1} max={4000} value={m.max_length} onChange={v => set('messages', 'max_length', v)} hint="1 to 4000. A longer message is refused." />
        <NumField label="Search results per search" min={1} max={100} value={m.search_results} onChange={v => set('messages', 'search_results', v)} hint="1 to 100." />
        <NumField label="Most reactions on one message" min={1} max={50} value={m.max_reactions} onChange={v => set('messages', 'max_reactions', v)} hint="Different emojis per message, 1 to 50." />
        <div className="cs-row"><div className="cs-text"><b>Blocked words and spam</b><span>AutoMod blocks words and slows down people who post too fast.</span></div><button type="button" className="btn btn-surface" onClick={() => goTo('automod')}><ShieldAlert size={14} /> AutoMod</button></div>
      </Card>
      <Card title="Link previews" icon={Link2}>
        <Toggle label="Show link previews" hint="A card with the page's title and picture under messages with links." on={m.link_previews} onChange={v => set('messages', 'link_previews', v)} />
        <label className="vc-field vc-gap-top"><span>Preview proxy {!s.instance_admin && <Lock size={12} className="vc-inline-ico" />}</span>
          <input className="form-input" maxLength={500} placeholder="https://proxy.example/fetch?url={url}" disabled={!s.instance_admin || !m.link_previews} value={m.preview_proxy} onChange={e => set('messages', 'preview_proxy', e.target.value)} />
          <small className="vc-hint">Optional. Previews are fetched through this address instead of from the server itself: {'{url}'} is replaced with the link (or it's added as ?url=).{s.instance_admin ? '' : ' Only the instance admins can change it.'}</small></label>
      </Card>
      {r.ui}
    </div>
  );
}

// ───────────────────────────── Reports ─────────────────────────────
const RTABS = [['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']];
function ReportRow({ sid, rep, onChange }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(rep.note || '');
  const canDelete = useChat(s => has(s.detail[sid]?.server?.perms, P.MANAGE_MESSAGES));
  useChat(s => s.members[sid]);
  const inst = instOf(sid), t = rep.target;
  const rights = t ? modRights(sid, t.username) : { kick: false, ban: false };
  const status = async st => { try { const d = await apiFetch(`/chat/servers/${sid}/reports/${rep.id}`, { method: 'PATCH', body: JSON.stringify({ status: st, note }) }); onChange(d.report); } catch (e) { fail(e); } };
  const del = async () => { try { await apiFetch(`/chat/messages/${rep.message.id}`, { method: 'DELETE', inst }); toast('Message deleted.', true); onChange({ ...rep, message: { ...rep.message, exists: false } }); } catch (e) { fail(e); } };
  const jump = () => jumpToMessage({ kind: 'channel', sid, cid: K(inst, rep.message.channel) }, rep.message.id);
  return (
    <div className={`bf-sr-report${open ? ' open' : ''}`}>
      <button type="button" className="vc-list-row bf-sr-report-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Avatar user={t || { username: '?' }} size={32} />
        <span className="vc-list-txt"><b>{rep.kind === 'message' ? `Message by ${t?.username || rep.message?.author_name || 'someone'}` : `Member ${t?.username || ''}`}</b>
          <small>{rep.reason || 'No reason given'} - reported by {rep.reporter?.username || 'someone'} {stampOf(rep.created_at)}</small></span>
        <span className="grow" />
        <span className={`bf-sr-status ${rep.status}`}>{rep.status}</span>
      </button>
      {open && (
        <div className="bf-sr-report-body">
          {rep.message && (
            <div className="bf-sr-quote">
              <small><Hash size={12} className="vc-inline-ico" />{rep.message.channel_name || 'channel'} - {rep.message.exists ? 'still there' : 'deleted'}</small>
              <p>{rep.message.body || <i>No text</i>}</p>
              {rep.message.attachments > 0 && <small>{rep.message.attachments} attachment{rep.message.attachments === 1 ? '' : 's'}</small>}
            </div>
          )}
          {rep.resolved_by && <small className="vc-hint">{rep.status === 'dismissed' ? 'Dismissed' : rep.status === 'resolved' ? 'Resolved' : 'Handled'} by {rep.resolved_by.username} {stampOf(rep.resolved_at)}</small>}
          <label className="vc-field"><span>Note for other moderators</span><textarea className="form-textarea" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className="bf-sr-actions">
            {rep.message?.exists && rep.message.channel && <button type="button" className="btn btn-surface btn-sm" onClick={jump}><ArrowUpRight size={13} /> Go to message</button>}
            {rep.message?.exists && canDelete && <button type="button" className="btn btn-surface btn-sm" onClick={del}><Trash2 size={13} /> Delete message</button>}
            {t && rights.kick && <button type="button" className="btn btn-surface btn-sm" disabled={!rights.below} onClick={() => moderate(sid, t.username, 'kick', t)}><UserMinus size={13} /> Remove</button>}
            {t && rights.ban && <button type="button" className="btn btn-danger btn-sm" disabled={!rights.below} onClick={() => moderate(sid, t.username, 'ban', t)}><Ban size={13} /> Ban</button>}
            <span className="grow" />
            {rep.status === 'open' ? <>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => status('dismissed')}><X size={13} /> Dismiss</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => status('resolved')}><Check size={13} /> Resolve</button>
            </> : <button type="button" className="btn btn-surface btn-sm" onClick={() => status('open')}><RotateCcw size={13} /> Reopen</button>}
          </div>
        </div>
      )}
    </div>
  );
}
export function ReportsPage({ sid }) {
  const [tab, setTab] = useState('open');
  const [d, setD] = useState(null);
  const load = (before) => apiFetch(`/chat/servers/${sid}/reports?status=${tab}${before ? `&before=${before}` : ''}`)
    .then(x => setD(o => (before && o ? { ...x, reports: [...o.reports, ...x.reports] } : x))).catch(e => { fail(e); setD({ reports: [], open: 0 }); });
  useEffect(() => { setD(null); load(); }, [sid, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const on = e => { if (e.detail?.server === sid) load(); }; addEventListener('vc-report', on); return () => removeEventListener('vc-report', on); }, [sid, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = rep => setD(o => ({ ...o, reports: o.reports.map(x => (x.id === rep.id ? rep : x)) }));
  const list = (d?.reports || []).filter(x => tab === 'all' || x.status === tab);
  return (
    <div className="bf-ss-page">
      <Card title={`Reports${d?.open ? ` - ${d.open} open` : ''}`} icon={Flag}>
        <div className="vc-tabs inline bf-sr-seg">{RTABS.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
        {!d && <Loading />}
        {d && !list.length && <p className="vc-hint">{tab === 'open' ? 'Nothing to look at. Members can report a message or a member from its menu.' : 'No reports here.'}</p>}
        <div className="vc-rows">{list.map(rep => <ReportRow key={rep.id} sid={sid} rep={rep} onChange={update} />)}</div>
        {d?.has_more && <button type="button" className="btn btn-surface btn-sm vc-gap-top" onClick={() => load(d.reports[d.reports.length - 1]?.id)}>Load more</button>}
      </Card>
    </div>
  );
}

// ───────────────────────────── AutoMod ─────────────────────────────
const cleanWords = d => ({ ...d, automod: { ...d.automod, words: [...new Set(d.automod.words.map(w => w.trim()).filter(Boolean))] } });
function Timeouts({ sid }) {
  const [list, setList] = useState(null);
  const load = () => apiFetch(`/chat/servers/${sid}/timeouts`).then(d => setList(d.timeouts)).catch(() => setList([]));
  useEffect(() => { load(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const lift = async u => { try { await apiFetch(`/chat/servers/${sid}/timeouts/${encodeURIComponent(u.id)}`, { method: 'DELETE' }); load(); } catch (e) { fail(e); } };
  return (
    <Card title={`Timed out${list?.length ? ` - ${list.length}` : ''}`} icon={Timer}>
      {list === null && <Loading />}
      {list && !list.length && <p className="vc-hint">No one is timed out.</p>}
      <div className="vc-rows">
        {(list || []).map(t => (
          <div key={t.user?.id} className="vc-list-row">
            <Avatar user={t.user || { username: '?' }} size={32} />
            <span className="vc-list-txt"><b>{t.user?.username || 'Unknown'}</b><small>Until {new Date(t.until).toLocaleString()}{t.reason ? ` - ${t.reason}` : ''}</small></span>
            <span className="grow" />
            <button type="button" className="btn btn-surface btn-sm" onClick={() => lift(t.user)}>Lift</button>
          </div>
        ))}
      </div>
    </Card>
  );
}
export function AutoModPage({ sid, onDirty }) {
  const r = useRules(sid, onDirty, ['automod'], { clean: cleanWords });
  if (r.failed) return <div className="bf-ss-page"><Card title="AutoMod" icon={ShieldAlert}><p className="vc-hint">This server doesn't have AutoMod yet - it needs an update.</p></Card></div>;
  if (r.loading) return <div className="bf-ss-page"><Loading /></div>;
  const { s, draft, set } = r, a = draft.automod, def = s.spam_defaults;
  const am = (k, v) => set('automod', k, v);
  return (
    <div className="bf-ss-page">
      <Card title="Blocked words" icon={ShieldAlert}>
        <Toggle label="Block messages with these words" hint="The message isn't sent, and the sender can be timed out. The owner is never blocked." on={a.words_enabled} onChange={v => am('words_enabled', v)} />
        <label className="vc-field vc-gap-top"><span>Words - {a.words.filter(w => w.trim()).length}</span>
          <textarea className="form-textarea bf-sr-words" rows={5} disabled={!a.words_enabled} placeholder={'One word or phrase per line'} value={a.words.join('\n')} onChange={e => am('words', e.target.value.split('\n'))} />
          <small className="vc-hint">One per line, up to 1000. Each can be up to 64 characters.</small></label>
        <label className="vc-field"><span>Word list file on the server {!s.instance_admin && <Lock size={12} className="vc-inline-ico" />}</span>
          <input className="form-input" maxLength={300} placeholder="automod/words.txt" disabled={!s.instance_admin || !a.words_enabled} value={a.word_file} onChange={e => am('word_file', e.target.value)} />
          <small className="vc-hint">Optional: a text file in the server's data folder, one word per line (lines starting with # are skipped). It's read again when it changes.{s.instance_admin ? '' : ' Only the instance admins can change it.'}</small></label>
        <Toggle label="Whole words only" hint={'On: "ass" doesn\'t block "class". Off: it blocks the letters anywhere.'} disabled={!a.words_enabled} on={a.whole_word} onChange={v => am('whole_word', v)} />
        <Toggle label="Match case" hint="On: capital letters have to match too." disabled={!a.words_enabled} on={a.match_case} onChange={v => am('match_case', v)} />
        <NumField label="Time out the sender for" unit="seconds (0: just block the message)" min={0} max={2419200} disabled={!a.words_enabled} value={a.timeout_seconds} onChange={v => am('timeout_seconds', v)} />
      </Card>
      <Card title="Spam" icon={Bot}>
        <Toggle label="Slow down people who post too fast" hint="Moderators who can manage messages aren't limited." on={a.spam_enabled} onChange={v => am('spam_enabled', v)} />
        <div className={`bf-sr-sentence${a.spam_enabled ? '' : ' off'}`}>
          Allow <input className="form-input" type="number" min={1} max={600} placeholder={String(def.per_minute)} disabled={!a.spam_enabled} aria-label="Messages a minute" {...optNum(a.spam_per_minute, v => am('spam_per_minute', v))} /> messages a minute
          and <input className="form-input" type="number" min={1} max={100} placeholder={String(def.burst)} disabled={!a.spam_enabled} aria-label="Messages in a row" {...optNum(a.spam_burst, v => am('spam_burst', v))} /> in a row,
          then pause for <input className="form-input" type="number" min={0} max={86400} placeholder={String(def.pause_seconds)} disabled={!a.spam_enabled} aria-label="Pause seconds" {...optNum(a.spam_pause_seconds, v => am('spam_pause_seconds', v))} /> seconds.
        </div>
        <small className="vc-hint">"In a row" means within 10 seconds. A pause of 0 only refuses the extra messages. Blank boxes use the numbers shown.</small>
      </Card>
      <Card title="Exempt roles" icon={Users}>
        <RolePicker sid={sid} label="AutoMod skips people with" value={a.exempt_roles} onChange={v => am('exempt_roles', v)} />
      </Card>
      <Timeouts sid={sid} />
      {r.ui}
    </div>
  );
}

// ───────────────────────────── Audit log ─────────────────────────────
const CAT_LABEL = { user_moderation: 'User moderation', role_management: 'Roles', channel_management: 'Channels', message_moderation: 'Message moderation', server_management: 'Server management' };
const ACTION_TEXT = {
  member_kick: 'removed', member_ban: 'banned', member_unban: 'unbanned', member_timeout: 'timed out', timeout_remove: 'lifted the timeout of',
  join_accept: 'let in', join_deny: 'turned away', role_create: 'created the role', role_update: 'changed the role', role_delete: 'deleted the role',
  role_order: 'reordered the roles', member_role_add: 'gave a role to', member_role_remove: 'took a role from', channel_create: 'created',
  channel_update: 'changed', channel_delete: 'deleted', channel_perms: 'changed the permissions of', channel_layout: 'rearranged the channels',
  message_delete: 'deleted a message by', message_pin: 'pinned a message in', message_unpin: 'unpinned a message in', automod_block: 'blocked a message by',
  spam_pause: 'paused', report_resolve: 'resolved a report about', report_dismiss: 'dismissed a report about', report_reopen: 'reopened a report about',
  server_update: 'changed the server', settings_update: 'changed the settings', unmarked_aliases_update: 'changed unmarked aliases', invite_create: 'created an invite', invite_delete: 'deleted an invite',
  emoji_create: 'added the emoji', emoji_rename: 'renamed the emoji', emoji_delete: 'deleted the emoji',
};
const actionName = a => (ACTION_TEXT[a] || a.replace(/_/g, ' ')).replace(/^./, c => c.toUpperCase());
function detailText(d) {
  if (!d) return '';
  const out = [];
  if (Array.isArray(d.changed)) out.push(`changed ${d.changed.join(', ')}`);
  for (const k of ['role', 'reason', 'word', 'note', 'name', 'channel', 'code']) if (d[k] != null && typeof d[k] !== 'object') out.push(`${k}: ${d[k]}`);
  if (d.seconds) out.push(`${d.seconds}s`);
  if (typeof d.enabled === 'boolean') out.push(d.enabled ? 'turned on' : 'turned off');
  return out.join(' - ');
}
export function AuditLogPage({ sid, onDirty }) {
  const canServer = useChat(s => has(s.detail[sid]?.server?.perms, P.MANAGE_SERVER));
  const r = useRules(sid, canServer ? onDirty : undefined, ['audit']);
  const [cat, setCat] = useState('all');
  const [action, setAction] = useState('all');
  const [log, setLog] = useState(null);
  const load = before => apiFetch(`/chat/servers/${sid}/audit?category=${cat}&action=${action}${before ? `&before=${before}` : ''}`)
    .then(x => setLog(o => (before && o ? { ...x, entries: [...o.entries, ...x.entries] } : x))).catch(e => { fail(e); setLog({ entries: [] }); });
  useEffect(() => { setLog(null); load(); }, [sid, cat, action]); // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useMemo(() => Object.entries(log?.action_categories || {}).filter(([, c]) => cat === 'all' || c === cat).map(([a]) => a), [log?.action_categories, cat]);
  const cats = log?.categories || Object.keys(CAT_LABEL);
  const au = r.draft?.audit;
  return (
    <div className="bf-ss-page">
      {canServer && au && (
        <Card title="Keeping the log" icon={ScrollText}>
          <Toggle label="Keep an audit log" hint="Records what moderators and admins do here. Off: nothing new is recorded (what's there stays until it's too old)." on={au.enabled} onChange={v => r.set('audit', 'enabled', v)} />
          <NumField label="Keep entries for" unit="days" min={1} max={3650} disabled={!au.enabled} value={au.retention_days} onChange={v => r.set('audit', 'retention_days', v)} />
          <div className="vc-field"><span>Per category</span>
            <div className="bf-sr-retention">
              {cats.map(c => (
                <label key={c}><span>{CAT_LABEL[c] || c}</span>
                  <input className="form-input" type="number" min={1} max={3650} disabled={!au.enabled} placeholder={String(au.retention_days)} value={au.retention[c] ?? ''}
                    onChange={e => { const n = { ...au.retention }; if (e.target.value === '') delete n[c]; else n[c] = Math.max(1, Math.round(Number(e.target.value)) || 1); r.set('audit', 'retention', n); }} />
                  <small>days</small></label>
              ))}
            </div>
            <small className="vc-hint">Blank uses the number above.</small></div>
        </Card>
      )}
      <Card title="Audit log" icon={ScrollText}>
        <div className="bf-sr-auditbar">
          <div className="vc-tabs inline bf-sr-seg">
            <button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => { setCat('all'); setAction('all'); }}>All</button>
            {cats.map(c => <button key={c} type="button" className={cat === c ? 'on' : ''} onClick={() => { setCat(c); setAction('all'); }}>{CAT_LABEL[c] || c}</button>)}
          </div>
          <select className="form-input bf-sr-add" value={action} onChange={e => setAction(e.target.value)} aria-label="Action">
            <option value="all">All actions</option>
            {actions.map(a => <option key={a} value={a}>{actionName(a)}</option>)}
          </select>
        </div>
        {!log && <Loading />}
        {log && !log.entries.length && <p className="vc-hint">Nothing recorded{cat !== 'all' || action !== 'all' ? ' for this filter' : ''} yet.</p>}
        <div className="vc-rows">
          {(log?.entries || []).map(e => (
            <div key={e.id} className="vc-list-row bf-sr-audit">
              {e.automod ? <span className="bf-sr-automod"><ShieldAlert size={16} /></span> : <Avatar user={e.actor || { username: '?' }} size={32} />}
              <span className="vc-list-txt">
                <span><b>{e.automod ? 'AutoMod' : e.actor?.username || 'Someone'}</b> {ACTION_TEXT[e.action] || e.action.replace(/_/g, ' ')} {e.target?.name && <b>{e.target.kind === 'channel' ? '#' : ''}{e.target.name}</b>}</span>
                <small>{CAT_LABEL[e.category] || e.category} - {stampOf(e.created_at)}{detailText(e.details) ? ` - ${detailText(e.details)}` : ''}</small>
              </span>
            </div>
          ))}
        </div>
        {log?.has_more && <button type="button" className="btn btn-surface btn-sm vc-gap-top" onClick={() => load(log.entries[log.entries.length - 1]?.id)}>Load more</button>}
      </Card>
      {r.ui}
    </div>
  );
}

// ───────────────────────────── Uploads ─────────────────────────────
const TYPE_LABEL = { any: 'Any file', images: 'Images', videos: 'Videos', audio: 'Audio', pdf: 'PDFs', text: 'Text', archives: 'Archives' };
const PLANS = [['free', 'Free'], ['pro', 'Pro']];
export function UploadRulesPage({ sid, onDirty }) {
  const canServer = useChat(s => has(s.detail[sid]?.server?.perms, P.MANAGE_SERVER));
  const r = useRules(sid, canServer ? onDirty : undefined, ['uploads']);
  const allow = useChat(s => s.detail[sid]?.server?.allow_uploads);
  if (!canServer || r.failed) return <div className="bf-ss-page"><Card title="Uploads" icon={Upload}><UploadsTab sid={sid} /></Card></div>;
  if (r.loading) return <div className="bf-ss-page"><Card title="Uploads" icon={Upload}><UploadsTab sid={sid} /></Card><Loading /></div>;
  const { s, draft, set } = r, u = draft.uploads, plan = s.plan || {};
  const up = (k, v) => set('uploads', k, v);
  const anyType = u.types.includes('any');
  const toggleType = t => {
    if (t === 'any') { up('types', ['any']); return; }
    const cur = anyType ? [] : u.types;
    const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    up('types', next.length ? next : ['any']);
  };
  const off = !allow;
  return (
    <div className="bf-ss-page">
      <Card title="Uploads" icon={Upload}>
        <UploadsTab sid={sid} />
        <NumField label="Uploads per minute" min={1} max={600} disabled={off} value={u.per_minute} onChange={v => up('per_minute', v)} hint="For each member. The owner isn't limited." />
        <NumField label="Files each member can keep" nullable fallback={500} cap={plan.files_per_member ?? null} max={1000000} disabled={off} value={u.files_per_member} onChange={v => up('files_per_member', v)} hint="When someone has this many, they delete one before uploading another." />
        <div className="vc-field"><span>Allowed file types</span>
          <div className="bf-sr-chips">{(s.file_types || Object.keys(TYPE_LABEL)).map(t => <button key={t} type="button" disabled={off} className={`vc-chip${(t === 'any' ? anyType : !anyType && u.types.includes(t)) ? ' on' : ''}`} onClick={() => toggleType(t)}>{TYPE_LABEL[t] || t}</button>)}</div>
          <small className="vc-hint">Checked by what's inside the file, not just its name.</small></div>
      </Card>
      <Card title="Keeping files" icon={HardDrive}>
        <NumField label="Delete files after" unit="days" nullable fallback={30} cap={plan.upload_expiry_days ?? null} max={3650} disabled={off} value={u.expire_days} onChange={v => up('expire_days', v)}
          hint="Unlimited keeps files until someone deletes them. Members can pick a shorter time when they upload. Expired files show as deleted in their messages." />
        <div className="vc-field"><span>Plans whose files never expire</span>
          <div className="bf-sr-chips">{PLANS.map(([id, label]) => { const on = u.never_expire_plans.includes(id); return <button key={id} type="button" disabled={off || u.expire_days == null} className={`vc-chip${on ? ' on' : ''}`} onClick={() => up('never_expire_plans', on ? u.never_expire_plans.filter(x => x !== id) : [...u.never_expire_plans, id])}>{label}</button>; })}</div>
          <small className="vc-hint">The Nookara plan of the person who uploaded it.</small></div>
        <RolePicker sid={sid} label="Roles whose files never expire" value={u.never_expire_roles || []} onChange={v => up('never_expire_roles', v)} hint="Members with one of these roles keep their files until they delete them." />
        <NumField label="Total storage" unit="MB" nullable fallback={1024} cap={plan.storage_mb ?? null} max={100000000} disabled={off} value={u.storage_mb} onChange={v => up('storage_mb', v)} hint="All uploads together. When it's full, uploads are refused until files are deleted." />
      </Card>
      <Card title="Image compression" icon={Image}>
        <Toggle label="Shrink big pictures" hint={s.image_compression_available ? 'Pictures are resized to fit and re-saved. Animated GIFs are left as they are.' : "This server can't process pictures (sharp isn't installed), so this does nothing yet."} disabled={off} on={u.compress} onChange={v => up('compress', v)} />
        <div className="bf-sr-grid">
          <NumField label="Max width" unit="px" min={16} max={16384} disabled={off || !u.compress} value={u.max_width} onChange={v => up('max_width', v)} />
          <NumField label="Max height" unit="px" min={16} max={16384} disabled={off || !u.compress} value={u.max_height} onChange={v => up('max_height', v)} />
          <NumField label="Max decoded pixels" min={10000} max={1000000000} disabled={off || !u.compress} value={u.max_pixels} onChange={v => up('max_pixels', v)} />
          <NumField label="JPEG quality" min={1} max={100} disabled={off || !u.compress} value={u.jpeg_quality} onChange={v => up('jpeg_quality', v)} />
        </div>
        <small className="vc-hint">A picture with more pixels than the limit is refused (it would take too much memory to open).</small>
      </Card>
      {r.ui}
    </div>
  );
}
