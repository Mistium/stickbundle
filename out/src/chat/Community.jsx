// Server settings pages that only exist for communities on an instance (join policy + requests + invites, uploads),
// and the Export button (instances and Velora's own servers).
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Trash2, UserCheck, UserX, Plus } from 'lucide-react';
import { apiFetch, downloadFetch } from '../api.js';
import { useChat, refreshServer, toast, errorText, ask, linkFor } from './store.js';
import { instOf, bare } from './ids.js';
import { Toggle } from './roles.jsx';
import { Avatar } from './Profile.jsx';
import { stampOf } from './text.jsx';
import { usePlan, PlanNotice, PlanUsage } from './PlanGate.jsx';

const patch = (sid, body) => apiFetch(`/chat/servers/${sid}`, { method: 'PATCH', body: JSON.stringify(body) }).then(() => refreshServer(sid));
const fail = e => toast(errorText(e.message));
// the join button and a line under it for a server's join policy (Gate, Instances)
export const joinLabel = (policy, fallback) => ({ request: 'Request to join', password: 'Join with password' })[policy] || fallback;
export const joinHint = policy => ({ request: 'Someone on the server lets you in.', password: 'This server asks for a password.', allowlist: 'Only people on its list can join.', invite: 'You need an invite link to join.' })[policy] || '';
const EXPIRES = [['Never', ''], ['30 minutes', 1800], ['1 hour', 3600], ['1 day', 86400], ['7 days', 604800], ['30 days', 2592000]];

// requestsOnly: inside Server settings > Joining (which has the join policy and member limit itself)
export function JoinInvites({ sid, requestsOnly }) {
  const srv = useChat(s => s.detail[sid]?.server);
  const people = useChat(s => s.members[sid]);
  const waiting = useChat(s => s.joinRequests[sid] || 0);
  const [reqs, setReqs] = useState(null);
  const [invites, setInvites] = useState(null);
  const [exp, setExp] = useState('');
  const [max, setMax] = useState('');
  const [copied, setCopied] = useState('');
  const loadReqs = () => apiFetch(`/chat/servers/${sid}/requests`).then(d => setReqs(d.requests)).catch(() => setReqs([]));
  const loadInvites = () => apiFetch(`/chat/servers/${sid}/invites`).then(d => setInvites(d.invites)).catch(() => setInvites([]));
  useEffect(() => { loadReqs(); loadInvites(); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadReqs(); }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!srv) return null;
  const decide = async (r, yes) => {
    try { await apiFetch(`/chat/servers/${sid}/requests/${encodeURIComponent(r.user.id)}/${yes ? 'accept' : 'deny'}`, { method: 'POST' }); setReqs(l => l.filter(x => x.user.id !== r.user.id)); refreshServer(sid); }
    catch (e) { fail(e); loadReqs(); }
  };
  const create = async () => {
    try {
      const body = {};
      if (exp) body.expires_in = Number(exp);
      if (max.trim()) body.max_uses = Number(max);
      await apiFetch(`/chat/servers/${sid}/invites`, { method: 'POST', body: JSON.stringify(body) });
      setMax(''); loadInvites();
    } catch (e) { fail(e); }
  };
  const copy = (code) => { navigator.clipboard?.writeText(linkFor({ kind: 'invite', code, inst: instOf(sid) })); setCopied(code); setTimeout(() => setCopied(''), 1500); };
  return (
    <div className="vc-settings">
      {!requestsOnly && <PlanUsage what="member_cap" used={people ? people.filter(m => !m.bot).length : undefined} label="People" />}
      {!requestsOnly && <Toggle label="Anyone can join without asking" hint={srv.join_policy === 'open' ? 'On: people who find the server can join straight away.' : 'Off: people ask to join and someone with the right permissions lets them in. An invite link always lets you in.'} on={srv.join_policy === 'open'} onChange={v => patch(sid, { join_policy: v ? 'open' : 'request' }).catch(fail)} />}
      <div className={`vc-field${requestsOnly ? '' : ' vc-gap-top'}`}><span>Waiting to join {reqs?.length ? `- ${reqs.length}` : ''}</span>
        {reqs === null && <div className="vc-loading"><i /><i /><i /></div>}
        {reqs && !reqs.length && <div className="vc-hint">No one is waiting.</div>}
        <div className="vc-rows">
          {(reqs || []).map(r => (
            <div key={r.user.id} className="vc-list-row">
              <Avatar user={r.user} size={32} />
              <span className="vc-list-txt"><b>{r.user.username}</b>{r.message && <small>{r.message}</small>}<small>{stampOf(r.created_at)}</small></span>
              <span className="grow" />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(r, true)}><UserCheck size={13} /> Accept</button>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => decide(r, false)}><UserX size={13} /> Deny</button>
            </div>
          ))}
        </div>
      </div>
      <div className="vc-field vc-gap-top"><span>Invites</span>
        <div className="vc-row vc-invite-new">
          <select className="form-input" value={exp} onChange={e => setExp(e.target.value)} aria-label="Expires after">{EXPIRES.map(([l, v]) => <option key={l} value={v}>{v === '' ? 'Never expires' : `Expires in ${l}`}</option>)}</select>
          <input className="form-input" type="number" min={1} max={100000} placeholder="Max uses" value={max} onChange={e => setMax(e.target.value)} aria-label="Max uses" />
          <button type="button" className="btn btn-primary" onClick={create}><Plus size={14} /> Create invite</button>
        </div>
        {invites === null && <div className="vc-loading"><i /><i /><i /></div>}
        {invites && !invites.length && <div className="vc-hint">No invites yet.</div>}
        <div className="vc-rows">
          {(invites || []).map(i => (
            <div key={i.code} className="vc-list-row">
              <span className="vc-list-txt"><b className="vc-mono">{i.code}</b><small>{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ''} use{i.uses === 1 ? '' : 's'} - {i.expires_at ? `expires ${stampOf(i.expires_at)}` : 'never expires'}</small></span>
              <span className="grow" />
              <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(i.code)}>{copied === i.code ? <Check size={13} /> : <Copy size={13} />} Copy link</button>
              <button type="button" className="vc-ico-btn danger" title="Delete invite" onClick={async () => { try { await apiFetch(`/chat/invites/${i.code}`, { method: 'DELETE', inst: instOf(sid) }); loadInvites(); } catch (e) { fail(e); } }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UploadsTab({ sid }) {
  const srv = useChat(s => s.detail[sid]?.server);
  const admin = useChat(s => !!s.instances.find(i => i.origin === instOf(sid))?.isAdmin);
  const [mb, setMb] = useState(String(srv?.upload_max_mb ?? 25));
  // one number for people: the server's own limit and the instance's ceiling are the same server now (one community per
  // instance), so its admins set both together; a plan from Velora hosting can cap it lower
  const [cfg, setCfg] = useState(null);
  const plan = usePlan('max_upload_mb');
  useEffect(() => { if (admin) apiFetch('/api/v1/instance/settings', { inst: instOf(sid) }).then(setCfg).catch(() => {}); }, [admin, sid]);
  useEffect(() => { setMb(String(srv?.upload_max_mb ?? 25)); }, [srv?.upload_max_mb]);
  if (!srv) return null;
  const top = Math.min(500, cfg?.managed?.limits?.max_upload_mb || 500);
  const save = async () => {
    const n = Number(mb);
    if (!Number.isInteger(n) || n < 1 || n > top) { toast(`Pick a size between 1 and ${top} MB.`); setMb(String(srv.upload_max_mb)); return; }
    if (n === srv.upload_max_mb && (!cfg || n === cfg.max_upload_mb)) return;
    try {
      if (cfg && n !== cfg.max_upload_mb) setCfg(await apiFetch('/api/v1/instance/settings', { inst: instOf(sid), method: 'PATCH', body: JSON.stringify({ max_upload_mb: n }) }));
      if (n !== srv.upload_max_mb) await patch(sid, { upload_max_mb: n });
      toast('Saved.', true);
    } catch (e) { if (!plan.catchPlan(e)) fail(e); setMb(String(srv.upload_max_mb)); }
  };
  return (
    <div className="vc-settings">
      {(plan.full || plan.gate) && <PlanNotice block={plan.full || { ...plan.gate, kind: 'limit', limit: top, used: top }} />}
      <Toggle label="Allow uploads" hint="Members with the Attach permission can send pictures, videos and files. They are stored on this server." on={srv.allow_uploads} onChange={v => patch(sid, { allow_uploads: v }).catch(fail)} />
      <label className="vc-field vc-gap-top"><span>Largest file people can upload (MB)</span>
        <input className="form-input vc-narrow" type="number" min={1} max={top} value={mb} disabled={!srv.allow_uploads} onChange={e => setMb(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
        <small className="vc-hint">Per file, from 1 to {top} MB. A bigger file is refused when someone tries to send it. It doesn't limit how much is stored in total.{cfg?.managed && top < 500 ? ` Your plan allows up to ${top} MB.` : ''}</small></label>
    </div>
  );
}

// the owner's copy of a whole server (bonfire-export-v1 zip): instance communities and Velora's own servers
export function ExportButton({ sid }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!(await ask({ title: 'Export this server?', text: 'You get a zip with the channels, roles, members, emojis, files and every message. Keep it safe: it holds the whole conversation.', confirm: 'Export' }))) return;
    setBusy(true);
    try {
      const { blob, filename } = await downloadFetch(`/chat/servers/${sid}/export`, { filename: `${bare(sid)}-export.zip` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return <button type="button" className="btn btn-surface" disabled={busy} onClick={run}><Download size={14} /> {busy ? 'Exporting...' : 'Export'}</button>;
}
