// Server settings > Backups (an Ember server's admins; restoring is the owner's): backups the server keeps itself, and the
// ones in your Velora account. Any server can make them - hosted by Velora or self-hosted, any plan. Ember moves the zip
// between the two (download from one, upload to the other): Velora tokens never go to a server, and servers never call Velora
// for this. A backup is Ember's portable export (PROTOCOL §9), so it also restores into a brand-new server.
import { useEffect, useRef, useState } from 'react';
import { Archive, Download, CloudUpload, RefreshCw, Trash2, Plus, Upload, Server, TriangleAlert } from 'lucide-react';
import { apiFetch, uploadFetch, downloadFetch } from '../api.js';
import { useChat, toast, errorText, ask, go } from './store.js';
import { hasVelora } from './session.js';
import { normOrigin } from './ids.js';
import { HOSTING_TEXT } from './Hosting.jsx';
import { usePlan, PlanGate, PlanNotice, PlanUsage } from './PlanGate.jsx';

const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const sizeOf = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const fail = e => toast(HOSTING_TEXT[e?.message] || errorText(e?.message));
const REASON = { archived: 'Saved when its time ran out', deleted: 'Saved when it was deleted', manual: 'Saved by Nookara hosting', uploaded: 'Saved from the server', 'before restore': 'Before a restore' };
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function BackupsPage({ origin }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const owner = !!inst?.isOwner;
  const signedIn = hasVelora();
  const [list, setList] = useState(null); // the server's own
  const [mine, setMine] = useState(null); // in your Velora account
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(''); // what's working: 'make' | '<id>:<what>'
  const pick = useRef(null);
  const call = (path, o = {}) => apiFetch(`/api/v1/instance${path}`, { inst: origin, ...o });
  const plan = usePlan('backups', list ? list.length : undefined);
  const load = () => plan.gate ? (setList([]), Promise.resolve()) : call('/backups').then(d => setList(d.backups || [])).catch(e => { setList([]); if (!plan.catchPlan(e)) fail(e); });
  const loadMine = () => (signedIn && !plan.gate ? apiFetch('/bonfire/hosting/backups').then(d => setMine(d.backups || [])).catch(() => setMine([])) : setMine([]));
  useEffect(() => { load(); loadMine(); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = (mine || []).filter(b => !b.url || normOrigin(b.url) === origin);
  const other = (mine || []).filter(b => b.url && normOrigin(b.url) !== origin);
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { if (!plan.catchPlan(e)) fail(e); } setBusy(''); };
  const fileName = b => `${(inst?.name || 'bonfire').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date(b.created_at).toISOString().slice(0, 10)}.zip`;

  const make = () => run('make', async () => { await call('/backups', { method: 'POST', body: JSON.stringify({ note: note.trim() || undefined }) }); setNote(''); await load(); toast('Backup made.', true); });
  const fromServer = b => downloadFetch(`/api/v1/instance/backups/${b.id}/download`, { inst: origin, filename: fileName(b) });
  const download = b => run(`${b.id}:dl`, async () => { const { blob, filename } = await fromServer(b); save(blob, filename); });
  const toVelora = b => run(`${b.id}:up`, async () => {
    const { blob, filename } = await fromServer(b);
    const fd = new FormData();
    fd.append('file', new File([blob], filename, { type: 'application/zip' }));
    fd.append('name', inst?.name || ''); fd.append('url', origin);
    await uploadFetch('/bonfire/hosting/backups/upload', fd);
    await loadMine(); toast('Saved to your Nookara account.', true);
  });
  const remove = b => run(`${b.id}:rm`, async () => {
    if (!(await ask({ title: 'Delete this backup?', text: 'It is gone for good from this server.', confirm: 'Delete backup', danger: true }))) return;
    await call(`/backups/${b.id}`, { method: 'DELETE' }); await load();
  });
  const sure = what => ask({ title: `Restore ${inst?.name || 'this server'}?`, text: `Everything in it - channels, roles, messages, emojis - is replaced with ${what}. People stay signed in but see the server as it was then. A backup of how it is now is made first, so you can go back.`, confirm: 'Restore', danger: true });
  const done = () => { toast('Restored - reconnecting...', true); load(); setTimeout(() => go({ kind: 'instance', inst: origin }), 400); }; // (a restore gives the server a new id: open it afresh)
  const restoreHere = b => run(`${b.id}:rs`, async () => { if (!(await sure(`the backup from ${when(b.created_at)}`))) return; await call(`/backups/${b.id}/restore`, { method: 'POST' }); done(); });
  const restoreBlob = async (blob, label) => { if (!(await sure(label))) return; const fd = new FormData(); fd.append('file', new File([blob], 'backup.zip', { type: 'application/zip' })); await uploadFetch('/api/v1/instance/restore', fd, { inst: origin }); done(); };
  const restoreVelora = b => run(`v${b.id}:rs`, async () => { const { blob } = await downloadFetch(`/bonfire/hosting/backups/${b.id}/download`); await restoreBlob(blob, `the backup from ${when(b.created_at)}`); });
  const restoreFile = file => run('file', () => restoreBlob(file, file.name));
  const downloadVelora = b => run(`v${b.id}:dl`, async () => { const { blob, filename } = await downloadFetch(`/bonfire/hosting/backups/${b.id}/download`, { filename: fileName(b) }); save(blob, filename); });
  const removeVelora = b => run(`v${b.id}:rm`, async () => {
    if (!(await ask({ title: 'Delete this backup?', text: 'It is gone for good from your Nookara account.', confirm: 'Delete backup', danger: true }))) return;
    await apiFetch(`/bonfire/hosting/backups/${b.id}`, { method: 'DELETE' }); await loadMine();
  });
  const ro = inst?.readOnly;

  const veloraRow = b => (
    <div key={`v${b.id}`} className="vc-list-row">
      <CloudUpload size={18} />
      <span className="vc-list-txt"><b>{b.name || b.slug || 'Backup'} - {when(b.created_at)}</b><small>{REASON[b.reason] || 'Backup'}{b.url ? ` - ${b.url.replace(/^https?:\/\//, '')}` : ''} - {sizeOf(b.size)}</small></span>
      <span className="grow" />
      <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => downloadVelora(b)}><Download size={13} /> {busy === `v${b.id}:dl` ? 'Downloading...' : 'Download'}</button>
      {owner && <button type="button" className="btn btn-surface btn-sm" disabled={!!busy || ro} onClick={() => restoreVelora(b)}><RefreshCw size={13} /> {busy === `v${b.id}:rs` ? 'Restoring...' : 'Restore here'}</button>}
      <button type="button" className="vc-ico-btn danger" title="Delete backup" disabled={!!busy} onClick={() => removeVelora(b)}><Trash2 size={15} /></button>
    </div>
  );
  return (
    <PlanGate block={plan.gate}>
    <div className="bf-ss-page">
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Archive size={15} /> Backups on this server</span>{!plan.gate && <PlanUsage what="backups" used={list ? list.length : undefined} />}</div>
        <div className="card-body">
          <PlanNotice block={plan.full} />
          <small className="vc-hint">A backup is a zip of the whole server: channels, roles, members, emojis, files and every message. It can be restored here or into a new server. This server keeps its last {list?.length >= 10 ? 'few' : '10'}.</small>
          {ro && <p className="vc-note warn"><TriangleAlert size={14} /> The server is read-only: you can download its backups, but not make or restore one.</p>}
          <div className="vc-row vc-gap-top">
            <input className="form-input" maxLength={100} placeholder="Note (optional), e.g. before the big cleanup" value={note} disabled={ro} onChange={e => setNote(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={!!busy || ro || !!plan.full || !!plan.gate} onClick={make}><Plus size={14} /> {busy === 'make' ? 'Making...' : 'Make a backup'}</button>
          </div>
          {list === null ? <div className="vc-loading"><i /><i /><i /></div> : !list.length ? <p className="vc-hint">No backups yet.</p> : (
            <div className="vc-rows vc-gap-top">{list.map(b => (
              <div key={b.id} className="vc-list-row">
                <Archive size={18} />
                <span className="vc-list-txt"><b>{when(b.created_at)}</b><small>{[b.note, b.by?.username ? `by ${b.by.username}` : null, sizeOf(b.size)].filter(Boolean).join(' - ')}</small></span>
                <span className="grow" />
                <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={() => download(b)}><Download size={13} /> {busy === `${b.id}:dl` ? 'Downloading...' : 'Download'}</button>
                {signedIn && <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} data-tip="Keep a copy in your Nookara account" onClick={() => toVelora(b)}><CloudUpload size={13} /> {busy === `${b.id}:up` ? 'Saving...' : 'Save to Nookara'}</button>}
                {owner && <button type="button" className="btn btn-surface btn-sm" disabled={!!busy || ro} onClick={() => restoreHere(b)}><RefreshCw size={13} /> {busy === `${b.id}:rs` ? 'Restoring...' : 'Restore'}</button>}
                <button type="button" className="vc-ico-btn danger" title="Delete backup" disabled={!!busy || ro} onClick={() => remove(b)}><Trash2 size={15} /></button>
              </div>))}</div>
          )}
        </div>
      </div>
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><CloudUpload size={15} /> In your Nookara account</span></div>
        <div className="card-body">
          {!signedIn ? <p className="vc-hint">Sign in with Nookara to keep backups in your account, safe even if this server goes away.</p> : mine === null ? <div className="vc-loading"><i /><i /><i /></div> : (
            <>
              <small className="vc-hint">Up to 10 backups, 500 MB each, kept for 180 days. Nookara hosting also saves one here when a hosted server is deleted or runs out of time.</small>
              {!here.length && !other.length && <p className="vc-hint">Nothing here yet - use Save to Nookara on a backup above.</p>}
              {here.length > 0 && <div className="vc-rows vc-gap-top">{here.map(veloraRow)}</div>}
              {owner && other.length > 0 && (<><div className="vc-sec-t vc-gap-top"><Server size={13} className="vc-inline-ico" /> From other servers</div><div className="vc-rows">{other.map(veloraRow)}</div></>)}
            </>
          )}
        </div>
      </div>
      {owner && (
        <div className="card bf-ss-card">
          <div className="card-header"><span className="card-title"><Upload size={15} /> Restore from a file</span></div>
          <div className="card-body"><div className="cs-row"><div className="cs-text"><b>Upload a backup or export</b><span>A zip from Download, or an Ember export from any server. It replaces everything in this server.</span></div>
            <label className={`btn btn-surface${busy || ro ? ' disabled' : ''}`}><Upload size={14} /> {busy === 'file' ? 'Restoring...' : 'Choose a zip'}<input ref={pick} type="file" hidden accept=".zip,application/zip" disabled={!!busy || ro} onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFile(f); }} /></label></div></div>
        </div>
      )}
    </div>
    </PlanGate>
  );
}
