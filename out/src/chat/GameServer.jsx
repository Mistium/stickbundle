// Ember Link: "Game server" channels (type `game`) - Minecraft servers linked to an Ember server.
// Setup wizard (game -> which server -> purpose), the global "Searching for servers..." list, claim codes,
// the live join-info card, the console (log + commands with who ran them), the synced-chat strip,
// Server settings > Game servers (unlink + audit log) and the compact join/leave/death lines in chat.
// Live data comes in as window 'vc-game' events (store.js), never through zustand, so big logs stay out of state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { viaProxy } from './mediaProxy.js';
import {
  Gamepad2, Server, Terminal, Users, Copy, Download, ExternalLink, Unlink, Radar, Search, Info, Check, X, Clock,
  ChevronRight, Network, LogIn, LogOut, Skull, Award, ArrowRightLeft, Power, Pickaxe, ArrowLeft, ScrollText, ArrowDown, TriangleAlert,
} from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, toast, errorText, ask, refreshServer, getState } from './store.js';
import { Dialog } from './Dialogs.jsx';
import { has, P } from './roles.jsx';
import { Avatar } from './Profile.jsx';
import { stampOf } from './text.jsx';
import { instOf, instOpt, isInst } from './ids.js';
import { usePlan, PlanGate } from './PlanGate.jsx';

// ── small helpers ────────────────────────────────────────────────────────────
export const GAME_ERRORS = {
  instance_not_linked: "That Minecraft server isn't linked to this Ember server.", already_linked: 'That Minecraft server is already linked.',
  too_many_instances: 'An Ember server can link up to 10 Minecraft servers.', console_needs_bonfire: 'Commands can only be run from Ember itself.',
  not_a_console: "This isn't a console channel.", claim_not_found: 'That code is gone - get a new one.', empty_command: 'Type a command first.',
  bad_purpose: 'Pick what the channel is for.', not_linked: "That server isn't linked any more.", not_a_game_channel: "That isn't a game server channel.",
};
const errText = code => GAME_ERRORS[code] || errorText(code);
const PLATFORM_LABEL = { paper: 'Paper', spigot: 'Spigot', fabric: 'Fabric', velocity: 'Velocity', forge: 'Forge' };
const PURPOSE_LABEL = { info: 'Join info', console: 'Console', chat: 'Synced chat' };
const PURPOSE_ICON = { info: Info, console: Terminal, chat: Gamepad2 };
const head = (p, size) => viaProxy(`https://mc-heads.net/avatar/${p.uuid && !/^00000000-0000-0000-/.test(p.uuid) ? p.uuid : encodeURIComponent(String(p.name || 'MHF_Steve').replace(/^\./, ''))}/${size}`);
function ago(t) {
  if (!t) return 'a while ago';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function uptime(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s % 60}s` : `${m}m ${s % 60}s`;
}
const copyText = (t, what = 'Copied') => navigator.clipboard?.writeText(String(t)).then(() => toast(`${what} to your clipboard.`, true), () => toast("Couldn't copy that."));
// window 'vc-game' events (game_status / game_console / game_linked / game_unlinked)
function useGameEvent(fn, deps) {
  useEffect(() => {
    const h = e => fn(e.detail);
    addEventListener('vc-game', h);
    return () => removeEventListener('vc-game', h);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
const hasPerm = (sid, bit) => has(getState().detail[sid]?.server.perms, bit);
const useCanServer = sid => useChat(s => has(s.detail[sid]?.server.perms, P.MANAGE_SERVER));

// MOTD / segments as text (never HTML): colours, bold, italic, underline, strike
export function Segs({ segs, className = '' }) {
  return (
    <span className={`vc-game-segs ${className}`}>
      {(segs || []).map((s, i) => (
        <span key={i} style={{ color: s.color || undefined, fontWeight: s.b ? 700 : undefined, fontStyle: s.i ? 'italic' : undefined, textDecoration: [s.u && 'underline', s.s && 'line-through'].filter(Boolean).join(' ') || undefined }}>
          {String(s.text || '').split('\n').map((t, j) => <span key={j}>{j > 0 && <br />}{t}</span>)}
        </span>
      ))}
    </span>
  );
}
// server icon (64 px, pixelated) or a drawn default "pack" icon
export function GameIcon({ src, size = 64 }) {
  const [bad, setBad] = useState(false);
  if (src && !bad) return <img className="vc-game-icon" src={src} alt="" width={size} height={size} onError={() => setBad(true)} />;
  return (
    <svg className="vc-game-icon def" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" fill="#3b3b42" /><rect width="16" height="5" fill="#62b47a" /><rect y="5" width="16" height="1" fill="#4c8f60" />
      <rect x="3" y="8" width="2" height="2" fill="#55555e" /><rect x="10" y="11" width="2" height="2" fill="#55555e" /><rect x="7" y="7" width="1" height="1" fill="#55555e" />
    </svg>
  );
}
const Dot = ({ on }) => <i className={`vc-game-dot${on ? ' on' : ''}`} />;
function PlatformBadge({ p }) { return p ? <span className="vc-game-badge">{PLATFORM_LABEL[p] || p}</span> : null; }

// ── shared status cache: the card, the chat strip and the console all read the same thing ──
const statusCache = new Map(); // cid -> { data, at, subs: Set, loading }
function useGameStatus(cid) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!cid) return undefined;
    if (!statusCache.has(cid)) statusCache.set(cid, { data: null, at: 0, subs: new Set() });
    const e = statusCache.get(cid);
    const f = () => bump(x => x + 1);
    e.subs.add(f);
    if (!e.loading && Date.now() - e.at > 5000) {
      e.loading = true;
      apiFetch(`/chat/game/channels/${cid}/status`).then(d => { e.data = { ...d, recv: Date.now() }; e.at = Date.now(); }).catch(() => {}).finally(() => { e.loading = false; e.subs.forEach(s => s()); });
    }
    return () => e.subs.delete(f);
  }, [cid]);
  return cid ? statusCache.get(cid)?.data || null : null;
}
addEventListener('vc-game', e => {
  const m = e.detail;
  if (m.type === 'game_status' && m.channel && statusCache.has(m.channel)) {
    const c = statusCache.get(m.channel);
    c.data = { ...(c.data || {}), status: m.status, online: m.online, last_seen: m.last_seen, connected: m.online ? true : c.data?.connected, recv: Date.now() };
    c.at = Date.now();
    c.subs.forEach(s => s());
  }
  if (m.type === 'game_linked' || m.type === 'game_unlinked') for (const c of statusCache.values()) c.at = 0;
});

// ── the channel itself ──────────────────────────────────────────────────────
export function GameChannel({ channel, sid }) {
  const cfg = channel.config || {};
  if (!cfg.setup) return <GameSetup channel={channel} sid={sid} />;
  if (cfg.purpose === 'console') return <ConsoleView channel={channel} sid={sid} />;
  return <JoinInfoCard channel={channel} sid={sid} />;
}

async function saveConfig(channel, sid, patch) {
  const config = { ...(channel.config || {}), game: 'minecraft', ...patch };
  delete config.setup; delete config.instance_name; delete config.platform;
  const d = await apiFetch(`/chat/channels/${channel.cid}`, { method: 'PATCH', body: JSON.stringify({ config }) });
  await refreshServer(sid);
  return d.channel;
}

// ── setup wizard (only admins see a channel that isn't set up) ──────────────
function GameSetup({ channel, sid }) {
  const cfg = channel.config || {};
  const inst = instOpt(sid); // an instance: its own game gateway, servers connect with `bonfire server <its address>`
  const canServer = useCanServer(sid);
  const [linked, setLinked] = useState(null);
  const [claim, setClaim] = useState(null); // { hint } while the claim dialog is open
  const [downloads, setDownloads] = useState(null);
  const loadLinked = () => apiFetch(`/chat/game/servers/${sid}/instances`).then(d => setLinked(d.instances)).catch(() => setLinked([]));
  // the plugin builds are Velora's (public), for instances too: an instance doesn't host them
  useEffect(() => { loadLinked(); fetch('/chat/game/downloads').then(r => r.json()).then(setDownloads).catch(() => setDownloads({ files: {} })); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useGameEvent(m => { if ((m.type === 'game_linked' || m.type === 'game_unlinked') && m.server === sid) loadLinked(); }, [sid]);
  const step = !cfg.instance ? 2 : 3;
  // an instance links a connected server straight away (only servers connected to it are listed)
  async function linkConnected(x) {
    try { await apiFetch(`/chat/game/connected/${encodeURIComponent(x.iid)}/link`, { inst, method: 'POST', body: JSON.stringify({ sid, cid: channel.cid }) }); toast('Linked.', true); await refreshServer(sid); loadLinked(); }
    catch (e) { toast(errText(e.message)); }
  }
  return (
    <div className="vc-shop vc-game-setup">
      <div className="vc-shop-head vc-game-head">
        <Gamepad2 size={28} />
        <div><h2>#{channel.name}</h2><p>Set up this game server channel. Only people who manage the server can see it until it's ready.</p></div>
      </div>
      <ol className="vc-game-steps">
        {['Game', 'Server', 'Purpose'].map((t, i) => <li key={t} className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}><b>{step > i + 1 ? <Check size={13} /> : i + 1}</b>{t}</li>)}
      </ol>
      <section className="vc-game-step vl-rise">
        <label className="vc-field"><span>Game</span>
          <select className="form-input" value={cfg.game || 'minecraft'} onChange={() => {}}><option value="minecraft">Minecraft</option></select>
        </label>
      </section>
      {step === 2 && (
        <>
          {linked?.length > 0 && (
            <section className="vc-game-step vl-rise" style={{ '--i': 1 }}>
              <h3>Already linked to this Ember server</h3>
              <div className="vc-game-cards">
                {linked.map(x => (
                  <button type="button" key={x.iid} className="vc-game-card-btn" onClick={() => saveConfig(channel, sid, { instance: x.iid }).catch(e => toast(errText(e.message)))}>
                    <GameIcon src={x.icon} size={40} />
                    <span className="vc-game-card-text"><b>{x.name}</b><small><Dot on={x.online} /> {x.online ? 'Online' : `Last seen ${ago(x.last_seen)}`} <PlatformBadge p={x.platform} /></small></span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {linked === null && <div className="vc-loading"><i /><i /><i /></div>}
          <section className="vc-game-step vl-rise" style={{ '--i': 2 }}>
            <h3>Link a new server</h3>
            {!canServer ? <p className="vc-empty-note">Ask someone with Manage server to link one.</p> : (
              <>
                {inst ? <>
                  <div className="vc-game-explain"><Info size={16} /><span>Ember Link is a plugin/mod for your Minecraft server. It connects out to this Ember server, so you don't need to open any ports. <b>1.</b> Install it and start the server. <b>2.</b> Run this in the server console. <b>3.</b> Pick it from the list below.</span></div>
                  <div className="vc-game-cmd"><code>bonfire server {inst}</code><button type="button" className="btn btn-surface" onClick={() => copyText(`bonfire server ${inst}`, 'Command copied')}><Copy size={14} /> Copy</button></div>
                </> : <div className="vc-game-explain"><Info size={16} /><span>Ember Link is a plugin/mod for your Minecraft server. It connects out to Ember, so you don't need to open any ports. Install it, start the server, and it shows up below.</span></div>}
                <Downloads d={downloads} />
                <SearchingList sid={sid} onPick={x => (inst ? linkConnected(x) : setClaim({ hint: x }))} />
                <button type="button" className="vc-game-textbtn" onClick={() => setClaim({ hint: null })}>{inst ? 'Link with a code instead' : 'Link without the list'}</button>
              </>
            )}
          </section>
        </>
      )}
      {step === 3 && (
        <section className="vc-game-step vl-rise">
          <PurposeSetup channel={channel} sid={sid} />
        </section>
      )}
      {claim && <ClaimDialog sid={sid} cid={channel.cid} hint={claim.hint} onClose={() => setClaim(null)} />}
    </div>
  );
}

function Downloads({ d }) {
  if (!d) return <div className="vc-loading"><i /><i /><i /></div>;
  const order = [['paper', 'Download for Paper / Spigot'], ['fabric', 'Download for Fabric 26.2'], ['velocity', 'Download for Velocity']];
  const size = n => (n ? ` (${n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`})` : '');
  return (
    <div className="vc-game-dl">
      <div className="vc-game-dl-row">
        {order.map(([k, label]) => {
          const f = d.files?.[k];
          return f?.url ? <a key={k} className="btn btn-surface" href={f.url} download title={f.label}><Download size={14} /> {label}{size(f.size)}</a>
            : <button key={k} type="button" className="btn btn-surface" disabled title="Not released yet"><Download size={14} /> {label} <small className="vc-chip">soon</small></button>;
        })}
        {d.modrinth_url ? <a className="btn btn-surface" href={d.modrinth_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Modrinth</a>
          : <button type="button" className="btn btn-surface" disabled><ExternalLink size={14} /> Modrinth <small className="vc-chip">Coming soon</small></button>}
      </div>
      <small className="vc-field-hint">Behind a Velocity proxy? Put it on the proxy <i>and</i> on each backend. Only the proxy connects to Ember.</small>
    </div>
  );
}

// "Searching for servers..." - every unclaimed server online right now (polls the page every 4 s)
function SearchingList({ sid, onPick }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [deb, setDeb] = useState({ q: '', tag: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { const t = setTimeout(() => { setDeb({ q: q.trim(), tag: tag.trim() }); setPage(1); }, 300); return () => clearTimeout(t); }, [q, tag]);
  useEffect(() => {
    let dead = false;
    const load = () => apiFetch(`/chat/game/unclaimed?sid=${sid}&page=${page}${deb.q ? `&q=${encodeURIComponent(deb.q)}` : ''}${deb.tag ? `&tag=${encodeURIComponent(deb.tag)}` : ''}`)
      .then(x => { if (!dead) { setD(x); setErr(''); } }).catch(e => { if (!dead) setErr(e.message); });
    load();
    const t = setInterval(load, 4000);
    return () => { dead = true; clearInterval(t); };
  }, [sid, page, deb]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="vc-game-search">
      <h3 className="vc-game-searching"><span className="vc-game-radar" aria-hidden="true"><Radar size={18} /></span> {isInst(sid) ? 'Connected game servers' : 'Searching for servers...'}</h3>
      <div className="vc-game-filters">
        <div className="vc-input-ico"><Search size={15} /><input className="form-input" maxLength={60} placeholder="Search MOTD or version" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="vc-input-ico vc-game-tagbox"><span className="vc-game-hash">#</span><input className="form-input" maxLength={8} placeholder="Pairing tag, e.g. K7Q-2M9" value={tag} onChange={e => setTag(e.target.value.toUpperCase())} /></div>
      </div>
      <small className="vc-field-hint">Your server prints its pairing tag in the console on startup.</small>
      {err === 'rate_limited' && <p className="vc-empty-note">Slow down a little - the list refreshes by itself.</p>}
      {!d && !err && <div className="vc-loading"><i /><i /><i /></div>}
      {d && !d.instances.length && <p className="vc-empty-note">{deb.tag ? 'No server with that pairing tag is online right now.' : isInst(sid) ? 'Nothing yet. Run the command above in your server console - it shows up here within a few seconds.' : 'Nothing yet. Start your server with Ember Link installed. It should show up within a few seconds.'}</p>}
      {d && d.instances.length > 0 && (
        <div className="vc-game-list">
          {d.instances.map((x, i) => (
            <button type="button" key={x.iid} className="vc-game-found vl-rise" style={{ '--i': Math.min(i, 10) }} onClick={() => onPick(x)}>
              <GameIcon src={x.icon} size={64} />
              <span className="vc-game-found-main">
                <Segs segs={x.motd} className="motd" />
                <span className="vc-game-meta"><PlatformBadge p={x.platform} /><span>{x.mc_version}</span><span><Users size={12} /> {x.players.online}/{x.players.max}</span><code className="vc-game-tag-code">{x.pairing_tag}</code><span className="vc-game-ago">connected {ago(x.connected_at)}</span></span>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
      {d && d.pages > 1 && (
        <div className="vc-game-pager">
          <button type="button" className="btn btn-surface" disabled={d.page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {d.page} of {d.pages}</span>
          <button type="button" className="btn btn-surface" disabled={d.page >= d.pages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
      <small className="vc-field-hint vc-game-warn-note">{isInst(sid) ? 'Anyone can connect a server here - check the pairing tag in your console before you pick one.' : 'Anyone can list a server here. Only the server whose console runs your code gets linked.'}</small>
    </div>
  );
}

// the claim code: run `bonfire link XXXX-XXXX` in the server console
export function ClaimDialog({ sid, cid, hint, onClose }) {
  const [c, setC] = useState(null);
  const [state, setState] = useState('loading'); // loading | pending | linked | expired | error
  const [linked, setLinked] = useState(null);
  const [errCode, setErrCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const make = () => {
    setState('loading');
    apiFetch('/chat/game/claims', { method: 'POST', inst: instOpt(sid), body: JSON.stringify({ sid, cid: cid || undefined, hint: hint?.iid || undefined }) })
      .then(x => { setC(x); setState('pending'); }).catch(e => { setErrCode(e.message); setState('error'); });
  };
  useEffect(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (state === 'pending' && c && now > c.expires_at) setState('expired'); }, [now, state, c]);
  useGameEvent(m => { if (m.type === 'game_linked' && c && m.claim === c.code) { setLinked(m.instance); setState('linked'); } }, [c]);
  useEffect(() => {
    if (state !== 'pending' || !c) return undefined;
    const t = setInterval(() => apiFetch(`/chat/game/claims/${c.code}`, { inst: instOpt(sid) }).then(x => { if (x.state === 'linked') { setLinked(x.instance); setState('linked'); } else if (x.state === 'expired') setState('expired'); }).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [state, c]);
  useEffect(() => { if (state === 'linked') refreshServer(sid); }, [state, sid]);
  const left = c ? Math.max(0, Math.round((c.expires_at - now) / 1000)) : 0;
  return (
    <Dialog title="Link a Minecraft server" onClose={onClose} className="vc-game-claim">
      {close => (
        <>
          {hint && (
            <div className="vc-game-claim-hint"><GameIcon src={hint.icon} size={40} /><span><Segs segs={hint.motd} className="motd" /><small><PlatformBadge p={hint.platform} /> {hint.mc_version} <code className="vc-game-tag-code">{hint.pairing_tag}</code></small></span></div>
          )}
          {state === 'loading' && <div className="vc-loading"><i /><i /><i /></div>}
          {state === 'error' && <p className="vc-game-err"><X size={15} /> {errText(errCode)}</p>}
          {state === 'pending' && c && (
            <>
              <p>Run this in your server's <b>console</b> (not in game chat):</p>
              <div className="vc-game-cmd"><code>{c.command}</code><button type="button" className="btn btn-primary" onClick={() => copyText(c.command, 'Command copied')}><Copy size={14} /> Copy</button></div>
              <small className="vc-field-hint">Run this in the server console (or RCON). It won't work from in-game chat.</small>
              <div className="vc-game-wait"><span className="vc-game-spin" aria-hidden="true" /> Waiting for the server... <span className="grow" /><Clock size={13} /> Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
            </>
          )}
          {state === 'expired' && (
            <div className="vc-game-done bad"><Clock size={22} /><b>Code expired</b><button type="button" className="btn btn-primary" onClick={make}>Get a new code</button></div>
          )}
          {state === 'linked' && (
            <div className="vc-game-done"><Check size={26} /><b>Linked {linked?.name || 'the server'}</b>
              {hint && linked && hint.iid !== linked.iid && <small>Linked {linked.name}, which is the server whose console ran the code.</small>}
              <button type="button" className="btn btn-primary" onClick={close}>Continue</button></div>
          )}
          {state !== 'linked' && <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Close</button></div>}
        </>
      )}
    </Dialog>
  );
}

// ── step 3 + the channel editor: what the channel is for ────────────────────
function PurposeFields({ cfg, set, sid, instance }) {
  const ev = cfg.events || {};
  const toggle = (k, label) => (
    <div className="vc-toggle-row" key={k}>
      <span><b>{label}</b></span>
      <button type="button" role="switch" aria-checked={ev[k] !== false} className={`cs-switch${ev[k] !== false ? ' on' : ''}`} onClick={() => set({ ...cfg, events: { ...ev, [k]: ev[k] === false } })}><i /></button>
    </div>
  );
  const canServer = hasPerm(sid, P.MANAGE_SERVER);
  return (
    <>
      <label className="vc-field"><span>What is this channel for?</span>
        <select className="form-input" value={cfg.purpose || ''} onChange={e => set({ ...cfg, purpose: e.target.value || null })}>
          <option value="">Pick one...</option>
          <option value="info">Join info - a live card with status, address and players</option>
          {(canServer || cfg.purpose === 'console') && <option value="console">Console - the server log, plus running commands</option>}
          <option value="chat">Synced chat - chat goes both ways with Minecraft</option>
        </select>
      </label>
      {cfg.purpose === 'info' && (
        <>
          <label className="vc-field"><span>Address</span>
            <input className="form-input" maxLength={120} placeholder={instance?.public_address || 'play.example.net'} value={cfg.address || ''} onChange={e => set({ ...cfg, address: e.target.value })} />
            <small className="vc-field-hint">Where players connect. Empty = what the server's Ember Link config says.</small></label>
          <div className="vc-toggle-row"><span><b>Show the player list</b><small>Heads and names of who's online.</small></span>
            <button type="button" role="switch" aria-checked={cfg.show_players !== false} className={`cs-switch${cfg.show_players !== false ? ' on' : ''}`} onClick={() => set({ ...cfg, show_players: cfg.show_players === false })}><i /></button></div>
        </>
      )}
      {cfg.purpose === 'chat' && (
        <div className="vc-game-toggles">
          {toggle('join', 'Joins')}{toggle('leave', 'Leaves')}{toggle('death', 'Deaths')}{toggle('advancement', 'Advancements')}{toggle('switch', 'Server switches')}{toggle('server', 'Server start / stop')}
          <div className="vc-toggle-row"><span><b>Show which server (proxy)</b><small>A small tag with the backend name, like survival.</small></span>
            <button type="button" role="switch" aria-checked={cfg.show_server_tag !== false} className={`cs-switch${cfg.show_server_tag !== false ? ' on' : ''}`} onClick={() => set({ ...cfg, show_server_tag: cfg.show_server_tag === false })}><i /></button></div>
        </div>
      )}
      {cfg.purpose === 'console' && (
        <div className="vc-game-explain warn"><TriangleAlert size={16} /><span>Anyone with Manage server can run any console command. Every command shows in this channel with who ran it. Ember Link's config can turn command running off.</span></div>
      )}
    </>
  );
}
function PurposeSetup({ channel, sid }) {
  const [cfg, setCfg] = useState(() => ({ ...(channel.config || {}) }));
  const [busy, setBusy] = useState(false);
  const [inst, setInst] = useState(null);
  useEffect(() => { apiFetch(`/chat/game/servers/${sid}/instances`).then(d => setInst(d.instances.find(x => x.iid === channel.config?.instance) || null)).catch(() => {}); }, [sid, channel.config?.instance]);
  async function save() {
    setBusy(true);
    try { await saveConfig(channel, sid, cfg); toast(`#${channel.name} is ready`, true); } catch (e) { toast(errText(e.message)); }
    setBusy(false);
  }
  return (
    <>
      <div className="vc-game-chosen">
        <GameIcon src={inst?.icon} size={40} />
        <span className="vc-game-card-text"><b>{inst?.name || channel.config?.instance_name || 'Minecraft server'}</b><small><Dot on={inst?.online} /> {inst ? (inst.online ? 'Online' : `Last seen ${ago(inst.last_seen)}`) : ''} <PlatformBadge p={inst?.platform || channel.config?.platform} /></small></span>
        <span className="grow" />
        <button type="button" className="btn btn-surface" onClick={() => saveConfig(channel, sid, { instance: null, purpose: null }).catch(e => toast(errText(e.message)))}><ArrowLeft size={14} /> Pick another server</button>
      </div>
      <PurposeFields cfg={cfg} set={setCfg} sid={sid} instance={inst} />
      <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-primary" disabled={busy || !cfg.purpose} onClick={save}>Save</button></div>
    </>
  );
}
// the channel editor's part for type `game` (TypeSettings)
export function GameTypeSettings({ config, setConfig, sid, channel }) {
  const [linked, setLinked] = useState(null);
  useEffect(() => { if (channel?.cid) apiFetch(`/chat/game/servers/${sid}/instances`).then(d => setLinked(d.instances)).catch(() => setLinked([])); }, [sid, channel?.cid]);
  useEffect(() => { if (!config.game) setConfig({ ...config, game: 'minecraft' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!channel?.cid || channel.type !== 'game') return <p className="vc-dialog-sub">No extra settings needed - create the channel, then set it up inside it (pick the Minecraft server and what the channel is for).</p>;
  const inst = (linked || []).find(x => x.iid === config.instance);
  return (
    <>
      <label className="vc-field"><span>Game</span><select className="form-input" value="minecraft" onChange={() => {}}><option value="minecraft">Minecraft</option></select></label>
      <label className="vc-field"><span>Minecraft server</span>
        <select className="form-input" value={config.instance || ''} onChange={e => setConfig({ ...config, instance: e.target.value || null })}>
          <option value="">None (set it up in the channel)</option>
          {(linked || []).map(x => <option key={x.iid} value={x.iid}>{x.name} ({PLATFORM_LABEL[x.platform] || x.platform}, {x.pairing_tag})</option>)}
        </select>
        <small className="vc-field-hint">Link new servers from inside a game channel that isn't set up yet.</small></label>
      <PurposeFields cfg={config} set={setConfig} sid={sid} instance={inst} />
    </>
  );
}

// ── join info card ──────────────────────────────────────────────────────────
function useNow(ms = 1000) { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
function JoinInfoCard({ channel }) {
  const d = useGameStatus(channel.cid);
  const now = useNow();
  const cfg = channel.config || {};
  if (!d) return <div className="vc-shop"><div className="vc-loading"><i /><i /><i /></div></div>;
  const inst = d.instance || {};
  const st = d.status || {};
  const on = !!d.online;
  const players = st.players || { online: 0, max: 0 };
  const address = cfg.address || inst.public_address || '';
  const up = on && st.uptime_s != null ? st.uptime_s + (now - (d.recv || now)) / 1000 : null;
  const list = Array.isArray(players.list) ? players.list : null;
  const groups = list && st.backends ? st.backends.map(b => ({ name: b.name, list: list.filter(p => p.server === b.name) })).filter(g => g.list.length) : null;
  return (
    <div className="vc-shop vc-game-info">
      <div className={`vc-game-card vl-rise${on ? '' : ' off'}`}>
        <div className="vc-game-card-top">
          <GameIcon src={inst.icon} size={64} />
          <div className="vc-game-card-title">
            <Segs segs={st.motd?.length ? st.motd : inst.motd} className="motd" />
            <div className="vc-game-meta">
              <span className={`vc-game-pill${on ? ' on' : ''}`}><Dot on={on} /> {on ? 'Online' : `Offline - last seen ${ago(d.last_seen)}`}</span>
              <PlatformBadge p={inst.platform} />{(st.version || inst.mc_version) && <span>{st.version || inst.mc_version}</span>}
              {up != null && <span title="Uptime"><Clock size={12} /> {uptime(up)}</span>}
              {on && st.tps != null && <span title="Ticks per second">{Number(st.tps).toFixed(1)} TPS</span>}
            </div>
          </div>
        </div>
        <div className="vc-game-addr">
          <Server size={15} />{address ? <><code>{address}</code><button type="button" className="btn btn-surface" onClick={() => copyText(address, 'Address copied')}><Copy size={14} /> Copy</button></> : <span className="vc-game-muted">No address set</span>}
        </div>
        <div className="vc-game-players">
          <div className="vc-game-players-head"><Users size={15} /> <b>{on ? players.online : 0}</b> / {players.max || 0} players</div>
          <div className="vc-game-bar"><i style={{ width: `${players.max ? Math.min(100, ((on ? players.online : 0) / players.max) * 100) : 0}%` }} /></div>
          {on && cfg.show_players !== false && list && list.length > 0 && (groups && groups.length ? groups.map(g => (
            <div key={g.name} className="vc-game-group"><h4>{g.name}</h4><PlayerGrid list={g.list} /></div>
          )) : <PlayerGrid list={list} />)}
        </div>
        {st.backends?.length > 0 && (
          <div className="vc-game-backends">
            <h4>Servers</h4>
            {st.backends.map(b => (
              <div key={b.name} className="vc-game-backend"><Dot on={on && b.online} /><b>{b.name}</b><span className="grow" />{b.players && <span><Users size={12} /> {b.players.online}/{b.players.max}</span>}{b.version && <span className="vc-game-muted">{b.version}</span>}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function PlayerGrid({ list }) {
  return (
    <div className="vc-game-grid">
      {list.map(p => <span key={p.uuid || p.name} className="vc-game-player" title={p.name}><img src={head(p, 32)} alt="" width={32} height={32} loading="lazy" /><span>{p.display || p.name}</span></span>)}
    </div>
  );
}

// ── synced chat: the slim strip on top + the offline note above the composer ──
export function GameChatStrip({ channel }) {
  const d = useGameStatus(channel.cid);
  if (!d) return null;
  const st = d.status || {};
  const address = channel.config?.address || d.instance?.public_address || '';
  return (
    <div className="vc-game-strip">
      <Dot on={d.online} /><b>{d.instance?.name || channel.config?.instance_name || 'Minecraft server'}</b>
      <span className="vc-game-muted">{d.online ? `${st.players?.online ?? 0}/${st.players?.max ?? 0} online` : `offline - last seen ${ago(d.last_seen)}`}</span>
      <span className="grow" />
      {address && <button type="button" className="vc-game-addr-btn" title="Copy the address" onClick={() => copyText(address, 'Address copied')}><code>{address}</code><Copy size={13} /></button>}
    </div>
  );
}
export function GameOfflineNote({ channel }) {
  const d = useGameStatus(channel.cid);
  if (!d || d.online) return null;
  return <div className="vc-game-offline-note"><Info size={14} /> The Minecraft server is offline - messages won't show in game until it's back</div>;
}

// ── console ─────────────────────────────────────────────────────────────────
const MAX_LINES = 2000;
const hhmmss = t => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':'); };
const history = new Map(); // cid -> [commands] (memory only)
function ConsoleView({ channel, sid }) {
  const d = useGameStatus(channel.cid);
  const me = useChat(s => (isInst(sid) ? s.instances.find(i => i.origin === instOf(sid))?.user?.username : s.me?.username));
  const [lines, setLines] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [outputs, setOutputs] = useState({}); // seq -> { output, error } (only in this tab)
  const [text, setText] = useState('');
  const [hist, setHist] = useState(-1);
  const [stick, setStick] = useState(true);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const linesRef = useRef(null);
  const outputsRef = useRef({});
  linesRef.current = lines;
  outputsRef.current = outputs;
  const merge = (list, add) => {
    const m = new Map((list || []).map(l => [l.seq, l]));
    for (const l of add) m.set(l.seq, { ...(m.get(l.seq) || {}), ...l });
    const out = [...m.values()].sort((a, b) => a.seq - b.seq);
    return out.length > MAX_LINES ? out.slice(out.length - MAX_LINES) : out;
  };
  useEffect(() => {
    setLines(null);
    apiFetch(`/chat/game/channels/${channel.cid}/console`).then(x => { setLines(x.lines); setHasMore(x.has_more); }).catch(e => { toast(errText(e.message)); setLines([]); });
  }, [channel.cid]);
  useGameEvent(m => { if (m.type === 'game_console' && m.channel === channel.cid) setLines(l => merge(l, m.lines)); }, [channel.cid]);
  useEffect(() => { if (stick && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines, outputs, stick]);
  const onScroll = () => { const b = box.current; if (b) setStick(b.scrollHeight - b.scrollTop - b.clientHeight < 40); };
  async function older() {
    const first = lines?.[0];
    if (!first) return;
    const x = await apiFetch(`/chat/game/channels/${channel.cid}/console?before=${first.seq}`).catch(() => null);
    if (x) { setLines(l => merge(x.lines, l)); setHasMore(x.has_more); }
  }
  async function run(e) {
    e?.preventDefault();
    const command = text.trim().replace(/^\/+/, '');
    if (!command || busy) return;
    const h = history.get(channel.cid) || [];
    history.set(channel.cid, [...h.filter(x => x !== command), command].slice(-50));
    setHist(-1); setText(''); setBusy(true); setStick(true);
    const r = await apiFetch(`/chat/game/channels/${channel.cid}/console`, { method: 'POST', body: JSON.stringify({ command }) }).catch(er => ({ ok: false, error: er.message }));
    setBusy(false);
    // the output shows under my own command line (others just see the server's log)
    const mine = [...(linesRef.current || [])].reverse().find(x => x.kind === 'command' && x.source === 'bonfire' && x.by === me && x.command === command && !outputsRef.current[x.seq]);
    setOutputs(o => ({ ...o, [mine ? mine.seq : `local-${Date.now()}`]: mine ? r : { ...r, command } }));
  }
  function keys(e) {
    const h = history.get(channel.cid) || [];
    if (e.key === 'ArrowUp' && h.length) { e.preventDefault(); const i = hist < 0 ? h.length - 1 : Math.max(0, hist - 1); setHist(i); setText(h[i]); }
    if (e.key === 'ArrowDown' && hist >= 0) { e.preventDefault(); const i = hist + 1; if (i >= h.length) { setHist(-1); setText(''); } else { setHist(i); setText(h[i]); } }
  }
  const on = !!d?.online;
  const execOff = d?.features && d.features.console_exec === false;
  const consoleOff = d?.features && d.features.console === false;
  const people = getState().people;
  const loose = Object.entries(outputs).filter(([k]) => k.startsWith('local-'));
  return (
    <div className="vc-game-console-wrap">
      <div className="vc-game-con-head">
        <Dot on={on} /><Terminal size={16} /><b>{d?.instance?.name || channel.config?.instance_name || 'Server console'}</b>
        <span className="vc-game-muted">{on ? 'online' : `offline - last seen ${ago(d?.last_seen)}`}</span>
        <span className="grow" />
        <button type="button" className="btn btn-surface" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'settings', sid, tab: 'game' } }))}><ScrollText size={14} /> Audit log</button>
      </div>
      {(!on || consoleOff) && <div className="vc-game-banner"><TriangleAlert size={15} /> {!on ? 'The server is offline. New log lines and commands will work again once it reconnects.' : "This server's Ember Link config has the console turned off."}</div>}
      <div className="vc-game-console" ref={box} onScroll={onScroll}>
        {hasMore && <button type="button" className="vc-game-older" onClick={older}>Load older lines</button>}
        {lines === null && <div className="vc-loading"><i /><i /><i /></div>}
        {lines && !lines.length && <div className="vc-game-con-empty">No console output yet. New lines show up here live.</div>}
        {(lines || []).map(l => (l.kind === 'command' ? (
          <div key={l.seq} className={`vc-game-cl cmd src-${l.source}`}>
            <span className="t">{hhmmss(l.t)}</span>
            <ChevronRight size={13} className="chev" />
            <b className="c">{l.command}</b>
            <span className="who">{l.source === 'bonfire' ? <><Avatar user={{ username: l.by, pfp: l.pfp || people[l.by]?.pfp }} size={16} />{l.by}</> : l.source === 'rcon' ? <><Network size={12} />{l.by || 'RCON'}</> : <><Terminal size={12} />{l.by || 'CONSOLE'}</>}</span>
            {l.source === 'bonfire' && <span className={`st st-${l.status}`} title={l.status}>{l.status === 'sent' ? <span className="vc-game-spin sm" /> : l.status === 'ok' ? <Check size={13} /> : l.status === 'timeout' ? <Clock size={13} /> : <X size={13} />}</span>}
            {outputs[l.seq] && <Output r={outputs[l.seq]} />}
          </div>
        ) : (
          <div key={l.seq} className={`vc-game-cl lv-${String(l.level || 'INFO').toLowerCase()}`}><span className="t">{hhmmss(l.t)}</span><span className="lv">{l.level}</span><span className="m">{l.msg}</span></div>
        )))}
        {loose.map(([k, r]) => <div key={k} className="vc-game-cl cmd src-bonfire"><ChevronRight size={13} className="chev" /><b className="c">{r.command}</b><Output r={r} /></div>)}
      </div>
      {!stick && <button type="button" className="vc-game-jump" onClick={() => { setStick(true); if (box.current) box.current.scrollTop = box.current.scrollHeight; }}><ArrowDown size={14} /> Jump to latest</button>}
      {execOff ? <div className="vc-game-con-note"><Info size={14} /> Running commands is turned off in this server's Ember Link config.</div> : (
        <form className="vc-game-input" onSubmit={run}>
          <ChevronRight size={16} className="prompt" />
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={keys} maxLength={1000} placeholder={on ? 'Type a command (no / needed)' : 'The server is offline'} spellCheck={false} autoComplete="off" />
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
function Output({ r }) {
  if (!r.ok) {
    const msg = r.error === 'timeout' ? 'No answer after 10 s - the command may still have run' : r.error === 'console_disabled' ? "This server's Ember Link config doesn't allow running commands." : r.error === 'offline' ? 'The server is offline.' : errText(r.error);
    return <div className="vc-game-out err">{msg}{(r.output || []).map((x, i) => <div key={i}>{x}</div>)}</div>;
  }
  return <div className="vc-game-out">{(r.output || []).length ? r.output.map((x, i) => <div key={i}>{x}</div>) : <div className="vc-game-muted">(no output)</div>}{r.truncated && <div className="vc-game-muted">... (more output was cut off)</div>}</div>;
}

// ── Server settings > Game servers ──────────────────────────────────────────
export function GameServersSettings({ sid }) {
  const [list, setList] = useState(null);
  const [audit, setAudit] = useState(null);
  const [more, setMore] = useState(false);
  const plan = usePlan('game');
  const load = () => plan.gate ? setList([]) : apiFetch(`/chat/game/servers/${sid}/instances`).then(d => setList(d.instances)).catch(e => { if (!plan.catchPlan(e)) toast(errText(e.message)); setList([]); });
  const loadAudit = before => plan.gate ? setAudit([]) : apiFetch(`/chat/game/servers/${sid}/audit${before ? `?before=${before}` : ''}`).then(d => { setAudit(a => (before ? [...(a || []), ...d.entries] : d.entries)); setMore(d.has_more); }).catch(() => setAudit([]));
  useEffect(() => { load(); loadAudit(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useGameEvent(m => { if ((m.type === 'game_linked' || m.type === 'game_unlinked') && m.server === sid) { load(); loadAudit(); } if (m.type === 'game_status') setList(l => l && l.map(x => (x.iid === m.instance ? { ...x, online: m.online, last_seen: m.last_seen || x.last_seen } : x))); }, [sid]);
  async function unlink(x) {
    if (!(await ask({ title: `Unlink ${x.name}?`, text: 'The channels using it go back to setup and only admins will see them.', confirm: 'Unlink', danger: true }))) return;
    try { await apiFetch(`/chat/game/servers/${sid}/instances/${x.iid}`, { method: 'DELETE' }); toast(`Unlinked ${x.name}.`, true); load(); loadAudit(); refreshServer(sid); } catch (e) { toast(errText(e.message)); }
  }
  return (
    <PlanGate block={plan.gate} title="Game servers (Ember Link)">
    <div className="vc-settings vc-game-settings">
      <p className="vc-dialog-sub">Minecraft servers linked with Ember Link. Link new ones from a "Game server" channel.</p>
      {list === null && <div className="vc-loading"><i /><i /><i /></div>}
      {list && !list.length && <p className="vc-empty-note">No Minecraft servers linked yet. Add a channel of type "Game server" to link one.</p>}
      {list?.map((x, i) => (
        <div key={x.iid} className="vc-game-linked vl-rise" style={{ '--i': i }}>
          <GameIcon src={x.icon} size={48} />
          <div className="vc-game-linked-main">
            <div className="vc-game-linked-name"><b>{x.name}</b><PlatformBadge p={x.platform} /></div>
            <small><Dot on={x.online} /> {x.online ? 'Online' : `Last seen ${ago(x.last_seen)}`} · {x.software || x.mc_version} · tag <code className="vc-game-tag-code">{x.pairing_tag}</code></small>
            <small>Linked by {x.linked_by || 'someone'}{x.linked_at ? ` on ${new Date(x.linked_at).toLocaleDateString()}` : ''}</small>
            <small>{x.channels?.length ? <>Used by {x.channels.map(c => `#${c.name}`).join(', ')}</> : 'Not used by any channel yet'}</small>
          </div>
          <button type="button" className="btn btn-danger" onClick={() => unlink(x)}><Unlink size={14} /> Unlink</button>
        </div>
      ))}
      <h3 className="vc-game-sec-title"><ScrollText size={15} /> Console audit log</h3>
      {audit === null && <div className="vc-loading"><i /><i /><i /></div>}
      {audit && !audit.length && <p className="vc-empty-note">Nothing yet. Links, unlinks and every console command show up here.</p>}
      {audit && audit.length > 0 && (
        <div className="vc-game-audit">
          {audit.map(a => (
            <div key={a.id} className={`vc-game-audit-row k-${a.kind}`}>
              <span className="when" title={new Date(a.created_at).toLocaleString()}>{stampOf(a.created_at)}</span>
              <span className="who">{a.user ? <><Avatar user={a.user} size={16} />{a.user.username}</> : /^\[RCON\]/.test(a.command || '') ? <><Network size={12} />RCON</> : <><Terminal size={12} />CONSOLE</>}</span>
              <span className="what">{a.kind === 'link' ? <>linked <b>{a.instance_name || a.instance}</b></> : a.kind === 'unlink' ? <>unlinked <b>{a.instance_name || a.instance}</b></> : <code>{String(a.command || '').replace(/^\[(CONSOLE|RCON)\] /, '')}</code>}</span>
              <span className={`st st-${a.status}`}>{a.status}</span>
              {a.output_preview && a.kind === 'command' && a.status !== 'local' && <span className="out">{a.output_preview}</span>}
            </div>
          ))}
          {more && <button type="button" className="btn btn-surface vc-game-older-btn" onClick={() => loadAudit(audit[audit.length - 1].id)}>Load older</button>}
        </div>
      )}
    </div>
    </PlanGate>
  );
}

// ── compact event rows in synced chat (sys_kind mc_*) ───────────────────────
const EVENT_ICON = { mc_join: LogIn, mc_leave: LogOut, mc_death: Skull, mc_adv: Award, mc_switch: ArrowRightLeft, mc_start: Power, mc_stop: Power };
export function GameEventLine({ m }) {
  const I = EVENT_ICON[m.sys_kind] || Pickaxe;
  const body = useMemo(() => String(m.body || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2).replace(/\\(.)/g, '$1')}</b> : <span key={i}>{p.replace(/\\(.)/g, '$1')}</span>)), [m.body]);
  const serverLine = m.sys_kind === 'mc_start' || m.sys_kind === 'mc_stop';
  return (
    <div className={`vc-msg vc-game-ev vl-in k-${m.sys_kind}`} data-id={m.id}>
      <span className="vc-game-ev-ico"><I size={15} /></span>
      <div className="vc-game-ev-body">
        {m.author?.pfp ? <img src={m.author.pfp} alt="" width={16} height={16} className={serverLine ? 'srv' : ''} /> : null}
        <b>{m.author?.username}</b>
        <span className="txt">{body}</span>
        {m.author?.bridge_from && <span className="vc-game-tag">{m.author.bridge_from}</span>}
        <span className="vc-time">{stampOf(m.created_at)}</span>
      </div>
    </div>
  );
}
