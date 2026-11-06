// Test install (staff): add any bot that isn't banned - pending or unlisted too - to a server I manage, as a TEST install.
// Opened from the admin Bot gallery panel (/chat#/test-bot/<id>), from a staff member's view of the bot (Add as test install) or by
// the "vc-dialog" event { kind: 'test-bot', id }. Contract: BOT-GALLERY.md ("Testing a pending bot before approving").
import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, RefreshCw, FlaskConical, Trash2, ExternalLink, Bot, Copy } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { apiFetch, getToken } from '../api.js';
import { useChat, go, loadMembers } from './store.js';
import { bare, normOrigin } from './ids.js';
import { moderate } from './roles.jsx';
import { useAddTargets, errText } from './Bots.jsx';

const STATE = { pending: 'Pending', private: 'Private (not submitted)', rejected: 'Rejected', delisted: 'Delisted', approved: 'Approved', banned: 'Banned' };
const EXTRA = {
  insufficient_rank: 'Only admins can add a bot as a test install.', no_test_server: "There's no review server set for Nookara's own servers.",
  gallery_banned: 'That bot is banned, so it cannot be added anywhere.', bot_is_private: 'Only admins can add a bot that is not listed.',
  unauthorized: 'Sign in again, then retry.', invalid_token: 'Sign in again, then retry.',
};
const why = e => EXTRA[e?.message] || errText(e);
const when = ms => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const mono = { fontFamily: 'monospace', fontSize: 12 };

// the two API examples for the "Advanced (API)" box: bash and PowerShell
export function addCalls(origin, ticket) {
  const bash = `curl -X POST ${origin}/api/v1/bots/gallery/add \\\n  -H "Authorization: Bearer <your session on that instance>" -H "Content-Type: application/json" \\\n  -d '{"ticket":"${ticket}","sid":"<server id on that instance>"}'`;
  const ps = `$h = @{ Authorization = "Bearer <your session on that instance>" }\n$body = @{ ticket = "${ticket}"; sid = "<server id on that instance>" } | ConvertTo-Json\nInvoke-RestMethod -Method Post -Uri "${origin}/api/v1/bots/gallery/add" -Headers $h -ContentType "application/json" -Body $body`;
  return { bash, ps };
}

function Advanced({ id }) {
  const [inst, setInst] = useState('');
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const origin = (normOrigin(inst) || inst.trim()).replace(/\/+$/, '');
  async function getTicket() {
    setBusy(true); setErr(''); setT(null);
    try { setT(await apiFetch(`/admin/bonfire/bots/${encodeURIComponent(id)}/test-ticket`, { method: 'POST', body: JSON.stringify({ instance: origin }) })); }
    catch (e) { setErr(why(e)); }
    setBusy(false);
  }
  const copy = (text, k) => navigator.clipboard?.writeText(text).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1400); });
  const calls = t ? addCalls(origin, t.ticket) : null;
  return (
    <details className="bt-adv">
      <summary>Advanced (API)</summary>
      <p className="vc-hint">For scripts: get a test ticket (valid 5 minutes, one use), then send it to the instance yourself.</p>
      <div className="bt-row">
        <input className="form-input grow" placeholder="https://e-testing.nookara.cc" value={inst} onChange={e => setInst(e.target.value)} aria-label="Instance address" />
        <button type="button" className="btn btn-surface btn-sm" disabled={busy || !inst.trim()} onClick={getTicket}>Get test ticket</button>
      </div>
      {err && <div className="vc-addbot-err">{err}</div>}
      {calls && (
        <>
          <small className="vc-hint">Ticket for {t.bot?.username} on {origin}:</small>
          <textarea className="form-input" readOnly rows={3} style={mono} value={t.ticket} onFocus={e => e.target.select()} />
          <small className="vc-hint">bash</small>
          <textarea className="form-input" readOnly rows={4} style={mono} value={calls.bash} onFocus={e => e.target.select()} />
          <small className="vc-hint">PowerShell</small>
          <textarea className="form-input" readOnly rows={4} style={mono} value={calls.ps} onFocus={e => e.target.select()} />
          <div className="bt-row">
            <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(t.ticket, 't')}>{copied === 't' ? <Check size={13} /> : <Copy size={13} />} Copy ticket</button>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(calls.bash, 'b')}>{copied === 'b' ? <Check size={13} /> : <Copy size={13} />} Copy bash</button>
            <button type="button" className="btn btn-surface btn-sm" onClick={() => copy(calls.ps, 'p')}>{copied === 'p' ? <Check size={13} /> : <Copy size={13} />} Copy PowerShell</button>
          </div>
        </>
      )}
    </details>
  );
}

export function TestBotDialog({ id, onClose }) {
  const [bot, setBot] = useState(null);
  const [det, setDet] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [done, setDone] = useState({}); // sid -> true while added in this dialog
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const targets = useAddTargets();
  useChat(s => s.instances); // (redraw when my instances connect)

  const loadDetail = useCallback(() => apiFetch(`/admin/bonfire/bots/${encodeURIComponent(id)}`).then(setDet).catch(() => {}), [id]);
  useEffect(() => {
    const t = getToken();
    fetch(`/bonfire/bots/gallery/${encodeURIComponent(id)}`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(x => setBot(x.bot || x))
      .catch(() => setLoadErr("Couldn't load that bot. Sign in with an admin account, then try again."));
    loadDetail();
  }, [id, loadDetail]);

  const installs = det?.installs || [];
  const nativeIn = new Set((det?.native_servers || []).map(s => s.sid));
  const isIn = s => (s.sid in done ? !!done[s.sid] : s.inst ? installs.some(i => i.url && normOrigin(i.url) === s.inst) : nativeIn.has(s.sid));

  async function add(s) {
    setMsg(''); setBusy(s.sid);
    try {
      const enc = encodeURIComponent(id);
      if (!s.inst) await apiFetch(`/admin/bonfire/bots/${enc}/test`, { method: 'POST', body: JSON.stringify({ sid: s.sid }) });
      else {
        const t = await apiFetch(`/admin/bonfire/bots/${enc}/test-ticket`, { method: 'POST', body: JSON.stringify({ instance: s.inst }) });
        if (!t?.ticket) throw new Error('ticket_invalid');
        await apiFetch('/api/v1/bots/gallery/add', { inst: s.inst, method: 'POST', body: JSON.stringify({ ticket: t.ticket, sid: bare(s.sid) }) });
      }
      setDone(d => ({ ...d, [s.sid]: true }));
      loadDetail(); setTimeout(loadDetail, 6000); // the instance reports the install to Velora a few seconds later
    } catch (e) { setMsg(why(e)); }
    setBusy('');
  }

  // remove a test install: Velora-native servers have a revoke route; on an instance the bot is simply kicked from the server
  async function remove(s) {
    setMsg(''); setBusy(s.sid);
    try {
      if (!s.inst) {
        await apiFetch(`/admin/bonfire/bots/${encodeURIComponent(id)}/test`, { method: 'DELETE', body: JSON.stringify({ sid: s.sid }) });
        setDone(d => ({ ...d, [s.sid]: false })); loadDetail();
      } else {
        const d = await apiFetch(`/chat/servers/${s.sid}/members`);
        let hit = null;
        for (const m of (d.members || []).filter(x => x.bot || x.kind === 'bot')) {
          const info = await apiFetch(`/chat/bots/by-name/${encodeURIComponent(m.username)}`, { inst: s.inst }).catch(() => null);
          if (String(info?.bot?.gallery_id) === String(id)) { hit = m; break; }
        }
        if (!hit) throw new Error('not_in_server');
        if (await moderate(s.sid, hit.username, 'kick', hit)) { setDone(x => ({ ...x, [s.sid]: false })); loadMembers(s.sid); setTimeout(loadDetail, 6000); }
      }
    } catch (e) { setMsg(e?.message === 'not_in_server' ? "It isn't in that server any more." : why(e)); }
    setBusy('');
  }

  const stateLabel = STATE[bot?.state] || (bot?.verified ? 'Approved' : bot?.state) || '';
  return (
    <Dialog title="Add as a test install" onClose={onClose} wide>
      {loadErr && <div className="vc-empty-note">{loadErr}</div>}
      {!bot && !loadErr && <div className="vc-loading"><i /><i /><i /></div>}
      {bot && (
        <>
          <div className="bt-bot">
            <span className="bg-av" style={{ width: 52, height: 52 }}>{/^https:\/\//i.test(bot.avatar_url || '') ? <img src={bot.avatar_url} alt="" /> : <Bot size={26} />}</span>
            <div className="grow">
              <b>{bot.username}</b>
              <small className="bt-line">State: <b>{stateLabel}</b>{bot.owner ? <> · Owner: @{bot.owner}</> : null}</small>
              {bot.description && <small className="bt-line">{bot.description}</small>}
            </div>
          </div>
          <p className="vc-dialog-sub bt-explain">
            This adds the bot as a TEST install: it is not counted in Trusted/In N servers and is removed if the bot is banned. The developer&apos;s bot connects with its normal token; nothing changes on their side.
          </p>
          <div className="bt-list">
            <div className="vc-addbot-head">Pick a server you manage</div>
            {targets.map(s => (
              <div className="bt-srv" key={s.sid}>
                <span className="vc-srv-ico sm">{s.icon ? <img src={s.icon} alt="" /> : (s.name || '?').slice(0, 2)}</span>
                <span className="grow">{s.name}{s.inst && <small className="vc-addbot-host"> {s.inst.replace(/^https?:\/\//, '')}</small>}</span>
                {isIn(s) ? (
                  <>
                    <span className="bt-in"><Check size={14} /> In this server</span>
                    <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} title="Remove the test install (kicks the bot from this server)" onClick={() => remove(s)}>
                      {busy === s.sid ? <RefreshCw size={13} className="vc-spin" /> : <Trash2 size={13} />} Remove
                    </button>
                    <button type="button" className="btn btn-surface btn-sm" onClick={() => { onClose(); go({ kind: 'server', sid: s.sid }); }}><ExternalLink size={13} /> Open</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => add(s)}>
                    {busy === s.sid ? <RefreshCw size={13} className="vc-spin" /> : <Plus size={13} />} Add as test
                  </button>
                )}
              </div>
            ))}
            {!targets.length && <div className="vc-empty-note">No servers to add it to. You need Manage server on one - add your test instance (for example e-testing.nookara.cc) from the + in the sidebar first.</div>}
          </div>
          {Object.values(done).some(Boolean) && (
            <div className="vc-addbot-ok bt-ok"><FlaskConical size={14} /> Added as a test install. The developer&apos;s program connects with its normal token to that server&apos;s address (<span style={mono}>/bot/gateway</span>); bots that read <span style={mono}>/bonfire/bots/self/installs</span> find it on their own within a few minutes.</div>
          )}
          {msg && <div className="vc-addbot-err bt-err" role="alert">{msg}</div>}
          {(installs.length > 0 || (det?.native_servers || []).length > 0) && (
            <div className="bt-installs">
              <div className="vc-addbot-head">Where it is now</div>
              {(det.native_servers || []).map(s => <div key={s.sid}>Nookara server: {s.name}</div>)}
              {installs.map(i => <div key={`${i.instance_id}${i.added_at}`}><span style={mono}>{i.url || i.instance_id}</span>{i.name ? ` (${i.name})` : ''} · {i.test ? 'test install' : 'normal install'} · seen {when(i.seen_at)}{i.url && !targets.some(s => s.inst === normOrigin(i.url)) ? ' · remove it by kicking the bot in that server' : ''}</div>)}
            </div>
          )}
          <Advanced id={id} />
        </>
      )}
      <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={onClose}>Close</button></div>
    </Dialog>
  );
}
