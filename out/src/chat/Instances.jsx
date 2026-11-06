// Adding a server (address -> its community -> log in -> join) and an instance's own settings tabs (for its admins), which
// live inside the normal Server settings dialog. One instance is one community: the address is the server.
import { useEffect, useState } from 'react';
import { Server, ShieldCheck, KeyRound, Users, Check, Trash2, RefreshCw, Plus, TriangleAlert, Mic } from 'lucide-react';

import { apiFetch } from '../api.js';
import { Dialog } from './Dialogs.jsx';
import { initials } from './Parts.jsx';
import { Avatar } from './Profile.jsx';
import { useChat, go, toast, errorText, ask } from './store.js';
import { Toggle } from './roles.jsx';
import { PlatformIcon } from './platforms.jsx';
import { discover, veloraSession, localSession, addInstance, loginInstance, instanceConn, refreshInstance, joinCommunity, hostOf } from './instances.js';
import { startSignIn, hasVelora } from './session.js';
import { useUnsaved, UnsavedBar } from './unsaved.jsx';
import { PlanGate, planOf } from './PlanGate.jsx';
import { joinLabel, joinHint } from './Community.jsx';

function InstanceCard({ origin, info }) {
  const c = info.community;
  return (
    <div className="vc-invite-srv vc-inst-card">
      <span className="vc-srv-ico lg">{(c?.icon_url || info.icon_url) ? <img src={c?.icon_url || info.icon_url} alt="" /> : initials(c?.name || info.name)}</span>
      <div><b>{c?.name || info.name}</b><small>{hostOf(origin)}{c ? <> - <Users size={13} /> {c.member_count} member{c.member_count === 1 ? '' : 's'}</> : ''}</small>
        <small>{info.accounts_mode === 'velora' ? <><ShieldCheck size={13} /> Signs you in with your Nookara account</> : <><KeyRound size={13} /> Has its own accounts</>}</small></div>
    </div>
  );
}

export function AddInstance({ url, invite, onClose, onSetup }) {
  const [text, setText] = useState(url || '');
  const [found, setFound] = useState(null); // { origin, info }
  const [step, setStep] = useState(url ? 'look' : 'url'); // url | auth | join
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('login');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState(invite || '');
  const [joinPass, setJoinPass] = useState(''); // (a server with a join password)
  const [asked, setAsked] = useState(false);
  const conns = useChat(s => s.instances);
  const mine = useChat(s => s.servers);
  const live = found && conns.find(i => i.origin === found.origin);
  const info = found ? { ...found.info, ...(live ? { community: live.community, claimed: live.claimed } : {}) } : null;
  const member = found && mine.find(m => m.inst === found.origin);

  async function look(value = text) {
    setBusy(true); setErr('');
    try {
      const d = await discover(value);
      setFound(d); setText(d.origin);
      setStep(instanceConn(d.origin)?.session ? 'join' : 'auth');
    } catch (e) { setErr(errorText(e.message)); setStep('url'); }
    setBusy(false);
  }
  useEffect(() => { if (url) look(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // opened from an invite link: join right after logging in
  useEffect(() => { if (step === 'join' && invite && live?.status === 'open' && !asked && !member) { setAsked(true); join(invite); } }, [step, live?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // logged in: it goes on the rail; a server that isn't set up yet is set up now
  async function authed(got) {
    const { origin } = found;
    const c = await addInstance(origin, found.info, got);
    if (found.info.claimed === false || (!found.info.community && c.isAdmin)) { onSetup?.(origin); return; }
    setStep('join');
  }
  async function viaVelora() {
    if (!hasVelora()) { startSignIn({ add: found.origin }); return; }
    setBusy(true); setErr('');
    try { await authed(await veloraSession(found.origin)); }
    catch (e) { setErr(e.message === 'insufficient_scope' ? 'This login has no chat permission - sign in with Nookara again and approve it.' : errorText(e.message)); }
    setBusy(false);
  }
  async function viaLocal(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (live) { await loginInstance(found.origin, tab, user.trim(), pass); if (found.info.claimed === false) onSetup?.(found.origin); else setStep('join'); }
      else await authed(await localSession(found.origin, tab, user.trim(), pass));
    } catch (er) { setErr(errorText(er.message)); }
    setBusy(false);
  }
  async function join(withCode) {
    setBusy(true);
    try {
      const r = await joinCommunity(found.origin, withCode, withCode ? undefined : joinPass);
      if (r.pending) { setAsked(true); toast(`Asked to join ${info.community?.name || 'the server'}.`, true); }
      else { onClose(); setTimeout(() => go({ kind: 'server', sid: r.sid }), 200); }
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  const closedSignup = found && info.accounts_mode === 'local' && info.registration !== 'open' && info.claimed !== false;
  const back = () => { setStep('url'); setFound(null); setErr(''); };

  return (
    <Dialog title="Add a server" sub="Every server has its own address. Enter it to find the server, log in and join - it then shows up in the list on the left." onClose={onClose} wide className="vc-inst-dialog">
      {close => (
        <>
          {(step === 'url' || step === 'look') && (
            <form onSubmit={e => { e.preventDefault(); look(); }}>
              <label className="vc-field"><span>Server address</span>
                <div className="vc-row"><input className="form-input" autoFocus placeholder="chat.example.com" value={text} onChange={e => setText(e.target.value)} />
                  <button className="btn btn-primary" type="submit" disabled={!text.trim() || busy}>{busy ? 'Looking...' : 'Continue'}</button></div></label>
              {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
              <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button></div>
            </form>
          )}
          {step === 'auth' && found && (
            <>
              <InstanceCard origin={found.origin} info={info} />
              {info.community?.description && <p className="vc-dialog-sub">{info.community.description}</p>}
              {(info.claimed === false || !info.community) && <p className="vc-note"><Server size={14} /> {info.claimed === false ? 'Nobody owns this server yet.' : "This server isn't set up yet."} {info.accounts_mode === 'local' ? 'Make an account' : 'Connect'}{info.claimed === false ? ' and you can set it up with its setup code.' : '.'}</p>}
              {info.accounts_mode === 'velora' ? (
                <>
                  {!hasVelora() && <p className="vc-note"><ShieldCheck size={14} /> This server uses Nookara accounts. Sign in with Nookara first, then connect.</p>}
                  {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
                  <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={back}>Back</button><span className="grow" />
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={viaVelora}><ShieldCheck size={15} /> {busy ? 'Connecting...' : hasVelora() ? 'Connect with Nookara' : 'Sign in with Nookara'}</button></div>
                </>
              ) : (
                <form onSubmit={viaLocal}>
                  <div className="vc-tabs flat vc-tabs-tight">
                    <button type="button" className={tab === 'login' ? 'on' : ''} onClick={() => { setTab('login'); setErr(''); }}>Log in</button>
                    <button type="button" className={tab === 'register' ? 'on' : ''} disabled={closedSignup} onClick={() => { setTab('register'); setErr(''); }}>Register</button>
                  </div>
                  {closedSignup && <p className="vc-hint vc-gap-top">This server isn't taking new accounts.</p>}
                  <label className="vc-field vc-gap-top"><span>Username</span><input className="form-input" autoFocus autoComplete="username" value={user} onChange={e => setUser(e.target.value)} maxLength={32} /></label>
                  <label className="vc-field"><span>Password</span><input className="form-input" type="password" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} value={pass} onChange={e => setPass(e.target.value)} /></label>
                  {tab === 'register' && <p className="vc-hint">2-32 letters, numbers, _ or . for the name, and a password of at least 8 characters. This account only exists on this server.</p>}
                  {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
                  <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={back}>Back</button><span className="grow" />
                    <button type="submit" className="btn btn-primary" disabled={busy || !user.trim() || !pass}>{busy ? 'Working...' : tab === 'login' ? 'Log in' : 'Create account'}</button></div>
                </form>
              )}
            </>
          )}
          {step === 'join' && found && (
            <>
              <InstanceCard origin={found.origin} info={info} />
              {info.community?.description && <p className="vc-dialog-sub">{info.community.description}</p>}
              {member && <p className="vc-note ok"><Check size={14} /> You're in this server.</p>}
              {!member && !info.community && <p className="vc-note"><Server size={14} /> {info.claimed === false ? 'Nobody owns this server yet.' : "Its owner hasn't set it up yet."} It shows up in your list and opens once it's ready.</p>}
              {!member && info.community && asked && <p className="vc-note"><Check size={14} /> Request sent. You'll be let in when someone accepts it.</p>}
              {!member && info.community && !asked && joinHint(info.community.join_policy) && <p className="vc-hint">{joinHint(info.community.join_policy)}</p>}
              {!member && info.community && !asked && info.community.join_policy === 'password' && (
                <label className="vc-field vc-gap-top"><span>Server password</span><input className="form-input" type="password" autoComplete="off" value={joinPass} onChange={e => setJoinPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && joinPass) join(); }} /></label>
              )}
              {!member && info.community && !asked && (
                <form className="vc-field vc-gap-top" onSubmit={e => { e.preventDefault(); if (code.trim()) join(code); }}><span>Have an invite code?</span>
                  <div className="vc-row"><input className="form-input" placeholder="Invite code or link" value={code} onChange={e => setCode(e.target.value)} /><button type="submit" className="btn btn-surface" disabled={!code.trim() || busy}>Join with invite</button></div></form>
              )}
              <div className="vc-dialog-btns"><span className="grow" />
                {member ? <button type="button" className="btn btn-primary" onClick={() => { close(); setTimeout(() => go({ kind: 'server', sid: member.sid }), 200); }}>Open server</button> : <>
                  <button type="button" className="btn btn-surface" onClick={close}>{asked || !info.community ? 'Done' : 'Not now'}</button>
                  {info.community && !asked && info.community.join_policy !== 'invite' && <button type="button" className="btn btn-primary" disabled={busy || (info.community.join_policy === 'password' && !joinPass)} onClick={() => join()}>{joinLabel(info.community.join_policy, 'Join')}</button>}</>}
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

// ── an instance's own settings (instance admins only): the Instance pages of Server settings ──
export async function restartInstance(origin, name) {
  if (!(await ask({ title: `Restart ${name}?`, text: 'Everyone on it is disconnected for a moment while it starts again. It only comes back by itself if it runs under something that restarts it (Docker, systemd).', confirm: 'Restart', danger: true }))) return;
  try { await apiFetch('/api/v1/instance/restart', { inst: origin, method: 'POST' }); toast('Restarting...', true); } catch (e) { toast(errorText(e.message)); }
}
export function InstanceTab({ origin, tab, onDirty }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState({});
  const [secrets, setSecrets] = useState({ cf_app_secret: '', cf_turn_token: '' });
  const [admins, setAdmins] = useState(null);
  const [newAdmin, setNewAdmin] = useState('');
  const [la, setLa] = useState({ username: '', password: '' }); // a local admin account, before switching to local accounts
  const [busy, setBusy] = useState('');
  const call = (path, o = {}) => apiFetch(`/api/v1${path}`, { inst: origin, ...o });
  useEffect(() => { call('/instance/settings').then(d => { setCfg(d); setF(d); }).catch(e => toast(errorText(e.message))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // accounts + voice save from the "unsaved changes" bar: dirty = the form differs from what the server has (or a secret is typed)
  const fv = f.voice || {};
  const accChanged = !!cfg && !cfg.managed && ((!cfg.accounts_mode_env && (f.accounts_mode || 'velora') !== (cfg.accounts_mode || 'velora')) || (f.registration || 'closed') !== (cfg.registration || 'closed') || (f.public_url || '') !== (cfg.public_url || '') || (f.velora_url || '') !== (cfg.velora_url || ''));
  const voiceChanged = !!cfg && ((fv.cf_app_id || '') !== (cfg.voice?.cf_app_id || '') || (fv.cf_turn_key_id || '') !== (cfg.voice?.cf_turn_key_id || '') || !!secrets.cf_app_secret || !!secrets.cf_turn_token);
  const changed = tab === 'accounts' ? accChanged : tab === 'voice' ? voiceChanged : false;
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  const reset = () => { setF(cfg); setSecrets({ cf_app_secret: '', cf_turn_token: '' }); };
  useEffect(() => { if (tab === 'admins' && !admins) call('/instance/admins').then(setAdmins).catch(e => toast(errorText(e.message))); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inst) return null;
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save(patch) {
    setBusy('save');
    try { const d = await call('/instance/settings', { method: 'PATCH', body: JSON.stringify(patch) }); setCfg(d); setF(d); setSecrets({ cf_app_secret: '', cf_turn_token: '' }); if (tab === 'velora') toast('Saved.', true); else flashSaved(); refreshInstance(origin); }
    catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  const voice = f.voice || {};
  const setVoice = (k, v) => set('voice', { ...voice, [k]: v });
  async function adminOp(id, add) {
    try { await call(`/instance/admins/${encodeURIComponent(id)}`, { method: add ? 'PUT' : 'DELETE' }); setNewAdmin(''); setAdmins(await call('/instance/admins')); } catch (e) { toast(errorText(e.message)); }
  }
  if (!cfg) return <div className="vc-loading"><i /><i /><i /></div>;
  const managed = cfg.managed || null; // hosted by Velora: its plan fixes some settings
  const needsRestart = f.accounts_mode !== cfg.running_accounts_mode || cfg.restart_required;
  // switching to local accounts locks out Velora sign-in: someone has to be able to sign in with a password (and switch back)
  const needLocalAdmin = !cfg.accounts_mode_env && (f.accounts_mode || 'velora') === 'local' && (cfg.accounts_mode || 'velora') !== 'local' && !cfg.local_admins?.length;
  async function makeLocalAdmin() {
    setBusy('local-admin');
    try { const d = await call('/instance/local-admin', { method: 'POST', body: JSON.stringify(la) }); setCfg(c => ({ ...c, local_admins: d.settings.local_admins })); setLa({ username: '', password: '' }); toast(`Made ${d.user.username} - you can save the switch now.`, true); }
    catch (e) { toast(errorText(e.message)); }
    setBusy('');
  }
  return (
    <div className={`vc-settings${tab === 'accounts' || tab === 'voice' ? ' bf-ss-page' : ''}`}>
      {tab === 'accounts' && managed && (
        <div className="card bf-ss-card"><div className="card-header"><span className="card-title"><KeyRound size={15} /> Who can log in</span></div><div className="card-body">
          <p className="vc-note"><ShieldCheck size={14} /> Hosted by Nookara: people log in with their Nookara account, at <b>{cfg.public_url}</b>. Servers that Nookara hosts can't switch to their own accounts or change their address.</p>
        </div></div>
      )}
      {tab === 'accounts' && !managed && (
        <>
          <div className="card bf-ss-card"><div className="card-header"><span className="card-title"><KeyRound size={15} /> Who can log in</span></div><div className="card-body">
            <div className="vc-field"><span>Accounts</span>
              <div className="bf-pe-vis">
                {[['velora', 'Nookara accounts', 'People log in with the Nookara account they already have. Their Nookara profile shows here, and messages can be signed.', ShieldCheck], ['local', "This server's own accounts", 'People register here with a username and password. No Nookara account needed.', KeyRound]].map(([id, label, hint, I]) => (
                  <label key={id} className={`bf-pe-vis-opt${(f.accounts_mode || 'velora') === id ? ' on' : ''}`}>
                    <input type="radio" name="bf-accounts" checked={(f.accounts_mode || 'velora') === id} disabled={cfg.accounts_mode_env} onChange={() => set('accounts_mode', id)} />
                    <span><b><I size={13} className="vc-inline-ico" /> {label}{cfg.running_accounts_mode === id ? ' (running now)' : ''}</b><small>{hint}</small></span>
                  </label>
                ))}
              </div>
              <small className="vc-hint">Changing it needs a restart, and people with the other kind of account can't log in afterwards.</small></div>
            {cfg.accounts_mode_env && <p className="vc-note"><TriangleAlert size={14} /> This server's environment fixes it (BONFIRE_ACCOUNTS_MODE={cfg.running_accounts_mode}). Remove that variable to change it here.</p>}
            {!cfg.accounts_mode_env && needsRestart && <p className="vc-note"><TriangleAlert size={14} /> {cfg.restart_required && f.accounts_mode === cfg.accounts_mode ? 'Saved - restart the server to switch.' : 'Save, then restart the server to switch.'}
              {cfg.restart_required && f.accounts_mode === cfg.accounts_mode && <button type="button" className="btn btn-surface btn-sm" onClick={() => restartInstance(origin, inst.name)}><RefreshCw size={13} /> Restart now</button>}</p>}
            {needLocalAdmin && (
              <div className="bf-ss-reg warn vc-gap-top bf-la">
                <TriangleAlert size={14} /><span><b>Make a local admin account first.</b> After the switch nobody can sign in with Nookara, so you need an account here with a username and password. It becomes an instance admin with the Administrator role, so you can always get back in and switch back.</span>
                {inst.isOwner ? <form className="vc-row bf-la-form" onSubmit={e => { e.preventDefault(); makeLocalAdmin(); }}>
                  <input className="form-input" placeholder="username" autoComplete="off" maxLength={32} value={la.username} onChange={e => setLa(x => ({ ...x, username: e.target.value }))} aria-label="Username" />
                  <input className="form-input" type="password" placeholder="password (8+ characters)" autoComplete="new-password" maxLength={200} value={la.password} onChange={e => setLa(x => ({ ...x, password: e.target.value }))} aria-label="Password" />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'local-admin' || !la.username.trim() || la.password.length < 8}><Plus size={13} /> Make account</button>
                </form> : <small>Only the server's owner can make it.</small>}
              </div>
            )}
            {!cfg.accounts_mode_env && (f.accounts_mode || 'velora') === 'local' && cfg.local_admins?.length > 0 && <p className="vc-note"><Check size={14} /> Local admin account{cfg.local_admins.length === 1 ? '' : 's'}: <b>{cfg.local_admins.join(', ')}</b>. Sign in with {cfg.local_admins.length === 1 ? 'it' : 'one'} after the switch.</p>}
            {(f.accounts_mode || 'velora') === 'local' && (
              <label className="vc-field vc-gap-top"><span>Registration</span>
                <select className="form-input" value={f.registration || 'closed'} onChange={e => set('registration', e.target.value)}><option value="open">Anyone can make an account</option><option value="closed">Closed - no new accounts</option></select></label>
            )}
          </div></div>
          <div className="card bf-ss-card"><div className="card-header"><span className="card-title"><Server size={15} /> Addresses</span></div><div className="card-body">
            <label className="vc-field"><span>Public address</span><input className="form-input" value={f.public_url || ''} onChange={e => set('public_url', e.target.value)} /><small className="vc-hint">The address people reach this server at. Nookara sign-ins are made out to it, so change it with care.</small></label>
            <label className="vc-field"><span>Nookara address</span><input className="form-input" value={f.velora_url || ''} onChange={e => set('velora_url', e.target.value)} /><small className="vc-hint">Which Nookara signs people in, and gives this server its services (both accounts modes).</small></label>
          </div></div>
          <UnsavedBar changed={changed} bar={bar} busy={busy === 'save'} disabled={needLocalAdmin} onReset={reset} onSave={() => save({ ...(cfg.accounts_mode_env ? {} : { accounts_mode: f.accounts_mode }), registration: f.registration, public_url: f.public_url, velora_url: f.velora_url })} />
        </>
      )}
      {tab === 'voice' && managed && !managed.limits?.custom_voice_keys && (
        <>
          <p className="vc-note"><Mic size={14} /> Your plan uses Nookara's voice{cfg.velora?.voice?.cap_minutes ? `, ${Number(cfg.velora.voice.cap_minutes).toLocaleString()} minutes a month` : ''}.</p>
        </>
      )}
      {tab === 'voice' && (
        <PlanGate block={managed && !managed.limits?.custom_voice_keys ? { what: 'custom_voice_keys', plan: managed.plan } : null}>
          <p className="vc-dialog-sub">Voice channels run on Cloudflare Realtime. Make an app and a TURN key in your Cloudflare dashboard and paste them here. Secrets are never shown again once saved.</p>
          <label className="vc-field"><span>Realtime app ID</span><input className="form-input" value={voice.cf_app_id || ''} onChange={e => setVoice('cf_app_id', e.target.value)} /></label>
          <label className="vc-field"><span>Realtime app secret {cfg.voice?.has_app_secret && <em className="vc-set"><Check size={12} /> set</em>}</span><input className="form-input" type="password" autoComplete="off" placeholder={cfg.voice?.has_app_secret ? 'Set - leave blank to keep it' : ''} value={secrets.cf_app_secret} onChange={e => setSecrets(s => ({ ...s, cf_app_secret: e.target.value }))} /></label>
          <label className="vc-field"><span>TURN key ID</span><input className="form-input" value={voice.cf_turn_key_id || ''} onChange={e => setVoice('cf_turn_key_id', e.target.value)} /></label>
          <label className="vc-field"><span>TURN key token {cfg.voice?.has_turn_token && <em className="vc-set"><Check size={12} /> set</em>}</span><input className="form-input" type="password" autoComplete="off" placeholder={cfg.voice?.has_turn_token ? 'Set - leave blank to keep it' : ''} value={secrets.cf_turn_token} onChange={e => setSecrets(s => ({ ...s, cf_turn_token: e.target.value }))} /></label>
          <UnsavedBar changed={changed} bar={bar} busy={busy === 'save'} onReset={reset} onSave={() => save({ voice: { cf_app_id: voice.cf_app_id || '', cf_turn_key_id: voice.cf_turn_key_id || '', cf_app_secret: secrets.cf_app_secret, cf_turn_token: secrets.cf_turn_token } })} />
        </PlanGate>
      )}
      {tab === 'velora' && <VeloraTab origin={origin} cfg={cfg} setCfg={d => { setCfg(d); setF(d); }} save={save} busy={busy} />}
      {tab === 'admins' && (
        <>
          <p className="vc-dialog-sub">Admins can change this server's settings. They have no special power in the server itself unless they're a member with roles. {inst.isOwner ? '' : 'Only the owner can add or remove admins.'}</p>
          {!admins && <div className="vc-loading"><i /><i /><i /></div>}
          <div className="vc-rows">
            {admins && [admins.owner, ...admins.admins.filter(a => a.id !== admins.owner?.id)].filter(Boolean).map(a => (
              <div key={a.id} className="vc-list-row">
                <Avatar user={a} size={32} />
                <span className="vc-list-txt"><b>{a.username}</b><small className="vc-mono">{a.id}{a.id === admins.owner?.id ? ' - owner' : ''}</small></span>
                <span className="grow" />
                {inst.isOwner && a.id !== admins.owner?.id && <button type="button" className="vc-ico-btn danger" title="Remove admin" onClick={() => adminOp(a.id, false)}><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
          {inst.isOwner && (
            <form className="vc-field vc-gap-top" onSubmit={e => { e.preventDefault(); if (newAdmin.trim()) adminOp(newAdmin.trim(), true); }}><span>Add an admin by user ID</span>
              <div className="vc-row"><input className="form-input" placeholder="v:123 or l:7" value={newAdmin} onChange={e => setNewAdmin(e.target.value)} /><button type="submit" className="btn btn-primary" disabled={!newAdmin.trim()}><Plus size={14} /> Add</button></div>
              <small className="vc-hint">Nookara accounts are v:&lt;their Nookara ID&gt;, accounts of this server are l:&lt;number&gt;. People who have logged in once can be made admins; their ID shows with "Copy account ID" in developer mode.</small></form>
          )}
        </>
      )}
    </div>
  );
}
// ── Velora & directory: the relays (registration, voice minutes), the public directory listing, payouts for paid roles ──
const ago = t => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
function VeloraTab({ origin, cfg, setCfg, save, busy }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const signedIn = useChat(s => s.signedIn);
  const [work, setWork] = useState('');
  const v = cfg.velora || {};
  const off = (cfg.velora_registration || 'auto') === 'off';
  const dir = v.directory || {};
  async function register() {
    setWork('register');
    try { const d = await apiFetch('/api/v1/instance/velora/register', { inst: origin, method: 'POST' }); setCfg(d); toast(d.velora?.registered ? 'Registered with Nookara.' : 'Nookara said no - see below.', !!d.velora?.registered); }
    catch (e) { toast(errorText(e.message)); }
    setWork('');
  }
  // the owner proves ownership with a short proof the instance signs; that goes to Velora with the owner's own Velora login
  // (Ember's Velora token never goes to the instance)
  // where paid-role credits go now (Velora knows; the owner or the current payee may ask)
  const [payee, setPayee] = useState(undefined); // undefined loading, null couldn't tell, { linked, payee, linked_at, you }
  const loadPayee = () => apiFetch(`/bonfire/instances/payout?url=${encodeURIComponent(origin)}`).then(setPayee).catch(() => setPayee(null));
  useEffect(() => { if (inst?.isOwner && signedIn && !off) loadPayee(); }, [origin, inst?.isOwner, signedIn, off]); // eslint-disable-line react-hooks/exhaustive-deps
  async function payouts() {
    setWork('payout');
    try {
      const a = await apiFetch('/api/v1/instance/owner-attestation', { inst: origin });
      await apiFetch('/bonfire/instances/payout', { method: 'POST', body: JSON.stringify({ attestation: a.attestation }) });
      toast('Payouts for paid roles now go to your Nookara account.', true);
      loadPayee();
    } catch (e) { toast(errorText(e.message)); }
    setWork('');
  }
  const voice = v.voice;
  return (
    <>
      <p className="vc-dialog-sub">Nookara gives this server push notifications, credit payments for paid roles, voice when you have no Cloudflare keys of your own, imports from Discord / Fluxer and a listing in the public directory. Nothing else is shared.</p>
      {!cfg.managed && <Toggle label="Use Nookara's services" hint={off ? 'Off: this server never contacts Nookara (no push, payments, voice minutes or directory).' : 'On: this server registers with Nookara and uses the services above.'} on={!off} disabled={busy === 'save'} onChange={on => save({ velora_registration: on ? 'auto' : 'off' })} />}

      {!off && (
        <div className="vc-br-note vc-gap-top">
          <div className="vc-row"><p className="grow">{v.registered ? <><Check size={13} className="vc-inline-ico" /> <b>Registered</b>{v.trusted ? ' - trusted by Nookara' : ''}{v.registered_at ? ` since ${ago(v.registered_at)}` : ''}</> : <><TriangleAlert size={13} className="vc-inline-ico" /> <b>Not registered yet</b></>}</p>
            <button type="button" className="btn btn-surface btn-sm" disabled={!!work} onClick={register}><RefreshCw size={13} /> {work === 'register' ? 'Registering...' : 'Register now'}</button></div>
          {v.instance_id && <p>ID <span className="vc-mono">{v.instance_id}</span>{v.velora_url ? ` on ${hostOf(v.velora_url)}` : ''}</p>}
          {v.last_error && <p className="vc-err"><TriangleAlert size={14} /> {errorText(v.last_error) === 'Something went wrong.' ? v.last_error : errorText(v.last_error)}</p>}
          <p>Voice: {v.voice_backend === 'direct' ? "your own Cloudflare keys" : voice ? (voice.cap_minutes == null ? `Nookara's voice, no limit (${Number(voice.used_minutes || 0).toLocaleString()} minutes this month)` : `Nookara's voice - ${Number(voice.used_minutes || 0).toLocaleString()} of ${Number(voice.cap_minutes).toLocaleString()} minutes used this month`) : 'not available'}</p>
          {voice?.cap_minutes != null && <div className="vc-game-bar vc-imp-bar"><i style={{ width: `${Math.min(100, (Number(voice.used_minutes || 0) / Math.max(1, voice.cap_minutes)) * 100)}%` }} /></div>}
        </div>
      )}
      <h3 className="vc-game-sec-title">Discover</h3>
      <p className="vc-dialog-sub">{cfg.listed ? (dir.hidden_by_staff ? "Listed, but Nookara's staff have hidden the listing." : dir.last_error ? `Listed - the last update failed: ${dir.last_error}` : `Listed in Discover${dir.pushed_at ? ` - updated ${ago(dir.pushed_at)}` : ''}.`) : 'Not listed in Discover.'} Show it in Discover and set its tags in Server &gt; Overview.</p>
      {inst?.isOwner && signedIn && !off && (
        <>
          <h3 className="vc-game-sec-title">Payouts</h3>
          <p className="vc-dialog-sub">Credits people pay for roles go to the owner's Nookara account. Link yours to receive them.</p>
          {payee === undefined ? <div className="vc-loading"><i /><i /><i /></div> : payee?.linked && payee.payee ? (
            <div className="vc-list-row bf-payee">
              <Avatar user={{ username: payee.payee.username, pfp: payee.payee.pfp }} size={32} />
              <span className="vc-list-txt"><b>Payouts go to {payee.payee.username}{payee.you ? ' (you)' : ''}</b><small>Linked{payee.linked_at ? ` ${ago(payee.linked_at)}` : ''} - their Nookara account gets the credits from paid roles.</small></span>
            </div>
          ) : <p className="vc-note"><TriangleAlert size={14} /> {payee === null ? "Couldn't check where payouts go right now." : "Not linked yet - people can't buy paid roles until an account is linked to receive the credits."}</p>}
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-primary" disabled={!!work || !v.registered} data-tip={v.registered ? undefined : 'Register with Nookara first'} onClick={payouts}>{work === 'payout' ? 'Linking...' : payee?.linked && payee.you ? 'Link again' : payee?.linked ? 'Send payouts to me instead' : 'Link payouts to my Nookara account'}</button></div>

        </>
      )}
    </>
  );
}

// ── Bridge bots (top of Server settings > Bridge, for the instance's admins): the owner's own Discord / Fluxer bots
// (tokens are write-only; only the last 4 characters come back) ──
const BRIDGE_STATE = { off: 'Off', connecting: 'Connecting...', ready: 'Connected', waiting: 'Not connected - trying again soon', error: 'Stopped - check the token', stopped: 'Stopped' };
export function BridgeBots({ origin, onPlan, gated }) {
  const [d, setD] = useState(null);
  const [tok, setTok] = useState({ discord: '', fluxer: '' });
  const [busy, setBusy] = useState('');
  const call = (o = {}) => apiFetch('/api/v1/bridge/settings', { inst: origin, ...o });
  useEffect(() => { if (gated) return undefined; let live = true; const load = () => call().then(x => live && setD(x.bridges)).catch(e => { if (!live) return; const p = planOf(e); if (p) { live = false; onPlan?.({ ...p, what: 'bridges' }); } else toast(errorText(e.message)); }); load(); const t = setInterval(load, 5000); return () => { live = false; clearInterval(t); }; }, [gated]); // eslint-disable-line react-hooks/exhaustive-deps
  async function put(p, token) {
    setBusy(p);
    try { const x = await call({ method: 'PATCH', body: JSON.stringify({ [p]: { token } }) }); setD(x.bridges); setTok(t => ({ ...t, [p]: '' })); toast(token === null ? 'Removed.' : 'Saved.', true); }
    catch (e) { toast(e.message === 'invalid_token' ? `That ${p === 'discord' ? 'Discord' : 'Fluxer'} token didn't work.` : errorText(e.message)); }
    setBusy('');
  }
  if (!d && !gated) return <div className="vc-loading"><i /><i /><i /></div>;
  const dd = d || {}; // (gated by the plan: the form shows empty behind the overlay)
  return (
    <>
      <h3 className="vc-game-sec-title">Bridge bots</h3>
      <p className="vc-dialog-sub">Bridges carry messages between this server and Discord or Fluxer with <b>your own bot</b>. Make a bot in the platform's developer portal (Discord: turn on the Message Content intent), paste its token here, then link a server below and pick channels in each channel's settings.</p>
      {['discord', 'fluxer'].map(p => {
        const b = dd[p] || {};
        return (
          <div key={p} className="vc-br-note vc-gap-top">
            <div className="vc-row"><PlatformIcon p={p} size={20} /><p className="grow"><b>{p === 'discord' ? 'Discord' : 'Fluxer'}</b> - {b.configured ? `${BRIDGE_STATE[b.state] || b.state}${b.bot ? ` as ${b.bot.username}` : ''}` : 'no bot'}</p>
              {b.configured && b.source !== 'env' && <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => put(p, null)}><Trash2 size={13} /> Remove</button>}</div>
            {b.error && <p className="vc-err"><TriangleAlert size={14} /> {b.error}</p>}
            {b.source === 'env' && <p className="vc-hint">Set by the server's environment ({p === 'discord' ? 'BONFIRE_DISCORD_TOKEN' : 'BONFIRE_FLUXER_TOKEN'}).</p>}
            <form className="vc-row" onSubmit={e => { e.preventDefault(); if (tok[p].trim()) put(p, tok[p].trim()); }}>
              <input className="form-input" type="password" autoComplete="off" placeholder={b.token ? `Saved (${b.token}) - paste a new one to replace it` : 'Bot token'} value={tok[p]} onChange={e => setTok(t => ({ ...t, [p]: e.target.value }))} />
              <button type="submit" className="btn btn-primary" disabled={!tok[p].trim() || !!busy}>{busy === p ? 'Checking...' : 'Save'}</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
