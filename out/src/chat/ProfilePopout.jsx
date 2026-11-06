// Your own profile pop-out (click yourself in the bottom-left panel), Fluxer-style:
// banner, big avatar + status, badges, name + copy, custom status, bio (links / emoji rendered),
// then a box with your status (submenu), switch accounts (the accounts saved on this device),
// copy user ID, and a full-width "Edit profile" button that opens Settings > Profile.
// PopoutCard is also the live preview in Settings > Profile (chat/ProfileEditor.jsx).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Pencil, ChevronRight, Check, Circle, Moon, MinusCircle, EyeOff, Smile, X, Users, IdCard, UserPlus, Crown, Globe, LogOut } from 'lucide-react';
import { isWebBonfire, getToken } from '../api.js';
import { signOutVelora, startSignIn, savedBonfireAccounts, rememberAccount, switchBonfireAccount } from './session.js';
import { useChat, lookup, wantPresence, setStatus, setCustom, toast, getState, onUserUpdate } from './store.js';
import { copy } from './Menu.jsx';
import { renderBody } from './text.jsx';
import { Avatar, STATUS_LABEL } from './Profile.jsx';
import './ProfilePopout.css';

const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const hostOf = u => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u; } };
const BODY_CTX = { linkImages: false, bio: true };

// local time from a UTC offset in minutes (what other people get), or from a time zone name (the editor's draft)
export function localTimeFrom({ tzOffsetMin, timeZone }) {
  try {
    // (Alberta stays on UTC-6 since 2026-11-01, newer than browsers' time zone data)
    if (timeZone) return new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timeZone === 'America/Edmonton' ? 'Etc/GMT+6' : timeZone });
    if (Number.isFinite(tzOffsetMin)) return new Date(Date.now() + (tzOffsetMin + new Date().getTimezoneOffset()) * 60000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { /* bad zone */ }
  return '';
}

function Bio({ text }) {
  const nodes = useMemo(() => (text ? renderBody(text, BODY_CTX).nodes : null), [text]);
  return nodes?.length ? <div className="bf-pp-bio">{nodes}</div> : null;
}
function Custom({ text }) {
  const nodes = useMemo(() => (text ? renderBody(text, BODY_CTX).nodes : null), [text]);
  return nodes?.length ? <div className="bf-pp-custom">{nodes}</div> : null;
}

// the card. p = { username, pfp, banner, color, bio, pronouns, website, badges: [{name, icon_url, description}], rank, created, localTime }
export function PopoutCard({ p, status = 'online', custom, children, preview = false }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const color = isHex(p?.color) ? p.color : '';
  const badges = (p?.badges || []).filter(b => b.icon_url).slice(0, 5);
  const name = p?.username || '';
  return (
    <div className={`bf-pp-card${preview ? ' preview' : ''}`} style={color ? { '--pe-accent': color } : undefined}>
      <div className="bf-pp-banner" style={color ? { background: `linear-gradient(135deg, ${color}66, ${color}14)` } : undefined}>
        {p?.banner && <img src={p.banner} alt="" />}
      </div>
      <div className="bf-pp-head">
        <span className="bf-pp-av"><Avatar user={{ username: name, pfp: p?.pfp }} size={84} status={status} /></span>
        {(badges.length > 0 || p?.pro) && (
          <span className="bf-pp-badges">
            {badges.length ? badges.map(b => <img key={b.name} src={b.icon_url} alt={b.name} data-tip={b.description ? `${b.name} - ${b.description}` : b.name} />)
              : <Crown size={16} data-tip="Nookara Pro" />}
          </span>
        )}
      </div>
      <div className="bf-pp-body">
        <div className="bf-pp-name-row">
          <b className="bf-pp-name" style={color ? { color } : undefined}>{name || ' '}</b>
          {name && <button type="button" className="bf-pp-copy" data-tip="Copy username" aria-label="Copy username" onClick={() => copy(name, 'Username copied')}><Copy size={13} /></button>}
        </div>
        {p?.pronouns && <div className="bf-pp-pronouns">{p.pronouns}</div>}
        <Custom text={custom} />
        <Bio text={p?.bio} />
        {p?.website && <a className="bf-pp-link" href={/^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer nofollow"><Globe size={13} /> {hostOf(p.website)}</a>}
        {p?.localTime && <div className="bf-pp-fact"><b>Local time</b><span>{p.localTime}</span></div>}
        {p?.created && <div className="bf-pp-fact"><b>Nookara member since</b><span>{new Date(p.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>}
        {children}
      </div>
    </div>
  );
}

// a submenu next to the row that opened it (fixed, so the pop-out's scrolling doesn't clip it)
function Flyout({ from, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !from) return;
    const r = from.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = r.right + 8;
    if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 8);
    const top = Math.max(8, Math.min(r.top - 6, innerHeight - h - 8));
    setPos({ left, top });
  }, [from]);
  return <div ref={ref} className="bf-pp-flyout" role="menu" style={pos || { left: -9999, top: 0 }}>{children}</div>;
}

const STATUS_ITEMS = [
  ['online', Circle, 'Online'],
  ['idle', Moon, 'Idle'],
  ['dnd', MinusCircle, 'Do not disturb', "You won't get notifications."],
  ['invisible', EyeOff, 'Invisible', "You'll look offline, but can still use Nookara."],
];

// the accounts saved on this device (same list as the login page's "Choose an account" and the site's account menu)
const web = () => isWebBonfire();
export function savedAccounts() {
  if (web()) return savedBonfireAccounts();
  try { const a = JSON.parse(localStorage.getItem('velora_saved') || '[]'); return Array.isArray(a) ? a.filter(x => x && x.username && x.token) : []; } catch { return []; }
}
function rememberCurrent(username, pfp) {
  if (web()) { rememberAccount(username, getToken(), pfp); return; }
  try {
    const token = localStorage.getItem('velora_token');
    if (!token || !username) return;
    const list = savedAccounts().filter(a => a.username.toLowerCase() !== username.toLowerCase());
    list.unshift({ username, token, pfp: pfp || null });
    localStorage.setItem('velora_saved', JSON.stringify(list.slice(0, 10)));
  } catch { /* private mode */ }
}
export async function switchTo(a, setBusy) {
  setBusy(a.username);
  if (web()) {
    try { await switchBonfireAccount(a); } catch (e) {
      setBusy('');
      toast(e.message === 'ended' ? `${a.username} was signed out - sign in again with "Add another account".` : "Couldn't reach Nookara - try again.");
    }
    return;
  }
  try {
    const r = await fetch('/auth/validate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ token: a.token }) });
    const d = await r.json().catch(() => ({}));
    if (!d?.valid) throw new Error('ended');
    localStorage.setItem('velora_token', a.token);
    ['velora_accent', 'velora_accent_at', 'velora_me_cache'].forEach(k => localStorage.removeItem(k));
    location.reload();
  } catch {
    try { localStorage.setItem('velora_saved', JSON.stringify(savedAccounts().filter(x => x.username.toLowerCase() !== a.username.toLowerCase()))); } catch { /* fine */ }
    setBusy('');
    toast(`${a.username} was signed out on this device - sign in again with "Add another account".`);
  }
}

// the switcher's Sign out (the other one is Settings > Account): the same as Settings' Log out (the lockout screen uses it too)
export async function signOut() {
  if (isWebBonfire()) { await signOutVelora(); return; } // Ember's own sign-in only; the website's session stays
  try { localStorage.removeItem('velora_token'); localStorage.removeItem('velora_me_cache'); } catch { /* fine */ }
  if (window.bonfireDesktop?.logout) await window.bonfireDesktop.logout();
  else location.assign('/login');
}

export function MePopout({ anchor, onClose, onEditProfile, onCustomStatus }) {
  const me = useChat(s => s.me);
  const presence = useChat(s => s.presence[s.me?.username]);
  const box = useRef(null);
  const [p, setP] = useState(null);
  const [sub, setSub] = useState(''); // 'status' | 'accounts'
  const statusRow = useRef(null);
  const acctRow = useRef(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState('');
  const [pos, setPos] = useState(null);
  const timers = useRef({}); // hover open / close timers
  const viaHover = useRef(false); // submenu opened by hover (closes when the pointer leaves) vs. click/keyboard (stays)
  const close = () => { setClosing(true); setTimeout(onClose, 130); };
  const username = me?.username;

  useEffect(() => {
    if (!username) return undefined;
    let gone = false;
    lookup(username).then(d => !gone && setP(d)).catch(() => {});
    wantPresence(username);
    return () => { gone = true; };
  }, [username]);
  // the person changed their profile while the card is open (Velora's user_update): re-read it in place
  useEffect(() => onUserUpdate(m => {
    if (!p || String(p.id) !== String(m.user.id)) return;
    lookup(m.user.username).then(d => { if (d && String(d.id) === String(m.user.id)) setP(d); }).catch(() => {});
  }), [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // above the panel, lined up with its left edge, kept on screen while it fills in
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !anchor) return undefined;
    const place = () => {
      const h = el.offsetHeight, w = el.offsetWidth;
      const left = Math.max(8, Math.min(anchor.left, innerWidth - w - 8));
      const top = Math.max(8, anchor.top - h - 8);
      setPos({ left, top });
    };
    place();
    const ro = window.ResizeObserver ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [anchor]);
  useEffect(() => () => { clearTimeout(timers.current.o); clearTimeout(timers.current.c); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !getState().ask) { if (sub) setSub(''); else close(); } };
    const onDown = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-me-who') && !e.target.closest('.vc-modal-back')) close(); };
    addEventListener('keydown', onKey);
    const t = setTimeout(() => addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); removeEventListener('keydown', onKey); removeEventListener('mousedown', onDown); };
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;

  const status = presence?.status || 'online';
  const others = sub === 'accounts' ? savedAccounts().filter(a => a.username.toLowerCase() !== username.toLowerCase()) : [];
  const uid = me.id || p?.id;
  const card = {
    username,
    pfp: p?.pfp_url ?? me.pfp,
    banner: p?.banner_url || null,
    color: p?.color || me.color,
    bio: p?.bio || '',
    pronouns: p?.pronouns || '',
    website: p?.website || '',
    badges: p?.badges || [],
    rank: p?.rank || me.rank,
    created: p?.created_at || null,
    localTime: localTimeFrom({ tzOffsetMin: p?.tz_offset_min }),
  };
  // hover behaviour (mouse on a desktop layout only; touch / phone layout keeps click-to-open): open after 100 ms, close 250 ms
  // after the pointer leaves the row AND its submenu (the flyout is a DOM child of the row wrapper, so crossing the gap is covered by the grace)
  const OPEN_MS = 100, CLOSE_MS = 250;
  const hoverOk = e => e.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(max-width: 700px)').matches;
  const clearT = () => { clearTimeout(timers.current.o); clearTimeout(timers.current.c); };
  const openSub = (k, hover) => { if (k === 'accounts') rememberCurrent(username, me.pfp); viaHover.current = hover; setSub(k); };
  const toggle = k => {
    clearT();
    if (sub !== k) openSub(k, false);
    else if (viaHover.current) viaHover.current = false; // clicking a hover-opened submenu pins it open
    else setSub('');
  };
  const rowRefs = { status: statusRow, accounts: acctRow };
  const hp = k => ({
    onPointerEnter: e => {
      if (!hoverOk(e)) return;
      clearT();
      if (sub !== k) timers.current.o = setTimeout(() => openSub(k, true), OPEN_MS);
    },
    onPointerLeave: e => {
      if (!hoverOk(e)) return;
      clearTimeout(timers.current.o);
      if (sub === k && viaHover.current) timers.current.c = setTimeout(() => setSub(s => (s === k ? '' : s)), CLOSE_MS);
    },
    onKeyDown: e => {
      if (e.key === 'ArrowRight' && e.target.classList?.contains('bf-pp-row')) {
        e.preventDefault(); clearT(); openSub(k, false);
        const wrap = e.currentTarget;
        setTimeout(() => wrap.querySelector('.bf-pp-flyout > button:not(:disabled), .bf-pp-flyout > a')?.focus(), 30);
      } else if (e.key === 'ArrowLeft' && sub === k) {
        e.preventDefault(); e.stopPropagation(); clearT(); setSub(''); rowRefs[k].current?.focus();
      }
    },
  });
  const back = (
    <div className="bf-pp-flyout-back">
      <button type="button" onClick={() => setSub('')}><ChevronRight size={14} className="flip" /> Back</button>
    </div>
  );

  return createPortal(
    <div ref={box} className={`bf-pp-pop${closing ? ' out' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }} role="dialog" aria-label="Your profile">
      <PopoutCard p={card} status={status} custom={presence?.custom}>
        <div className="bf-pp-rows">
          <div className="bf-pp-rowwrap" {...hp('status')}>
            <button type="button" ref={statusRow} className={`bf-pp-row${sub === 'status' ? ' on' : ''}`} aria-expanded={sub === 'status'} onClick={() => toggle('status')}>
              <i className={`vc-st-sq ${status === 'invisible' ? 'offline' : status}`} />
              <span className="bf-pp-row-l">{STATUS_LABEL[status] || 'Online'}</span>
              <ChevronRight size={15} />
            </button>
            {sub === 'status' && (
              <Flyout from={statusRow.current}>
                {back}
                {STATUS_ITEMS.map(([k, , label, hint]) => (
                  <button type="button" role="menuitemradio" aria-checked={status === k} key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setSub(''); }}>
                    <i className={`vc-st-sq ${k === 'invisible' ? 'offline' : k}`} />
                    <span className="bf-pp-fl-txt"><span>{label}</span>{hint && <small>{hint}</small>}</span>
                    {status === k && <Check size={14} />}
                  </button>
                ))}
                <div className="bf-pp-fl-sep" />
                <button type="button" onClick={() => { setSub(''); onCustomStatus(); }}><Smile size={15} /><span className="bf-pp-fl-txt"><span>{presence?.custom ? 'Change custom status' : 'Set a custom status'}</span></span></button>
                {presence?.custom && <button type="button" onClick={() => { setSub(''); setCustom('').catch(() => toast("Couldn't clear your status.")); }}><X size={15} /><span className="bf-pp-fl-txt"><span>Clear custom status</span></span></button>}
              </Flyout>
            )}
          </div>
          <div className="bf-pp-rowwrap" {...hp('accounts')}>
            <button type="button" ref={acctRow} className={`bf-pp-row${sub === 'accounts' ? ' on' : ''}`} aria-expanded={sub === 'accounts'} onClick={() => toggle('accounts')}>
              <Users size={16} />
              <span className="bf-pp-row-l">Switch accounts</span>
              <ChevronRight size={15} />
            </button>
            {sub === 'accounts' && (
              <Flyout from={acctRow.current}>
                {back}
                <div className="bf-pp-fl-head">Saved on this device</div>
                <div className="bf-pp-fl-acct current"><Avatar user={me} size={26} /><span className="bf-pp-fl-txt"><span>{username}</span><small>Signed in</small></span><Check size={14} /></div>
                {others.map(a => (
                  <button type="button" key={a.username} disabled={!!busy} onClick={() => switchTo(a, setBusy)}>
                    <Avatar user={{ username: a.username, pfp: a.pfp }} size={26} />
                    <span className="bf-pp-fl-txt"><span>{busy === a.username ? `Switching to ${a.username}...` : a.username}</span></span>
                  </button>
                ))}
                {!others.length && <div className="bf-pp-fl-none">No other accounts on this device yet.</div>}
                <div className="bf-pp-fl-sep" />
                <a href={isWebBonfire() ? '#' : `/login?next=${encodeURIComponent('/chat' + location.hash)}`} onClick={e => { rememberCurrent(username, me.pfp); if (isWebBonfire()) { e.preventDefault(); startSignIn(); } }}><UserPlus size={15} /><span className="bf-pp-fl-txt"><span>Add another account</span></span></a>
                <button type="button" onClick={() => signOut()}><LogOut size={15} /><span className="bf-pp-fl-txt"><span>Sign out</span></span></button>
              </Flyout>
            )}
          </div>
          <button type="button" className="bf-pp-row" disabled={!uid} onClick={() => { copy(uid, 'User ID copied'); }}>
            <IdCard size={16} />
            <span className="bf-pp-row-l">Copy user ID</span>
          </button>
        </div>
        <button type="button" className="btn btn-primary bf-pp-edit" onClick={() => { onEditProfile(); onClose(); }}><Pencil size={15} /> Edit profile</button>
      </PopoutCard>
    </div>,
    document.body,
  );
}
