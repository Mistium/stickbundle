// Roles + permissions on the client: what you're allowed to do, name colours, role icons,
// channel icons, and the Roles part of Server settings.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Hash, Megaphone, Lock, MessageCircle, Gamepad2, Music, Image, Code, Bug, Lightbulb, HelpCircle, Star, Heart, BookOpen,
  Coffee, Sparkles, Trophy, Video, Palette, Terminal, Globe, Bell, Shield, Rocket, ScrollText, Smile, Flame, Zap, Gift, Pin,
  Plus, Trash2, GripVertical, Upload, X, Check, BadgeCheck, DoorOpen, ExternalLink, Volume2, EyeOff, UserMinus, Ban, Clock } from 'lucide-react';
const TYPE_ICONS = { logs: ScrollText, roles: BadgeCheck, welcome: DoorOpen, link: ExternalLink, voice: Volume2, game: Gamepad2, starboard: Star };
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, getState, toast, errorText, ask, refreshServer, memberRef, loadMembers, untilText } from './store.js';
import { isInst, instOf } from './ids.js';
import { userScrolled } from './userscroll.js';

export const P = {
  SEND: 1, MANAGE_CHANNELS: 2, MANAGE_SERVER: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32,
  MANAGE_MESSAGES: 64, MENTION_EVERYONE: 128, ATTACH: 256, ADMIN: 512, MANAGE_USERS: 2048,
  UNMARKED_ALIASES: 4096, // instances only: a bot's alias messages show unmarked while the server's Danger zone allows it
};
const INST_ONLY_PERMS = new Set(['UNMARKED_ALIASES']); // Velora's own servers don't have these
export const PERM_LIST = [
  ['ADMIN', 'Administrator', 'Every permission, and can do anything in the server. Be careful who gets this.'],
  ['MANAGE_SERVER', 'Manage server', 'Change the name, description, icon, banner and server settings.'],
  ['MANAGE_ROLES', 'Manage roles', 'Create and edit roles below their own, and give them to people.'],
  ['MANAGE_USERS', 'Manage users', 'See who is really online (invisible people show with a hollow dot), which client and device people use, and when they last logged in. Also shows a client tag next to their messages.', "Shows when people last logged in and which page each message was sent from. Invisible status and devices only show in Nookara's own servers: this server doesn't see people's presence."],
  ['MANAGE_CHANNELS', 'Manage channels', 'Create, edit, delete and rearrange channels and categories.'],
  ['KICK', 'Kick members', 'Remove people from the server (they can come back with an invite).'],
  ['BAN', 'Ban members', 'Remove people for good.'],
  ['MANAGE_MESSAGES', 'Manage messages', "Delete other people's messages, and post in locked channels."],
  ['MENTION_EVERYONE', 'Mention @everyone, @here and all roles', 'Ping the whole server, or roles that are not mentionable.'],
  ['SEND', 'Send messages', 'Post in channels that let everyone send messages.'],
  ['ATTACH', 'Attach files', 'Send pictures with their messages.'],
  ['UNMARKED_ALIASES', 'Use unmarked aliases', "For bots: while the server owner has turned on unmarked aliases (Server settings > Danger zone > Advanced), this bot's alias messages look exactly like a member's, with no alias mark. Only give it to bots you trust."],
];
export const has = (perms, bit) => ((Number(perms) || 0) & bit) === bit;
export const myPerms = sid => getState().detail[sid]?.server.perms || 0;
export function useCan(sid, bit) { return useChat(s => has(s.detail[sid]?.server.perms, bit)); }

export const CHANNEL_ICONS = {
  hash: Hash, megaphone: Megaphone, lock: Lock, 'message-circle': MessageCircle, 'gamepad-2': Gamepad2, music: Music, image: Image,
  code: Code, bug: Bug, lightbulb: Lightbulb, 'help-circle': HelpCircle, star: Star, heart: Heart, 'book-open': BookOpen, coffee: Coffee,
  sparkles: Sparkles, trophy: Trophy, video: Video, palette: Palette, terminal: Terminal, globe: Globe, bell: Bell, shield: Shield,
  rocket: Rocket, 'scroll-text': ScrollText, smile: Smile, flame: Flame, zap: Zap, gift: Gift, pin: Pin,
};
// a channel's icon: its own (a lucide name or a picture), else # / lock / megaphone
export function ChannelIcon({ c, size = 17 }) {
  if (c?.icon && /^https?:\/\//.test(c.icon)) return <img className="vc-ch-img" src={c.icon} alt="" style={{ width: size, height: size }} />;
  const I = CHANNEL_ICONS[c?.icon] || TYPE_ICONS[c?.type] || (c?.locked ? (String(c?.name).includes('announce') ? Megaphone : Lock) : Hash);
  // private channels get a small eye-off mark on their icon
  return c?.private ? <span className="vc-ch-priv" title="Private channel"><I size={size} /><EyeOff size={Math.round(size * 0.55)} /></span> : <I size={size} />;
}

// ── names: colour + role icon ──
// the roles someone has in a server, highest first
export function rolesOf(sid, username, st = getState()) {
  const m = st.members[sid]?.find(x => x.username === username);
  const all = st.detail[sid]?.roles || [];
  return all.filter(r => !r.is_default && m?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
}
// their own accent colour (if the server allows it), else their highest coloured role
export function nameColor(sid, user, st = getState()) {
  if (!user) return null;
  const allow = sid ? st.detail[sid]?.server.allow_accent !== false : true;
  // a Velora person on an instance: their accent comes from their live Velora profile, which may not have loaded yet - hold the
  // name neutral until it has (rather than showing the role colour first and flipping to the accent)
  if (allow && user.inst && user.kind === 'velora' && user.velora_id && !st.veloraFaces[String(user.velora_id)]) return null;
  if (allow && user.color && !/^#?(fff|ffffff)$/i.test(user.color)) return user.color;
  if (!sid) return null;
  return rolesOf(sid, user.username, st).find(r => r.color)?.color || null;
}
export function roleIcon(sid, username, st = getState()) {
  return sid ? rolesOf(sid, username, st).find(r => r.icon) || null : null;
}
// a hook so names redraw when roles / members / settings change
export function useNameStyle(sid, user) {
  return useChat(s => {
    const c = nameColor(sid, user, s);
    const ic = roleIcon(sid, user?.username, s);
    return `${c || ''}|${ic ? `${ic.icon}|${ic.name}` : ''}`;
  });
}
export function NameDecor({ sid, user }) {
  const key = useNameStyle(sid, user);
  const [, icon, iname] = key.split('|');
  return icon ? <img className="vc-role-ico" src={icon} alt="" title={iname} /> : null;
}
export const colorFrom = key => key.split('|')[0] || undefined;

// roles as little chips (profile cards), with add / remove for people who can manage roles
export function RoleChips({ sid, username }) {
  const all = useChat(s => s.detail[sid]?.roles);
  const member = useChat(s => s.members[sid]?.find(x => x.username === username));
  const canManage = useCan(sid, P.MANAGE_ROLES);
  const [adding, setAdding] = useState(false);
  if (!sid || !all) return null;
  const mine = all.filter(r => !r.is_default && member?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
  const others = all.filter(r => !r.is_default && !member?.roles?.includes(r.rid)).sort((a, b) => b.position - a.position);
  if (!mine.length && !canManage) return null;
  const toggle = async (r, on) => {
    try { await apiFetch(`/chat/servers/${sid}/members/${memberRef(sid, username)}/roles/${r.rid}`, { method: on ? 'PUT' : 'DELETE' }); }
    catch (e) { toast(errorText(e.message)); }
  };
  return (
    <div className="vc-roles">
      <div className="vc-sec-t">Roles</div>
      <div className="vc-role-chips">
        {mine.map(r => (
          <span key={r.rid} className="vc-role-chip" style={{ '--rc': r.color || 'var(--dim)' }}>
            {canManage ? <button type="button" title={`Remove ${r.name}`} onClick={() => toggle(r, false)}><X size={10} /></button> : <i />}
            {r.icon && <img src={r.icon} alt="" />}{r.name}
          </span>
        ))}
        {canManage && others.length > 0 && (
          <span className="vc-role-add-wrap">
            <button type="button" className="vc-role-chip add" onClick={() => setAdding(a => !a)} title="Give a role"><Plus size={12} /></button>
            {adding && <RoleAddMenu roles={others} onPick={r => { setAdding(false); toggle(r, true); }} onClose={() => setAdding(false)} />}
          </span>
        )}
      </div>
    </div>
  );
}

// the "give a role" list - lives on <body> so the profile card can't clip it; opens under the + (or above it
// when there's no room) and stays inside the window. picked: a list you tick several roles in (stays open; Server settings)
export function RoleAddMenu({ roles, onPick, onClose, picked }) {
  const spot = useRef(null);
  const menu = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const b = spot.current?.parentElement?.getBoundingClientRect();
      if (!b) return;
      const h = Math.min(menu.current?.scrollHeight || 260, 260), w = 230, gap = 6;
      const below = innerHeight - b.bottom - gap - 8, above = b.top - gap - 8;
      const up = below < h && above > below;
      setPos({ left: Math.max(8, Math.min(b.left, innerWidth - w - 8)), top: up ? undefined : b.bottom + gap, bottom: up ? innerHeight - b.top + gap : undefined, maxHeight: Math.max(120, Math.min(260, up ? above : below)), up });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [roles.length]);
  useEffect(() => {
    const down = e => { if (!menu.current?.contains(e.target) && !spot.current?.parentElement?.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    const scroll = e => { if (!menu.current?.contains(e.target) && userScrolled()) onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); document.removeEventListener('scroll', scroll, true); };
  }, [onClose]);
  return (
    <>
      <i ref={spot} hidden />
      {createPortal(
        <div ref={menu} className={`vc-menu vc-role-menu${pos?.up ? ' up' : ''}`} style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}>
          {roles.map(r => <button type="button" key={r.rid} role={picked ? 'menuitemcheckbox' : undefined} aria-checked={picked ? picked.includes(r.rid) : undefined} onClick={() => onPick(r)}><i className="vc-role-dot" style={{ background: r.color || 'var(--dim)' }} />{r.icon && <img className="vc-role-ico" src={r.icon} alt="" />}<span className="grow">{r.name}</span>{picked?.includes(r.rid) && <Check size={13} />}</button>)}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── removing / banning someone (member menu, profile card, Server settings > Members) ──
// may I? On an instance the server also wants my highest role above theirs (the owner is above everyone); it checks again.
export function modRights(sid, username, st = getState()) {
  const srv = st.detail[sid]?.server;
  const inst = isInst(sid);
  const them = st.members[sid]?.find(x => x.username === username);
  const meU = inst ? st.instances.find(i => i.origin === instOf(sid))?.user : st.me;
  const isMe = inst ? !!them && them.id === meU?.id : meU?.username === username;
  if (!srv || isMe || them?.role === 'owner') return { kick: false, ban: false, below: false };
  const top = name => Math.max(0, ...rolesOf(sid, name, st).map(r => r.position));
  const below = !inst || srv.role === 'owner' || !them || top(username) < top(meU?.username);
  return { kick: !!them && has(srv.perms, P.KICK), ban: has(srv.perms, P.BAN), below };
}
const MOD_ASK = {
  ban: n => ({ title: `Ban ${n}?`, text: "They're removed from the server and can't rejoin until they're unbanned.", confirm: 'Ban', danger: true }),
  kick: n => ({ title: `Remove ${n}?`, text: 'They can join again with an invite.', confirm: 'Remove', danger: true }),
  unban: n => ({ title: `Unban ${n}?`, text: 'They can join again.', confirm: 'Unban' }),
};
// -> true when done. who = the member / ban entry (its id is what an instance's routes want)
export async function moderate(sid, username, what, who) {
  if (!(await ask(MOD_ASK[what](username)))) return false;
  const ref = who?.id && isInst(sid) ? encodeURIComponent(who.id) : memberRef(sid, username);
  try {
    await apiFetch(what === 'unban' ? `/chat/servers/${sid}/bans/${ref}` : `/chat/servers/${sid}/members/${ref}${what === 'ban' ? '?ban=1' : ''}`, { method: 'DELETE' });
    toast(what === 'ban' ? `${username} is banned.` : what === 'kick' ? `${username} was removed.` : `${username} is unbanned.`, true);
    return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}
// the Remove / Ban items of a member's right-click menu
export function modMenuItems(sid, username) {
  if (!sid) return [];
  const r = modRights(sid, username);
  if (!r.kick && !r.ban) return [];
  const hint = r.below ? '' : 'Their role is as high as yours';
  const m = isInst(sid) ? getState().members[sid]?.find(x => x.username === username) : null;
  const out = m?.timeout_until > Date.now();
  return ['sep',
    m && !m.bot && { label: out ? `Change timeout` : `Time out ${username}`, icon: Clock, disabled: !r.below, hint, onClick: () => timeOutMember(sid, m) },
    m && out && { label: 'Remove timeout', icon: Clock, onClick: () => liftTimeout(sid, m) },
    r.kick && { label: `Remove ${username}`, icon: UserMinus, danger: true, disabled: !r.below, hint, onClick: () => moderate(sid, username, 'kick') },
    r.ban && { label: `Ban ${username}`, icon: Ban, danger: true, disabled: !r.below, hint, onClick: () => moderate(sid, username, 'ban') },
  ];
}

// timeouts (instances): no posting, reacting or voice until it ends. Kick or Ban; the server checks the role order too
const TIMEOUTS = [['60', '60 seconds'], ['300', '5 minutes'], ['600', '10 minutes'], ['3600', '1 hour'], ['86400', '1 day'], ['604800', '1 week']];
const UNIT = { m: 60, h: 3600, d: 86400 };
export async function timeOutMember(sid, m) {
  const a = await ask({
    title: `Time out ${m.username}`, compact: true,
    text: `They can still read, but can't send messages, react, join voice or play sounds until it ends.${m.timeout_until > Date.now() ? ` They're timed out until ${untilText(m.timeout_until)} now - this replaces it.` : ''}`,
    choices: [...TIMEOUTS.map(([id, label]) => ({ id, label })), { id: 'custom', label: 'Custom', custom: { units: [['m', 'minutes'], ['h', 'hours'], ['d', 'days']] } }],
    input: { placeholder: 'Reason (optional, they see it)', value: '', optional: true, max: 200 }, confirm: 'Time out',
  });
  if (!a) return false;
  const seconds = a.choice === 'custom' ? Math.round(a.amount * UNIT[a.unit]) : Number(a.choice);
  if (!(seconds >= 1 && seconds <= 28 * 86400)) { toast('A timeout can be up to 28 days.'); return false; }
  try {
    const r = await apiFetch(`/chat/servers/${sid}/timeouts`, { method: 'POST', body: JSON.stringify({ user_id: m.id, seconds, reason: a.text || '' }) });
    toast(`${m.username} is timed out until ${untilText(r.until)}.`, true); loadMembers(sid); return true;
  } catch (e) { toast(errorText(e.message)); return false; }
}
export async function liftTimeout(sid, m) {
  try { await apiFetch(`/chat/servers/${sid}/timeouts/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); toast(`${m.username}'s timeout is lifted.`, true); loadMembers(sid); }
  catch (e) { toast(errorText(e.message)); }
}

// "Roles" submenu for right-click menus
export function roleMenuItems(sid, username) {
  const st = getState();
  if (!sid || !has(st.detail[sid]?.server.perms, P.MANAGE_ROLES)) return [];
  const m = st.members[sid]?.find(x => x.username === username);
  const list = (st.detail[sid]?.roles || []).filter(r => !r.is_default).sort((a, b) => b.position - a.position);
  if (!list.length) return [];
  return [{
    label: 'Roles', sub: list.map(r => ({
      label: r.name, checked: !!m?.roles?.includes(r.rid),
      onClick: () => apiFetch(`/chat/servers/${sid}/members/${memberRef(sid, username)}/roles/${r.rid}`, { method: m?.roles?.includes(r.rid) ? 'DELETE' : 'PUT' }).catch(e => toast(errorText(e.message))),
    })),
  }];
}

// ── Server settings > Roles ──
const COLORS = ['#9d8ad1', '#e06c9f', '#f0c674', '#7fbf8f', '#6fb3e0', '#e08a5a', '#c26a6a', '#b48ead', '#8fbcbb', '#a3be8c', '#ebcb8b', '#e7e7ea'];
export function RolesEditor({ sid }) {
  const d = useChat(s => s.detail[sid]);
  const perms = d?.server.perms || 0;
  const isOwner = d?.server.role === 'owner';
  const roles = useMemo(() => [...(d?.roles || [])].sort((a, b) => (a.is_default - b.is_default) || b.position - a.position), [d?.roles]);
  const [sel, setSel] = useState(null);
  const [drag, setDragS] = useState(null);
  const [order, setOrderS] = useState(null); // while dragging
  // refs too: drop / dragend handlers must see the latest values, not the render they were made in
  const dragRef = useRef(null), orderRef = useRef(null);
  const setDrag = v => { dragRef.current = v; setDragS(v); };
  const setOrder = v => { orderRef.current = v; setOrderS(v); };
  const shown = order || roles;
  const r = roles.find(x => x.rid === sel) || roles[0];
  useEffect(() => { if (!sel && roles[0]) setSel(roles[0].rid); }, [roles, sel]);
  // my highest role: I can only change roles below it
  const st = getState();
  const staffHere = d?.server.is_default && ['owner', 'admin', 'mod'].includes(st.me?.rank);
  const meM = st.members[sid]?.find(m => m.username === st.me?.username);
  const myTop = isOwner || staffHere ? Infinity : Math.max(0, ...roles.filter(x => !x.is_default && meM?.roles?.includes(x.rid)).map(x => x.position));
  const canEdit = x => isOwner || x.is_default || x.position < myTop;

  async function create() {
    try { const res = await apiFetch(`/chat/servers/${sid}/roles`, { method: 'POST', body: JSON.stringify({ name: 'new role', color: COLORS[roles.length % COLORS.length] }) }); setSel(res.role.rid); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function save(patch) {
    try { await apiFetch(`/chat/servers/${sid}/roles/${r.rid}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function remove() {
    if (!(await ask({ title: `Delete the ${r.name} role?`, text: 'Everyone who has it loses it.', confirm: 'Delete role', danger: true }))) return;
    try { await apiFetch(`/chat/servers/${sid}/roles/${r.rid}`, { method: 'DELETE' }); setSel(null); } catch (e) { toast(errorText(e.message)); }
  }
  async function icon(file) {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try { await uploadFetch(`/chat/servers/${sid}/roles/${r.rid}/icon`, fd); } catch (e) { toast(errorText(e.message)); }
  }
  async function dropOn() {
    const cur = orderRef.current;
    if (!dragRef.current) return;
    setDrag(null);
    if (!cur) { setOrder(null); return; }
    const list = cur.filter(x => !x.is_default).map(x => x.rid);
    try { await apiFetch(`/chat/servers/${sid}/roles/order`, { method: 'PUT', body: JSON.stringify({ order: list }) }); }
    catch (e) { toast(errorText(e.message)); setOrder(null); }
  }
  // the server's roles update (with the new order) replaces the dragged copy
  useEffect(() => { if (!dragRef.current) setOrder(null); }, [roles]); // eslint-disable-line react-hooks/exhaustive-deps
  function over(target) {
    const dr = dragRef.current;
    if (!dr || dr === target) return;
    const list = [...(orderRef.current || roles)];
    const from = list.findIndex(x => x.rid === dr), to = list.findIndex(x => x.rid === target);
    if (from < 0 || to < 0 || list[to].is_default) return;
    const [m] = list.splice(from, 1); list.splice(to, 0, m);
    setOrder(list);
  }
  if (!d) return null;
  const editable = r && canEdit(r);
  return (
    <div className="vc-roles-ed">
      <div className="vc-roles-list">
        <button type="button" className="btn btn-primary vc-roles-new" onClick={create}><Plus size={14} /> Create role</button>
        <small className="vc-hint">Drag roles to set their order. Higher roles show first and can manage the ones below them.</small>
        {shown.map(x => (
          <div key={x.rid} className={`vc-roles-row${x.rid === r?.rid ? ' on' : ''}${drag === x.rid ? ' dragging' : ''}`}
            draggable={!x.is_default && canEdit(x)} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.rid); dragRef.current = x.rid; setTimeout(() => setDragS(x.rid), 0); }}
            onDragOver={e => { if (!dragRef.current) return; e.preventDefault(); over(x.rid); }} onDrop={e => { e.preventDefault(); dropOn(); }} onDragEnd={() => dropOn()}
            onClick={() => setSel(x.rid)}>
            {!x.is_default && canEdit(x) ? <GripVertical size={14} className="vc-grip" /> : <span className="vc-grip-sp" />}
            <i className="vc-role-dot" style={{ background: x.color || 'var(--dim)' }} />
            {x.icon && <img src={x.icon} alt="" className="vc-role-ico" />}
            <span>{x.name}</span>
            {!canEdit(x) && <Lock size={12} className="vc-roles-lock" title="Above your highest role" />}
          </div>
        ))}
      </div>
      {r && (
        <div className="vc-roles-pane" key={r.rid}>
          {r.is_default
            ? <p className="vc-dialog-sub">@everyone is every member of the server. What it allows, everyone can do.</p>
            : (
              <>
                <label className="vc-field"><span>Role name</span>
                  <input className="form-input" defaultValue={r.name} maxLength={40} disabled={!editable} onBlur={e => e.target.value.trim() && e.target.value !== r.name && save({ name: e.target.value })} /></label>
                <div className="vc-field"><span>Colour</span>
                  <div className="vc-colors">
                    <button type="button" className={`vc-color none${!r.color ? ' on' : ''}`} disabled={!editable} onClick={() => save({ color: null })} title="No colour" />
                    {COLORS.map(c => <button type="button" key={c} className={`vc-color${r.color === c ? ' on' : ''}`} style={{ background: c }} disabled={!editable} onClick={() => save({ color: c })} />)}
                    <label className="vc-color custom" title="Pick any colour" style={{ background: r.color || '#2a2a30' }}>
                      <input type="color" disabled={!editable} value={r.color || '#9d8ad1'} onChange={e => save({ color: e.target.value })} />
                    </label>
                  </div></div>
                <div className="vc-field"><span>Role icon</span>
                  <div className="vc-img-row">
                    <span className="vc-role-ico-prev">{r.icon ? <img src={r.icon} alt="" /> : <Shield size={16} />}</span>
                    <label className={`btn btn-surface${editable ? '' : ' disabled'}`}><Upload size={14} /> Upload<input type="file" hidden accept="image/*" disabled={!editable} onChange={e => icon(e.target.files[0])} /></label>
                    {r.icon && editable && <button type="button" className="btn btn-surface" onClick={() => apiFetch(`/chat/servers/${sid}/roles/${r.rid}/icon`, { method: 'DELETE' }).catch(e => toast(errorText(e.message)))}>Remove</button>}
                  </div><small className="vc-hint">Shows next to the names of people with this role.</small></div>
                <Toggle label="Show separately in the member list" hint="People with this role get their own group." on={r.hoist} disabled={!editable} onChange={v => save({ hoist: v })} />
                <Toggle label="Anyone can @mention this role" hint="Otherwise only people with Mention @everyone can." on={r.mentionable} disabled={!editable} onChange={v => save({ mentionable: v })} />
                {isInst(sid) && <RoleUploadField key={r.rid} sid={sid} role={r} editable={editable} save={save} />}

              </>
            )}
          <div className="vc-sec-t" style={{ marginTop: 16 }}>Permissions</div>
          {PERM_LIST.filter(([k]) => isInst(sid) || !INST_ONLY_PERMS.has(k)).map(([k, label, hint, instHint]) => (
            <Toggle key={k} label={label} hint={isInst(sid) && instHint ? instHint : hint} on={has(r.permissions, P[k])}
              disabled={!editable || (!has(perms, P[k]) && !isOwner)}
              onChange={v => save({ permissions: v ? (r.permissions | P[k]) : (r.permissions & ~P[k]) })} />
          ))}
          {!r.is_default && editable && <div className="vc-dialog-btns"><button type="button" className="btn btn-danger" onClick={remove}><Trash2 size={14} /> Delete role</button></div>}
        </div>
      )}
    </div>
  );
}
export function Toggle({ label, hint, on, onChange, disabled }) {
  return (
    <div className={`vc-toggle-row slim${disabled ? ' off' : ''}`}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={!!on} disabled={disabled} className={`cs-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}
export { Check, refreshServer };

// an Ember server's roles can raise the largest file their people may upload (blank = the server's default; the server's
// plan / ceiling still caps it). People get the biggest of their roles' numbers.
function RoleUploadField({ sid, role, editable, save }) {
  const def = useChat(s => s.detail[sid]?.server?.upload_max_mb);
  const [v, setV] = useState(role.upload_max_mb == null ? '' : String(role.upload_max_mb));
  const commit = () => {
    const t = v.trim();
    if (!t) { if (role.upload_max_mb != null) save({ upload_max_mb: null }); return; }
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 500) { toast('Pick a size between 1 and 500 MB, or leave it empty.'); setV(role.upload_max_mb == null ? '' : String(role.upload_max_mb)); return; }
    if (n !== role.upload_max_mb) save({ upload_max_mb: n });
  };
  return (
    <label className="vc-field vc-gap-top"><span>Largest file upload (MB)</span>
      <input className="form-input vc-narrow" type="number" min={1} max={500} disabled={!editable} placeholder={def ? `Server default (${def})` : 'Server default'} value={v}
        onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
      <small className="vc-hint">Per file. Empty = the server's default. People with several roles get the biggest number; the server's plan can still cap it.</small></label>
  );
}
