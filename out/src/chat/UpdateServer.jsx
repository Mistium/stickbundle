// "Update server": an instance's admins can pull a newer build of their server in one click (GET/POST /api/v1/instance/update, which asks
// the host agent to rebuild + recreate the container). Unsupported servers (self-hosters, Velora-hosted ones) get a note instead of the button.
import { useEffect, useRef, useState } from 'react';
import { CircleArrowUp, TriangleAlert } from 'lucide-react';

import { apiFetch } from '../api.js';
import { ask, toast, errorText } from './store.js';

const PATH = '/api/v1/instance/update';
const POLL_MS = 4000, GIVE_UP_MS = 15 * 60 * 1000;
const label = b => (b ? [b.version, b.commit_short ? `(${b.commit_short})` : ''].filter(Boolean).join(' ') || 'unknown' : 'unknown');
const key = b => b?.build_id || b?.commit || null;
const changed = (a, b) => !!key(a) && !!key(b) && key(a) !== key(b); // unknown on either side counts as unchanged
const WHY = {
  managed: 'This server is hosted by Nookara and is kept up to date by it.',
  not_configured: 'One-click updates are not set up on this server. Update it where it runs (docker pull / rebuild, then restart).',
};

export function UpdateServerRow({ origin, name }) {
  const [info, setInfo] = useState(null); // GET answer
  const [loadErr, setLoadErr] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | updating | done | failed | slow
  const [note, setNote] = useState('');
  const alive = useRef(true);
  const before = useRef(null);
  useEffect(() => () => { alive.current = false; }, []);
  const load = () => apiFetch(PATH, { inst: origin }).then(d => { if (alive.current) { setInfo(d); setLoadErr(''); } return d; }).catch(e => { if (alive.current) setLoadErr(errorText(e.message)); return null; });
  useEffect(() => { load(); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps

  // after the POST the container is stopped and recreated: the server goes away for a while, then comes back with the new build
  async function watch(started) {
    let down = false;
    while (alive.current && Date.now() - started < GIVE_UP_MS) {
      await new Promise(r => setTimeout(r, POLL_MS));
      if (!alive.current) return;
      let d = null;
      try { d = await apiFetch(PATH, { inst: origin }); } catch { down = true; setNote('Restarting...'); continue; }
      setInfo(d);
      const u = d.update;
      if (u?.state === 'failed') { setPhase('failed'); setNote(u.output ? u.output.split('\n').filter(Boolean).slice(-3).join(' / ') : 'The update failed.'); return; }
      if (changed(before.current, d.current) || (down && u?.state === 'done') || (u?.state === 'done' && d.outdated === false)) { setPhase('done'); setNote(''); toast('Server updated', true); return; }
      setNote(u?.step === 'update-chat' ? 'Switching to the new version...' : u?.step === 'rebuild-image' ? 'Building the new version...' : 'Updating...');
    }
    if (alive.current) setPhase('slow');
  }

  async function update() {
    if (!(await ask({ title: `Update ${name || 'this server'}?`, text: `${label(info.current)} -> ${label(info.latest)}. Everyone is disconnected for a minute or two while the new version starts. If it does not come up, the old version is put back.`, confirm: 'Update' }))) return;
    try {
      before.current = info.current; setPhase('updating'); setNote('Updating...');
      await apiFetch(PATH, { inst: origin, method: 'POST' });
      toast('Updating...', true);
      watch(Date.now());
    } catch (e) { setPhase('idle'); setNote(''); toast(errorText(e.message)); load(); }
  }

  const busy = phase === 'updating';
  const supported = info?.supported;
  let text;
  if (!info) text = loadErr || 'Checking...';
  else if (!supported) text = WHY[info.reason] || 'Updating from here is not available on this server.';
  else if (info.reachable === false) text = `Running ${label(info.current)}. The update service could not be reached (${errorText(info.error || 'update_service_unreachable')}).`;
  else if (info.outdated) text = `Running ${label(info.current)}. Available: ${label(info.latest)}${info.latest?.message ? ' - ' + info.latest.message : ''}.`;
  else text = `Running ${label(info.current)}${info.outdated === false ? '. You are up to date.' : '.'}`;
  const canUpdate = supported && info.reachable !== false && info.update?.state !== 'running' && !busy;

  return (
    <>
      <div className="cs-row"><div className="cs-text"><b>Update the server</b><span>{text}</span></div>
        <button type="button" className="btn btn-surface" disabled={!canUpdate} onClick={update}><CircleArrowUp size={14} /> {busy ? 'Updating...' : 'Update server'}</button></div>
      {busy && note && <p className="vc-note"><CircleArrowUp size={14} /> {note} This page reconnects by itself.</p>}
      {phase === 'done' && <p className="vc-note"><CircleArrowUp size={14} /> Updated to {label(info?.current)}.</p>}
      {phase === 'failed' && <p className="vc-err"><TriangleAlert size={14} /> {note}</p>}
      {phase === 'slow' && <p className="vc-err"><TriangleAlert size={14} /> This is taking longer than expected. Check the server, then reload.</p>}
    </>
  );
}
