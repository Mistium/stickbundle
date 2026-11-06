// Server settings: the same dialog as Ember's own settings (SettingsDialog: sidebar of grouped pages + the page with its
// title and a close X; on phones the list first, then a page slides in). Server / Members / Integrations, and for an
// instance's admins its own pages (Instance). Velora-hosted servers use the same shell with the pages they have.
import { useEffect, useMemo, useState } from 'react';
import {
  Search, LayoutGrid, Shield, Smile, Volume2, Upload, Users, DoorOpen, Bot, ArrowLeftRight, Gamepad2,
  KeyRound, Mic, Globe, UserCog, TriangleAlert, Trash2, RefreshCw, Check, Ban, UserMinus, Compass, Download, Rocket, Archive, Info, Copy, CircleArrowUp,
  Gauge, MessageSquare, Flag, ShieldAlert, ScrollText, ChartLine,


} from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, go, ask, toast, errorText, refreshServer, loadServersOf, loadMembers, useFace } from './store.js';
import { instOf, isInst } from './ids.js';
import { initials } from './Parts.jsx';
import { Avatar } from './Profile.jsx';
import { stampOf } from './text.jsx';
import { RolesEditor, Toggle, P, has, rolesOf, modRights, moderate } from './roles.jsx';
import { EmojiManager } from './EmojiPicker.jsx';
import { SoundManager } from './Soundboard.jsx';
import { BridgeSettings } from './Bridge.jsx';
import { GameServersSettings } from './GameServer.jsx';
import { BotsManager } from './Bots.jsx';
import { ExportButton } from './Community.jsx';
import { InsightsPage } from './Insights.jsx';
import { DashboardPage, JoiningPage, MessageRulesPage, ReportsPage, AutoModPage, AuditLogPage, UploadRulesPage } from './ServerRules.jsx';
import { InstanceTab, BridgeBots, restartInstance } from './Instances.jsx';
import { UpdateServerRow } from './UpdateServer.jsx';
import { HostingPage } from './Hosting.jsx';
import { BackupsPage } from './Backups.jsx';
import { ServerInfoPage } from './ServerInfo.jsx';
import { PlanCtx, buildPlanCtx, PlanUsage, PlanGate, usePlan } from './PlanGate.jsx';
import { SettingsShell, Card } from './SettingsShell.jsx';
import { useUnsaved, UnsavedBar } from './unsaved.jsx';
import './SettingsDialog.css';

// [id, label, icon, words the search box answers to]
function pagesFor({ onInst, canServer, canRoles, canMod, canReports, instAdmin, owner, legacyDefault, hosted }) {
  const uploads = ['uploads', 'Uploads', Upload, ['Files', 'Biggest file', 'MB', 'File types', 'Expire', 'Storage', 'Compression', 'Per minute']];
  const danger = (owner && !legacyDefault) || instAdmin ? ['danger', 'Danger zone', TriangleAlert, ['Delete server', 'Export', 'Restart', 'Update', 'Backup', 'Advanced', 'Unmarked aliases']] : null;
  return [
    ['Server', [
      onInst && canServer && ['dashboard', 'Dashboard', Gauge, ['Stats', 'Health', 'Storage', 'Disk', 'Top channels', 'Memory', 'Uptime']],
      onInst && canServer && ['insights', 'Insights', ChartLine, ['Activity', 'Engagement', 'Graphs', 'Joins', 'Leaves', 'Messages', 'Chatters', 'Active', 'Reactions', 'Busiest hours', 'Top chatters']],
      canServer && ['overview', 'Overview', LayoutGrid, ['Name', 'Icon', 'Banner', 'Description', 'Accent colour', 'Invite code', 'Discover', 'Directory', 'Tags', 'List']],
      canRoles && ['roles', 'Roles', Shield, ['Permissions', 'Colour']],
      canServer && ['emojis', 'Emojis', Smile, ['Custom emoji']],
      canServer && ['sounds', 'Soundboard', Volume2, ['Sounds']],
      onInst && canServer && ['messages', 'Message rules', MessageSquare, ['Message length', 'Search results', 'Reactions', 'Link previews', 'Proxy']],
      onInst && canServer && !instAdmin && uploads, // (the instance's admins find it under Instance)
    ]],
    ['Members', [
      canMod && ['members', onInst ? 'Members & bans' : 'Members', Users, ['Kick', 'Remove', 'Ban', 'Unban']],
      onInst && canServer && ['join', 'Joining', DoorOpen, ['Join requests', 'Invites', 'Anyone can join', 'Password', 'Allowlist', 'Member limit', 'Default roles']],
    ]],
    ['Moderation', onInst ? [
      canReports && ['reports', 'Reports', Flag, ['Report', 'Open', 'Resolved', 'Dismissed']],
      canServer && ['automod', 'AutoMod', ShieldAlert, ['Blocked words', 'Word list', 'Spam', 'Timeout', 'Exempt roles']],
      (canServer || canMod) && ['audit', 'Audit log', ScrollText, ['Log', 'History', 'Retention']],
    ] : []],
    ['Integrations', [
      onInst && (canServer || instAdmin) && ['bots', 'Bots', Bot, ['Bot accounts', 'Token']],
      (canServer || instAdmin) && ['bridge', 'Bridge', ArrowLeftRight, ['Discord', 'Fluxer', 'Bridge bots']],
      canServer && ['game', 'Game servers', Gamepad2, ['Minecraft', 'CloudLink', 'Audit log']],
    ]],
    ['Instance', instAdmin ? [
      hosted && ['hosting', 'Hosting', Rocket, ['Plan', 'Starter', 'Plus', 'Billing', 'Credits', 'Upgrade', 'Voice minutes', 'Delete server']],
      ['accounts', 'Accounts', KeyRound, ['Accounts mode', 'Nookara accounts', 'Own accounts', 'Local accounts', 'Registration', 'Public address']],
      uploads,
      ['backups', 'Backups', Archive, ['Backup', 'Restore', 'Download', 'Save to Nookara', 'Export']],
      ['voice', 'Voice', Mic, ['Cloudflare', 'Realtime', 'TURN']],
      ['velora', 'Nookara', Globe, ['Registration', 'Register', 'Payouts', 'Push', 'Directory', 'Voice minutes']],
      ['admins', 'Admins', UserCog, ['Instance admins', 'Owner']],
      ['serverinfo', 'Server info', Info, ['Version', 'Commit', 'Build', 'Update', 'Outdated', 'Uptime', 'Node', 'Stats', 'Database', 'Uploads']],
      danger,
    ] : []],
    ['Owner', onInst ? [] : [danger]], // (Velora-hosted servers: no Instance pages)
  ].map(([g, items]) => [g, items.filter(Boolean)]).filter(([, items]) => items.length);
}

export function ServerSettings({ sid, onClose, tab: startTab }) {
  const d = useChat(s => s.detail[sid]);
  const onInst = isInst(sid);
  const origin = onInst ? instOf(sid) : null;
  const inst = useChat(s => (onInst ? s.instances.find(i => i.origin === origin) : null));
  const instAdmin = !!inst?.isAdmin;
  const srv = d?.server;
  const canServer = has(srv?.perms, P.MANAGE_SERVER), canRoles = has(srv?.perms, P.MANAGE_ROLES);
  const canMod = has(srv?.perms, P.KICK) || has(srv?.perms, P.BAN);
  const canReports = canMod || canServer || has(srv?.perms, P.MANAGE_MESSAGES);
  const owner = srv?.role === 'owner';
  const hosted = !!inst?.managed && !!inst?.isOwner; // hosted by Velora: its owner manages the plan here
  const groups = useMemo(() => pagesFor({ onInst, canServer, canRoles, canMod, canReports, instAdmin, owner, legacyDefault: !!srv?.is_default, hosted }), [onInst, canServer, canRoles, canMod, canReports, instAdmin, owner, srv?.is_default, hosted]);

  return (
    <SettingsShell label="Server settings" groups={groups} startTab={startTab} onClose={onClose} gone={!d}
      head={srv && <>
        <span className="vc-srv-ico">{srv.icon ? <img src={srv.icon} alt="" /> : initials(srv.name)}</span>
        <span><b>{srv.name}</b><small>{onInst ? <><Globe size={11} /> {inst?.host || origin}</> : 'Hosted by Nookara'}</small></span>
      </>}>
      {(page, { onDirty, goTo }) => <PlanCtx.Provider value={buildPlanCtx(inst, goTo)}>
        {page === 'overview' && <Overview sid={sid} origin={origin} instAdmin={instAdmin} onDirty={onDirty} goTo={goTo} />}
        {page === 'roles' && <RolesEditor sid={sid} />}
        {page === 'emojis' && <EmojiManager sid={sid} />}
        {page === 'sounds' && <SoundManager sid={sid} />}
        {page === 'dashboard' && <DashboardPage sid={sid} goTo={goTo} />}
        {page === 'insights' && <InsightsPage sid={sid} />}
        {page === 'messages' && <MessageRulesPage sid={sid} onDirty={onDirty} goTo={goTo} />}
        {page === 'uploads' && <UploadRulesPage sid={sid} onDirty={onDirty} />}
        {page === 'reports' && <ReportsPage sid={sid} />}
        {page === 'automod' && <AutoModPage sid={sid} onDirty={onDirty} />}
        {page === 'audit' && <AuditLogPage sid={sid} onDirty={onDirty} />}
        {page === 'members' && <MembersPage sid={sid} />}
        {page === 'join' && <JoiningPage sid={sid} onDirty={onDirty} goTo={goTo} instAdmin={instAdmin} />}
        {page === 'bots' && <BotsManager inst={origin} sid={sid} />}
        {page === 'bridge' && <BridgePage sid={sid} origin={origin} instAdmin={instAdmin} canServer={canServer} />}
        {page === 'game' && <GameServersSettings sid={sid} />}
        {['accounts', 'voice', 'velora', 'admins'].includes(page) && <InstanceTab key={page} origin={origin} tab={page} onDirty={onDirty} />}
        {page === 'hosting' && <HostingPage origin={origin} />}
        {page === 'serverinfo' && <ServerInfoPage origin={origin} />}
        {page === 'backups' && <BackupsPage origin={origin} />}
        {page === 'danger' && <DangerZone sid={sid} origin={origin} instAdmin={instAdmin} onClose={onClose} />}
      </PlanCtx.Provider>}
    </SettingsShell>
  );
}

// Bridge: a plan without bridges answers every bridge call with plan_limit, so the page is one "not in your plan" panel (not two errors)
function BridgePage({ sid, origin, instAdmin, canServer }) {
  const plan = usePlan('bridges');
  const [hit, setHit] = useState(null);
  const gate = plan.gate || hit;
  return <PlanGate block={gate}>{instAdmin && <BridgeBots origin={origin} onPlan={setHit} gated={!!gate} />}{canServer && <>{instAdmin && <h3 className="vc-game-sec-title">Linked servers</h3>}<BridgeSettings sid={sid} gated={!!gate} onPlan={setHit} /></>}</PlanGate>;
}

// ── Overview: name, icon, banner, description; Show in Discover + tags (instance admins), accent colours, invite code ──
async function uploadTo(url, file) { const fd = new FormData(); fd.append('file', file); return uploadFetch(url, fd); }
const tagText = list => (list || []).join(', ');
const tagsOf = t => [...new Set(t.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
function Overview({ sid, origin, instAdmin, onDirty, goTo }) {
  const srv = useChat(s => s.detail[sid]?.server);
  const [name, setName] = useState(srv?.name || '');
  const [desc, setDesc] = useState(srv?.description || '');
  const [cfg, setCfg] = useState(null); // the instance's settings (Discover listing), for its admins
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState('');
  const call = (path, o = {}) => apiFetch(`/api/v1${path}`, { inst: origin, ...o });
  const loadCfg = () => call('/instance/settings').then(c => { setCfg(c); setTags(tagText(c.tags)); return c; }).catch(e => toast(errorText(e.message)));
  useEffect(() => { if (instAdmin) loadCfg(); }, [instAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  // the listing is pushed a few seconds after a change: look again then
  const recheck = () => setTimeout(() => { loadCfg(); }, 4500);
  const tagList = tagsOf(tags);
  const tagsChanged = !!cfg && tagText(tagList) !== tagText(cfg.tags);
  const changed = !!srv && (name !== srv.name || desc !== (srv.description || '') || tagsChanged);
  const tagBad = tagList.length > 8 || tagList.some(t => t.length > 24);
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  if (!srv) return null;
  const reset = () => { setName(srv.name); setDesc(srv.description || ''); if (cfg) setTags(tagText(cfg.tags)); };
  async function save() {
    if (tagBad) { toast('Up to 8 tags, each up to 24 characters.'); return; }
    setBusy('save');
    try {
      if (name !== srv.name || desc !== (srv.description || '')) await apiFetch(`/chat/servers/${sid}`, { method: 'PATCH', body: JSON.stringify({ name, description: desc }) });
      if (tagsChanged) { setCfg(await call('/instance/settings', { method: 'PATCH', body: JSON.stringify({ tags: tagList }) })); recheck(); }
      await refreshServer(sid); await loadServersOf(sid);
      flashSaved();
    } catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  async function img(kind, file) {
    if (!file) return;
    setBusy(kind);
    try { await uploadTo(`/chat/servers/${sid}/${kind}`, file); await refreshServer(sid); await loadServersOf(sid); } catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  async function clearImg(kind) {
    setBusy(kind);
    try { await apiFetch(`/chat/servers/${sid}/${kind}`, { method: 'DELETE' }); await refreshServer(sid); await loadServersOf(sid); } catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  async function setListed(listed) {
    setBusy('listed');
    try { setCfg(await call('/instance/settings', { method: 'PATCH', body: JSON.stringify({ listed }) })); await refreshServer(sid); recheck(); } catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  async function register() {
    setBusy('register');
    try { const c = await call('/instance/velora/register', { method: 'POST' }); setCfg(c); toast(c.velora?.registered ? 'Registered with Nookara.' : "Nookara said no - see below.", !!c.velora?.registered); if (c.listed) recheck(); }
    catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  const v = cfg?.velora || {};
  const off = cfg && (cfg.velora_registration || 'auto') === 'off';
  const dir = v.directory || {};
  return (
    <div className="bf-ss-page">
      <Card title="Server profile" icon={LayoutGrid}>
        <div className="vc-settings-imgs">
          <div className="vc-field"><span>Icon</span>
            <div className="vc-img-row"><span className="vc-srv-ico lg">{srv.icon ? <img src={srv.icon} alt="" /> : initials(srv.name)}</span>
              <label className="btn btn-surface"><Upload size={14} /> {busy === 'icon' ? 'Uploading...' : 'Upload'}<input type="file" hidden accept="image/*" onChange={e => img('icon', e.target.files[0])} /></label>
              {srv.icon && <button type="button" className="btn btn-surface" onClick={() => clearImg('icon')}>Remove</button>}</div></div>
          <div className="vc-field"><span>Banner</span>
            <div className="vc-img-row"><span className="vc-banner-prev">{srv.banner && <img src={srv.banner} alt="" />}</span>
              <label className="btn btn-surface"><Upload size={14} /> {busy === 'banner' ? 'Uploading...' : 'Upload'}<input type="file" hidden accept="image/*" onChange={e => img('banner', e.target.files[0])} /></label>
              {srv.banner && <button type="button" className="btn btn-surface" onClick={() => clearImg('banner')}>Remove</button>}</div></div>
        </div>
        <label className="vc-field"><span>Name</span><input className="form-input" maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="vc-field"><span>Description</span><textarea className="form-textarea" rows={3} maxLength={300} value={desc} onChange={e => setDesc(e.target.value)} /></label>
      </Card>
      {instAdmin && (
        <Card title="Discover" icon={Compass} className="bf-ss-discover">
          {!cfg ? <div className="vc-loading"><i /><i /><i /></div> : (
            <>
              <div className="cs-row">
                <div className="cs-text"><b>Show in Discover</b><span>{cfg.listed ? 'On: anyone can find this server in Discover and add it.' : 'Off: people need its address or an invite.'}</span></div>
                <button type="button" role="switch" aria-label="Show in Discover" aria-checked={!!cfg.listed} className={`cs-switch${cfg.listed ? ' on' : ''}`} disabled={off || busy === 'listed'} onClick={() => setListed(!cfg.listed)}><i /></button>
              </div>
              <div className={`bf-ss-reg${off || !v.registered ? ' warn' : ' ok'}`}>
                {off ? <><TriangleAlert size={14} /><span>Nookara's services are off for this server, so it can't be listed.</span><button type="button" className="btn btn-surface btn-sm" onClick={() => goTo('velora')}>Nookara settings</button></>
                  : !v.registered ? <><TriangleAlert size={14} /><span><b>Not registered with Nookara yet.</b> Discover lists only registered servers.{v.last_error ? ` (${errorText(v.last_error) === 'Something went wrong.' ? v.last_error : errorText(v.last_error)})` : ''}</span><button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={register}><RefreshCw size={13} /> {busy === 'register' ? 'Registering...' : 'Register now'}</button></>
                  : <><Check size={14} /><span><b>Registered with Nookara</b>{v.trusted ? ' - trusted' : ''}. {dir.hidden_by_staff ? "Nookara's staff have hidden the listing." : cfg.listed ? (dir.last_error ? `The listing didn't update: ${dir.last_error}` : dir.pushed_at ? `Listed - updated ${stampOf(dir.pushed_at)}.` : 'Listing it now...') : 'Not listed.'}</span></>}
              </div>
              <label className="vc-field vc-gap-top"><span>Tags</span>
                <input className="form-input" maxLength={220} placeholder="gaming, art, minecraft" value={tags} onChange={e => setTags(e.target.value)} />
                <small className={`vc-hint${tagBad ? ' vc-err' : ''}`}>Up to 8, separated by commas, each up to 24 characters. People can search Discover for them.</small></label>
            </>
          )}
        </Card>
      )}
      <Card title="Members' names" icon={Users}>
        <Toggle label="Let people show their accent colour" hint="On: names use each person's own Nookara accent colour. Off: names use the colour of their highest role." on={srv.allow_accent !== false}
          onChange={on => apiFetch(`/chat/servers/${sid}`, { method: 'PATCH', body: JSON.stringify({ allow_accent: on }) }).then(() => refreshServer(sid)).catch(e => toast(errorText(e.message)))} />
      </Card>
      <Card title="Invite code" icon={DoorOpen}>
        <div className="vc-row"><input className="form-input" readOnly value={srv.invite || ''} aria-label="Invite code" /><button type="button" className="btn btn-surface" onClick={async () => { await apiFetch(`/chat/servers/${sid}`, { method: 'PATCH', body: JSON.stringify({ new_invite: true }) }).catch(e => toast(errorText(e.message))); refreshServer(sid); }}>New code</button></div>
        <small className="vc-hint">A new code stops the old one working.</small>
      </Card>
      <UnsavedBar changed={changed} bar={bar} busy={busy === 'save'} disabled={!name.trim()} onReset={reset} onSave={save} />
    </div>
  );
}

// ── Members (& bans on an instance): remove / ban with the same questions as the member menu; the ban list with Unban ──
function MemberRow({ sid, m, onDone }) {
  const face = useFace(m);
  useChat(s => s.detail[sid]); useChat(s => s.members[sid]); // (redraw when roles / members change)
  const r = modRights(sid, m.username), roles = rolesOf(sid, m.username);
  const tip = r.below ? undefined : 'Their role is as high as yours';
  return (
    <div className="vc-list-row">
      <Avatar user={face} size={32} />
      <span className="vc-list-txt"><b>{m.username}{m.bot ? ' (bot)' : ''}</b>
        <small>{[m.role === 'owner' ? 'Owner' : null, ...roles.map(x => x.name)].filter(Boolean).join(', ') || 'No roles'}{m.joined_at ? ` - joined ${new Date(m.joined_at).toLocaleDateString()}` : ''}</small></span>
      <span className="grow" />
      {r.kick && <button type="button" className="btn btn-surface btn-sm" disabled={!r.below} data-tip={tip} onClick={() => moderate(sid, m.username, 'kick', m).then(ok => ok && onDone())}><UserMinus size={13} /> Remove</button>}
      {r.ban && <button type="button" className="btn btn-danger btn-sm" disabled={!r.below} data-tip={tip} onClick={() => moderate(sid, m.username, 'ban', m).then(ok => ok && onDone())}><Ban size={13} /> Ban</button>}
    </div>
  );
}
function MembersPage({ sid }) {
  const members = useChat(s => s.members[sid]);
  const canBan = useChat(s => has(s.detail[sid]?.server.perms, P.BAN));
  const [q, setQ] = useState('');
  const [bans, setBans] = useState(null);
  const onInst = isInst(sid);
  const loadBans = () => { if (onInst && canBan) apiFetch(`/chat/servers/${sid}/bans`).then(d => setBans(d.bans)).catch(() => setBans([])); };
  useEffect(() => { loadMembers(sid); loadBans(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (members || []).filter(m => m.username.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  const done = () => { loadMembers(sid); loadBans(); };
  return (
    <div className="bf-ss-page">
      <Card title={`Members${members ? ` - ${members.length}` : ''}`} icon={Users}>
        {onInst && members && <PlanUsage what="member_cap" used={members.filter(m => !m.bot).length} label="People" />}
        <label className="vc-search sm"><Search size={14} /><input placeholder="Find a member" value={q} onChange={e => setQ(e.target.value)} /></label>
        {!members && <div className="vc-loading"><i /><i /><i /></div>}
        <div className="vc-rows">{list.map(m => <MemberRow key={m.id || m.username} sid={sid} m={m} onDone={done} />)}</div>
        {members && !list.length && <div className="vc-hint">No one called that.</div>}
      </Card>
      {onInst && canBan && (
        <Card title={`Bans${bans?.length ? ` - ${bans.length}` : ''}`} icon={Ban}>
          {bans === null && <div className="vc-loading"><i /><i /><i /></div>}
          {bans && !bans.length && <div className="vc-hint">No one is banned.</div>}
          <div className="vc-rows">
            {(bans || []).map(b => (
              <div key={b.user?.id} className="vc-list-row">
                <Avatar user={{ username: b.user?.username, pfp: b.user?.kind === 'velora' ? b.user?.pfp : null }} size={32} />
                <span className="vc-list-txt"><b>{b.user?.username || 'Unknown'}</b><small>Banned {stampOf(b.created_at)}{b.banned_by?.username ? ` by ${b.banned_by.username}` : ''}</small></span>
                <span className="grow" />
                <button type="button" className="btn btn-surface btn-sm" onClick={() => moderate(sid, b.user?.username, 'unban', b.user).then(ok => ok && loadBans())}>Unban</button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Danger zone: restart the instance (its admins), export / delete the server (its owner) ──
function DangerZone({ sid, origin, instAdmin, onClose }) {
  const srv = useChat(s => s.detail[sid]?.server);
  const instName = useChat(s => s.instances.find(i => i.origin === origin)?.name);
  if (!srv) return null;
  const owner = srv.role === 'owner' && !srv.is_default;
  const del = async () => {
    if (!(await ask({ title: `Delete ${srv.name}?`, text: 'This deletes the server, its channels and every message in it, for everyone. It cannot be undone.', match: srv.name, confirm: 'Delete server', danger: true }))) return;
    try { await apiFetch(`/chat/servers/${sid}`, { method: 'DELETE' }); onClose(); go({ kind: 'home' }); loadServersOf(sid); } catch (e) { toast(errorText(e.message)); }
  };
  return (
    <div className="bf-ss-page">
      {owner && (
        <Card title="Export" icon={Download}>
          <div className="cs-row"><div className="cs-text"><b>Download a copy</b><span>A zip with the channels, roles, members, emojis, files and every message.{origin ? '' : " Servers hosted by Nookara are moving to Ember servers of their own - you can import it into one."}</span></div><ExportButton sid={sid} /></div>
        </Card>
      )}
      {instAdmin && (
        <Card title="Restart" icon={RefreshCw}>
          <div className="cs-row"><div className="cs-text"><b>Restart the server</b><span>Everyone is disconnected for a moment. It only comes back by itself under something that restarts it (Docker, systemd).</span></div>
            <button type="button" className="btn btn-surface" onClick={() => restartInstance(origin, instName)}><RefreshCw size={14} /> Restart</button></div>
        </Card>
      )}
      {instAdmin && (
        <Card title="Update" icon={CircleArrowUp}>
          <UpdateServerRow origin={origin} name={instName} />
        </Card>
      )}
      {owner && (
        <Card title="Delete" icon={Trash2} className="bf-ss-danger">
          <div className="cs-row"><div className="cs-text"><b>Delete this server</b><span>Its channels and every message go, for everyone. This can't be undone.</span></div>
            <button type="button" className="btn btn-danger" onClick={del}><Trash2 size={14} /> Delete server</button></div>
        </Card>
      )}
      {owner && origin && <AdvancedCard sid={sid} />}
    </div>
  );
}

// ── Danger zone > Advanced (owner only, Ember servers): unmarked aliases. Kept at the very bottom on purpose: it lets bots post
// messages that look exactly like a member's. Turning it on asks first; the server logs every change in the audit log. ──
function AdvancedCard({ sid }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(null); // null = not loaded yet
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || on !== null) return;
    let off = false;
    apiFetch(`/chat/servers/${sid}/settings`).then(d => { if (!off) setOn(!!d.settings?.advanced?.unmarked_aliases); }).catch(e => { if (!off) toast(errorText(e.message)); });
    return () => { off = true; };
  }, [open, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function flip(next) {
    if (next && !(await ask({
      title: 'Turn on unmarked aliases?',
      text: "Bots you allow will be able to post messages that look exactly like they came from a member of this server: their name, colour and profile card, with no alias mark and no BOT tag. Members won't be able to tell. Only people who can manage messages can still see the real sender (Message info).",
      match: 'unmarked', confirm: 'Turn on', danger: true,
    }))) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/chat/servers/${sid}/settings`, { method: 'PATCH', body: JSON.stringify({ advanced: { unmarked_aliases: next } }) });
      setOn(!!d.settings?.advanced?.unmarked_aliases); refreshServer(sid);
      toast(next ? 'Unmarked aliases are on. Reload the channel to see older messages change.' : 'Unmarked aliases are off.', true);
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return (
    <Card title="Advanced" icon={ShieldAlert} className="bf-ss-danger">
      {!open ? (
        <div className="cs-row"><div className="cs-text"><b>Advanced settings</b><span>Risky settings most servers never need.</span></div>
          <button type="button" className="btn btn-surface" onClick={() => setOpen(true)}>Show</button></div>
      ) : (
        <>
          <div className="bf-ss-advanced-warn" role="note"><TriangleAlert size={16} /><span>
            <b>Unmarked aliases</b> let bots post messages that look exactly like they came from a member: no mask, no BOT tag, and if
            the alias name matches someone in this server, their colour and profile card. Mentions, blocks, reports and moderation still go to the
            real bot, and people with Manage messages can see it under Message info. A bot also needs the <b>Use unmarked aliases</b> permission
            (or Administrator) on one of its roles.</span></div>
          {on === null ? <div className="vc-loading"><i /><i /><i /></div>
            : <Toggle label="Allow unmarked aliases" hint={on ? 'On: allowed bots post aliases with no mark. Turning it off marks every alias again, old ones too.' : 'Off: every alias shows its mask and the real bot.'} on={on} disabled={busy} onChange={flip} />}
        </>
      )}
    </Card>
  );
}
