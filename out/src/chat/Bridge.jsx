import { siteHref } from './hosts.js';
// Discord / Fluxer: import a server into Ember (Create a server > Import; or, for a new instance, a Velora import bundle),
// and the Bridge tab in Server settings (Velora's bot for Velora-hosted servers, the instance owner's own bot on an instance).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, RefreshCw, Link2, Unlink, Volume2, Hash, Lock, EyeOff, Smile, Shield, Image as ImageIcon, ArrowLeftRight, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../api.js';
import { go, loadServers, refreshServer, toast, errorText, ask, useChat } from './store.js';
import { Dialog, ServerCreationNotice } from './Dialogs.jsx';
import serverCreationPolicy from '../server-creation-policy.json';
import { Toggle } from './roles.jsx';
import { PlatformIcon } from './platforms.jsx';
import { instOpt } from './ids.js';
import { usePlan, PlanGate, PlanNotice, planOf } from './PlanGate.jsx';

const ERR = {
  not_linked: 'Link that account to Nookara first (Account > Security > Connected accounts).',
  bot_not_in_server: "The Nookara bot isn't in that server - add it first.",
  not_your_server: 'You need to own that server, or have Administrator / Manage server there.',
  bridge_not_set_up: "That platform isn't set up on Nookara yet.",
  pick_a_channel: 'Pick at least one channel.',
  too_many_servers: "You already own as many servers as you can.",
  import_running: 'An import is already running - give it a moment.',
  bot_needs_webhooks: 'The Nookara bot needs the Manage webhooks permission in that channel.',
  already_linked: 'That channel is already bridged to another Ember channel.',
  already_bridged: 'This server already has a bridge for that platform.',
  text_channels_only: 'Only text channels can be bridged.',
};
// an instance's bridge runs on its owner's own bot, not Velora's
const INST_ERR = {
  bot_not_in_server: "Your bot isn't in that server - add it first.", bridge_not_set_up: "That platform's bot isn't set up on this server yet - its admins add the bot's token in Server settings > Bridge.",
  bot_needs_webhooks: 'Your bot needs the Manage webhooks permission in that channel.', unreachable: "Can't reach the platform right now.",
};
const why = (e, inst) => (inst && INST_ERR[e?.message]) || ERR[e?.message] || errorText(e?.message);
const IMPORT_ERR = { not_linked: 'Link that account to Nookara first (Account > Security > Connected accounts).', bot_not_in_server: "Nookara's bot isn't in that server - add it first.", not_your_server: 'You need to own that server, or have Administrator / Manage server there.', import_running: 'An import is already running - give it a moment.', invalid_instance: "Nookara can't make an import for this server's address.", ticket_invalid: 'That import is gone - run it again.', ticket_expired: 'That import ran out - run it again.', ticket_wrong_instance: 'That import was made for another server.', import_failed: "Nookara couldn't build the import - try again.", velora_not_registered: "This server isn't registered with Nookara yet - try again in a minute.", velora_off: 'This server has its Nookara connection turned off.', community_exists: 'This server already has its community.' };

function useLoad(url, deps, inst) {
  const [v, setV] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    setV(x => ({ ...x, loading: true, error: null }));
    apiFetch(url, { inst }).then(data => live && setV({ data, error: null, loading: false })).catch(error => live && setV({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [url, n, inst, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, () => setN(x => x + 1)];
}
const Loading = () => <div className="vc-loading"><i /><i /><i /></div>;

// step 1 + 2 (shared with the Bridge tab): pick Discord or Fluxer, add the bot, pick one of your servers there.
// inst: an instance's bridge (its owner's bot: no linked account, every server the bot is in); base: where the routes are
// ('/chat/bridge' = Velora-hosted bridge / import, '/bonfire/import' = a Velora import bundle for an instance)
function GuildPicker({ onPick, pickLabel = 'Choose', exclude = [], inst, base = '/chat/bridge' }) {
  const [plats] = useLoad(`${base}/platforms`, [], inst);
  const [p, setP] = useState(null);
  const plat = plats.data?.platforms.find(x => x.id === p);
  const [guilds, reload] = useLoad(plat?.linked ? `${base}/${p}/guilds` : null, [p], inst);
  if (plats.loading) return <Loading />;
  if (plats.error) return <div className="vc-empty-note">{why(plats.error, inst)}</div>;
  if (!p) {
    return (
      <div className="vc-br-plats">
        {plats.data?.platforms.filter(x => !exclude.includes(x.id)).map(x => (
          <button type="button" key={x.id} className="vc-br-plat" disabled={!x.ready} onClick={() => setP(x.id)}>
            <PlatformIcon p={x.id} size={30} />
            <b>{x.name}</b>
            <small>{!x.ready ? (inst ? 'No bot set up yet' : `Nookara's ${x.name} bot isn't configured on this Nookara`) : inst ? `Bot: ${x.bot || 'ready'}` : x.linked ? 'Your account is linked' : 'Link your account first'}</small>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={() => setP(null)}><ArrowLeft size={14} /> <PlatformIcon p={p} size={14} /> {plat?.name}</button>
      {!plat?.linked ? (
        <div className="vc-br-note">
          <p>Link your {plat?.name} account to Nookara so Ember can check which servers are yours.</p>
          <div className="vc-row"><a className="btn btn-primary" href={siteHref("/me#settings/security")} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Connected accounts</a>
            <button type="button" className="btn btn-surface" onClick={() => location.reload()}><RefreshCw size={14} /> I've linked it</button></div>
        </div>
      ) : (
        <>
          <div className="vc-br-note">
            <p><b>1.</b> Add <b>{plat.bot}</b> ({inst ? "this server's bot" : "Nookara's bot"}) to your {plat.name} server. It reads the server and carries messages across.</p>
            <a className="btn btn-surface" href={plat.invite} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Add {plat.bot} to a server</a>
          </div>
          <div className="vc-br-note">
            <div className="vc-row"><p className="grow"><b>2.</b> Pick the server. {inst ? 'Every server the bot is in shows here.' : 'Only ones you own or manage, with the bot in them, show here.'}</p>
              <button type="button" className="btn btn-surface btn-sm" onClick={reload}><RefreshCw size={13} /> Refresh</button></div>
            {guilds.loading && <Loading />}
            {guilds.error && <div className="vc-empty-note">{base === '/bonfire/import' ? IMPORT_ERR[guilds.error.message] || why(guilds.error) : why(guilds.error, inst)}</div>}
            {guilds.data && !guilds.data.guilds.length && <div className="vc-empty-note">None yet - add the bot, then press Refresh.</div>}
            <div className="vc-br-guilds">
              {guilds.data?.guilds.map(g => (
                <div key={g.id} className="vc-br-guild">
                  <span className="vc-srv-ico">{g.icon ? <img src={g.icon} alt="" /> : g.name.slice(0, 2)}</span>
                  <b>{g.name}</b><span className="grow" />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(p, g, plat)}>{pickLabel}</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── import ──
export function ImportServer(props) {
  return serverCreationPolicy.creationEnabled ? <ImportServerForm {...props} /> : <ServerCreationNotice {...props} />;
}
function ImportServerForm({ onClose }) {
  const [pick, setPick] = useState(null); // { p, g, plat }
  return (
    <Dialog title="Import a server" sub="Copy a Discord or Fluxer server's channels, roles and emojis into a new Ember server - and keep them talking to each other if you like." onClose={onClose} wide className="vc-br">
      {close => (pick ? <ImportPicker {...pick} back={() => setPick(null)} close={close} onImport={async ({ name, channels, roles, opts }) => {
        const r = await apiFetch(`/chat/bridge/${pick.p}/guilds/${pick.g.id}/import`, { method: 'POST', body: JSON.stringify({ name, channels, roles, ...opts }) });
        await loadServers(); await refreshServer(r.sid);
        toast(`Imported ${r.channels} channels, ${r.roles} roles and ${r.emojis} emojis${r.bridged ? ` - ${r.bridged} channels bridged` : ''}.`, true);
        close(); go({ kind: 'server', sid: r.sid });
      }} />
        : <GuildPicker pickLabel="Import" onPick={(p, g, plat) => setPick({ p, g, plat })} />)}
    </Dialog>
  );
}
// the channel / role / extras picker; onImport({ name, channels, roles, opts }) does the import (throws to show an error).
// base: where the preview comes from; bridge: offer "keep them talking" (only Velora-hosted servers bridge with Velora's bot)
function ImportPicker({ p, g, plat, back, close, onImport, base = '/chat/bridge', bridge = true, label = 'Import server' }) {
  const [pv] = useLoad(`${base}/${p}/guilds/${g.id}`, []);
  const [name, setName] = useState(g.name);
  const [chans, setChans] = useState(null);
  const [roles, setRoles] = useState(null);
  const [opts, setOpts] = useState({ icon: true, banner: true, emojis: true, ...(bridge ? { bridge: true } : {}) });
  const [busy, setBusy] = useState(false);
  const d = pv.data;
  useEffect(() => {
    if (!d) return;
    // public channels on by default; private ones would be visible to everyone here, so they start off
    setChans(new Set(d.groups.flatMap(x => x.channels).filter(c => c.kind).map(c => c.id)));
    setRoles(new Set(d.roles.map(r => r.id)));
  }, [d]);
  const count = chans?.size || 0;
  const flip = (set, setter, id) => setter(old => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function go2() {
    setBusy(true);
    try { await onImport({ name, channels: [...chans], roles: [...roles], opts }); }
    catch (e) { toast((!bridge && IMPORT_ERR[e.message]) || why(e)); setBusy(false); }
  }
  if (pv.loading) return <Loading />;
  if (pv.error) return <div className="vc-br-step"><button type="button" className="vc-br-back" onClick={back}><ArrowLeft size={14} /> Back</button><div className="vc-empty-note">{(!bridge && IMPORT_ERR[pv.error.message]) || why(pv.error)}</div></div>;
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={back}><ArrowLeft size={14} /> <PlatformIcon p={p} size={14} /> {plat.name}: {g.name}</button>
      <label className="vc-field"><span>Ember server name</span><input className="form-input" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="vc-br-cols">
        <div className="vc-br-col">
          <div className="vc-br-head"><b>Channels</b><small>{count} picked{count > 60 ? ' - only the first 60 fit' : ''}</small></div>
          <div className="vc-br-list">
            {d.groups.map(grp => (
              <div key={grp.id || 'none'} className="vc-br-group">
                <div className="vc-br-cat">{grp.name}</div>
                {grp.channels.map(c => (
                  <label key={c.id} className={`vc-br-item${c.kind ? '' : ' off'}`} title={c.skip || (c.private ? `Private on ${plat.name} - stays private on Ember (for the roles you import)` : undefined)}>
                    <input type="checkbox" disabled={!c.kind} checked={!!chans?.has(c.id)} onChange={() => flip(chans, setChans, c.id)} />
                    {c.kind === 'voice' ? <Volume2 size={14} /> : <Hash size={14} />}
                    <span className="grow">{c.name}</span>
                    {c.private && <EyeOff size={13} className="vc-br-flag" />}
                    {c.locked && c.kind === 'text' && <Lock size={13} className="vc-br-flag" />}
                    {!c.kind && <small>not supported</small>}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <small className="vc-hint">Private channels keep their per-role permissions (see / send / attach) for the roles you import. Read-only channels come over as locked.</small>
        </div>
        <div className="vc-br-col">
          <div className="vc-br-head"><b>Roles</b><small>{roles?.size || 0} of {d.roles.length}</small></div>
          <div className="vc-br-list short">
            {d.roles.map(r => (
              <label key={r.id} className="vc-br-item">
                <input type="checkbox" checked={!!roles?.has(r.id)} onChange={() => flip(roles, setRoles, r.id)} />
                <i className="vc-br-dot" style={{ background: r.color || 'var(--muted)' }} />
                <span className="grow">{r.name}</span>{r.admin && <Shield size={13} className="vc-br-flag" />}
              </label>
            ))}
            {!d.roles.length && <div className="vc-empty-note">No roles.</div>}
          </div>
          <small className="vc-hint">Roles keep their colours and permissions. Nobody has them yet - people get roles once they join.</small>
          <div className="vc-br-head"><b>Also bring</b></div>
          <div className="vc-br-extras">
            {d.guild.icon && <label className="vc-br-item"><input type="checkbox" checked={opts.icon} onChange={e => setOpts(o => ({ ...o, icon: e.target.checked }))} /><ImageIcon size={14} /> Server icon</label>}
            {d.guild.banner && <label className="vc-br-item"><input type="checkbox" checked={opts.banner} onChange={e => setOpts(o => ({ ...o, banner: e.target.checked }))} /><ImageIcon size={14} /> Banner</label>}
            {d.emojis.length > 0 && <label className="vc-br-item"><input type="checkbox" checked={opts.emojis} onChange={e => setOpts(o => ({ ...o, emojis: e.target.checked }))} /><Smile size={14} /> {d.emojis.length} custom emoji{d.emojis.length === 1 ? '' : 's'}{d.emojis.some(e => e.animated) ? `, including ${d.emojis.filter(e => e.animated).length} animated` : ''}{d.emoji_total > d.emojis.length ? ` (first ${d.emojis.length} of ${d.emoji_total})` : ''}</label>}
          </div>
          {opts.emojis && d.emojis.length > 0 && <div className="vc-br-emojis">{d.emojis.slice(0, 24).map(e => <img key={e.id} src={e.url} alt={e.name} title={`:${e.name}:${e.animated ? ' (animated)' : ''}`} loading="lazy" />)}</div>}
        </div>
      </div>
      {bridge && <Toggle label={`Bridge it with ${plat.name}`} hint={`Messages in the imported text channels go both ways between Ember and ${g.name}. You can change or turn this off in Server settings > Bridge.`} on={opts.bridge} onChange={v => setOpts(o => ({ ...o, bridge: v }))} />}
      <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !count || !name.trim()} onClick={go2}>{busy ? 'Importing...' : label}</button></div>
    </div>
  );
}

// ── Server settings > Bridge ──
export function BridgeSettings({ sid, gated, onPlan }) {
  const inst = instOpt(sid);
  const plan = usePlan('bridges');
  const [st, reload] = useLoad(gated || plan.gate ? null : `/chat/bridge/servers/${sid}`, [sid, !!gated || !!plan.gate]);
  const channels = useChat(s => s.detail[sid]?.channels);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState('');
  const text = useMemo(() => (channels || []).filter(c => (c.type || 'text') === 'text'), [channels]);
  const call = async (key, fn) => { setBusy(key); try { await fn(); reload(); refreshServer(sid); return true; } catch (e) { if (!plan.catchPlan(e)) toast(why(e, inst)); return false; } finally { setBusy(''); } };
  const block = plan.gate || (st.error && planOf(st.error) ? { ...planOf(st.error), what: 'bridges' } : null); // (the plan has no bridges)
  useEffect(() => { if (block && !gated) onPlan?.(block); }, [!!block, !!gated]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!block && !gated) {
    if (st.loading && !st.data) return <Loading />;
    if (st.error) return <div className="vc-empty-note">{why(st.error, inst)}</div>;
  }
  const bridges = st.data?.bridges || [];
  const available = ['discord', 'fluxer'].filter(p => !bridges.some(b => b.platform === p));
  return (
    <PlanGate block={gated ? null : block}>
    <div className="vc-br-settings">
      <PlanNotice block={plan.full} />
      {bridges.map(b => (
        <div key={b.platform}>
          <div className="vc-br-top">
            <PlatformIcon p={b.platform} size={28} />
            <div><b>{b.platform_name}: {b.guild_name}</b><small>{b.links.length} channel{b.links.length === 1 ? '' : 's'} bridged</small></div>
            <span className="grow" />
            <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={async () => {
              if (await ask({ title: `Unlink ${b.guild_name}?`, text: `Messages stop going between Ember and ${b.platform_name}, and the bridge webhooks over there are removed. Messages already sent stay.`, confirm: 'Unlink', danger: true })) call(`unlink-${b.platform}`, () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'DELETE', body: JSON.stringify({ platform: b.platform }) }));
            }}><Unlink size={14} /> Unlink</button>
          </div>
          {b.problem && <div className="vc-br-warn">{b.problem === 'bot_not_in_server' ? `${inst ? 'Your' : 'The Nookara'} bot isn't in ${b.guild_name} any more - add it back to keep the bridge working.` : b.problem === 'bridge_not_set_up' ? INST_ERR.bridge_not_set_up : `Can't reach ${b.platform_name} right now.`}</div>}
          <Toggle label={`${b.platform_name} bridge on`} hint="Turn it off to pause it without losing the channel links." on={b.enabled} disabled={!!busy} onChange={v => call(`on-${b.platform}`, () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'PATCH', body: JSON.stringify({ platform: b.platform, enabled: v }) }))} />
          <div className="vc-br-head"><b>Linked channels</b><small>Link each channel from its own settings (Edit channel &gt; Bridge)</small></div>
          <div className="vc-br-map">
            {text.filter(c => b.links.some(l => l.cid === c.cid)).map(c => {
              const l = b.links.find(x => x.cid === c.cid);
              return <div key={c.cid} className="vc-br-row ro">
                <span className="vc-br-ch"><Hash size={14} /> {c.name}</span>
                <ArrowLeftRight size={14} className="vc-br-arrow on" />
                <span className="vc-br-ch"><PlatformIcon p={b.platform} size={14} /> #{l.ext_name || 'channel'}</span>
                {l.hook ? <Check size={14} className="vc-br-ok" /> : <small className="vc-br-flag" title="The bot couldn't make a webhook there yet - it needs Manage webhooks">no webhook</small>}
              </div>;
            })}
            {!b.links.length && <div className="vc-empty-note">No channels linked yet. Open a text channel's settings and pick a {b.platform_name} channel under Bridge.</div>}
          </div>
        </div>
      ))}
      {linking ? <>
        <button type="button" className="vc-br-back" onClick={() => setLinking(false)}><ArrowLeft size={14} /> Back</button>
        <GuildPicker pickLabel="Link" inst={inst} exclude={bridges.map(b => b.platform)} onPick={async (p, g) => {
          if (await call('link', () => apiFetch(`/chat/bridge/servers/${sid}`, { method: 'PUT', body: JSON.stringify({ platform: p, guild_id: g.id, automap: false }) }))) setLinking(false);
        }} />
      </> : available.length > 0 && <div className="vc-br-empty">
        <ArrowLeftRight size={28} />
        <b>{bridges.length ? 'Link another server' : 'Bridge this server with Discord or Fluxer'}</b>
        <p>Link a Discord server, a Fluxer server, or both. Pick which channels talk to each other in each channel's settings. Messages, replies, edits and deletes go both ways.{inst ? " This server uses its own bots - its admins set them up at the top of this page." : ''}</p>
        <button type="button" className="btn btn-primary" onClick={() => setLinking(true)}><Link2 size={14} /> Link a server</button>
      </div>}
    </div>
    </PlanGate>
  );
}

// Channel settings: which channel over there this one talks to (once the server is linked in Server settings > Bridge)
export function ChannelBridge({ sid, channel }) {
  const [st, reload] = useLoad(`/chat/bridge/servers/${sid}`, [sid]);
  const [busy, setBusy] = useState(false);
  if (st.loading && !st.data) return null;
  if (st.error) return null; // not allowed to manage the bridge
  const bridges = st.data?.bridges || [];
  return (
    <div className="vc-field"><span>Bridge</span>
      {!bridges.length ? (
        <div className="vc-br-chnote">
          <small>Link this server to a Discord or Fluxer server first, then pick a channel here.</small>
          <button type="button" className="btn btn-surface btn-sm" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'settings', sid, tab: 'bridge' } }))}><Link2 size={13} /> Link a server</button>
        </div>
      ) : bridges.map(b => {
        const l = b.links.find(x => x.cid === channel.cid);
        return <div key={b.platform}>
          <div className="vc-row"><PlatformIcon p={b.platform} size={16} />
            <select className="form-input" aria-label={`${b.platform_name} channel`} value={l?.ext_channel_id || ''} disabled={busy} onChange={async e => {
              setBusy(true);
              try { await apiFetch(`/chat/bridge/servers/${sid}/channels/${channel.cid}`, { method: 'PUT', body: JSON.stringify({ platform: b.platform, ext_channel_id: e.target.value || null }) }); reload(); refreshServer(sid); }
              catch (er) { toast(why(er, instOpt(sid))); }
              setBusy(false);
            }}>
              <option value="">Not bridged</option>
              {b.ext_channels.map(x => <option key={x.id} value={x.id}>#{x.name}{x.category ? ` (${x.category})` : ''}</option>)}
            </select>
          </div>
          <small className="vc-hint"><PlatformIcon p={b.platform} size={12} /> {l ? `Messages here and in ${b.platform_name} #${l.ext_name} (${b.guild_name}) go both ways.` : `Pick a channel in ${b.guild_name} to bridge with ${b.platform_name}.`}{!b.enabled ? ' The bridge is paused in Server settings.' : ''}</small>
        </div>;
      })}
    </div>
  );
}

// ── a new instance's community from a Discord / Fluxer server (setup wizard): Velora's bot builds a bundle (channels, roles,
// emojis - no members or messages) with the signed-in Velora account; the instance downloads it with a one-time ticket ──
const STAGES = { queued: 'Waiting to start...', running: 'Copying the server...', done: 'Bringing it over...' };
export function VeloraImport({ origin, onDone, onCancel }) {
  const [pick, setPick] = useState(null); // { p, g, plat }
  const [job, setJob] = useState(null); // { job_id, ticket }
  if (job) return <ImportProgress origin={origin} job={job} onDone={onDone} onBack={() => { setJob(null); setPick(null); }} />;
  if (pick) {
    return (
      <ImportPicker {...pick} base="/bonfire/import" bridge={false} label="Import" back={() => setPick(null)} close={onCancel} onImport={async ({ name, channels, roles, opts }) => {
        setJob(await apiFetch('/bonfire/import', { method: 'POST', body: JSON.stringify({ platform: pick.p, guild_id: pick.g.id, channels, roles, options: { name, ...opts }, instance: origin }) }));
      }} />
    );
  }
  return (
    <div className="vc-br-step">
      <button type="button" className="vc-br-back" onClick={onCancel}><ArrowLeft size={14} /> Back</button>
      <p className="vc-dialog-sub">Nookara copies the server's channels, categories, roles and emojis into this one with its own bot. Members and messages stay where they are. You need your Discord / Fluxer account linked to Nookara, Nookara's bot in that server, and to own or manage it there.</p>
      <GuildPicker base="/bonfire/import" pickLabel="Import" onPick={(p, g, plat) => setPick({ p, g, plat })} />
    </div>
  );
}
function ImportProgress({ origin, job, onDone, onBack }) {
  const [st, setSt] = useState({ status: 'queued', progress: 0 });
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        for (let i = 0; live; i++) {
          const j = await apiFetch(`/bonfire/import/${encodeURIComponent(job.job_id)}`);
          if (!live) return;
          setSt(j);
          if (j.status === 'failed') throw new Error(j.error || 'import_failed');
          if (j.status === 'done') break;
          await new Promise(r => setTimeout(r, i < 20 ? 1200 : 3000));
        }
        // the ticket goes to this instance only (Velora bound it to its address); it fetches the bundle from Velora itself
        for (let i = 0; live; i++) {
          try { const d = await apiFetch('/api/v1/import/velora', { inst: origin, method: 'POST', body: JSON.stringify({ ticket: job.ticket }) }); if (live) onDone(d.sid); return; }
          catch (e) { if (e.message !== 'not_ready' || i > 20) throw e; await new Promise(r => setTimeout(r, 2000)); }
        }
      } catch (e) { if (live) setErr(IMPORT_ERR[e.message] || why(e)); }
    })();
    return () => { live = false; };
  }, [job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = st.status === 'done' ? 100 : Math.max(3, Math.min(99, Number(st.progress) || 0));
  return (
    <div className="vc-br-step">
      {err ? (
        <>
          <p className="vc-err"><TriangleAlert size={14} /> {err}</p>
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={onBack}>Try again</button></div>
        </>
      ) : (
        <div className="vc-br-note">
          <p><b>{STAGES[st.status] || 'Working...'}</b>{st.stage ? ` ${st.stage}` : ''}</p>
          <div className="vc-game-bar vc-imp-bar"><i style={{ width: `${pct}%` }} /></div>
          <p>{pct}% - keep this open until it's done.</p>
        </div>
      )}
    </div>
  );
}
