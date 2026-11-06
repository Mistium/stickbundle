import { useState, useEffect } from 'react';
import { Bell, BellOff, Send } from 'lucide-react';
import { apiFetch } from '../../api.js';
import { pushSupported, browserSubscribed, enablePush, disablePush } from '../../push.js';

// Settings > Notifications: browser notifications for this device + what they're about.
export default function NotificationsTab() {
  const [state, setState] = useState(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    setState(await apiFetch('/push/state').catch(() => null));
    setOn(await browserSubscribed().catch(() => false));
  };
  useEffect(() => { load(); }, []);

  async function toggle() {
    setBusy(true); setMsg(null);
    try {
      if (on) { await disablePush(); setMsg({ type: 'success', text: 'Notifications are off for this browser.' }); }
      else { await enablePush(); setMsg({ type: 'success', text: "Notifications are on for this browser!" }); }
      await load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setBusy(false);
  }
  async function setPref(k, v) {
    const prefs = { ...state.prefs, [k]: v };
    setState({ ...state, prefs });
    try { await apiFetch('/push/prefs', { method: 'PATCH', body: JSON.stringify({ prefs: { [k]: v } }) }); }
    catch { setMsg({ type: 'error', text: "Couldn't save that." }); load(); }
  }
  async function test() {
    const r = await apiFetch('/push/test', { method: 'POST' }).catch(() => null);
    setMsg(r?.sent ? { type: 'success', text: 'Sent! (it may not pop up while this tab is focused - switch tabs to see it)' } : { type: 'error', text: 'Nothing was sent - turn notifications on first.' });
  }

  if (!pushSupported()) {
    return <div className="card"><div className="card-body">This browser doesn't support notifications.</div></div>;
  }
  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <span className="card-title">Browser notifications</span>
            <span className="card-subtitle">Get a notification from Nookara even when this tab is closed. Turn it on separately on each browser or device.</span>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          {msg && <div className={`inline-msg ${msg.type}`}>{msg.text}</div>}
          {state?.hyperfocus && !on && (
            <div className="form-hint">You use Hyperfocus, which already sends you Nookara notifications on this PC - so these are off unless you turn them on (handy for other devices).</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${on ? 'btn-surface' : 'btn-primary'}`} onClick={toggle} disabled={busy}>
              {on ? <><BellOff size={13} /> Turn off for this browser</> : <><Bell size={13} /> Turn on for this browser</>}
            </button>
            {on && <button className="btn btn-surface btn-sm" onClick={test}><Send size={12} /> Send a test</button>}
          </div>
          {state?.subscribed > (on ? 1 : 0) && <div className="form-hint">On for {state.subscribed - (on ? 1 : 0)} other browser{state.subscribed - (on ? 1 : 0) === 1 ? '' : 's'} / device{state.subscribed - (on ? 1 : 0) === 1 ? '' : 's'} too.</div>}
        </div>
      </div>
      {state && (
        <div className="card">
          <div className="card-header"><span className="card-title">Notify me about</span></div>
          <div className="card-body vis-options">
            {Object.entries(state.categories).map(([k, label]) => (
              <label key={k} className="vis-option" style={{ justifyContent: 'space-between' }}>
                <span className="vis-text"><b>{label}</b></span>
                <input type="checkbox" style={{ position: 'static', opacity: 1, pointerEvents: 'auto', width: 18, height: 18, accentColor: 'var(--accent)' }}
                  checked={!!state.prefs[k]} onChange={e => setPref(k, e.target.checked)} />
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// the little "turn on notifications?" card on the overview (not for Hyperfocus users)
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    // Ember Desktop uses its own notification bridge; browser Push is not
    // available in Electron, so don't show an unusable registration prompt.
    if (window.bonfireDesktop?.isDesktop) return;
    (async () => {
      if (!pushSupported() || Notification.permission === 'denied') return;
      try { if (localStorage.getItem('velora_push_prompt') === 'no') return; } catch {}
      if (await browserSubscribed()) return;
      const st = await apiFetch('/push/state').catch(() => null);
      // Hyperfocus users may still want a phone or a second computer. A push
      // subscription belongs to this browser/device, not to the whole account.
      if (st) setShow(true);
    })();
  }, []);
  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem('velora_push_prompt', 'no'); } catch {} setShow(false); };
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Bell size={18} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600 }}>Get notified?</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Messages, calls, friend requests and credits - even when Nookara is closed. You can turn this on for each device.</div>
          {msg && <div className="inline-msg error" style={{ marginTop: 6 }}>{msg}</div>}
        </div>
        <button className="btn btn-primary btn-sm" onClick={async () => { try { await enablePush(); setShow(false); } catch (e) { setMsg(e.message); } }}>Turn on</button>
        <button className="btn btn-surface btn-sm" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
