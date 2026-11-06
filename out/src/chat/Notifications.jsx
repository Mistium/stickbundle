import { siteHref } from './hosts.js';
// The bell next to your name (bottom left): Velora's account notifications, which replaced the DMs from "System".
// The badge is notifUnread (loaded at start, kept live by the home socket). The popup lists only UNREAD ones, newest first;
// clicking one marks it read and follows its link. Everything else (history, settings) lives on the site under /me.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Settings, Megaphone, ShieldAlert, Coins, UserPlus, ShoppingBag, Gem, Award, Server, LifeBuoy, UserCheck, MessageCircle, Gift, Info, Star, Heart, CheckCheck } from 'lucide-react';
import { useChat, getState, loadNotifs, closeNotifs, readNotifs, followNotifLink } from './store.js';

// the category icon names Velora sends (lucide names) -> the components; anything else is a bell
const ICONS = {
  megaphone: Megaphone, 'shield-alert': ShieldAlert, coins: Coins, 'user-plus': UserPlus, 'shopping-bag': ShoppingBag, gem: Gem, award: Award,
  server: Server, 'life-buoy': LifeBuoy, 'user-check': UserCheck, 'message-circle': MessageCircle, gift: Gift, info: Info, star: Star, heart: Heart, bell: Bell,
};

// title / body are plain text with **bold** only: split on the pairs and build text + <b> (never HTML).
// An unclosed ** at the end stays as typed.
export function NotifText({ text }) {
  const parts = String(text || '').split('**');
  const open = parts.length % 2 === 0; // even count = the last ** has no partner
  return parts.map((p, i) => <Fragment key={i}>{i % 2 === 0 ? p : open && i === parts.length - 1 ? `**${p}` : <b>{p}</b>}</Fragment>);
}

function ago(t) {
  const at = new Date(t).getTime();
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function NotifIcon({ n }) {
  const [bad, setBad] = useState(false);
  const Icon = ICONS[n.icon] || Bell;
  if (n.actor?.pfp_url && !bad) return <span className="vc-notif-av"><img src={n.actor.pfp_url} alt="" loading="lazy" onError={() => setBad(true)} /></span>;
  return <span className="vc-notif-av ico"><Icon size={17} /></span>;
}

export function NotificationBell() {
  const unread = useChat(s => s.notifUnread);
  const [anchor, setAnchor] = useState(null); // the button's rect while the popup is open
  const btn = useRef(null);
  const toggle = () => setAnchor(a => (a ? null : btn.current.getBoundingClientRect()));
  return (
    <>
      <button type="button" ref={btn} className={`vc-ico-btn vc-bell${anchor ? ' on' : ''}`} aria-expanded={!!anchor} onClick={toggle} title={unread ? `Notifications (${unread} unread)` : 'Notifications'}>
        <Bell size={17} />
        {unread > 0 && <span className="vc-bell-n">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {anchor && <NotifPopup anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

function NotifPopup({ anchor, onClose }) {
  const data = useChat(s => s.notifs);
  const unread = useChat(s => s.notifUnread);
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => { loadNotifs(); return () => closeNotifs(); }, []);
  // above the button, kept on screen (the phone layout gets nearly the full width)
  useLayoutEffect(() => {
    const place = () => {
      const w = Math.min(360, innerWidth - 16);
      setPos({ left: Math.max(8, Math.min(anchor.left - 8, innerWidth - w - 8)), bottom: Math.max(8, innerHeight - anchor.top + 8), width: w, maxHeight: Math.max(220, anchor.top - 16) });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !getState().ask) onClose(); };
    const onDown = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('.vc-bell')) onClose(); };
    addEventListener('keydown', onKey);
    const t = setTimeout(() => addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); removeEventListener('keydown', onKey); removeEventListener('mousedown', onDown); };
  }, [onClose]);
  const list = data?.list || [];
  const pick = n => {
    readNotifs([n.id]);
    if (n.link) { onClose(); followNotifLink(n.link); }
  };
  return createPortal(
    <div ref={box} className="vc-notifs" style={pos || { left: -9999, bottom: 0 }} role="dialog" aria-label="Notifications">
      <div className="vc-notifs-head">
        <b>Notifications</b>
        <span className="grow" />
        <button type="button" className="vc-notifs-all" disabled={!unread && !list.length} onClick={() => readNotifs('all')}><CheckCheck size={14} /> Mark all read</button>
        <a className="vc-ico-btn" href={siteHref("/me#settings/notifications")} target="_blank" rel="noopener noreferrer" title="Notification settings" onClick={onClose}><Settings size={16} /></a>
      </div>
      <div className="vc-notifs-list">
        {list.map(n => (
          <button type="button" key={n.id} className="vc-notif" onClick={() => pick(n)}>
            <NotifIcon n={n} />
            <span className="vc-notif-txt">
              <span className="vc-notif-top"><b><NotifText text={n.title} /></b><small>{ago(n.created_at)}</small></span>
              {n.body && <span className="vc-notif-body"><NotifText text={n.body} /></span>}
            </span>
          </button>
        ))}
        {!list.length && !data?.loading && !data?.error && <div className="vc-notifs-empty"><CheckCheck size={22} /><span>You're all caught up</span></div>}
        {data?.error && <div className="vc-notifs-empty"><span>Couldn't load notifications.</span><button type="button" className="btn btn-surface btn-sm" onClick={() => loadNotifs()}>Try again</button></div>}
        {data?.loading && <div className="vc-notifs-empty"><span>Loading...</span></div>}
        {!data?.loading && data?.cursor && list.length > 0 && <button type="button" className="vc-notifs-more" onClick={() => loadNotifs({ more: true })}>Load more</button>}
      </div>
      <a className="vc-notifs-foot" href={siteHref("/me#notifications")} target="_blank" rel="noopener noreferrer" onClick={onClose}>View all</a>
    </div>,
    document.body,
  );
}
