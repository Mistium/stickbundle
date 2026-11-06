// Ember's settings (the gear by your name), laid out like Fluxer's: a sidebar with "Search settings...",
// your profile card (= Edit profile), then grouped pages with icons; the page on the right with its title
// and a close X. The pages are the same Ember settings as My Account > Chat (ChatSettingsTab) plus
// the profile editor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Search, UserRound, CircleUser, Shield, Bell, MessageSquare, Monitor, Sparkles, SlidersHorizontal, Bot, Info, Bug, LifeBuoy, ExternalLink } from 'lucide-react';
import ChatSettingsTab, { GROUPS, matches, useDesktopMac, desktopAppTitle } from '../components/tabs/ChatSettingsTab.jsx';
import ProfileEditor from './ProfileEditor.jsx';
import { useChat, ask, getState } from './store.js';
import { isWebBonfire } from '../api.js';
import { signOutVelora, startSignIn } from './session.js';
import { Avatar } from './Profile.jsx';
import './SettingsDialog.css';

const rowText = title => (GROUPS.find(([t]) => t === title)?.[1] || []).flatMap(([, label, hint, choices]) => [label, hint, ...(choices || []).map(c => c[1])]);
// what each page answers to in the search box (its title, its rows, and a few words for the pages that aren't simple rows)
const PAGES = [
  ['Your account', [
    ['profile', 'Profile', UserRound, ['Edit profile', 'Profile customization', 'Username', 'Change username', 'Avatar', 'Profile picture', 'Banner', 'Accent colour', 'Accent color', 'About me', 'Bio', 'Website', 'Country', 'Local time', 'Time zone', 'Profile visibility', 'Friends only', 'Badges']],
    ['Account', 'Account', CircleUser, ['Log out', 'Sign out', 'Account management', 'Email', 'Password', 'Security', 'Signing key', 'Message signing', 'Signed messages', 'Sign messages as you', 'Ed25519']],
    ['Privacy', 'Privacy', Shield, rowText('Privacy')],
  ]],
  ['App settings', [
    ['Notifications', 'Notifications', Bell, [...rowText('Notifications'), 'Push notifications', 'Windows notifications', 'macOS notifications', 'Browser notifications']],
    ['Messages', 'Messages', MessageSquare, [...rowText('Messages'), 'Design', 'Look', 'Rounded', 'Square', 'Corners', 'Theme']],
    ['Windows app', 'Windows app', Monitor, ['Desktop app', 'Start with Windows', 'Start minimized', 'Minimize to tray', 'Discord game status', 'RPC', 'Detect games I play'], 'desktop'],
    ['Extras', 'Extras', Sparkles, [...rowText('Extras'), 'Radio', 'Stream address', 'Volume']],
    ['Advanced', 'Advanced', SlidersHorizontal, rowText('Advanced')],
    ['About', 'About', Info, ['Ember', 'Ikelene', 'Creator', 'Author', 'Version', 'Build', 'Copyright', 'License']],
  ]],
  ['Developer', [
    ['Bots', 'Bots', Bot, ['Bot accounts', 'Bot token', 'Bot API', 'Applications', 'Create a bot']],
  ]],
];

// the desktop app page on a Mac: its name and words (no Discord RPC there)
const MAC_APP_WORDS = ['Desktop app', 'Mac', 'Open at login', 'Start hidden', 'Menu bar', 'Detect games I play'];
// help links at the bottom of the sidebar: they open in the browser (the desktop app hands them to the system's browser)
const HELP = [
  ['Report a bug', Bug, 'https://nookara.cc/bug-report', ['Bug report', 'Bug', 'Problem', 'Broken', 'Feedback', 'Help']],
  ['Get support', LifeBuoy, 'https://nookara.cc/support', ['Support', 'Help', 'Contact', 'Question']],
];
function openOutside(url) {
  const d = window.bonfireDesktop;
  if (d?.openExternal) { Promise.resolve(d.openExternal(url)).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

// phones: the pages come as a full-width list first, then slide in one at a time (see SettingsDialog.css .bf-sd.m)
const NARROW = '(max-width: 700px)';
export function useNarrow() {
  const [n, setN] = useState(() => !!window.matchMedia?.(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW);
    if (!m) return undefined;
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}

export default function SettingsDialog({ page: startPage, onClose }) {
  const narrow = useNarrow();
  const [mview, setMview] = useState(startPage ? 'page' : 'list'); // phones: which screen is showing
  const depth = useRef(0); // history entries this dialog added (phones: the dialog, then an opened page)
  const closingRef = useRef(false);
  const closeRef = useRef(null);
  const me = useChat(s => s.me);
  const signedIn = useChat(s => s.signedIn);
  const desktop = !!window.bonfireDesktop?.isDesktop || typeof window.bonfireDesktop?.getAppSettings === 'function';
  const mac = useDesktopMac();
  const [page, setPage] = useState(startPage || (signedIn ? 'profile' : 'Account'));
  const [q, setQ] = useState('');
  const [closing, setClosing] = useState(false);
  const dirty = useRef({ on: false, nudge: null });
  const content = useRef(null);
  const search = useRef(null);

  // pages that exist here, and the ones that match the search
  // signed out of Velora (web Ember): only the pages that don't need an account
  const groups = useMemo(() => PAGES.map(([g, items]) => [g, items.filter(it => (it[4] !== 'desktop' || desktop) && (signedIn || ['Account', 'About'].includes(it[0])))
    .map(it => (it[4] === 'desktop' && mac ? [it[0], desktopAppTitle(true), it[2], MAC_APP_WORDS, it[4]] : it))]).filter(([, items]) => items.length), [desktop, signedIn, mac]);
  const shown = useMemo(() => groups.map(([g, items]) => [g, items.filter(([, label, , words]) => matches(q, label, ...words))]).filter(([, items]) => items.length), [groups, q]);
  const help = useMemo(() => HELP.filter(([label, , , words]) => matches(q, label, ...words)), [q]);
  const all = shown.flatMap(([, items]) => items);
  // typing a search jumps to the first matching page if the open one doesn't match
  useEffect(() => { if (!narrow && q.trim() && all.length && !all.some(it => it[0] === page)) setPage(all[0][0]); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [page]);

  // unsaved profile changes: ask before leaving the page / closing
  async function leaveOk() {
    if (!dirty.current.on) return true;
    dirty.current.nudge?.();
    return ask({ title: 'Discard your changes?', text: "Your profile changes aren't saved yet.", confirm: 'Discard', danger: true });
  }
  async function go(id) {
    if (narrow) {
      if (id !== page && !(await leaveOk())) return;
      dirty.current.on = false; setPage(id);
      if (mview !== 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; setMview('page'); }
      return;
    }
    if (id === page) return;
    if (await leaveOk()) { dirty.current.on = false; setPage(id); }
  }
  async function close(fromPop) {
    if (closingRef.current) return;
    if (!(await leaveOk())) {
      if (fromPop === true) { history.pushState({ bfSd: 'open' }, '', location.href); depth.current = 1; if (mview === 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; } }
      return;
    }
    closingRef.current = true;
    setClosing(true);
    if (fromPop !== true && depth.current > 0) { const d = depth.current; depth.current = 0; history.go(-d); }
    setTimeout(onClose, 160);
  }
  closeRef.current = close;
  // phones: the dialog and each opened page are history entries, so the browser / Android back button steps back
  useEffect(() => {
    if (!narrow) return undefined;
    history.pushState({ bfSd: 'open' }, '', location.href); depth.current = 1;
    if (mview === 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; }
    const onPop = () => {
      const s = history.state?.bfSd;
      if (s === 'page') { setMview('page'); depth.current = 2; }
      else if (s === 'open') {
        depth.current = 1;
        leaveOk().then(ok => { if (ok) { dirty.current.on = false; setMview('list'); } else { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; } });
      } else { depth.current = 0; closeRef.current(true); }
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const backToList = () => { if (depth.current >= 2) history.back(); else setMview('list'); };
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || getState().ask || document.querySelector('.crop-back, .vc-ctx')) return;
      if (q && document.activeElement === search.current) { setQ(''); return; }
      close();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }); // re-bound each render so it sees the current page / search

  const logout = async () => {
    if (isWebBonfire()) { await signOutVelora(); return; } // Ember's own sign-in only; the website's session stays
    try { localStorage.removeItem('velora_token'); localStorage.removeItem('velora_me_cache'); } catch { /* fine */ }
    if (window.bonfireDesktop?.logout) await window.bonfireDesktop.logout();
    else location.assign('/login');
  };
  const current = groups.flatMap(([, items]) => items).find(it => it[0] === page);
  const Icon = current?.[2];

  return createPortal(
    <div className={`vc-modal-back bf-sd-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className={`bf-sd${narrow ? ` m m-${mview}` : ''}`} role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="bf-sd-side" aria-label="Settings pages">
          <header className="bf-sd-mhead"><h2>Settings</h2><button type="button" className="bf-sd-x" aria-label="Close settings" onClick={() => close()}><X size={20} /></button></header>
          <label className="bf-sd-search">
            <Search size={15} />
            <input ref={search} type="search" placeholder="Search settings..." value={q} onChange={e => setQ(e.target.value)} aria-label="Search settings" />
            {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(''); search.current?.focus(); }}><X size={14} /></button>}
          </label>
          {me && (
            <button type="button" className={`bf-sd-me${page === 'profile' ? ' on' : ''}`} onClick={() => go('profile')} data-tip="Edit profile" data-tip-side="right">
              <Avatar user={me} size={34} status={getState().presence[me.username]?.status || 'online'} />
              <span><b>{me.username}</b><small>Edit profile</small></span>
              <ChevronRight className="bf-sd-chev" size={18} />
            </button>
          )}
          {shown.map(([g, items]) => (
            <div className="bf-sd-group" key={g}>
              <div className="bf-sd-group-t">{g}</div>
              {items.map(([id, label, ItemIcon]) => (
                <button type="button" key={id} className={page === id ? 'on' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
                  <ItemIcon size={17} /> {label}<ChevronRight className="bf-sd-chev" size={18} />
                </button>
              ))}
            </div>
          ))}
          {help.length > 0 && (
            <div className="bf-sd-group" key="help">
              <div className="bf-sd-group-t">Help</div>
              {help.map(([label, ItemIcon, url]) => (
                <button type="button" key={url} onClick={() => openOutside(url)}>
                  <ItemIcon size={17} /> {label}<ExternalLink className="bf-sd-ext" size={14} />
                </button>
              ))}
            </div>
          )}
          {!shown.length && !help.length && <div className="bf-sd-none">No settings match "{q.trim()}".</div>}
        </nav>
        <div className="bf-sd-main">
          <header className="bf-sd-head">
            <button type="button" className="bf-sd-backbtn" aria-label="Back to settings" onClick={backToList}><ChevronLeft size={22} /></button>
            <h2>{Icon && <Icon size={19} />} {current?.[1] || 'Settings'}</h2>
            <button type="button" className="bf-sd-x" aria-label="Close settings" data-tip="Close (Esc)" onClick={() => close()}><X size={18} /></button>
          </header>
          <div className="bf-sd-content" ref={content} key={page}>
            {page === 'profile'
              ? <ProfileEditor onDirty={(on, nudge) => { dirty.current = { on, nudge }; }} />
              : <ChatSettingsTab embedded bare page={page} query={matches(q, current?.[1] || '') ? '' : q} web={isWebBonfire()} onLogout={signedIn ? logout : undefined} onLogin={signedIn ? undefined : () => startSignIn()} />}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
