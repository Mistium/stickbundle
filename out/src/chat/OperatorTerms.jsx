// Ember Server Operator Terms (https://nookara.cc/operator-terms, v1.0): whoever sets up or hosts an Ember server accepts them.
// - the required checkbox in "Create a server" (Hosting.jsx) and in the first-run setup of a self-hosted server (Setup.jsx)
// - a one-time notice on the Dashboard of a server that was set up before the terms existed (it never blocks chat)
import { useEffect, useState } from 'react';
import { ScrollText, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, toast, errorText } from './store.js';
import { instOf, isInst } from './ids.js';

export const OPERATOR_TERMS_URL = 'https://nookara.cc/operator-terms';
export const OPERATOR_TERMS_VERSION = '1.0';

export const TermsLink = ({ children = 'Ember Server Operator Terms' }) => <a href={OPERATOR_TERMS_URL} target="_blank" rel="noreferrer">{children}</a>;

// the required checkbox
export function OperatorTermsCheck({ checked, onChange }) {
  return (
    <label className="vc-check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} required />
      <span>I have read and accept the <TermsLink /></span>
    </label>
  );
}

// Dashboard notice for an instance set up before the terms existed. Admins can dismiss it; the owner accepts.
export function OperatorTermsNotice({ sid }) {
  const origin = sid && isInst(sid) ? instOf(sid) : null;
  const inst = useChat(s => (origin ? s.instances.find(i => i.origin === origin) : null));
  const [t, setT] = useState(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const call = (path, body) => apiFetch(`/api/v1/instance/operator-terms${path}`, { inst: origin, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  useEffect(() => { if (origin && inst?.isAdmin) call('').then(setT).catch(() => {}); }, [origin, inst?.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inst?.isAdmin || !t?.notice) return null;
  const act = async (path, body, done) => {
    setBusy(true);
    try { setT(await call(path, body)); if (done) toast(done, true); } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  };
  return (
    <div className="vc-note bf-terms-notice" role="status">
      <ScrollText size={16} />
      <span>
        <b>Operator terms</b><br />
        Anyone who runs an Ember server accepts the <TermsLink /> (v{t.version}). This server was set up before they existed, so nothing is blocked - but please accept them.
        {inst.isOwner
          ? <label className="vc-check sm"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /><span>I have read and accept the <TermsLink /></span></label>
          : <small className="vc-hint"><TriangleAlert size={12} className="vc-inline-ico" /> Only the owner of this server can accept them.</small>}
      </span>
      {inst.isOwner && <button type="button" className="btn btn-primary btn-sm" disabled={!ok || busy} onClick={() => act('/accept', { accept_operator_terms: true }, 'Thanks - accepted.')}>Accept</button>}
      <button type="button" className="btn btn-surface btn-sm" disabled={busy} onClick={() => act('/dismiss', {})}>Not now</button>
    </div>
  );
}
