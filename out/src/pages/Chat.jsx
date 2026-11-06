import { clientUrl } from '../chat/hosts.js';
// Ember (/chat): servers + channels, DMs and group chats in one place, with presence.
import { ForwardDialog, PinsButton } from '../chat/MsgTools.jsx';
import { TooltipHost } from '../chat/Tooltip.jsx';
import { MediaViewerHost, viewPicture, copyImage, downloadImage } from '../chat/MediaViewer.jsx';
import { VoicePanel, VoiceView, DmCallBar, DmCallButton, IncomingCalls } from '../chat/VoiceParts.jsx';
import { ChannelIcon } from '../chat/roles.jsx';
import { RoleShop, openLinkChannel, lockedTextFor } from '../chat/ChannelTypes.jsx';
import { Starboard } from '../chat/Starboard.jsx';
import { GameChannel, GameChatStrip, GameOfflineNote } from '../chat/GameServer.jsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { initSheets } from '../chat/sheets.js';
import { Hash, Lock, Users, Menu, ChevronLeft, Search, X, AtSign, UsersRound, LogOut, Megaphone, PanelRight, ExternalLink, ShieldCheck, ShieldAlert, Bell, Ban, Flag } from 'lucide-react';
import { reportDmUser } from '../chat/report.js';
import { api, getToken, cachedMe, apiFetch, isWebBonfire } from '../api.js';
import { applyAccentColor } from '../theme.js';
import { jumpToMessage, loginAgain, retryNow } from '../chat/store.js';
import { useChat, init, open, go, readHash, keyOf, loadGroups, loadMembers, toast, errorText, getState, ask, unreadTotals } from '../chat/store.js';
import { Rail, ServerSidebar, HomeSidebar, MemberList, UserPanel, VoiceQuotaNote, OutdatedNote, useConnLost } from '../chat/Parts.jsx';

import { MessageList, Composer } from '../chat/Messages.jsx';
import { ProfileCard, useProfiles, subtitle, Avatar } from '../chat/Profile.jsx';
import { ImportServer } from '../chat/Bridge.jsx';
import { PlatformIcon } from '../chat/platforms.jsx';
import { CrashGuard } from '../chat/Crash.jsx';
import { EmojiInfoHost } from '../chat/EmojiInfo.jsx';
import { ReactionPickerHost } from '../chat/Reactions.jsx';
import { UpdatePopup } from '../chat/UpdatePopup.jsx';
import { MobileAppPromo } from '../chat/MobileAppPromo.jsx';
import { AppDownload, AppDownloadTip } from '../chat/AppDownload.jsx';
import { AccountNotices } from '../chat/AccountNotices.jsx';
import { E2eeGate } from '../chat/E2ee.jsx';
import RockEgg from '../chat/RockEgg.jsx';
import { PermissionPrompts } from '../chat/Permissions.jsx';
import { RadioHost } from '../chat/Radio.jsx';
import SettingsDialog from '../chat/SettingsDialog.jsx';
import { useDesktopMac } from '../components/tabs/ChatSettingsTab.jsx';
import { ServerSettings } from '../chat/ServerSettings.jsx';
import { ChannelSettings } from '../chat/ChannelSettings.jsx';
import { CreateServer, HostingNote } from '../chat/Hosting.jsx';
import { ExportButton } from '../chat/Community.jsx';

import { isInst, instOf } from '../chat/ids.js';


import { Discover, Invite, JoinInvite, ChannelEditor, NewDM, NewGroup, QuickSwitcher, AskHost } from '../chat/Dialogs.jsx';
import { UploadDestHost } from '../chat/UploadDest.jsx';
import Home from '../chat/Home.jsx';
import { TestBotDialog } from '../chat/BotTest.jsx';
import { AddInstance } from '../chat/Instances.jsx';
import { OcAddServer, OcDiscover } from '../originchats/OcServers.jsx';
import { OcServerGate } from '../originchats/OcServerGate.jsx';
import { InstanceGate, LockedScreen, SUPPORT_URL, SignInPrompt, SignedOutSidebar, RetryIn } from '../chat/Gate.jsx';
import { finishSignIn, SIGNIN_TEXT } from '../chat/session.js';
import { SetupWizard } from '../chat/Setup.jsx';
import { MenuHost, openMenu, copy } from '../chat/Menu.jsx';
import { InteractionModalHost } from '../chat/Commands.jsx';
import { stampOf } from '../chat/text.jsx';
import { pushSupported, browserSubscribed, enablePush } from '../push.js';
import { BootScreen } from '../chat/Boot.jsx';
import { applyDesign, clearDesign } from '../chat/design.js';
import '../chat/chat.css';
import '../chat/rounded.css';
import '../chat/boot.css';
import { MaskIcon } from '../chat/Alias.jsx';
import { aliasOf, shownName } from '../chat/aliases.js';

function meFrom(d) {
  return { id: d.account.id != null ? String(d.account.id) : undefined, username: d.account.username, pfp: d.profile.pfp || null, color: d.profile.color || null, rank: d.account.rank, pro: !!d.account.pro };
}

// desktop app: the middle of its title bar says where you are (server / DM / group)
function DesktopTitle() {
  const view = useChat(s => s.view);
  const server = useChat(s => (view.sid ? s.detail[view.sid]?.server.name || s.servers.find(x => x.sid === view.sid)?.name : null));
  const srvIcon = useChat(s => (view.sid ? s.detail[view.sid]?.server.icon || s.servers.find(x => x.sid === view.sid)?.icon : null));
  const pfp = useChat(s => (view.kind === 'dm' && view.username !== 'System' ? s.people[view.username]?.pfp || s.dms.find(c => c.username === view.username)?.pfp : null));
  const group = useChat(s => (view.kind === 'group' ? s.groups.find(g => g.room === view.room)?.name : null));
  const text = view.kind === 'channel' || view.kind === 'server' ? server || ''
    : view.kind === 'dm' ? (view.username === 'System' ? 'Nookara' : `@${view.username}`)
      : view.kind === 'group' ? group || 'Group chat'
        : view.kind === 'modmail' ? 'Nookara Moderator Chat'
          : view.kind === 'home' ? 'Friends' : '';
  const raw = view.kind === 'channel' || view.kind === 'server' ? srvIcon : view.kind === 'dm' ? (view.username === 'System' ? '/assets/bonfire/logo-256.png' : pfp) : view.kind === 'modmail' ? '/assets/bonfire/logo-256.png' : null;
  const icon = raw ? new URL(raw, location.origin).href : '';
  useEffect(() => { window.bonfireDesktop?.setTitle?.(text, icon); }, [text, icon]);
  return null;
}
// desktop app: Discord holds the RPC connection while it runs, so games' status can't reach Ember
function RpcWarning() {
  const s = useChat(st => st.rpcStatus);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('bf_rpc_warn') === '1'; } catch { return false; } });
  if (!s || !s.enabled || !s.discordRunning || hidden) return null;
  return (
    <div className="vc-rpc-warn" role="status">
      <b>Discord is running</b>
      <span>Ember can't pick up your game status from Discord RPC while Discord is open - games send it to Discord instead. Close Discord (from its tray icon too) and Ember takes over.</span>
      <button type="button" className="vc-ico-btn" title="Hide until Ember restarts" onClick={() => { setHidden(true); try { sessionStorage.setItem('bf_rpc_warn', '1'); } catch { /* fine */ } }}><X size={15} /></button>
    </div>
  );
}

// Browser push is separate per device and keeps working after the tab closes.
// Desktop Ember 1.5.1 already has its own interactive notifications.
function NotificationBanner() {
  const [show, setShow] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const macDesktop = useDesktopMac(); // the Mac app: say macOS, not Windows
  useEffect(() => {
    if (/(?:^|; )bonfire_notifications_dismissed=1(?:;|$)/.test(document.cookie)) return;
    // Old desktop shells do not have Ember's notification bridge yet. Put
    // the update call-to-action in the chat app itself, not account settings.
    if (window.bonfireDesktop?.isDesktop) {
      if (!window.bonfireDesktop.notify) { setDesktopUpdate(true); setShow(true); return; }
      if (!window.bonfireDesktop.notificationStatus) { setDesktopUpdate(true); setShow(true); return; }
      window.bonfireDesktop.notificationStatus().then(s => {
        setDesktop(true); setUnsupported(!s?.supported); setShow(!s?.enabled || !s?.supported);
      }).catch(() => { setDesktop(true); setShow(true); });
      return;
    }
    if (!pushSupported()) { setUnsupported(true); setShow(true); return; }
    if (Notification.permission === 'denied') { setBlocked(true); setShow(true); return; }
    browserSubscribed().then(on => setShow(!on)).catch(() => {});
  }, []);
  if (!show) return null;
  const turnOn = async () => {
    if (unsupported) { setError(desktop ? `Desktop notifications are not supported by this installation or are disabled by ${macDesktop ? 'macOS' : 'Windows'}.` : "This browser doesn't support background push notifications. Try a current Chrome, Edge, Firefox, or Safari browser."); return; }
    if (blocked) { setError('Notifications are blocked in this browser. Allow notifications for ' + location.hostname + ' in your browser settings, then reload Ember.'); return; }
    setBusy(true); setError('');
    try {
      if (desktop) await window.bonfireDesktop.enableNotifications();
      else await enablePush();
      setShow(false);
    }
    catch (e) { setError(e.message || "Couldn't enable notifications."); }
    setBusy(false);
  };
  return (
    <div className="vc-notify-banner" role="status">
      <Bell size={18} />
      <span><b>{desktopUpdate ? 'Enable desktop notifications' : unsupported ? 'Notifications unavailable' : blocked ? 'Notifications are blocked' : desktop ? 'Enable desktop notifications' : 'Turn on notifications?'}</b> {desktopUpdate ? 'Update Ember, then restart it to receive DMs and incoming-call actions.' : unsupported ? (desktop ? `Enable ${macDesktop ? 'macOS' : 'Windows'} notifications for Ember, then restart the app.` : "This browser can't receive background push notifications.") : blocked ? 'Allow notifications for Nookara in your browser settings, then reload Ember.' : desktop ? 'Get DM reply boxes and incoming-call actions while Ember is inactive.' : 'Get DMs, calls and mentions even when Ember is closed.'}</span>
      {error && <small>{error}</small>}
      {!blocked && !unsupported && <button type="button" onClick={() => desktopUpdate ? window.bonfireDesktop?.checkForUpdates?.() : turnOn()} disabled={busy}>{desktopUpdate ? 'Check for update' : busy ? 'Turning on…' : desktop ? 'Enable & test' : 'Turn on'}</button>}
      <button type="button" className="dismiss" title="Not now" onClick={() => { document.cookie = 'bonfire_notifications_dismissed=1; Max-Age=2592000; Path=/; SameSite=Lax'; setShow(false); }}><X size={15} /></button>
    </div>
  );
}
// Signed in to Velora but this login can't sign messages: people on other servers can't verify them (chat/signing.js).
// Dismissing hides it for this browser session only.
function SigningBanner() {
  const state = useChat(s => s.signing?.state);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('bonfire_sign_banner_off') === '1'; } catch { return false; } });
  if (state !== 'no_scope' || hidden) return null;
  return (
    <div className="vc-sign-banner" role="status">
      <ShieldAlert size={16} />
      <span>Your messages aren't being signed. People on other servers can't verify they came from you.</span>
      <button type="button" onClick={loginAgain}>Sign in again to allow</button>
      <button type="button" className="dismiss" title="Dismiss for now" aria-label="Dismiss" onClick={() => { try { sessionStorage.setItem('bonfire_sign_banner_off', '1'); } catch { /* fine */ } setHidden(true); }}><X size={15} /></button>
    </div>
  );
}
// Ember is switched off for this account on that server (the server's own view is a notice, see Gate.jsx; this covers a channel opened anyway)
function RestrictedBar() {
  const note = useChat(s => { const v = s.view; const o = v.kind === 'channel' && v.sid && isInst(v.sid) ? instOf(v.sid) : null; return o ? s.instances.find(i => i.origin === o)?.restricted : null; });
  if (!note) return null;
  return <div className="vc-sign-banner" role="status"><Ban size={14} /><span>{note} Contact Nookara support if you think this is a mistake.</span><a className="vc-sign-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Nookara support</a></div>;
}
// a server hosted by Velora whose paid time ran out is read-only for everyone until its owner buys more time
function ReadOnlyBar() {
  const ro = useChat(s => { const v = s.view; const o = v.kind === 'channel' && v.sid && isInst(v.sid) ? instOf(v.sid) : null; return !!(o && s.instances.find(i => i.origin === o)?.readOnly); });
  if (!ro) return null;
  return <div className="vc-sign-banner vc-reconnect-bar" role="status"><Lock size={14} /><span>This server is read-only for now - its owner needs to renew it.</span></div>;
}
// a server hosted inside Velora itself (the old kind) is read-only now: where it went, and its owner's way out
function LegacyReadOnlyBar() {
  const view = useChat(s => s.view);
  const srv = useChat(s => (s.view.kind === 'channel' && s.view.sid && !isInst(s.view.sid) ? s.detail[s.view.sid]?.server : null));
  const [busy, setBusy] = useState('');
  if (!srv?.read_only) return null;
  const owner = srv.role === 'owner';
  const moved = srv.moved_to ? srv.moved_to.replace(/^https?:\/\//, '') : '';
  const open = () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: srv.moved_to } }));
  async function keep() {
    setBusy('keep');
    try { await apiFetch(`/chat/servers/${view.sid}/export-to-account`, { method: 'POST' }); toast('Saved to your Nookara account - restore it from Create a server.', true); }
    catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  return (
    <div className="vc-sign-banner vc-legacy-bar" role="status">
      <Lock size={14} />
      <span>{moved ? <>This server moved to <b>{moved}</b>. This copy is read-only.</> : <>Servers hosted inside Nookara are read-only now.{owner ? ' Move it to an Ember server to keep going.' : ''}</>}</span>
      {moved && <button type="button" onClick={open}>Open {moved}</button>}
      {owner && !moved && <button type="button" disabled={!!busy} onClick={keep}>{busy === 'keep' ? 'Saving...' : 'Save to my Nookara account'}</button>}
      {owner && !moved && <ExportButton sid={view.sid} />}
    </div>
  );
}
// the home socket has been down for a while: a popup while it reconnects by itself (it never signs you out for that)
function ReconnectPopup() {
  const lost = useConnLost();
  const connecting = useChat(s => s.conn === 'connecting');
  const connected = useChat(s => s.connected);
  const at = useChat(s => s.connRetryAt);
  if (!lost || !connected) return null;
  return (
    <div className="vc-upd vc-reconnect-pop" role="status">
      <span className="vc-upd-ico"><i className="vc-gate-spin" /></span>
      <div className="vc-upd-txt"><b>Reconnecting to Nookara...</b><span>Messages may not send or arrive until it's back. <RetryIn at={at} busy={connecting} /></span></div>
      <div className="vc-upd-btns"><button type="button" className="btn btn-surface btn-sm" onClick={retryNow}>Retry now</button></div>
    </div>
  );
}
// Browsers do not expose a real pause control for GIF decoding. Replace an
// inactive GIF with a PNG snapshot instead: it stays visible but cannot keep
// decoding/animating in the background.  Some third-party hosts do not permit
// canvas snapshots (CORS); those are left alone rather than made invisible.
function GifPauseGate() {
  useEffect(() => {
    let desktopFocused = true;
    const gif = img => /\.gif(?:[?#]|$)/i.test(img.dataset.vcGifSrc || img.currentSrc || img.src || '') || img.closest('.vc-att.gif, .vc-gif-tile') || img.classList.contains('vc-gif-image');
    const snapshot = img => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return '';
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        return canvas.toDataURL('image/png');
      } catch { return ''; }
    };
    const setStill = (img, original, still) => {
      if (!still || !img.isConnected || img.dataset.vcGifSrc) return;
      img.dataset.vcGifSrc = original;
      img.src = still;
      img.classList.add('vc-gif-paused');
    };
    const freezeImage = img => {
      if (img.dataset.vcGifSrc || img.dataset.vcGifPending || !gif(img)) return;
      const original = img.currentSrc || img.src;
      const still = snapshot(img);
      if (still) { setStill(img, original, still); return; }
      // The displayed image was loaded in no-CORS mode, which makes its canvas
      // unreadable even when its host does support CORS. Load a temporary CORS
      // copy for the snapshot without risking the visible image.
      img.dataset.vcGifPending = '1';
      const copy = new Image();
      copy.crossOrigin = 'anonymous';
      copy.onload = () => {
        delete img.dataset.vcGifPending;
        if (inactive()) setStill(img, original, snapshot(copy));
      };
      copy.onerror = () => { delete img.dataset.vcGifPending; };
      copy.src = original;
    };
    const freeze = root => root.querySelectorAll?.('img').forEach(freezeImage);
    const resume = () => {
      document.querySelectorAll('img[data-vc-gif-src]').forEach(img => { img.src = img.dataset.vcGifSrc; delete img.dataset.vcGifSrc; img.classList.remove('vc-gif-paused'); });
      document.querySelectorAll('img[data-vc-gif-pending]').forEach(img => { delete img.dataset.vcGifPending; });
    };
    const inactive = () => document.visibilityState !== 'visible' || (window.bonfireDesktop?.isDesktop ? !desktopFocused : !document.hasFocus());
    const sync = () => { if (inactive()) freeze(document); else resume(); };
    const observer = new MutationObserver(list => { if (inactive()) list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches?.('img')) freeze(n.parentElement || document); else freeze(n); } })); });
    observer.observe(document.body, { childList: true, subtree: true });
    const off = window.bonfireDesktop?.onWindowFocus?.(v => { desktopFocused = v; sync(); });
    document.addEventListener('visibilitychange', sync); window.addEventListener('blur', sync); window.addEventListener('focus', sync); sync();
    return () => { observer.disconnect(); off?.(); document.removeEventListener('visibilitychange', sync); window.removeEventListener('blur', sync); window.removeEventListener('focus', sync); resume(); };
  }, []);
  return null;
}
// a crash anywhere in Ember shows the crash screen (reload / report) instead of a blank page
export default function Chat() {
  useLayoutEffect(() => { applyDesign(); return clearDesign; }, []); // rounded / square (chat/design.js)
  // Ember's own tab title + icon while you're here (the rest of Velora keeps Velora's)
  useEffect(() => {
    const link = document.querySelector('link[rel~="icon"]');
    const old = { title: document.title, href: link?.href };
    document.title = 'Ember';
    if (link) link.href = '/assets/bonfire/favicon-circle-64.png?v=2';
    return () => { document.title = old.title; if (link && old.href) link.href = old.href; };
  }, []);
  return <CrashGuard><ChatPage /></CrashGuard>;
}
// the tab icon with what's waiting on it: a white dot for unread messages, a red one with the count when you're pinged
let faceImg = null;
function drawTabIcon(count, pings) {
  const link = document.querySelector('link[rel~="icon"]');
  if (!link) return;
  if (!count && !pings) { link.href = '/assets/bonfire/favicon-circle-64.png?v=2'; return; }
  const paint = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(faceImg, 0, 0, 64, 64);
    if (pings) {
      const text = pings > 99 ? '99+' : String(pings);
      const r = 17, w = Math.max(r * 2, text.length * 13 + 12), x = 64 - w, y = 64 - r * 2;
      g.fillStyle = '#f23f43';
      g.strokeStyle = '#1e1f22';
      g.lineWidth = 4;
      g.beginPath(); g.roundRect(x + 2, y + 2, w - 4, r * 2 - 4, r - 2); g.fill(); g.stroke();
      g.fillStyle = '#fff';
      g.font = `bold ${text.length > 2 ? 18 : 24}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, x + w / 2, y + r + 1);
    } else {
      g.fillStyle = '#fff';
      g.strokeStyle = '#1e1f22';
      g.lineWidth = 4;
      g.beginPath(); g.arc(50, 50, 11, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    try { link.href = c.toDataURL('image/png'); } catch { /* fine */ }
  };
  if (faceImg?.complete && faceImg.naturalWidth) { paint(); return; }
  if (!faceImg) { faceImg = new Image(); faceImg.src = '/assets/bonfire/favicon-circle-64.png?v=2'; }
  faceImg.addEventListener('load', () => { const t = drawTabIcon.want; if (t) drawTabIcon(t[0], t[1]); }, { once: true });
}
function useTabBadge() {
  const totals = useChat(s => { const t = unreadTotals(s); return `${t.count}|${t.pings}`; });
  const [count, pings] = totals.split('|').map(Number);
  useEffect(() => { drawTabIcon.want = [count, pings]; drawTabIcon(count, pings); }, [count, pings]);
  return count;
}
function ChatPage() {
  const [ready, setReady] = useState(false);
  const view = useChat(s => s.view);
  const error = useChat(s => s.error);
  const [dialog, setDialog] = useState(null); // { kind, ... }
  const [showMembers, setShowMembers] = useState(() => { try { return innerWidth >= 1100 && localStorage.getItem('velora_chat_members') !== '0'; } catch { return innerWidth >= 1100; } });
  const [drawer, setDrawer] = useState(false);
  useEffect(() => initSheets(), []); // phones: pop-ups and menus open as bottom sheets
  // phones: the menu drawer is a history entry, so the browser / Android back button closes it, and going back from a chat shows the chat list again
  const openDrawer = () => { if (innerWidth <= 760 && !history.state?.vcDrawer) history.pushState({ vcDrawer: 1 }, '', location.href); setDrawer(true); };
  const closeDrawer = () => { if (history.state?.vcDrawer) history.back(); else setDrawer(false); };
  useEffect(() => {
    const sync = () => setDrawer(!!history.state?.vcDrawer && innerWidth <= 760);
    const onResize = () => { if (innerWidth > 760) setDrawer(false); };
    addEventListener('popstate', sync); addEventListener('resize', onResize);
    return () => { removeEventListener('popstate', sync); removeEventListener('resize', onResize); };
  }, []);
  // phones: when the keyboard opens the browser may pan the page up and hide the header / menus; keep the app glued to the visible area
  useEffect(() => {
    const vv = window.visualViewport; const root = document.documentElement;
    if (!vv) return undefined;
    const fit = () => {
      if (vv.scale > 1.01) { root.style.removeProperty('--vc-vh'); return; }
      root.style.setProperty('--vc-vh', `${Math.round(vv.height)}px`);
      if (window.scrollY || vv.offsetTop) window.scrollTo(0, 0);
    };
    fit(); vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); root.style.removeProperty('--vc-vh'); };
  }, []);
  const [replyTo, setReplyTo] = useState(null);
  const [search, setSearch] = useState(null); // { q, results }
  const [scope, setScope] = useState('server'); // search: whole server or just this channel
  const staff = useChat(s => s.staff); // Velora staff: Moderator chat button in DMs
  const { openMini, ui: profileUI } = useProfiles();

  const signin = useRef(null);
  useEffect(() => {
    document.title = 'Ember';
    document.documentElement.classList.add('vc-page');
    const web = isWebBonfire(); // in a browser Ember works without a Velora sign-in; the desktop / Android apps always have one
    (async () => {
      signin.current = await finishSignIn(); // back from Velora's approve-this-app screen (#/signin?code=...)
      if (!getToken()) {
        if (!web) { location.href = '/login'; return; }
        init(null); setReady(true);
        return;
      }
      const cached = cachedMe();
      if (web && cached?.account?.username) try { localStorage.setItem('bonfire_user', cached.account.username); } catch { /* fine */ } // (the per-account storage keys follow it)
      if (cached) { applyAccentColor(cached.profile?.color); init(meFrom(cached)); setReady(true); }
      api.getMe().then(d => {
        applyAccentColor(d.profile?.color);
        if (!getState().me) { init(meFrom(d)); setReady(true); }
      }).catch(e => {
        if (web) { if (e.status !== 401 && !getState().me) { init({ username: localStorage.getItem('bonfire_user') || 'you' }); setReady(true); } return; } // (a 401 already dropped to signed-out mode)
        if (e.status === 401 || e.status === 403) location.href = '/login';
      });
    })();
    return () => document.documentElement.classList.remove('vc-page');
  }, []);
  // notes from the sign-in round trip
  useEffect(() => {
    if (!ready) return;
    const r = signin.current;
    if (r) { if (r.ok) toast('Signed in with Nookara.', true); else toast(SIGNIN_TEXT[r.error]); if (r.back?.add) setDialog({ kind: 'add-instance', url: r.back.add }); else if (r.back?.create) setDialog({ kind: 'create-server' }); }
    try { if (sessionStorage.getItem('bonfire_notice')) { sessionStorage.removeItem('bonfire_notice'); toast('Your Nookara sign-in ended - sign in again to get your messages back.'); } } catch { /* fine */ }
  }, [ready]);

  // where to start: the address, or where you were last time
  useEffect(() => {
    if (!ready) return;
    const tb = /^#\/test-bot\/(\d{1,20})\/?$/.exec(location.hash); // admin: /chat#/test-bot/<bot id> opens the test-install dialog
    if (tb) { setDialog({ kind: 'test-bot', id: tb[1] }); history.replaceState(null, '', clientUrl('#/home')); open({ kind: 'home' }); return; }
    let v = readHash();
    if (v.kind === 'invite') { setDialog({ kind: 'invite-join', code: v.code, inst: v.inst }); history.replaceState(null, '', clientUrl('#/home')); open({ kind: 'home' }); return; }
    if (v.kind === 'home' && !location.hash) {
      try { const last = localStorage.getItem('velora_chat_last'); if (last) { history.replaceState(null, '', clientUrl(last)); v = readHash(); } } catch { /* fine */ }
    }
    open(v);
  }, [ready]);
  useEffect(() => { setReplyTo(null); setSearch(null); setDrawer(!!history.state?.vcDrawer && innerWidth <= 760); }, [view.kind, view.cid, view.username, view.room]);
  // invite links (from messages, the address bar...) open the invite pop-up here
  useEffect(() => {
    const on = e => setDialog({ kind: 'invite-join', code: e.detail?.code ?? e.detail, inst: e.detail?.inst });
    addEventListener('vc-invite', on);
    return () => removeEventListener('vc-invite', on);
  }, []);
  const settings = useChat(s => s.settings);
  const toastOk = useChat(s => s.toastOk);
  // dialogs opened from right-click menus (they may be about another server than the one you're in)
  useEffect(() => {
    const on = async e => {
      const { kind, sid, room } = e.detail;
      if (kind === 'leave') {
        const srv = getState().servers.find(x => x.sid === sid);
        if (!srv || !(await ask({ title: `Leave ${srv.name}?`, text: srv.inst ? (srv.join_policy === 'open' ? 'You can join again whenever you like.' : "You'll need to ask again, or have an invite, to get back in.") : srv.discoverable || srv.is_default ? 'You can join again from Discover.' : "You'll need an invite to get back in.", confirm: 'Leave server', danger: true }))) return;
        apiFetch(`/chat/servers/${sid}/leave`, { method: 'POST' }).catch(er => toast(errorText(er.message)));
        return;
      }
      if (kind === 'leave-group') {
        const g = getState().groups.find(x => x.room === room);
        if (!g || !(await ask({ title: `Leave ${g.name}?`, text: 'Someone in the group will have to add you back.', confirm: 'Leave group', danger: true }))) return;
        apiFetch(`/groups/${room}/members/${encodeURIComponent(getState().me.username)}`, { method: 'DELETE' }).then(loadGroups).then(() => { if (getState().view.room === room) go({ kind: 'home' }); }).catch(er => toast(errorText(er.message)));
        return;
      }
      if (sid && getState().view.sid !== sid) await open({ kind: 'server', sid });
      setDialog({ ...e.detail, kind, sid });
    };
    addEventListener('vc-dialog', on);
    return () => removeEventListener('vc-dialog', on);
  }, []);
  // Ctrl+K: quick switcher
  useEffect(() => {
    const k = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog(d => (d?.kind === 'quick' ? null : { kind: 'quick' })); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  // the member list stays fresh on its own (joins / leaves come live; this catches anything missed)
  useEffect(() => {
    if (view.kind !== 'channel') return undefined;
    const t = setInterval(() => loadMembers(view.sid), 90000);
    return () => clearInterval(t);
  }, [view.kind, view.sid]);
  useEffect(() => { if (innerWidth >= 1100) try { localStorage.setItem('velora_chat_members', showMembers ? '1' : '0'); } catch { /* fine */ } }, [showMembers]);

  const detail = useChat(s => (view.sid ? s.detail[view.sid] : null));
  const channel = detail?.channels.find(c => c.cid === view.cid);
  const group = useChat(s => (view.kind === 'group' ? s.groups.find(g => g.room === view.room) : null));
  const dmPresence = useChat(s => (view.kind === 'dm' ? s.presence[view.username] : null));
  const unreadCount = useTabBadge();
  const gateName = useChat(s => (view.kind === 'instance' ? s.instances.find(i => i.origin === view.inst)?.name : null));
  useEffect(() => { document.title = `${unreadCount ? `(${unreadCount > 999 ? '999+' : unreadCount}) ` : ''}${channel ? `#${channel.name} - ${detail.server.name}` : view.kind === 'instance' ? gateName || 'Server' : view.kind === 'dm' ? `@${view.username}` : group ? group.name : 'Friends'} | Ember`; }, [unreadCount, channel, detail, view, group, gateName]);
  const signedIn = useChat(s => s.signedIn);
  const locked = useChat(s => s.locked); // staff switched Ember and DMs off for the account (store.js lockAccount)
  // an OriginChats server that isn't connected or signed in yet covers its channel
  const ocSid = view.kind === 'channel' && !isInst(view.sid) ? view.sid : null;
  const ocState = useChat(s => {
    const v = s.view;
    if (v.kind !== 'channel' || isInst(v.sid)) return null;
    return s.detail[v.sid]?.server?.oc_state || s.servers.find(x => x.sid === v.sid)?.oc_state || 'idle';
  });

  if (!ready) return <BootScreen />;
  if (locked) return <div className="vc"><LockedScreen /></div>; // (no rail, lists, dialogs or toasts: just the notice)

  const isServer = view.kind === 'channel';
  const sysDM = view.kind === 'dm' && view.username === 'System';
  const modView = view.kind === 'modmail';
  const canMod = ((detail?.server.perms || 0) & 64) === 64; // Manage messages
  const canPost = channel ? channel.can_post !== false && !detail?.server?.read_only : true; // the server works it out per channel type (a read-only server: nobody)

  const ChIcon = ({ size, className }) => <span className={className} style={{ display: 'inline-flex' }}><ChannelIcon c={channel} size={size} /></span>; // the channel's own icon / type icon

  // search this channel, or the whole server (from:name in:channel has:image|video|file|link|embed)
  async function runSearch(q, sc = scope) {
    if (!q.trim() || !channel) { setSearch(null); return; }
    setSearch({ q, scope: sc, results: null });
    try {
      const d = sc === 'server' ? await apiFetch(`/chat/servers/${view.sid}/search?q=${encodeURIComponent(q)}`) : await apiFetch(`/chat/channels/${channel.cid}/search?q=${encodeURIComponent(q)}`);
      setSearch({ q, scope: sc, results: d.messages, total: d.total ?? d.messages.length });
    } catch (e) { toast(errorText(e.message)); setSearch(null); }
  }
  async function leaveServer() {
    const srv = detail.server;
    if (!(await ask({ title: `Leave ${srv.name}?`, text: srv.inst ? (srv.join_policy === 'open' ? 'You can join again whenever you like.' : "You'll need to ask again, or have an invite, to get back in.") : srv.discoverable || srv.is_default ? 'You can join again from Discover.' : "You'll need an invite to get back in.", confirm: 'Leave server', danger: true }))) return;
    try { await apiFetch(`/chat/servers/${view.sid}/leave`, { method: 'POST' }); } catch (e) { toast(errorText(e.message)); }
  }
  async function leaveGroup() {
    if (!(await ask({ title: `Leave ${group.name}?`, text: "Someone in the group will have to add you back.", confirm: 'Leave group', danger: true }))) return;
    try { await apiFetch(`/groups/${group.room}/members/${encodeURIComponent(getState().me.username)}`, { method: 'DELETE' }); await loadGroups(); go({ kind: 'home' }); } catch (e) { toast(errorText(e.message)); }
  }

  const title = isServer
    ? { icon: <ChIcon size={34} />, big: `Welcome to #${channel?.name || ''}`, sub: channel?.topic || `This is the start of the #${channel?.name} channel.` }
    : modView
      ? { icon: <ShieldCheck size={34} />, big: view.username ? `Moderator chat with ${view.username}` : 'Nookara Moderator Chat', sub: view.username ? `They see these as "Nookara Administrator" - never who sent them. Only Nookara staff see the names.` : "Messages from Nookara's admins. You can't reply here - if you need to answer, use nookara.cc/support." }
    : view.kind === 'dm'
      ? (sysDM ? { icon: <AtSign size={34} />, big: 'Nookara', sub: 'Notices about your account: credits, reports and more.' } : { icon: <AtSign size={34} />, big: view.username, sub: `This is the start of your conversation with ${view.username}.` })
      : { icon: <UsersRound size={34} />, big: group?.name || 'Group chat', sub: 'This is the start of the group chat.' };
  const sideKey = view.kind === 'channel' ? view.sid : 'home';

  return (
    <div className={`vc${drawer ? ' drawer' : ''}${settings.compact ? ' compact' : ''}${settings.animations === false ? ' still' : ''}`}
      onContextMenu={e => {
        // anything without its own menu: copy selected text / links / pictures, and nothing else (no browser menu)
        if (e.target.closest('input, textarea, [contenteditable]')) return;
        const sel = String(getSelection?.() || '').trim();
        const link = e.target.closest('a[href]');
        const img = e.target.closest('img');
        openMenu(e, [
          sel && { label: 'Copy', onClick: () => copy(sel, 'Text copied') },
          link && { label: 'Open link', onClick: () => window.open(link.href, '_blank', 'noopener') },
          link && { label: 'Copy link', onClick: () => copy(link.href, 'Link copied') },
          img && { label: 'Open picture', onClick: () => viewPicture(img.src) },
          img && { label: 'Copy image', onClick: () => copyImage(img.src) },
          img && { label: 'Download image', onClick: () => downloadImage(img.src) },
        ]);
        e.preventDefault();
      }}>
      {signedIn && !__ORIGINCHATS__ && <NotificationBanner />}
      <GifPauseGate />
      <div className="vc-left" onClick={e => { const t = e.target.closest?.('.vc-dm, .vc-ch, .vc-home-link, .vc-rail-item'); if (!t || !drawer) return; const h = location.hash; setTimeout(() => { if (location.hash === h) closeDrawer(); }, 60); }}>
        <Rail onDiscover={() => setDialog({ kind: 'discover' })} onAddInstance={() => setDialog({ kind: 'add-instance' })} />
        <div className="vc-side-col">
          <div className="vc-side-swap" key={sideKey}>
            {view.kind === 'channel'
              ? <ServerSidebar sid={view.sid} onInvite={() => setDialog({ kind: 'invite' })} onSettings={() => setDialog({ kind: 'settings' })} onChannel={c => setDialog({ kind: 'channel', channel: c })} onLeave={leaveServer} onUser={openMini} />
              : view.kind === 'instance' ? <div className="vc-side" /> // a server that isn't connected yet: no channel list
                : signedIn ? <HomeSidebar onNewDM={() => setDialog({ kind: 'dm' })} onNewGroup={() => setDialog({ kind: 'group' })} onQuick={() => setDialog({ kind: 'quick' })} /> : <SignedOutSidebar />}
          </div>
          <VoicePanel />
          <VoiceQuotaNote />
          <HostingNote />
          <OutdatedNote />

          <UserPanel onSettings={() => setDialog({ kind: 'chat-settings' })} onEditProfile={() => setDialog({ kind: 'chat-settings', page: 'profile' })} />
        </div>
      </div>
      <div className="vc-scrim" onClick={closeDrawer} />

      <main className="vc-main">
        {signedIn && <ReconnectPopup />}
        {signedIn && <SigningBanner />}
        <RestrictedBar />
        <ReadOnlyBar />
        <LegacyReadOnlyBar />
        {view.kind === 'home' || view.kind === 'instance' ? (
          <>
            <button type="button" className="vc-ico-btn vc-burger floating" onClick={openDrawer} title="Menu"><Menu size={19} /></button>
            {view.kind === 'instance' ? <InstanceGate origin={view.inst} /> : signedIn ? <Home onUser={openMini} /> : <SignInPrompt />}
          </>
        ) : (
          <>
            <header className="vc-head">
              <button type="button" className="vc-ico-btn vc-burger" onClick={openDrawer} title="Menu"><Menu size={19} /></button>
              <button type="button" className="vc-ico-btn vc-back" onClick={openDrawer} title="Back to your chats" aria-label="Back to your chats"><ChevronLeft size={22} /></button>
              {isServer && <><ChIcon size={20} className="vc-head-ico" /><b className="vc-head-name">{channel?.name || ''}</b>{(channel?.bridges || (channel?.bridged ? [channel.bridged] : [])).map(link => <span key={link.platform} className="vc-bridge-tag" title={`Bridged with #${link.name} in the linked ${link.platform === 'discord' ? 'Discord' : 'Fluxer'} community`}><PlatformIcon p={link.platform} size={14} /> #{link.name}</span>)}{channel?.type === 'logs' && channel.config?.mode === 'cloudlink' && <span className="vc-bridge-tag" title={`Bridged with CloudLink (${channel.config.url}${channel.config.room ? `, room ${channel.config.room}` : ''}) - messages go both ways. Type !online to see who's there.`}><PlatformIcon p="cloudlink" size={14} /> CloudLink</span>}{channel?.topic && <span className="vc-head-topic" title={channel.topic}>{channel.topic}</span>}</>}
              {sysDM && <><b className="vc-head-name">Nookara</b><span className="vc-head-topic">Notices about your account</span></>}
              {modView && <><ShieldCheck size={20} className="vc-head-ico" /><b className="vc-head-name">{view.username ? `Moderator chat: ${view.username}` : 'Nookara Moderator Chat'}</b><span className="vc-head-topic">{view.username ? 'You write as Nookara Administrator' : 'From Nookara\'s admins - read only'}</span></>}
              {view.kind === 'dm' && !sysDM && (
                <>
                  <button type="button" className="vc-head-user" onClick={e => openMini(view.username, e.currentTarget)}>
                    <Avatar user={{ username: view.username, pfp: getState().people[view.username]?.pfp }} size={26} status={dmPresence?.status || 'offline'} />
                    <b className="vc-head-name">{view.username}</b>
                  </button>
                  {subtitle(dmPresence) && <span className="vc-head-topic">{subtitle(dmPresence)}</span>}
                </>
              )}
              {view.kind === 'group' && <><UsersRound size={20} className="vc-head-ico" /><b className="vc-head-name">{group?.name || 'Group chat'}</b><span className="vc-head-topic">{group ? `${group.members.length} members` : ''}</span></>}
              <span className="grow" />
              {isServer && (
                <form className="vc-head-search" onSubmit={e => { e.preventDefault(); runSearch(new FormData(e.currentTarget).get('q')); }}>
                  <button type="button" className="vc-search-scope" title="Search the whole server or just this channel" onClick={() => setScope(s => (s === 'server' ? 'channel' : 'server'))}>{scope === 'server' ? 'Server' : `#${channel?.name || ''}`}</button>
                  <input name="q" placeholder={scope === 'server' ? `Search ${detail?.server.name || 'server'}` : `Search #${channel?.name || ''}`} key={view.sid} title="Filters: from:name  in:channel  has:image / video / file / link / embed" />
                  <Search size={14} />
                </form>
              )}
              {isServer && channel && (['text', 'logs', 'welcome', undefined].includes(channel.type) || (channel.type === 'game' && channel.config?.purpose === 'chat')) && <PinsButton channel={channel} sid={view.sid} />}
              {isServer && <button type="button" className={`vc-ico-btn${showMembers ? ' on' : ''}`} title={showMembers ? 'Hide members' : 'Show members'} onClick={() => setShowMembers(x => !x)}><Users size={19} /></button>}
              {((view.kind === 'dm' && !sysDM) || view.kind === 'group') && <PinsButton view={view} />}
              {view.kind === 'dm' && !sysDM && staff && <button type="button" className="vc-ico-btn" title="Message them as Nookara Administrator (Nookara Moderator Chat)" onClick={() => go({ kind: 'modmail', username: view.username })}><ShieldCheck size={19} /></button>}
              {view.kind === 'dm' && !sysDM && <DmCallButton username={view.username} />}
              {view.kind === 'dm' && !sysDM && <button type="button" className="vc-ico-btn" title={`Report @${view.username} to Nookara staff`} aria-label={`Report @${view.username}`} onClick={() => reportDmUser(view.username)}><Flag size={19} /></button>}
              {view.kind !== 'channel' && <button type="button" className={`vc-ico-btn${showMembers ? ' on' : ''}`} title="Side panel" onClick={() => setShowMembers(x => !x)}><PanelRight size={19} /></button>}
            </header>
            <div className="vc-body">
              <div className="vc-convo" key={keyOf(view)}>
                {view.kind === 'dm' && !sysDM && <DmCallBar username={view.username} />}
                {channel?.type === 'game' && !(channel.config?.setup && channel.config?.purpose === 'chat') ? <GameChannel channel={channel} sid={view.sid} /> : channel?.type === 'voice' ? <VoiceView channel={channel} sid={view.sid} /> : channel?.type === 'roles' ? <RoleShop channel={channel} /> : channel?.type === 'starboard' ? <Starboard channel={channel} sid={view.sid} /> : channel?.type === 'link' ? (
                  <div className="vc-linkch">
                    <ExternalLink size={34} />
                    <h2>#{channel.name}</h2>
                    <p>{channel.topic || 'This channel opens a website.'}</p>
                    <button type="button" className="btn btn-primary" onClick={() => openLinkChannel(channel)}>Open {(() => { try { return new URL(channel.config?.url).host; } catch { return 'the link'; } })()}</button>
                  </div>
                ) : <>
                {channel?.type === 'game' && <GameChatStrip channel={channel} />}
                <MessageList view={view} onUser={openMini} onReply={setReplyTo} canPost={canPost} canMod={canMod} channels={detail?.channels} title={title} />
                {channel?.type === 'game' && <GameOfflineNote channel={channel} />}
                <Composer view={view} locked={(isServer && !canPost) || sysDM || (modView && !view.username)} lockedText={sysDM ? "These are Nookara's own notices - there's no one to reply to here." : modView ? "This is a message from Nookara's admins - you can't reply here." : detail?.server?.read_only ? 'This server is read-only.' : lockedTextFor(channel)}
 replyTo={replyTo} setReplyTo={setReplyTo}
                  placeholder={modView ? `Message ${view.username} as Nookara Administrator` : isServer ? `Message #${channel?.name || ''}${channel?.type === 'game' ? ' (also shows in Minecraft)' : ''}` : view.kind === 'dm' ? `Message @${view.username}` : `Message ${group?.name || 'the group'}`} /></>}
              </div>
              {search && (
                <aside className="vc-results">
                  <div className="vc-results-head"><b>{search.results ? `${search.total} result${search.total === 1 ? '' : 's'}${search.scope === 'server' ? ' in this server' : ''}` : 'Searching...'}</b><button type="button" className="vc-ico-btn" onClick={() => setSearch(null)}><X size={16} /></button></div>
                  <div className="vc-results-tip">Filters: <code>from:name</code> <code>in:channel</code> <code>has:image</code> <code>has:file</code> <code>has:link</code></div>
                  {search.results?.map(m => (
                    <button type="button" key={m.id} className="vc-result" onClick={() => jumpToMessage({ kind: 'channel', sid: view.sid, cid: m.channel }, m.id)}>
                      <span>{m.channel_name && <em className="vc-result-ch">#{m.channel_name}</em>}<b>{shownName(m)}</b>{aliasOf(m) && !aliasOf(m).unmarked && <span className="vc-alias-mark" title={`Alias - posted by ${m.author.username}`}><MaskIcon size={12} /></span>} <small>{stampOf(m.created_at)}</small></span>
                      <span>{m.body || (m.attachments?.length ? `[${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}]` : '')}</span>
                    </button>
                  ))}
                  {search.results && !search.results.length && <div className="vc-empty-note">Nothing found.</div>}
                </aside>
              )}
              {!search && showMembers && isServer && <MemberList sid={view.sid} onUser={openMini} />}
              {!search && showMembers && view.kind === 'dm' && view.username !== 'System' && (
                <aside className="vc-dm-side"><ProfileCard username={view.username} onExpand={rect => { const r = rect; window.dispatchEvent(new CustomEvent('vc-open-big', { detail: { username: view.username, rect: r } })); }} /></aside>
              )}
              {!search && showMembers && view.kind === 'group' && group && (
                <aside className="vc-members">
                  <div className="vc-cat-name static">Members - {group.members.length}</div>
                  {group.members.map((u, i) => (
                    <button type="button" key={u} className="vc-member vl-rise" style={{ '--i': i }} onClick={e => openMini(u, e.currentTarget, 'left')}>
                      <Avatar user={{ username: u, pfp: getState().people[u]?.pfp }} size={34} status={getState().presence[u]?.status || undefined} />
                      <span className="vc-member-txt"><b>{u}</b>{u === group.owner && <small>Group owner</small>}</span>
                    </button>
                  ))}
                  <button type="button" className="vc-more danger" onClick={leaveGroup}><LogOut size={14} /> Leave group</button>
                </aside>
              )}
            </div>
          </>
        )}
      </main>

      {error && <div className={`vc-toast${toastOk ? ' ok' : ''}`} key={error}>{error}</div>}
      <MenuHost />
      {ocSid && ocState && ocState !== 'ready' && (
        <div className="oc-gate-overlay">
          <OcServerGate sid={ocSid} />
        </div>
      )}
      <InteractionModalHost />
      <TooltipHost />
      <MediaViewerHost />
      <EmojiInfoHost />
      <ReactionPickerHost />
      <RpcWarning />
      <UpdatePopup />
      {!__ORIGINCHATS__ && <MobileAppPromo />}
      {!__ORIGINCHATS__ && <AppDownloadTip onOpen={() => setDialog({ kind: 'app-download' })} />}
      {signedIn && <AccountNotices onOpenSettings={page => setDialog({ kind: 'chat-settings', page })} />}
      <RockEgg enabled={!!settings.rock_easter_egg} />
      <PermissionPrompts />
      <DesktopTitle />
      <IncomingCalls />
      <RadioHost />
      {profileUI}
      <BigFromEvent />
      {dialog?.kind === 'discover' && <OcDiscover onClose={() => setDialog(null)} />}
      {dialog?.kind === 'app-download' && <AppDownload onClose={() => setDialog(null)} />}
      {dialog?.kind === 'test-bot' && <TestBotDialog key={dialog.id} id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <ImportServer onClose={() => setDialog(null)} />}
      {dialog?.kind === 'add-instance' && <OcAddServer url={dialog.url} invite={dialog.invite} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'setup' && <SetupWizard origin={dialog.origin} name={dialog.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'create-server' && <OcAddServer onClose={() => setDialog(null)} />}

      {dialog?.kind === 'invite' && <Invite sid={dialog.sid || view.sid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'invite-join' && <OcAddServer url={dialog.inst} invite={dialog.code} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <ServerSettings key={`${dialog.sid || view.sid}-${dialog.tab || ''}`} sid={dialog.sid || view.sid} tab={dialog.tab} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'channel' && (dialog.channel?.cid
        ? <ChannelSettings key={dialog.channel.cid} sid={dialog.sid || view.sid} channel={dialog.channel} tab={dialog.tab} onClose={() => setDialog(null)} />
        : <ChannelEditor sid={dialog.sid || view.sid} channel={dialog.channel} onClose={() => setDialog(null)} />)}
      {dialog?.kind === 'dm' && <NewDM onClose={() => setDialog(null)} />}
      {dialog?.kind === 'group' && <NewGroup onClose={() => setDialog(null)} />}
      {dialog?.kind === 'quick' && <QuickSwitcher onClose={() => setDialog(null)} />}
      {dialog?.kind === 'chat-settings' && <SettingsDialog key={dialog.page || 'settings'} page={dialog.page} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'forward' && <ForwardDialog message={dialog.message} from={dialog.from} onClose={() => setDialog(null)} />}
      <AskHost />
      {signedIn && <E2eeGate />}
      <UploadDestHost />
    </div>
  );
}

// the DM side panel's card expands into the large profile too
function BigFromEvent() {
  const { openBig, ui } = useProfiles();
  const ref = useRef(openBig);
  ref.current = openBig;
  useEffect(() => {
    const on = e => ref.current(e.detail.username, e.detail.rect);
    addEventListener('vc-open-big', on);
    return () => removeEventListener('vc-open-big', on);
  }, []);
  return ui;
}
