// First-run setup of a server (an instance with one community): claim it with the setup code, make the server (name,
// description, icon - or import one), pick how accounts work, set its options. Every step but the first two can be skipped.
import { useEffect, useRef, useState } from 'react';
import { Check, Upload, RefreshCw, KeyRound, TriangleAlert } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { Dialog } from './Dialogs.jsx';
import { Toggle } from './roles.jsx';
import { initials } from './Parts.jsx';
import { useChat, toast, errorText, ask, go, refreshServer } from './store.js';
import { refreshInstance, loadInstanceData, hostOf } from './instances.js';
import { VeloraImport } from './Bridge.jsx';
import { PlatformIcon } from './platforms.jsx';
import { OperatorTermsCheck } from './OperatorTerms.jsx';

const STEPS = ['Claim', 'Your server', 'Accounts', 'Options', 'Done'];

// (a server hosted by Velora always uses Velora accounts: the "how do people sign in" step is skipped)
export function SetupWizard({ origin, onClose, name: givenName = '' }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const had = useChat(s => s.servers.find(x => x.inst === origin));
  const accountsStep = inst?.managed ? 3 : 2;
  const [step, setStep] = useState(() => (inst && inst.claimed ? (inst.community || had ? accountsStep : 1) : 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [terms, setTerms] = useState(false); // Ember Server Operator Terms: setting up a server means accepting them
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState('velora');
  const [f, setF] = useState({ name: givenName, description: '' });
  const [icon, setIcon] = useState(null); // { file, url }
  const [sid, setSid] = useState(had?.sid || null); // the server (namespaced)
  const [opts, setOpts] = useState({ join_policy: 'request', allow_uploads: true, upload_max_mb: '25' });
  const [restartNote, setRestartNote] = useState(false);
  const [importing, setImporting] = useState(false); // "Your server" -> Import from Discord / Fluxer
  const signedIn = useChat(s => s.signedIn);
  const pick = useRef(null);
  const call = (path, o = {}) => apiFetch(`/api/v1${path}`, { inst: origin, ...o });
  const claimed = !!inst?.claimed;
  const loadCfg = () => call('/instance/settings').then(d => { setCfg(d); setMode(d.accounts_mode); }).catch(() => {});
  useEffect(() => { if (claimed && !cfg) loadCfg(); }, [claimed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (icon) URL.revokeObjectURL(icon.url); }, [icon]);
  useEffect(() => { if (sid && step >= 3) refreshServer(sid).then(d => { const v = d?.server; if (v) setOpts({ join_policy: v.join_policy, allow_uploads: v.allow_uploads !== false, upload_max_mb: String(v.upload_max_mb || 25) }); }); }, [sid, step === 3]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inst) return null;
  const name = inst.community?.name || had?.name || inst.name;

  async function run(fn, next = true) {
    setBusy(true); setErr('');
    try { await fn(); if (next) setStep(x => x + 1); } catch (e) { setErr(errorText(e.message)); }
    setBusy(false);
  }
  const claim = () => run(async () => {
    await call('/instance/claim', { method: 'POST', body: JSON.stringify({ code: code.trim(), accept_operator_terms: true }) });
    await refreshInstance(origin);
    await loadCfg();
  });
  // the server and the instance are one thing: this form names both
  const made = async k => { setSid(k); await refreshInstance(origin); await loadInstanceData(origin); };
  const createServer = () => run(async () => {
    const d = await apiFetch('/chat/servers', { method: 'POST', inst: origin, body: JSON.stringify({ name: f.name.trim(), description: f.description }) });
    if (icon) { const fd = new FormData(); fd.append('file', icon.file); await uploadFetch(`/chat/servers/${d.server.sid}/icon`, fd).catch(() => toast("The icon didn't upload - add it later in Server settings.")); }
    await made(d.server.sid);
    setStep(accountsStep);
  }, false);
  const importZip = file => run(async () => {
    const fd = new FormData(); fd.append('file', file);
    const d = await uploadFetch('/api/v1/import', fd, { inst: origin });
    await made(d.sid); // already namespaced by the api layer
    setStep(accountsStep);
  }, false);
  const saveMode = () => run(async () => {
    if (cfg && mode !== cfg.accounts_mode) { await call('/instance/settings', { method: 'PATCH', body: JSON.stringify({ accounts_mode: mode }) }); setRestartNote(true); await loadCfg(); }
  }, false);
  const saveOpts = () => run(async () => {
    const body = { join_policy: opts.join_policy, allow_uploads: opts.allow_uploads, upload_max_mb: Number(opts.upload_max_mb) };
    await apiFetch(`/chat/servers/${sid}`, { method: 'PATCH', body: JSON.stringify(body) });
    await refreshServer(sid);
  });
  async function restart() {
    if (!(await ask({ title: `Restart ${name}?`, text: 'It disconnects everyone for a moment while it starts again. It only comes back by itself if it runs under something that restarts it (Docker, systemd).', confirm: 'Restart', danger: true }))) return;
    try { await call('/instance/restart', { method: 'POST' }); toast('Restarting...', true); setRestartNote(false); setStep(3); } catch (e) { toast(errorText(e.message)); }
  }
  const skip = () => setStep(x => x + 1);
  const Foot = ({ onNext, nextLabel = 'Continue', disabled, canSkip = true, close }) => (
    <div className="vc-dialog-btns">
      {step === 4 ? null : <button type="button" className="btn btn-surface" onClick={close}>Finish later</button>}
      <span className="grow" />
      {canSkip && step > 1 && step < 4 && <button type="button" className="btn btn-surface" disabled={busy} onClick={skip}>Skip</button>}
      <button type="button" className="btn btn-primary" disabled={busy || disabled} onClick={onNext}>{busy ? 'Working...' : nextLabel}</button>
    </div>
  );

  return (
    <Dialog title={`Set up ${inst.community?.name || had?.name || 'your server'}`} sub={hostOf(origin)} onClose={onClose} wide className="vc-setup">
      {close => (
        <>
          <ol className="vc-steps" aria-label="Setup steps">
            {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}><i>{i < step ? <Check size={12} /> : i + 1}</i><span>{s}</span></li>)}
          </ol>
          {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
          {step === 0 && (
            <>
              <p className="vc-dialog-sub">Nobody owns this server yet. Enter its setup code to become the owner. The code is printed in the server's console when it starts, and saved in <span className="vc-mono">setup-code.txt</span> in its data folder.</p>
              <label className="vc-field"><span>Setup code</span><input className="form-input vc-mono vc-narrow" autoFocus placeholder="XXXX-XXXX" maxLength={9} value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter' && code.trim() && terms) claim(); }} /></label>
              <OperatorTermsCheck checked={terms} onChange={setTerms} />
              <Foot onNext={claim} nextLabel="Claim this server" disabled={!code.trim() || !terms} canSkip={false} close={close} />
            </>
          )}
          {step === 1 && importing && <VeloraImport origin={origin} onCancel={() => setImporting(false)} onDone={k => run(async () => { await made(k); setImporting(false); toast('Imported.', true); setStep(accountsStep); }, false)} />}

          {step === 1 && !importing && (
            <>
              <p className="vc-dialog-sub">What should people see when they find this server? You can change all of this later in its settings. Or bring one over: from an Ember export (a <span className="vc-mono">.zip</span> from another server or from Nookara), or from Discord / Fluxer.</p>
              <div className="vc-field"><span>Icon</span>
                <div className="vc-img-row"><span className="vc-srv-ico lg">{icon ? <img src={icon.url} alt="" /> : initials(f.name || 'My server')}</span>
                  <button type="button" className="btn btn-surface" onClick={() => pick.current?.click()}><Upload size={14} /> Upload</button>
                  {icon && <button type="button" className="btn btn-surface" onClick={() => setIcon(null)}>Remove</button>}
                  <input ref={pick} type="file" hidden accept="image/*" onChange={e => { const x = e.target.files[0]; e.target.value = ''; if (x) setIcon({ file: x, url: URL.createObjectURL(x) }); }} /></div></div>
              <label className="vc-field"><span>Server name</span><input className="form-input" autoFocus maxLength={60} value={f.name} placeholder="My server" onChange={e => setF(x => ({ ...x, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && f.name.trim()) createServer(); }} /></label>
              <label className="vc-field"><span>Description</span><textarea className="form-textarea" rows={3} maxLength={300} value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="What is it for?" /></label>
              <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={close}>Finish later</button><span className="grow" />
                <button type="button" className="btn btn-surface" disabled={busy || !signedIn} data-tip={signedIn ? undefined : 'Sign in with Nookara to import from Discord or Fluxer'} onClick={() => setImporting(true)}><PlatformIcon p="discord" size={14} /><PlatformIcon p="fluxer" size={14} /> Import from Discord / Fluxer</button>
                <label className={`btn btn-surface${busy ? ' disabled' : ''}`}><Upload size={14} /> Import an export<input type="file" hidden accept=".zip,application/zip" onChange={e => { const x = e.target.files[0]; e.target.value = ''; if (x) importZip(x); }} /></label>
                <button type="button" className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={createServer}>{busy ? 'Working...' : 'Create server'}</button></div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="vc-dialog-sub">How do people sign in? You can't mix the two.</p>
              <div className="vc-seg-pick">
                {[['velora', 'Nookara accounts', 'People log in with the Nookara account they already have. Messages can be signed.'], ['local', "This server's own accounts", 'People register here with a username and password.']].map(([id, label, hint]) => (
                  <button key={id} type="button" className={`vc-check-card${mode === id ? ' on' : ''}`} onClick={() => setMode(id)}><KeyRound size={16} /><span><b>{label}</b><small>{hint}</small></span></button>
                ))}
              </div>
              <p className="vc-hint">Running now: <b>{cfg?.running_accounts_mode === 'local' ? 'own accounts' : 'Nookara accounts'}</b>.</p>
              {(restartNote || cfg?.restart_required) && <p className="vc-note"><RefreshCw size={14} /> Saved - the server has to restart to switch.</p>}
              <div className="vc-dialog-btns">
                <button type="button" className="btn btn-surface" onClick={close}>Finish later</button><span className="grow" />
                {(restartNote || cfg?.restart_required) && <button type="button" className="btn btn-surface" onClick={restart}><RefreshCw size={14} /> Restart server</button>}
                <button type="button" className="btn btn-surface" disabled={busy} onClick={skip}>Skip</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => (cfg && mode !== cfg.accounts_mode ? saveMode() : skip())}>{cfg && mode !== cfg.accounts_mode ? 'Save' : 'Continue'}</button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              {!sid ? <p className="vc-dialog-sub">There's no server to set up yet.</p> : (
                <>
                  <p className="vc-dialog-sub">How does the server work? You can change all of this later in its settings.</p>
                  <Toggle label="Anyone can join without asking" hint={opts.join_policy === 'open' ? 'On: open to everyone who finds it.' : 'Off: people ask to join and you let them in. An invite link always works.'} on={opts.join_policy === 'open'} onChange={v => setOpts(o => ({ ...o, join_policy: v ? 'open' : 'request' }))} />
                  <Toggle label="Allow uploads" hint="Pictures, videos and files, stored on this server." on={opts.allow_uploads} onChange={v => setOpts(o => ({ ...o, allow_uploads: v }))} />
                  <label className="vc-field vc-gap-top"><span>Biggest file (MB)</span><input className="form-input vc-narrow" type="number" min={1} max={500} value={opts.upload_max_mb} disabled={!opts.allow_uploads} onChange={e => setOpts(o => ({ ...o, upload_max_mb: e.target.value }))} /></label>
                </>
              )}
              <Foot onNext={sid ? saveOpts : skip} close={close} />
            </>
          )}
          {step === 4 && (
            <>
              <p className="vc-dialog-sub"><Check size={14} className="vc-inline-ico" /> {name} is ready. You're its owner - open its settings any time from the server's menu (right-click its icon on the left).</p>
              <div className="vc-dialog-btns"><span className="grow" />
                {sid && <button type="button" className="btn btn-surface" onClick={() => { close(); setTimeout(() => go({ kind: 'server', sid }), 200); }}>Open the server</button>}
                <button type="button" className="btn btn-primary" onClick={close}>Done</button></div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
