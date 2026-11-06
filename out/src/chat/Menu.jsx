// Right-click menus for everything in Ember (servers, channels, messages, people, DMs, links).
// openMenu(e, items): item = { label, icon: LucideIcon, onClick, danger, checked, radio, hint, disabled, sub: [items] } | 'sep'
//   | { type: 'head', label }  - a small section title
//   | { type: 'slider', label, value, min, max, step, format(v), onChange(v), hint, meter() }  - stays open while you drag;
//     meter() -> 0..1 on the slider's own scale (or null) draws a live level bar above it (e.g. mic sensitivity)
// e may be a plain { clientX, clientY, touch } (long-press menus); touch menus ignore the press's own trailing events.
// Developer mode (Chat settings) adds "Copy ... ID" items at the bottom (dev: true).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Check, Hash, Copy, Link2, BellOff, Bell, CheckCheck, UserPlus, Settings, LogOut, Pencil, Trash2, Reply, User, MessageCircle, ExternalLink, Image as ImageIcon, Code2, Forward, Pin, Download, SmilePlus, BookmarkPlus, RefreshCw, LogIn, ShieldCheck, BellRing, Flag, Ban, Info } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, getState, setMenu, toggleBlock, toast, setNotify, notifyOf, go, markServerRead, markChannelRead, linkFor } from './store.js';
import { bare, instOpt, isInst } from './ids.js';
import { reportTo, reportDmMessage } from './report.js';
import { canReportDm } from './dm-report.js';
import { reactionId } from './msg-actions.js';
import { myReactions } from './msg-actions.js';
import { setInstancePrefs } from './instances.js';
import { roleMenuItems, modMenuItems, P, has } from './roles.jsx';
import { viewPicture, copyImage, downloadImage } from './MediaViewer.jsx';
import { saveToMedia } from './store.js';
import { QuickReactions } from './Reactions.jsx';
import { userScrolled } from './userscroll.js';
import { appsItems } from './commands.js';

// Track the full press, rather than timing out while the finger is still down.
let menuTouch = null;
document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.isPrimary) menuTouch = { id: e.pointerId, down: true, ended: 0 }; }, true);
const endMenuTouch = e => { if (menuTouch?.id === e.pointerId) { menuTouch.down = false; menuTouch.ended = Date.now(); } };
document.addEventListener('pointerup', endMenuTouch, true);
document.addEventListener('pointercancel', endMenuTouch, true);
export function openMenu(e, items, options = {}) {
  e.preventDefault();
  e.stopPropagation();
  const dev = getState().settings.developer_mode;
  let list = items.filter(Boolean).filter(i => i === 'sep' || !i.dev || dev);
  // tidy separators (none first / last / doubled)
  list = list.filter((i, n) => i !== 'sep' || (n > 0 && list[n - 1] !== 'sep'));
  while (list[list.length - 1] === 'sep') list.pop();
  if (!list.length) return;
  setMenu({ x: e.clientX, y: e.clientY, items: list, reaction: options.reaction, k: Date.now(), touch: !!(e.touch || e.nativeEvent?.touch || menuTouch?.down), press: menuTouch });
}
export const copy = (text, what = 'Copied') => {
  navigator.clipboard?.writeText(String(text)).then(() => toast(`${what} to your clipboard.`, true), () => toast("Couldn't copy that."));
};

function Panel({ items, x, y, onDone, nested, reaction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [open, setOpen] = useState(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x, top = y;
    if (left + w > innerWidth - 6) left = nested ? x - w - (nested.w || 0) : innerWidth - w - 6;
    if (top + h > innerHeight - 6) top = Math.max(6, innerHeight - h - 6);
    setPos({ left: Math.max(6, left), top, ready: true });
  }, [x, y]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={`vc-ctx${nested ? ' nested' : ''}`} style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }} onContextMenu={e => e.preventDefault()}>
      {reaction && <QuickReactions id={reaction.id} inst={reaction.inst} selected={reaction.selected} onDone={onDone} />}

      {items.map((it, i) => {
        if (it === 'sep') return <div key={`s${i}`} className="vc-menu-sep" />;
        if (it.type === 'head') return <div key={`h${i}`} className="vc-ctx-head">{it.label}</div>;
        if (it.type === 'slider') return <SliderRow key={it.label + i} it={it} onHover={() => setOpen(-1)} />;
        const Icon = it.icon;
        return (
          <div key={it.label + i} className="vc-ctx-row" onMouseEnter={() => setOpen(it.sub ? i : -1)}>
            <button type="button" disabled={it.disabled} className={`${it.danger ? 'danger' : ''}${it.dev ? ' dev' : ''}`}
              onClick={() => { if (it.sub) { setOpen(i); return; } onDone(); it.onClick?.(); }}>
              <span className="vc-ctx-label">{it.label}{it.hint && <small>{it.hint}</small>}</span>
              {it.checked !== undefined ? <span className={`vc-ctx-check${it.radio ? ' radio' : ''}${it.checked ? ' on' : ''}`}>{it.checked && (it.radio ? <i /> : <Check size={12} />)}</span>
                : it.sub ? <ChevronRight size={14} /> : Icon ? <Icon size={15} /> : null}
            </button>
            {it.sub && open === i && <SubPanel items={it.sub} onDone={onDone} />}
          </div>
        );
      })}
    </div>
  );
}
// a slider inside a menu: keeps its own value while you drag (the menu's item list is a snapshot)
function SliderRow({ it, onHover }) {
  const [val, setVal] = useState(Number(it.value) || 0);
  const fill = useRef(null);
  const min = it.min ?? 0, max = it.max ?? 100;
  const pct = x => `${((x - min) / ((max - min) || 1)) * 100}%`;
  const valRef = useRef(val);
  valRef.current = val;
  useEffect(() => {
    if (!it.meter) return undefined;
    const t = setInterval(() => {
      const el = fill.current, m = it.meter();
      if (!el) return;
      el.style.width = m == null ? '0%' : `${Math.round(m * 100)}%`;
      el.classList.toggle('hot', m != null && min + m * (max - min) >= valRef.current && valRef.current > min);
    }, 50);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="vc-ctx-slider" onMouseEnter={onHover}>
      <span className="vc-ctx-slider-top"><span>{it.label}</span><b>{it.format ? it.format(val) : val}</b></span>
      {it.meter && <span className="vc-ctx-meter"><i ref={fill} /><b style={{ left: pct(val) }} /></span>}
      <input type="range" min={min} max={max} step={it.step ?? 1} value={val} aria-label={it.label}
        onChange={e => { const v = Number(e.target.value); setVal(v); it.onChange?.(v); }} />
      {it.hint && <small>{it.hint}</small>}
    </div>
  );
}
function SubPanel({ items, onDone }) {
  const anchor = useRef(null);
  const [at, setAt] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.current?.parentElement?.getBoundingClientRect();
    if (r) setAt({ x: r.right + 2, y: r.top - 6, w: r.width + 4 });
  }, []);
  return <span ref={anchor} className="vc-ctx-anchor">{at && createPortal(<Panel items={items} x={at.x} y={at.y} onDone={onDone} nested={{ w: at.w }} />, document.body)}</span>;
}

export function MenuHost() {
  const m = useChat(s => s.menu);
  useEffect(() => {
    if (!m) return undefined;
    // a long-press menu: the same press's trailing mousedown / native contextmenu must not close it again
    const own = () => window.bonfireMobile?.holdingMenu?.() || (m.touch && (m.press?.down || Date.now() - Math.max(m.k, m.press?.ended || 0) < 600));
    const close = e => {
      // Android may retarget its trailing native contextmenu onto the backdrop
      // inserted during this same hold. Only an outside press bypasses own().
      const backdropPress = e.type === 'mousedown' && e.target.closest?.('.vc-sheet-back');
      if (!e.target.closest?.('.vc-ctx') && (backdropPress || !own())) setMenu(null);
    };
    const key = e => { if (e.key === 'Escape') setMenu(null); };
    const off = e => { if (own()) return; if (e?.type === 'scroll' && (e.target?.closest?.('.vc-ctx') || !userScrolled())) return; setMenu(null); }; // scrolling inside a tall menu keeps it
    const attach = setTimeout(() => { addEventListener('mousedown', close); addEventListener('contextmenu', close, true); }, 0);
    addEventListener('keydown', key);
    addEventListener('resize', off);
    addEventListener('blur', off);
    document.addEventListener('scroll', off, true);
    return () => {
      clearTimeout(attach);
      removeEventListener('mousedown', close); removeEventListener('contextmenu', close, true); removeEventListener('keydown', key);
      removeEventListener('resize', off); removeEventListener('blur', off); document.removeEventListener('scroll', off, true);
    };
  }, [m]);
  if (!m) return null;
  return createPortal(<Panel key={m.k} items={m.items} x={m.x} y={m.y} reaction={m.reaction} onDone={() => setMenu(null)} />, document.body);
}

// ── the menus ──
const MUTE_FOR = [['For 15 minutes', 15], ['For 1 hour', 60], ['For 8 hours', 480], ['For 24 hours', 1440], ['Until I turn it back on', -1]];
function notifyItems(target, isChannel) {
  const n = notifyOf(target);
  const muted = n.muted_until && n.muted_until > Date.now();
  const until = muted && n.muted_until < 4102444800000 ? `until ${new Date(n.muted_until).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}` : '';
  const levels = [...(isChannel ? [['default', 'Use the server\'s setting']] : []), ['all', 'All messages'], ['mentions', 'Only @mentions'], ['none', 'Nothing']];
  return [
    muted ? { label: `Unmute ${isChannel ? 'channel' : 'server'}`, hint: until, icon: Bell, onClick: () => setNotify(target, { mute_minutes: 0 }) }
      : { label: `Mute ${isChannel ? 'channel' : 'server'}`, icon: BellOff, sub: MUTE_FOR.map(([label, min]) => ({ label, onClick: () => setNotify(target, { mute_minutes: min }) })) },
    { label: 'Notifications', sub: [
      ...levels.map(([v, label]) => ({ label, checked: (n.level || (isChannel ? 'default' : 'mentions')) === v, onClick: () => setNotify(target, { level: v }) })),
      'sep',
      { label: 'Push notifications', hint: 'When Ember is closed', checked: n.push !== false, onClick: () => setNotify(target, { push: n.push === false }) },
    ] },
  ];
}
export function serverMenu(e, s, { onInvite, onSettings, onLeave, admin: isAdmin } = {}) {
  const admin = isAdmin || has(s.perms, P.MANAGE_SERVER) || has(s.perms, P.MANAGE_ROLES);
  openMenu(e, [
    { label: 'Mark as read', icon: CheckCheck, onClick: () => markServerRead(s.sid) },
    'sep',
    ...notifyItems(s.sid, false),
    'sep',
    { label: 'Invite people', icon: UserPlus, onClick: onInvite },
    admin && { label: 'Server settings', icon: Settings, onClick: onSettings },
    s.role !== 'owner' && { label: 'Leave server', icon: LogOut, danger: true, onClick: onLeave },
    'sep',
    { label: 'Copy server ID', icon: Code2, dev: true, onClick: () => copy(bare(s.sid), 'Server ID copied') },
  ]);
}
// right-click on a server of an instance (its icon on the rail). srv = the community once I'm in it, whatever state the connection is in.
export function instanceMenu(e, inst, srv, { onInvite, onSettings, onLeave, onLogin, onRemove, onReconnect }) {
  const name = srv?.name || inst.community?.name || inst.name;
  const here = srv && inst.status === 'open';
  const admin = here && (has(srv.perms, P.MANAGE_SERVER) || has(srv.perms, P.MANAGE_ROLES) || inst.isAdmin);
  openMenu(e, [
    { type: 'head', label: `${name} \u00b7 ${inst.host}` },
    here && { label: 'Mark as read', icon: CheckCheck, onClick: () => markServerRead(srv.sid) },
    srv && 'sep',
    ...(srv ? notifyItems(srv.sid, false) : []),
    // Velora's push consent for this server (it pushes to me through Velora only while it's in my list, unmuted, push on)
    getState().signedIn && inst.prefs && { label: 'Push through Nookara', icon: BellRing, sub: [
      { label: 'Push notifications from this server', hint: 'When Ember is closed', checked: inst.prefs.push, onClick: () => setInstancePrefs(inst.origin, { push: !inst.prefs.push }) },
      { label: 'Mute this server', hint: 'No pushes from it at all', checked: inst.prefs.muted, onClick: () => setInstancePrefs(inst.origin, { muted: !inst.prefs.muted }) },
    ] },
    (srv || (getState().signedIn && inst.prefs)) && 'sep',
    here && { label: 'Invite people', icon: UserPlus, onClick: onInvite },
    admin && { label: 'Server settings', icon: Settings, onClick: onSettings },
    { label: 'Copy URL', icon: Link2, onClick: () => copy(inst.origin, 'Server URL copied') },
    inst.status !== 'connecting' && { label: 'Reconnect', icon: RefreshCw, onClick: onReconnect },
    inst.status === 'login' && inst.needsVelora && { label: 'Sign in with Nookara', icon: ShieldCheck, onClick: onLogin },
    inst.status === 'login' && !inst.needsVelora && inst.mode === 'local' && { label: 'Log in', icon: LogIn, onClick: onLogin },
    'sep',
    here && srv.role !== 'owner' && { label: 'Leave server', icon: LogOut, danger: true, onClick: onLeave },
    { label: 'Remove from list', icon: Trash2, danger: true, onClick: onRemove },
    srv && 'sep',
    srv && { label: 'Copy server ID', icon: Code2, dev: true, onClick: () => copy(bare(srv.sid), 'Server ID copied') },
  ]);
}
export function channelMenu(e, c, sid, { admin, onEdit, onDelete } = {}) {
  openMenu(e, [
    { label: 'Mark as read', icon: CheckCheck, onClick: () => markChannelRead(c.cid, sid) },
    'sep',
    ...notifyItems(c.cid, true),
    'sep',
    { label: 'Copy link', icon: Link2, onClick: () => copy(linkFor({ kind: 'channel', sid, cid: c.cid }), 'Link copied') },
    admin && { label: 'Edit channel', icon: Pencil, onClick: onEdit },
    admin && { label: 'Delete channel', icon: Trash2, danger: true, onClick: onDelete },
    'sep',
    { label: 'Copy channel ID', icon: Code2, dev: true, onClick: () => copy(bare(c.cid), 'Channel ID copied') },
  ]);
}
export function messageMenu(e, m, view, { onReply, onEdit, onDelete, canDelete, canReply, canEdit, canCopyLink, onForward, canPin, onPin, onReact, onInfo, me } = {}) {
  const sel = String(getSelection?.() || '').trim();
  const link = e.target.closest?.('a[href]');
  const img = e.target.closest?.('img');
  // a picture / video / sound kept on Velora (or a Klipy GIF): Save to Saved Media
  const mediaEl = e.target.closest?.('[data-media-url]');
  const mediaUrl = mediaEl?.dataset.mediaUrl || null;
  const mediaName = mediaEl?.dataset.mediaName || '';
  const pic = img && !/vc-(c|t)emoji|vc-av|vc-srv-ico/.test(`${img.className} ${img.parentElement?.className || ''}`) ? img : null; // a real picture, not an emoji or avatar
  const authorId = m.author?.id || getState().people[m.author?.username]?.id; // (DM and group messages only carry the name)
  openMenu(e, [
    sel && { label: 'Copy', icon: Copy, onClick: () => copy(sel, 'Text copied') },
    link && { label: 'Open link', icon: ExternalLink, onClick: () => window.open(link.href, '_blank', 'noopener') },
    link && { label: 'Copy link', icon: Link2, onClick: () => copy(link.href, 'Link copied') },
    pic && { label: 'Open picture', icon: ImageIcon, onClick: () => viewPicture(pic.src) },
    pic && { label: 'Copy image', icon: Copy, onClick: () => copyImage(pic.src) },
    pic && { label: 'Download image', icon: Download, onClick: () => downloadImage(pic.src) },
    mediaUrl && { label: 'Save to Saved Media', icon: BookmarkPlus, onClick: () => saveToMedia(mediaUrl, mediaName) },
    (sel || link || img || mediaUrl) && 'sep',
    canReply && { label: 'Reply', icon: Reply, onClick: onReply },
    view.kind === 'channel' && !m.system && !m.ephemeral && /^\d+$/.test(String(m.id)) && appsItems({ sid: view.sid, cid: view.cid, type: 3, target: m.id }),
    onReact && { label: 'Add reaction', icon: SmilePlus, onClick: onReact },
    onForward && { label: 'Forward', icon: Forward, onClick: onForward },
    canPin && { label: m.pinned ? 'Unpin message' : 'Pin message', icon: Pin, onClick: onPin },
    canEdit && { label: 'Edit message', icon: Pencil, onClick: onEdit },
    m.body && { label: 'Copy text', icon: Copy, onClick: () => copy(m.body, 'Text copied') },
    canCopyLink && { label: 'Copy message link', icon: Link2, onClick: () => copy(linkFor(view), 'Link copied') },
    canDelete && { label: 'Delete message', icon: Trash2, danger: true, onClick: onDelete },
    view.kind === 'channel' && isInst(view.sid) && !canEdit && !m.system && /^\d+$/.test(String(m.id)) && { label: 'Report message', icon: Flag, danger: true, onClick: () => reportTo(view.sid, { message_id: m.id }, 'this message', { target: m.author, message: m }) },
    canReportDm(view, m, getState().me?.username) && { label: 'Report message', icon: Flag, danger: true, onClick: () => reportDmMessage(view, m) },
    'sep',
    onInfo && { label: 'Message info', icon: Info, onClick: onInfo }, // Manage messages: the real sender (aliases included)
    { label: 'Copy message ID', icon: Code2, dev: true, onClick: () => copy(m.imId || m.gid || m.id, 'Message ID copied') },
    authorId && { label: 'Copy author ID', icon: Code2, dev: true, onClick: () => copy(authorId, 'Account ID copied') },
  ], { reaction: onReact ? { id: reactionId(m), inst: instOpt(m.channel), selected: myReactions(m, me) } : null });
}
export function userMenu(e, username, { onProfile, sid, extra = [] } = {}) {
  const st = getState();
  const isMe = st.me?.username === username;
  const member = sid ? st.members[sid]?.find(x => x.username === username) : null;
  const friend = st.friends.some(f => f.friend_username === username);
  const uid = member?.id || st.people[username]?.id;
  const blocked = !!st.blocks?.some(b => b.username === username);
  const local = !!member?.kind && member.kind !== 'velora'; // an account that only exists on a self-hosted instance (a person or a bot): no Velora profile, DM or friend request
  openMenu(e, [
    onProfile && { label: 'Profile', icon: User, onClick: onProfile },
    !isMe && !local && { label: 'Message', icon: MessageCircle, onClick: () => go({ kind: 'dm', username }) },
    !isMe && !friend && !local && { label: 'Add friend', icon: UserPlus, onClick: () => apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }).then(d => toast(d.status === 'accepted' ? `You and ${username} are friends now!` : `Friend request sent to ${username}.`, true)).catch(er => toast(er.message === 'already_friends' ? "You're already friends." : "Couldn't send that request.")) },
    { label: 'Copy username', icon: Copy, onClick: () => copy(username, 'Username copied') },
    sid && !isMe && getState().view?.kind === 'channel' && member && appsItems({ sid, cid: getState().view.cid, type: 2, target: member.id }),
    ...roleMenuItems(sid, username),
    ...modMenuItems(sid, username),
    sid && isInst(sid) && !isMe && member && !member.bot && { label: 'Report', icon: Flag, danger: true, onClick: () => reportTo(sid, { user_id: member.id }, `@${username}`, { target: member }) },
    !isMe && !local && username !== 'System' && { label: blocked ? 'Unblock' : 'Block', icon: Ban, danger: !blocked, onClick: () => toggleBlock(username, blocked) },
    ...extra,
    'sep',
    { label: 'Copy account ID', icon: Code2, dev: true, disabled: !uid, hint: uid ? '' : 'Open their profile first', onClick: () => copy(uid, 'Account ID copied') },
  ]);
}
export { Hash };
