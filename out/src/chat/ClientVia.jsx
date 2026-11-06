// Which client someone is using. Velora only sends this to people with the Manage users permission:
// `via` on a message, and `sessions` / `last_online` / `notifications_only` on a presence (people also get `sessions` for themselves). Ember servers send `via` the same way.
// The name and verified badge come from Velora's official clients list (officialClients.js); anything not on it shows
// its domain (or token name) with no badge.
import { useEffect, useState } from 'react';
import { BadgeCheck, Plug, Globe, Monitor, Smartphone } from 'lucide-react';
import { viaTitle, sessionShort, sessionDetails, sessionKind, sessionIsIdle, STATE_SHORT } from './clientViaText.js';
import { describeVia, officialClients, loadOfficialClients, onOfficialClients } from './officialClients.js';

// the official clients list (null until it's known), re-rendering when it arrives
export function useOfficialClients() {
  const [list, setList] = useState(officialClients);
  useEffect(() => {
    const off = onOfficialClients(setList);
    loadOfficialClients().then(setList).catch(() => {});
    return off;
  }, []);
  return list;
}

// the chip: [icon] name [verified badge]. Unknown clients: a globe (or plug for a token) + their domain / token name
const KIND_ICON = { mobile: Smartphone, desktop: Monitor, browser: Globe };
function Chip({ via, list, tip, Icon }) {
  const d = describeVia(via, list);
  const tipData = tip ? JSON.stringify({ name: d.name, domain: d.domain, verified: d.verified, known: d.known, text: viaTitle(via, list) }) : undefined;
  return (
    <span className={`vc-via${d.verified ? ' official' : ''}`} data-tip-via={tipData} aria-label={viaTitle(via, list)}>
      {d.icon ? <img className="vc-via-icon" src={d.icon} alt="" /> : Icon ? <Icon size={13} aria-hidden="true" /> : !d.verified && (via.token ? <Plug size={12} /> : <Globe size={12} />)}
      <span className="vc-via-name">{d.name}</span>
      {d.verified && <BadgeCheck size={12} className="vc-via-check" aria-hidden="true" />}
    </span>
  );
}

// the small tag next to a message's author
export function ViaBadge({ via }) {
  const list = useOfficialClients();
  if (!via) return null;
  return <Chip via={via} list={list} tip />;
}
// the hover card (Tooltip.jsx, data-tip-via): "Sent from <name>", the domain in small text
export function ViaTip({ t }) {
  if (!t) return null;
  return (
    <div className="vc-tip-via">
      <span>{t.known ? <>Sent from <b>{t.name}</b></> : t.text}{t.verified && <BadgeCheck size={12} className="vc-via-check" aria-label="Verified client" />}</span>
      {t.domain && t.known && <small>{t.domain}</small>}
      <small className="vc-tip-via-note">Only people with Manage users see this</small>
    </div>
  );
}
// "just now", "5 minutes ago", "4 hours ago", "5 days ago" ... for a timestamp in the past
function agoText(at) {
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [u, n] = units.find(([, n]) => sec >= n);
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-Math.floor(sec / n), u);
}
// the "Last online" row: "Online now", or how long ago with the full date on hover
function LastOnlineRow({ online, at }) {
  if (online) return <div className="pe-fact vc-manage-fact"><b>Last online</b><span>Online now</span></div>;
  if (!(at > 0)) return null;
  return <div className="pe-fact vc-manage-fact"><b>Last online</b><span title={new Date(at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })}>{agoText(at)}</span></div>;
}
// an instance's members (their member row carries last_online + online; presence is Velora's)
export function LastOnlineFact({ member }) {
  if (!member) return null;
  return <LastOnlineRow online={!!member.online} at={Number(member.last_online) || 0} />;
}
// the "Client" and "Last online" rows of a mini profile
export function ManageFacts({ presence }) {
  const list = useOfficialClients();
  if (!presence || (presence.sessions === undefined && presence.last_online === undefined && presence.last_login === undefined)) return null;
  const sessions = presence.sessions || [];
  const online = presence.status !== 'offline';
  const at = presence.last_online ? Number(presence.last_online) : 0;
  return (
    <>
      {sessions.length > 0 && (
        <div className="pe-fact vc-manage-fact">
          <b>{sessions.length > 1 ? 'Clients' : 'Client'}</b>
          {sessions.map((s, i) => (
            <span key={i} className={`vc-via-row${sessionIsIdle(s) ? ' idle' : ''}`} title={sessionDetails(s) || undefined}>
              {s.via ? <Chip via={s.via} list={list} Icon={KIND_ICON[sessionKind(s)]} /> : <span className="vc-via"><Globe size={13} /><span className="vc-via-name">Unknown client</span></span>}
              {sessionIsIdle(s) ? <small>{STATE_SHORT[s.state]}</small> : sessionShort(s) && <small>{sessionShort(s)}</small>}
            </span>
          ))}
        </div>
      )}
      {sessions.length === 0 && presence.status === 'offline' && <div className="pe-fact vc-manage-fact"><b>Client</b><span>Not connected</span></div>}
      <LastOnlineRow online={online} at={at} />
    </>
  );
}
