import { siteHref } from './hosts.js';
import { viaProxy } from './mediaProxy.js';
// People: square avatars with a status square, the mini profile (the same card as the
// profile editor's preview) and the large profile it expands into.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Maximize2, X, UserPlus, Check, Clock, ExternalLink, Globe, Gamepad2, Music, Tv, Trophy, Radio, MoreHorizontal, Pencil, ShieldCheck, Crown, UserMinus, Ban, Link as LinkIcon } from 'lucide-react';
import { apiFetch, getToken } from '../api.js';
import { BotTag, AddBotButton, TrustedIn } from './Bots.jsx';
import { useChat, lookup, go, wantPresence, toast, errorText, getState, setCustom, ask, loadFriends, toggleBlock, memberRef, faceOf, botPresenceOf, loadMembers, onUserUpdate } from './store.js';
import { isInst } from './ids.js';
import { ServerIcon } from './ServerIcon.jsx';
// your own profile's "Edit profile": Ember's settings, Profile page (Chat.jsx listens for vc-dialog)
export const openProfileEditor = () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'chat-settings', page: 'profile' } }));
import { elapsed, BioText } from './text.jsx';
import { userMenu } from './Menu.jsx';
import { RoleChips, modRights, moderate } from './roles.jsx';
import { PlatformIcon, PLATFORM_NAMES } from './platforms.jsx';
import StatusReply from './StatusReply.jsx';
import { ManageFacts, LastOnlineFact } from './ClientVia.jsx';
import { MaskIcon } from './Alias.jsx';

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', invisible: 'Invisible', offline: 'Offline' };
const CONN_HOVER = { discord: '#5865F2', fluxer: '#7c78ee', github: '#ffffff', spotify: '#1DB954' };
// one linked account: brand icon (tinted like the text) + account name, platform name as the tooltip, links to the account when there is a URL
function Connection({ c }) {
  const label = PLATFORM_NAMES[c.provider] || c.provider;
  const ico = PLATFORM_NAMES[c.provider] ? <PlatformIcon p={c.provider} size={17} mono /> : <LinkIcon size={17} />;
  const body = <>{ico}<span>{c.name}</span></>;
  const style = { '--cc': CONN_HOVER[c.provider] || 'var(--accent)' };
  return /^https?:[/][/]/i.test(c.url || '')
    ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="vc-chip vc-conn" style={style} data-tip={label}>{body}</a>
    : <span className="vc-chip vc-conn" style={style} data-tip={label}>{body}</span>;
}

const VERB = { playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in', streaming: 'Streaming', custom: '' };
const ACT_ICON = { playing: Gamepad2, listening: Music, watching: Tv, competing: Trophy, streaming: Radio, custom: Gamepad2 };

// the shared status mark: a square dot, or (online / idle / dnd on a phone) a small phone in the same colour
const PHONE_OK = new Set(['online', 'idle', 'dnd']);
export function PhoneMark({ sq }) {
  return sq ? (
    <svg viewBox="0 0 12 18" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="12" height="18" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 20 30" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="17" height="27" fill="currentColor" stroke="var(--st-cut)" strokeWidth="3" strokeLinejoin="miter" />
      <rect x="6.5" y="6.5" width="7" height="10" fill="var(--st-cut)" />
      <rect x="8.5" y="20" width="3" height="3" fill="var(--st-cut)" />
    </svg>
  );
}
// console (3DS Velora Arcade): a gamepad in the status colour; wins over the phone mark and the plain dot
export function ConsoleMark() {
  // the Community Developer badge's blocky gamepad (public/assets/badges/community_developer.svg): solid, no outline
  return (
    <svg viewBox="6 26 88 64" aria-hidden="true">
      <g fill="currentColor"><rect x="10" y="32" width="80" height="40" /><rect x="10" y="64" width="22" height="20" /><rect x="68" y="64" width="22" height="20" /></g>
      <g fill="var(--st-cut)"><rect x="22" y="46" width="20" height="8" /><rect x="28" y="40" width="8" height="20" /><rect x="62" y="40" width="9" height="9" /><rect x="74" y="50" width="9" height="9" /></g>
    </svg>
  );
}
// Nintendo 3DS clamshell (activity.platform === '3ds'): two stacked screens + hinge, solid currentColor like ConsoleMark
export function Icon3DS({ className = 'vc-3ds' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M6 1.5h12a2 2 0 0 1 2 2v7.3H4V3.5a2 2 0 0 1 2-2ZM6.5 3.5v5.3h11V3.5Zm-3.5 9h18v7.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 19.7ZM7 14.6v5.8h10v-5.8Z" />
      <rect x="3" y="10.9" width="18" height="1.5" fill="currentColor" />
    </svg>
  );
}
const onPlatform = a => (a?.platform === '3ds' ? '3DS' : null);
export function StatusSq({ status, username }) {
  const consoleOn = useChat(s => !!s.presence[username]?.console) && PHONE_OK.has(status);
  const mobile = useChat(s => !!s.presence[username]?.mobile) && PHONE_OK.has(status) && !consoleOn;
  const ghost = useChat(s => !!s.presence[username]?.invisible); // seen by Manage users: really online, but set to invisible
  return <i title={ghost ? 'Invisible' : undefined} className={`vc-st-sq ${status === 'invisible' ? 'offline' : status}${consoleOn ? ' console' : mobile ? ' mobile' : ''}${ghost ? ' ghost' : ''}`}>{consoleOn ? <ConsoleMark /> : mobile && <PhoneMark sq />}</i>;
}
// `ghost`: pass it when the presence is not stored under user.username (an instance's Velora members); otherwise it is looked up
export function Avatar({ user, size = 32, status, className = '', ghost: ghostProp }) {
  const [bad, setBad] = useState(false);
  const consoleOn = useChat(s => !!s.presence[user?.username]?.console) && PHONE_OK.has(status);
  const mobile = useChat(s => !!s.presence[user?.username]?.mobile) && PHONE_OK.has(status) && !consoleOn;
  const looked = useChat(s => !!s.presence[user?.username]?.invisible);
  const ghost = ghostProp ?? looked;
  const pfp = user?.pfp;
  return (
    <span className={`vc-av ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {pfp && !bad ? <img src={viaProxy(pfp)} alt="" loading="lazy" onError={() => setBad(true)} /> : <span className="vc-av-l">{(user?.username || '?').charAt(0).toUpperCase()}</span>}
      {status && <i className={`vc-st ${status === 'invisible' ? 'offline' : status}${consoleOn ? ' console' : mobile ? ' mobile' : ''}${ghost ? ' ghost' : ''}`} title={ghost ? 'Invisible (really online)' : STATUS_LABEL[status] + (consoleOn ? ' (console)' : mobile ? ' (mobile)' : '')}>{consoleOn ? <ConsoleMark /> : mobile && <PhoneMark />}</i>}
    </span>
  );
}
// next to "Blocked User" in a server: you blocked this person (only you see it)
export function BlockedMark({ size = 13 }) {
  return <span className="vc-blocked-mark" title="You blocked this person" aria-label="Blocked by you"><Ban size={size} /></span>;
}
// "Playing Hyperfocus", or their custom status
export function subtitle(p) {
  const a = p?.activities?.[0];
  if (a && onPlatform(a)) return <><Icon3DS /> Playing on <strong className="vc-sub-activity">{onPlatform(a)}</strong></>;
  if (a?.app === 'Spotify' && a.type === 'listening' && a.details) return <>Listening to <strong className="vc-sub-activity">{a.details}</strong></>; // the artist; the song title stays on the activity card
  if (a) return a.type === 'custom' ? a.name : <>{VERB[a.type] || 'Playing'} <strong className="vc-sub-activity">{a.name}</strong></>;
  return p?.custom || '';
}
export function RoleChip({ role }) {
  if (role === 'owner') return <span className="vc-role owner ico" title="Server owner" aria-label="Server owner"><Crown size={14} /></span>;
  if (role === 'admin') return <span className="vc-role admin" title="Server admin"><ShieldCheck size={11} /> Admin</span>;
  return null;
}

// an activity, as a little box (the "rich presence")
export function ActivityCard({ a, compact = false }) {
  // Keep the render clock explicit: Spotify corrects this every poll, while
  // the card visibly advances its sampled playhead once per second in between.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const Icon = a.platform === '3ds' ? Icon3DS : (ACT_ICON[a.type] || Gamepad2);
  const plat = onPlatform(a);
  const duration = Number(a.duration) || 0;
  const sampled = Number(a.progress);
  const sampledAt = Number(a.progress_at);
  const progressBase = Number.isFinite(sampled) && sampledAt > 0 ? sampled + Math.max(0, now - sampledAt) : now - Number(a.since || now);
  const progress = duration ? Math.min(duration, Math.max(0, progressBase)) : 0;
  const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  return (
    <div className={`vc-act${compact ? ' compact' : ''}`}>
      <div className="vc-act-head">{plat ? <><Icon3DS /> Playing on {plat}</> : a.type === 'custom' ? 'Activity' : (VERB[a.type] || 'Playing')}{a.app ? <span> via {a.app}</span> : null}</div>
      <div className="vc-act-row">
        <span className="vc-act-art">{a.image || a.icon ? <img src={viaProxy(a.image || a.icon)} alt="" /> : <Icon size={compact ? 20 : 26} className={plat ? 'vc-3ds' : undefined} />}</span>
        <span className="vc-act-txt">
          <b>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">{a.name}</a> : a.name}</b>
          {a.details && <span>{a.details}</span>}
          {a.state && <span>{a.state}</span>}
          {a.since && a.app !== 'Spotify' && <span className="vc-act-time"><Clock size={11} /> {elapsed(a.since)} elapsed</span>}
          {duration > 0 && <span className="vc-song-progress"><span className="vc-song-times"><span>{time(progress)}</span><span>{time(duration)}</span></span><span className="vc-song-track"><i style={{ width: `${(progress / duration) * 100}%` }} /></span></span>}
        </span>
      </div>
    </div>
  );
}

// who = the author / member object when the person was clicked on an instance server: a Velora person (v:) is looked up on
// Velora by their Velora id (the name Velora knows them by now, checked against the id); a local account or bot there has no
// Velora profile at all (a Velora account with the same name is somebody else): a plain card from the instance's own data.
export const plainOn = who => !!who?.inst && who.kind !== 'velora';
// A bot on an instance server: the instance gives its description / trusted_in / gallery_id; a gallery-linked one is completed from
// Velora's public gallery detail (avatar, description, owner, approval state). Cached for a minute.
const galleryCache = new Map();
function galleryDetail(id) {
  const hit = galleryCache.get(id);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const t = getToken();
  const p = fetch(`/bonfire/bots/gallery/${encodeURIComponent(id)}`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined).then(r => (r.ok ? r.json() : null)).catch(() => null);
  galleryCache.set(id, { at: Date.now(), p });
  return p;
}
async function instanceBotInfo(who, username) {
  try {
    if (!who?.inst || !who?.bot) return null;
    let b = { id: String(who?.id || ''), username, public: false, verified: !!who?.verified, avatar_url: who?.pfp || null };
    const d = await apiFetch(`/api/v1/bots/by-name/${encodeURIComponent(username)}`, { inst: who.inst });
    const local = d?.bot ?? d;
    if (!local || typeof local !== 'object' || Array.isArray(local) || d?.error || local.error) return null;
    b = { ...b, ...local, id: b.id, username, avatar_url: local.avatar_url || b.avatar_url, public: false };
    const gid = typeof local.gallery_id === 'string' || typeof local.gallery_id === 'number' ? local.gallery_id : null;
    if (gid) {
      b.id = String(gid);
      const detail = await galleryDetail(gid);
      const g = detail?.bot ?? detail;
      if (g && typeof g === 'object' && !Array.isArray(g) && !detail?.error && !g.error) b = { ...b, description: g.description || b.description, avatar_url: g.avatar_url || b.avatar_url, owner: g.owner || b.owner, trusted_in: g.trusted_in ?? b.trusted_in, verified: !!(g.verified ?? b.verified), public: !!g.verified, ...(g.state ? { state: g.state } : {}), ...(g.can_submit != null ? { mine: true } : {}) };
    }
    // Only render scalar fields; owners may be a username or a user object.
    const owner = typeof b.owner === 'string' ? b.owner : b.owner?.username;
    const bot = { id: b.id, username, gallery_id: gid, public: !!b.public, verified: !!b.verified, mine: !!b.mine,
      avatar_url: typeof b.avatar_url === 'string' ? b.avatar_url : null,
      description: typeof b.description === 'string' ? b.description : '',
      owner: typeof owner === 'string' ? owner : '', trusted_in: Number(b.trusted_in) || 0,
      state: typeof b.state === 'string' ? b.state : undefined };
    // extra.bot is the same { bot, can_add_to } envelope as a Velora profile.
    return { bot: { bot, can_add_to: null } };
  } catch { return null; } // sign-in needed / unreachable / odd data: keep the plain card
}
function useProfile(username, who) {
  const [p, setP] = useState(null);
  const [extra, setExtra] = useState(null);
  const vid = who?.inst && who.kind === 'velora' ? String(who.velora_id || '') : '';
  const vname = useChat(s => (vid ? s.veloraNames[vid] : null)) || username;
  useEffect(() => {
    let gone = false;
    setP(null); setExtra(null);
    if (plainOn(who)) {
      setP({ username, plain: true });
      if (who?.bot) instanceBotInfo(who, username).then(x => !gone && setExtra(x)).catch(() => {});
      return () => { gone = true; };
    }
    const fallback = { username, pfp_url: vid ? faceOf(who)?.pfp || null : null, missing: true };
    lookup(vname).then(d => { if (!gone) setP(d && (!vid || String(d?.id) === vid) ? d : fallback); }).catch(() => !gone && setP(fallback));
    if (getToken()) apiFetch(`/chat/users/${encodeURIComponent(vname)}`).then(d => !gone && setExtra(d)).catch(() => {});
    wantPresence(vname);
    return () => { gone = true; };
  }, [username, vname, plainOn(who)]); // eslint-disable-line react-hooks/exhaustive-deps
  // Velora says this person changed their profile: re-read it in place (no blanking)
  useEffect(() => onUserUpdate(m => {
    if (!p || p.plain || p.missing || String(p.id) !== String(m.user.id)) return;
    lookup(m.user.username).then(d => { if (d && String(d.id) === String(m.user.id)) setP(d); }).catch(() => {});
  }), [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return [p, extra, vname];
}
// servers we both are in: Velora's own (the server says) plus the ones on Ember instances (only this browser knows who is in those:
// a Velora account is matched by its Velora id, an instance's own account by its id on that instance)
function useMutualServers(extra, who, vid) {
  const servers = useChat(s => s.servers);
  const members = useChat(s => s.members);
  const instServers = servers.filter(s => s.inst && isInst(s.sid));
  useEffect(() => { instServers.forEach(s => { if (!members[s.sid]) loadMembers(s.sid); }); }, [instServers.map(s => s.sid).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const veloraId = String(who?.kind === 'velora' ? who.velora_id || '' : vid || '');
  const here = [];
  for (const s of instServers) {
    const hit = (members[s.sid] || []).find(m => (m.kind === 'velora' && veloraId && String(m.velora_id) === veloraId) || (who?.inst === s.inst && who.kind !== 'velora' && who.id != null && String(m.id) === String(who.id)));
    if (hit) here.push({ sid: s.sid, name: s.name, icon: s.icon || s.icon_url || null, role: hit.role });
  }
  const seen = new Set();
  return [...(extra?.mutual_servers || []), ...here].filter(s => !seen.has(s.sid) && seen.add(s.sid));
}
const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

// Badge Arcade badges placed on someone's mini profile (their own board, same as the editor preview)
function useArcadeBoard(cardRef, username, kind = 'mini') {
  useEffect(() => {
    if (!username) return undefined; // (an instance's own account: no Velora profile, no board)
    let board = null, gone = false;
    const ready = window.VeloraProfileBadges ? Promise.resolve() : new Promise(res => {
      let sc = document.getElementById('vpb-js');
      if (!sc) { sc = document.createElement('script'); sc.id = 'vpb-js'; sc.src = '/assets/js/profile-badges.js?v=6'; document.head.appendChild(sc); }
      sc.addEventListener('load', res);
    });
    Promise.all([ready, fetch(`/arcade/profile/${encodeURIComponent(username)}`, { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()).catch(() => null)])
      .then(([, a]) => {
        if (gone || !a || a.error || !cardRef.current || !window.VeloraProfileBadges) return;
        board = window.VeloraProfileBadges.mount(cardRef.current, a, { isMe: false, kind });
      });
    return () => { gone = true; board?.destroy(); };
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps
}

// the card itself (mini profile)
// their local time (only the UTC offset is shared, never the timezone itself)
function localTimeOf(p) {
  if (!p || !Number.isFinite(p.tz_offset_min)) return '';
  const d = new Date(Date.now() + (p.tz_offset_min + new Date().getTimezoneOffset()) * 60000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function ProfileCard({ username, sid, who, onExpand, onClose, cardRef: outerRef }) {
  const [p, extra, vname] = useProfile(username, who);
  const plain = plainOn(who); // an instance's own account / bot: name, roles, joined - nothing from Velora
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const localTime = localTimeOf(p);
  const me = useChat(s => s.me);
  const instMe = useChat(s => (who?.inst ? s.instances?.find(i => i?.origin === who.inst)?.user?.id : null));
  const presence = useChat(s => (plain ? null : s.presence[vname])) || (plain ? null : extra?.presence);
  const member = useChat(s => (sid ? s.members[sid]?.find(m => m.username === username) : null));
  const ref = useRef(null);
  const setRef = el => { ref.current = el; if (outerRef) outerRef.current = el; };
  const [menu, setMenu] = useState(false);
  useArcadeBoard(ref, plain ? null : vname, 'mini');
  const isMe = who?.inst ? !!instMe && instMe === who?.id : me?.username === username;
  const color = !plain && isHex(p?.color) ? p.color : '';
  const botSt = plain && who?.kind === 'bot' ? botPresenceOf(member) || botPresenceOf(who) : null; // an instance bot: its presence comes with the member row
  const status = botSt || presence?.status || 'offline';
  const sub = subtitle(presence);
  const role = member?.role;
  useChat(s => (sid ? s.detail[sid] : null)); useChat(s => (sid ? s.members[sid] : null)); // (redraw when roles / members change)
  const rights = sid ? modRights(sid, username) : null;
  const canKick = !!rights?.kick && rights.below, canBan = !!rights?.ban && rights.below;
  const act = async what => { setMenu(false); if (await moderate(sid, username, what, member)) onClose?.(); };
  const canMod = canKick || canBan;

  return (
    <div className={`pe-card vc-card${plain ? ' plain' : ''}`} ref={setRef} style={color ? { '--pe-accent': color } : undefined} onContextMenu={e => { if (!e.target.closest('input, textarea')) userMenu(e, username, { sid }); }}>
      <div className="pe-banner" style={color ? { background: `linear-gradient(135deg, ${color}55, ${color}11)` } : undefined}>
        {!plain && p?.banner_url && <img src={p.banner_url} alt="" />}
        <div className="vc-card-tools">
          {onExpand && !plain && <button type="button" title="Open the full profile" onClick={() => onExpand(ref.current?.getBoundingClientRect())}><Maximize2 size={14} /></button>}
          {canMod && <button type="button" title="More" onClick={() => setMenu(m => !m)}><MoreHorizontal size={15} /></button>}
          {menu && (
            <div className="vc-menu vc-card-menu">
              {canKick && <button type="button" className="danger" onClick={() => act('kick')}>Remove from server</button>}
              {canBan && <button type="button" className="danger" onClick={() => act('ban')}>Ban from server</button>}
            </div>
          )}
        </div>
      </div>
      <div className="pe-body">
        <div className="pe-avatar-row">
          <div className="pe-avatar vc-card-av" data-vpb-protect="">
            <Avatar user={{ username, pfp: plain ? (who?.bot ? extra?.bot?.bot?.avatar_url || who.pfp || null : null) : p?.pfp_url }} size={80} status={plain ? botSt || undefined : status} />
          </div>
          {!plain && presence?.custom && !isMe && (
            <span className="vc-bubble-wrap">
              <div className="vc-bubble" title={presence.custom}>{presence.custom}</div>
              {!extra?.bot && <StatusReply username={vname} custom={presence.custom} onOpenDm={onClose} />}
            </span>
          )}
          {!plain && presence?.custom && isMe && (
            <span className="vc-bubble-wrap">
              <button type="button" className="vc-bubble mine" title="Edit your custom status" onClick={() => window.dispatchEvent(new CustomEvent('vc-custom-status'))}>{presence.custom}<Pencil size={11} /></button>
              <button type="button" className="vc-bubble-x" title="Clear your custom status" onClick={() => setCustom('').catch(() => toast(errorText('')))}><X size={12} /></button>
            </span>
          )}
          {!plain && !presence?.custom && isMe && !who?.inst && <button type="button" className="vc-bubble empty" onClick={() => window.dispatchEvent(new CustomEvent('vc-custom-status'))}>What are you up to?</button>}
        </div>
        <div className="pe-name" data-vpb-protect="" style={color ? { color } : undefined}>{plain ? username : p?.username || vname}{(extra?.bot || (plain && who?.bot)) && <BotTag verified={!!(extra?.bot?.bot?.verified || (plain && who?.verified))} />}</div>
        {!plain && p?.pronouns && !p.private && <div className="vc-pronouns">{p.pronouns}</div>}
        {!plain && vname !== username && <div className="vc-card-sub">{username} on this server</div>}
        {who?.alias_name && <div className="vc-card-sub vc-card-alias"><MaskIcon size={13} /> Posting as alias: <b>{who.alias_name}</b></div>}
        {extra?.bot?.bot?.owner && <div className="vc-card-sub">Bot made by @{extra.bot.bot.owner}</div>}
        {extra?.bot?.bot && extra.bot.bot.trusted_in != null && <TrustedIn n={extra.bot.bot.trusted_in} verified={!!extra.bot.bot.verified} />}
        {sub && <div className="vc-card-sub">{sub}</div>}
        <div className="pe-sub">
          <RoleChip role={role} />
          {!plain && p?.badges?.length > 0 && (
            <span className="pe-badges vc-card-badges" data-vpb-protect="">
              {p.badges.slice(0, 8).map(b => (b.icon_url ? <img key={b.name} src={b.icon_url} alt={b.name} title={b.name} /> : null))}
            </span>
          )}
        </div>
        {p?.private ? (
          <div className="vc-private"><b>This profile is private</b><span>Only their friends can see it.</span></div>
        ) : (
          <>
            {presence?.activities?.map((a, i) => <ActivityCard key={`${a.name}${i}`} a={a} compact />)}
            {!plain && p?.bio ? <BioText text={p.bio} /> : null}
            {plain && who?.bot && extra?.bot?.bot?.description ? <BioText text={extra.bot.bot.description} /> : null}
            {sid && <RoleChips sid={sid} username={username} />}
            {localTime && <div className="pe-fact"><b>Local time</b><span>{localTime}</span></div>}
            {!plain && <ManageFacts presence={presence} />}
            {plain && <LastOnlineFact member={member} />}
            {member?.joined_at && <div className="pe-fact"><b>Joined this server</b><span>{new Date(member.joined_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>}
            {!plain && p?.created_at && <div className="pe-fact"><b>Nookara member since</b><span>{new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>}
          </>
        )}
        {!p && <div className="vc-skel" />}
        {(!plain || (who?.bot && extra?.bot)) && getToken() && (
          <div className="vc-card-btns">
            {isMe
              ? <button type="button" className="pe-msg vc-btn-msg" onClick={() => { onClose?.(); openProfileEditor(); }}><Pencil size={14} /> Edit profile</button>
              : extra?.bot ? <AddBotButton username={vname} info={extra.bot} className="btn btn-primary vc-addbot-btn" />
              : <button type="button" className="pe-msg vc-btn-msg" onClick={() => { onClose?.(); go({ kind: 'dm', username: vname }); }}><MessageCircle size={14} /> Message</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// the mini profile as a pop-up next to whatever was clicked
export function MiniProfile({ username, anchor, side = 'right', sid, who, onClose, onExpand }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 140); };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !anchor) return undefined;
    // placed next to what was clicked, kept on screen - again whenever the card grows (it fills in as it loads)
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight, gap = 10;
      let x = side === 'left' ? anchor.left - w - gap : anchor.right + gap;
      if (x + w > innerWidth - 8) x = anchor.left - w - gap;
      if (x < 8) x = Math.min(innerWidth - w - 8, Math.max(8, anchor.left));
      const y = Math.min(anchor.top, innerHeight - h - 10);
      setPos({ x, y: Math.max(10, y) });
    };
    place();
    const ro = window.ResizeObserver ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [anchor, side]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close(); };
    const onDown = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vpb-drawer')) close(); };
    addEventListener('keydown', onKey);
    setTimeout(() => addEventListener('mousedown', onDown), 0);
    return () => { removeEventListener('keydown', onKey); removeEventListener('mousedown', onDown); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div ref={box} className={`vc-pop${closing ? ' out' : ''}`} style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: 0 }}>
      <ProfileCard username={username} sid={sid} who={who} onClose={close} onExpand={rect => { onExpand?.(username, rect); onClose(); }} />
    </div>,
    document.body,
  );
}

// the large profile: grows out of the mini card it was opened from
export function ProfileModal({ username: shown, from, sid, who, onClose }) {
  const [p, extra, username] = useProfile(shown, who); // (username: their Velora name - on an instance it can differ from the one it shows)
  const me = useChat(s => s.me);
  const presence = useChat(s => s.presence[username]) || extra?.presence;
  const member = useChat(s => (sid ? s.members[sid]?.find(m => m.username === shown) : null));
  const [tab, setTab] = useState('about');
  const [friend, setFriend] = useState(null);
  const [closing, setClosing] = useState(false);
  const card = useRef(null);
  const isMe = me?.username === username;
  const color = isHex(p?.color) ? p.color : '';
  const botSt = who?.inst && who?.kind === 'bot' ? botPresenceOf(member) || botPresenceOf(who) : null;
  const status = botSt || presence?.status || 'offline';
  const sub = subtitle(presence);
  const close = () => { setClosing(true); setTimeout(onClose, 200); };

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !from || !el.animate || document.documentElement.classList.contains('vl-reduce')) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.6 },
      { transform: 'none', opacity: 1 },
    ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    if (!isMe && getToken()) apiFetch(`/friends/status/${encodeURIComponent(username)}`).then(d => setFriend(d.status)).catch(() => {});
    return () => removeEventListener('keydown', onKey);
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFriend() {
    try { const d = await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }); setFriend(d.status === 'accepted' ? 'friends' : 'pending_outgoing'); }
    catch (e) { toast(e.message === 'already_friends' ? "You're already friends." : errorText(e.message)); }
  }
  // already friends: the Friends button turns red on hover ("Remove friend"), asks, then unfriends
  const [removing, setRemoving] = useState(false);
  const blocks = useChat(s => s.blocks);
  const blocked = blocks ? blocks.some(b => b.username === username) : !!extra?.blocked_by_me;
  async function removeFriend() {
    if (!(await ask({ title: `Remove ${username} as a friend?`, text: "They won't be told. You can send them a friend request again later.", confirm: 'Remove friend', danger: true }))) return;
    setRemoving(true);
    try {
      await apiFetch(`/friends/${encodeURIComponent(username)}`, { method: 'DELETE' });
      setFriend('none');
      loadFriends();
      apiFetch(`/friends/status/${encodeURIComponent(username)}`).then(d => setFriend(d.status)).catch(() => {});
    } catch (e) { toast(errorText(e.message)); }
    setRemoving(false);
  }
  let localTime = '';
  if (p && Number.isFinite(p.tz_offset_min)) {
    const d = new Date(Date.now() + (p.tz_offset_min + new Date().getTimezoneOffset()) * 60000);
    localTime = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const mutual = useMutualServers(extra, who, p?.id != null && !p.missing ? String(p.id) : '');
  const tabs = [['about', 'About'], ['activity', `Activity${presence?.activities?.length ? ` (${presence.activities.length})` : ''}`], ['servers', `Mutual servers (${mutual.length})`]];

  return createPortal(
    <div className={`vc-modal-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="vc-big" ref={card} style={color ? { '--pe-accent': color } : undefined}>
        <button type="button" className="vc-big-x" onClick={close} title="Close"><X size={18} /></button>
        <div className="vc-big-banner" style={color ? { background: `linear-gradient(135deg, ${color}66, ${color}11)` } : undefined}>
          {p?.banner_url && <img src={p.banner_url} alt="" />}
        </div>
        <div className="vc-big-head">
          <Avatar user={{ username, pfp: p?.pfp_url }} size={112} status={status} className="vc-big-av" />
          <div className="vc-big-btns">
            {extra?.bot && <AddBotButton username={username} info={extra.bot} />}
            {!isMe && !extra?.bot && <button type="button" className="btn btn-primary" onClick={() => { close(); go({ kind: 'dm', username }); }}><MessageCircle size={15} /> Message</button>}
            {!isMe && !extra?.bot && friend === 'none' && <button type="button" className="btn btn-surface" onClick={addFriend}><UserPlus size={15} /> Add friend</button>}
            {!isMe && friend === 'pending_outgoing' && <span className="vc-chip">Request sent</span>}
            {!isMe && friend === 'pending_incoming' && <a className="btn btn-surface" href={siteHref("/me#people")} target="_blank" rel="noopener noreferrer">Answer their request</a>}
            {!isMe && friend === 'friends' && <button type="button" className="btn btn-surface vc-friend-btn" onClick={removeFriend} disabled={removing} aria-label={`Remove ${username} as a friend`}><span className="is"><Check size={14} /> Friends</span><span className="rm"><UserMinus size={14} /> Remove friend</span></button>}
            {!isMe && !extra?.bot && getToken() && <button type="button" className="btn btn-surface" onClick={() => toggleBlock(username, blocked)}><Ban size={14} /> {blocked ? 'Unblock' : 'Block'}</button>}
            {isMe && <button type="button" className="btn btn-surface" onClick={() => { close(); openProfileEditor(); }}><Pencil size={15} /> Edit profile</button>}
            <a className="btn btn-surface" href={siteHref(`/u/${encodeURIComponent(username)}`)} target="_blank" rel="noopener"><ExternalLink size={15} /> Profile page</a>
          </div>
        </div>
        <div className="vc-big-id">
          <h2 style={color ? { color } : undefined}>{p?.username || username}{extra?.bot && <BotTag verified={!!extra.bot.bot?.verified} />}</h2>
          {p?.pronouns && !p.private && <div className="vc-pronouns">{p.pronouns}</div>}
          {extra?.bot?.bot?.owner && <div className="vc-card-sub">Bot made by @{extra.bot.bot.owner}</div>}
          {extra?.bot?.bot && <TrustedIn n={extra.bot.bot.trusted_in} verified={!!extra.bot.bot.verified} />}
          {sub && <div className="vc-card-sub">{sub}</div>}
          <div className="pe-sub">
            <RoleChip role={member?.role} />
            <span className="vc-big-status"><StatusSq status={status} username={username} /> {STATUS_LABEL[status]}</span>
          </div>
          {p?.badges?.length > 0 && (
            <div className="vc-big-badges">
              {p.badges.map(b => (b.icon_url ? <span key={b.name} className="vc-big-badge" title={b.description || b.name}><img src={b.icon_url} alt="" /> {b.name}</span> : null))}
            </div>
          )}
        </div>
        {p?.private ? (
          <div className="vc-big-body"><div className="vc-private"><b>This profile is private</b><span>Only their friends can see it.</span></div></div>
        ) : (
          <>
            <div className="vc-tabs">
              {tabs.map(([k, label]) => <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            <div className="vc-big-body" key={tab}>
              {tab === 'about' && (
                <div className="vc-about">
                  {presence?.custom && (
                    <span className="vc-bubble-wrap big">
                      <div className="vc-bubble big">{presence.custom}</div>
                      {!isMe && !extra?.bot && <StatusReply username={username} custom={presence.custom} onOpenDm={close} />}
                    </span>
                  )}
                  <div className="vc-sec-t">About me</div>
                  {p?.bio ? <BioText text={p.bio} /> : <p className="pe-bio empty">No bio yet.</p>}
                  {sid && <RoleChips sid={sid} username={shown} />}
                  <div className="vc-facts">
                    {p?.country_code && <div className="pe-fact"><b>Country</b><span className="pe-country"><img className="pe-flag" src={`/assets/flags/${p.country_code.toLowerCase()}.png`} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> {regionName(p.country_code)}</span></div>}
                    {localTime && <div className="pe-fact"><b>Local time</b><span>{localTime}</span></div>}
                    <ManageFacts presence={presence} />
                    {p?.created_at && <div className="pe-fact"><b>Nookara member since</b><span>{new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>}
                    {p?.website && <div className="pe-fact"><b>Website</b><span><a className="pe-link" href={/^https?:/i.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer nofollow"><Globe size={13} /> {p.website.replace(/^https?:\/\/(www\.)?/i, '')}</a></span></div>}
                  </div>
                  {p?.connections?.length > 0 && (
                    <>
                      <div className="vc-sec-t">Connections</div>
                      <div className="vc-conns">{p.connections.map(c => <Connection key={c.provider} c={c} />)}</div>
                    </>
                  )}
                </div>
              )}
              {tab === 'activity' && (presence?.activities?.length
                ? presence.activities.map((a, i) => <ActivityCard key={`${a.name}${i}`} a={a} />)
                : <div className="vc-empty-note">{status === 'offline' ? `${username} is offline.` : `${username} isn't doing anything right now.`}</div>)}
              {tab === 'servers' && (mutual.length
                ? <div className="vc-mutual">{mutual.map(s => (
                    <button type="button" key={s.sid} className="vc-mutual-row" onClick={() => { close(); go({ kind: 'server', sid: s.sid }); }}>
                      <span className="vc-srv-ico sm"><ServerIcon src={s.icon} name={s.name} /></span>
                      <b>{s.name}</b><RoleChip role={s.role} />
                    </button>))}</div>
                : <div className="vc-empty-note">No servers in common.</div>)}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
function regionName(cc) {
  try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(cc.toUpperCase()); } catch { return cc; }
}

// for anything that can open a profile: click -> mini profile; "expand" -> large
export function useProfiles() {
  const [mini, setMini] = useState(null);
  const [big, setBig] = useState(null);
  const view = useChat(s => s.view);
  const sid = view.kind === 'channel' ? view.sid : null;
  // who: the author / member object when it's someone on an instance server (decides Velora profile vs plain card)
  const openMini = (username, el, side = 'right', who) => setMini({ username, anchor: el?.getBoundingClientRect?.() || el, side, sid, who, k: Date.now() + Math.random() });
  const ui = (
    <>
      {mini && <MiniProfile key={mini.k} {...mini} onClose={() => setMini(m => (m?.k === mini.k ? null : m))} onExpand={(u, rect) => setBig({ username: u, from: rect, sid: mini.sid, who: mini.who })} />}
      {big && <ProfileModal {...big} onClose={() => setBig(null)} />}
    </>
  );
  return { openMini, openBig: (username, from) => setBig({ username, from, sid }), ui };
}
export const meName = () => getState().me?.username;
