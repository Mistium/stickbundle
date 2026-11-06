// Server settings > Server info (instance admins): the build it runs, whether it is up to date, its runtime and what it holds.
import { useEffect, useState } from 'react';
import { Info, CircleArrowUp, Check, Copy, Server, Database, RefreshCw } from 'lucide-react';
import { useChat } from './store.js';
import { instanceConn, loadServerInfo } from './instances.js';
import { Card } from './SettingsShell.jsx';

const bytes = n => {
  n = Number(n); if (!Number.isFinite(n) || n < 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};
const num = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '-');
const when = t => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleString() : '-'; };
const span = s => {
  s = Math.floor(Number(s)); if (!Number.isFinite(s) || s < 0) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
};

const Row = ({ label, children }) => <div className="cs-row"><div className="cs-text"><b>{label}</b></div><span className="vc-info-val">{children}</span></div>;

export function ServerInfoPage({ origin }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const info = inst?.serverInfo;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const c = instanceConn(origin); if (c) loadServerInfo(c); }, [origin]);
  const refresh = async () => { const c = instanceConn(origin); if (!c) return; setBusy(true); await loadServerInfo(c); setBusy(false); };
  if (!inst?.isAdmin) return null;
  if (!info) return <div className="bf-ss-page"><div className="vc-loading"><i /><i /><i /></div></div>;
  const b = info.build || {}, r = info.runtime || {}, st = info.stats || {}, u = info.update;
  const copy = () => navigator.clipboard?.writeText(b.commit || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  return (
    <div className="bf-ss-page">
      <Card title="Version" icon={Info}>
        <Row label="Version">{b.version || '-'}{b.dirty ? ' (modified build)' : ''}</Row>
        <Row label="Commit">{b.commit_short || '-'}</Row>
        <div className="vc-field"><span>Full commit</span>
          <div className="vc-row"><input className="form-input vc-info-mono" readOnly value={b.commit || ''} aria-label="Full commit hash" onFocus={e => e.target.select()} />
            <button type="button" className="btn btn-surface" disabled={!b.commit} onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button></div></div>
        <Row label="Commit date">{when(b.commit_date)}</Row>
        <Row label="Built at">{when(b.built_at)}</Row>
        {b.dirty && <Row label="Build">Modified build</Row>}
      </Card>
      <Card title="Updates" icon={CircleArrowUp}>
        {!u ? <div className="vc-hint">Update status is not available right now.</div> : u.outdated
          ? <div className="bf-ss-reg warn"><CircleArrowUp size={14} /><span><b>Out of date.</b> Latest is {u.latest?.commit_short || u.latest?.version || 'newer'}{u.latest?.commit_date ? ` (${when(u.latest.commit_date)})` : ''}.{u.latest?.message ? ` ${u.latest.message}` : ''} {inst.managed ? 'Nookara updates this server automatically within about 10 minutes.' : 'Update the server software to get it.'}</span></div>
          : <div className="bf-ss-reg ok"><Check size={14} /><span><b>Up to date.</b>{u.checked_at ? ` Checked ${when(u.checked_at)}.` : ''}</span></div>}
        <button type="button" className="btn btn-surface btn-sm vc-gap-top" disabled={busy} onClick={refresh}><RefreshCw size={13} /> {busy ? 'Checking...' : 'Refresh'}</button>
      </Card>
      <Card title="Runtime" icon={Server}>
        <Row label="Uptime">{span(r.uptime_s)}</Row>
        <Row label="Started">{when(r.started_at)}</Row>
        <Row label="Node">{r.node || '-'}</Row>
        <Row label="Platform">{r.platform || '-'}</Row>
      </Card>
      <Card title="Contents" icon={Database}>
        <Row label="Members">{num(st.members)}</Row>
        <Row label="Channels">{num(st.channels)}</Row>
        <Row label="Messages">{num(st.messages)}</Row>
        <Row label="Uploads">{num(st.upload_count)} ({bytes(st.upload_bytes)})</Row>
        <Row label="Database">{bytes(st.db_bytes)}</Row>
        <Row label="Bots">{num(st.bots)}</Row>
        <Row label="Emojis">{num(st.emojis)}</Row>
        <Row label="Sounds">{num(st.sounds)}</Row>
      </Card>
    </div>
  );
}
