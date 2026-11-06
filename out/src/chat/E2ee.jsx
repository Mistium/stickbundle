// The screens of end-to-end encrypted DMs: setting up, unlocking on a new device, linking, the settings page, comparing keys with someone.
import { useEffect, useState } from 'react';
import { Lock, LockOpen, KeyRound, ShieldCheck, Smartphone, AppWindow, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { toast, errorText, ask, useChat, openE2eeGate, closeE2eeGate } from './store.js';
import * as S from './e2ee/session.js';
import './E2ee.css';

const ERR = {
  wrong_passcode: 'That is not right.', passcode_locked: 'Too many wrong tries, so PIN and password unlock is off. Use your recovery code.',
  wrong_recovery_code: "That recovery code isn't right.", link_not_found: "That code isn't waiting, or it expired.", link_mismatch: "That code doesn't match the device asking. Don't approve it, and try again.",
  link_denied: 'That was denied on your other device.', link_expired: 'That code expired. Start again.', rate_limited: 'Too many tries. Wait a bit and try again.',
};
const say = e => ERR[e?.message] || errorText(e?.message);

function PasscodeFields({ type, setType, a, setA, b, setB }) {
  return (
    <div className="e2-fields">
      <div className="e2-kinds" role="radiogroup" aria-label="What to use">
        <button type="button" role="radio" aria-checked={type === 'pin'} className={type === 'pin' ? 'on' : ''} onClick={() => { setType('pin'); setA(''); setB(''); }}>PIN</button>
        <button type="button" role="radio" aria-checked={type === 'password'} className={type === 'password' ? 'on' : ''} onClick={() => { setType('password'); setA(''); setB(''); }}>Password</button>
      </div>
      <label>{type === 'pin' ? 'Choose a PIN (6 digits or more)' : 'Choose a password (10 characters or more)'}
        <input className="form-input" type="password" autoComplete="new-password" inputMode={type === 'pin' ? 'numeric' : undefined} value={a} onChange={e => setA(type === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)} />
      </label>
      <label>Type it again
        <input className="form-input" type="password" autoComplete="new-password" inputMode={type === 'pin' ? 'numeric' : undefined} value={b} onChange={e => setB(type === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)} />
      </label>
      <p className="vc-dialog-sub">
        {type === 'pin'
          ? 'Use this only for DMs, not your Nookara password. The longer it is, the better: if our database ever leaked, someone could try every 6-digit PIN within hours. A password is much stronger.'
          : "Use this only for DMs, not your Nookara password. Nookara can't reset it for you."}
      </p>
    </div>
  );
}

function RecoveryCode({ code, onDone }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="e2-fields">
      <p>This is your recovery code. <b>Save it somewhere safe, it's only shown now.</b> If you forget your PIN or password and don't have another device, it's the only way back to your DMs. Nookara can't recover them for you.</p>
      <div className="e2-code">{code}</div>
      <button type="button" className="btn btn-surface" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}</button>
      <label className="e2-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my recovery code</label>
      <div className="vc-dialog-btns"><button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>Done</button></div>
    </div>
  );
}

function Setup({ replace, onDone, onCancel }) {
  const [type, setType] = useState('pin');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState(null);
  if (code) return <RecoveryCode code={code} onDone={onDone} />;
  const ok = S.validPasscode(type, a) && a === b;
  const go = async () => {
    setBusy(true); setErr('');
    try { setCode(await S.setup(type, a, { replace })); }
    catch (e) { setErr(say(e)); setBusy(false); }
  };
  return (
    <>
      {replace
        ? <p className="e2-warn"><AlertTriangle size={15} /> New keys can't open your old encrypted messages. They stay locked for good, and the people you talk to will see that your key changed.</p>
        : <p>Your DMs are now end-to-end encrypted: only you and the person you're talking to can read them, not even Nookara. Choose how you'll unlock them on a new device.</p>}
      <PasscodeFields {...{ type, setType, a, setA, b, setB }} />
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns">
        {onCancel && <button type="button" className="btn btn-surface" onClick={onCancel}>Later</button>}
        <button type="button" className="btn btn-primary" disabled={!ok || busy} onClick={go}>{busy ? 'Setting up...' : 'Continue'}</button>
      </div>
    </>
  );
}

function LinkWait({ onDone, onBack }) {
  const [link, setLink] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true, cur = null;
    S.startLink(navigator.userAgent.includes('Android') ? 'Ember on Android' : 'Ember on a new device').then(l => {
      if (!live) { l.cancel(); return; }
      cur = l; setLink(l);
      l.wait.then(done => { if (done && live) onDone(); }).catch(e => { if (live) setErr(say(e)); });
    }).catch(e => { if (live) setErr(say(e)); });
    return () => { live = false; cur?.cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="e2-fields">
      <p>On a device where you're already unlocked, open Ember, go to Settings, then Privacy, then Encrypted DMs, and choose Approve a device. Enter this code:</p>
      <div className="e2-code big">{link ? link.code : '...'}</div>
      <p className="vc-dialog-sub">Waiting for your other device. This code lasts 10 minutes.</p>
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={onBack}>Back</button></div>
    </div>
  );
}

function Unlock({ onDone, onCancel }) {
  const [mode, setMode] = useState('passcode');
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newCode, setNewCode] = useState(false);
  const p = S.passcodeInfo();
  const locked = !!p?.locked;
  if (newCode) return <NewPasscode onDone={onDone} intro="You're unlocked. Choose a new PIN or password, because the old one was locked after too many wrong tries." />;
  if (mode === 'link') return <LinkWait onDone={onDone} onBack={() => setMode('passcode')} />;
  if (mode === 'replace') return <Setup replace onDone={onDone} onCancel={() => setMode('passcode')} />;
  const usePass = mode === 'passcode' && !locked;
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (usePass) { await S.unlockPasscode(v); onDone(); }
      else { await S.unlockRecovery(v); if (locked) setNewCode(true); else onDone(); }
    } catch (x) {
      const left = S.passcodeInfo()?.tries_left;
      setErr(x.message === 'wrong_passcode' && left != null ? `That is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : say(x));
      setBusy(false); setV('');
    }
  };
  return (
    <form onSubmit={submit} className="e2-fields">
      <p>{usePass ? `Enter your DM ${p?.type === 'password' ? 'password' : 'PIN'} to read your DMs on this device.` : 'Enter your recovery code.'}</p>
      {locked && mode === 'passcode' && <p className="e2-warn"><AlertTriangle size={15} /> Too many wrong tries, so PIN and password unlock is off.</p>}
      <input className="form-input" autoFocus type={usePass ? 'password' : 'text'} inputMode={usePass && p?.type === 'pin' ? 'numeric' : undefined} autoComplete="off" value={v} onChange={e => setV(e.target.value)} placeholder={usePass ? '' : 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX'} aria-label={usePass ? 'PIN or password' : 'Recovery code'} />
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns">
        {onCancel && <button type="button" className="btn btn-surface" onClick={onCancel}>Later</button>}
        <button type="submit" className="btn btn-primary" disabled={!v || busy}>{busy ? 'Unlocking...' : 'Unlock'}</button>
      </div>
      <div className="e2-links">
        {usePass ? <button type="button" onClick={() => { setMode('recovery'); setV(''); setErr(''); }}>Use my recovery code</button>
          : !locked && <button type="button" onClick={() => { setMode('passcode'); setV(''); setErr(''); }}>Use my {p?.type === 'password' ? 'password' : 'PIN'}</button>}
        <button type="button" onClick={() => setMode('link')}>Link from another device</button>
        <button type="button" onClick={() => setMode('replace')}>I lost everything, start again</button>
      </div>
    </form>
  );
}

function NewPasscode({ onDone, intro }) {
  const [type, setType] = useState('pin');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await S.changePasscode(type, a); toast('Changed.', true); onDone(); }
    catch (e) { setErr(say(e)); setBusy(false); }
  };
  return (
    <>
      {intro && <p>{intro}</p>}
      <PasscodeFields {...{ type, setType, a, setA, b, setB }} />
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns"><button type="button" className="btn btn-primary" disabled={!S.validPasscode(type, a) || a !== b || busy} onClick={go}>{busy ? 'Saving...' : 'Save'}</button></div>
    </>
  );
}

// the popup: setting up, or unlocking. Opened by openE2eeGate(), or by itself once per visit (store.js)
export function E2eeGate() {
  const open = useChat(s => s.e2eeGate);
  const status = useChat(s => s.e2eeStatus);
  if (!open || status === 'loading') return null;
  return <GateDialog first={status === 'none'} />;
}
// (what it opened as stays: setting up makes the status "ready" while the recovery code is still on screen)
function GateDialog({ first }) {
  const [setup] = useState(first);
  const done = () => closeE2eeGate();
  return (
    <Dialog title={setup ? 'Set up encrypted DMs' : 'Unlock your DMs'} onClose={done}>
      {setup ? <Setup onDone={done} onCancel={done} /> : <Unlock onDone={done} onCancel={done} />}
    </Dialog>
  );
}

// in place of a conversation until this device can read it
export function E2eeLockedPanel() {
  const status = useChat(s => s.e2eeStatus);
  return (
    <div className="e2-panel">
      <Lock size={22} />
      <div>
        <b>{status === 'none' ? 'Set up encrypted DMs to read and send messages' : 'Unlock your DMs on this device'}</b>
        <p>{status === 'none' ? 'Only you and the person you talk to can read your DMs, not even Nookara.' : 'Your messages are encrypted. This device needs your PIN, password or recovery code, or a link from another device.'}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={() => openE2eeGate()}>{status === 'none' ? 'Set up' : 'Unlock'}</button>
    </div>
  );
}

// a line under the conversation's header: what kind of privacy this conversation has
export function E2eeLabel({ kind, username }) {
  if (__ORIGINCHATS__) return null; // OriginChats DMs and groups are not end-to-end encrypted
  if (kind === 'group') return <div className="e2-label off"><LockOpen size={13} /> Not end-to-end encrypted. Nookara can read group chats.</div>;
  return <button type="button" className="e2-label" onClick={() => openSafety(username)} title="Compare keys with them"><Lock size={13} /> End-to-end encrypted. Only you two can read this.</button>;
}

export async function openSafety(username) {
  let code = null;
  try { code = await S.safetyWith(username); } catch { /* shown below */ }
  await ask({
    title: `Your keys with @${username}`,
    text: code
      ? `Compare these numbers with @${username} somewhere outside Nookara, like in person or on a call. If they match, nobody is listening in, not even Nookara.\n\n${code.join(' ')}`
      : `@${username} hasn't set up encrypted DMs yet, so there's nothing to compare.`,
    confirm: 'Done',
  });
}

function ApproveLink({ onClose }) {
  const [code, setCode] = useState('');
  const [l, setL] = useState(null);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const look = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { setL(await S.lookupLink(code)); } catch (x) { setErr(say(x)); }
    setBusy(false);
  };
  const approve = async () => {
    setBusy(true); setErr('');
    try { await S.approveLink(l, { history }); toast(l.kind === 'device' ? 'That device is unlocked.' : `${l.label} is linked.`, true); onClose(); }
    catch (x) { setErr(say(x)); setBusy(false); }
  };
  if (!l) return (
    <form onSubmit={look} className="e2-fields">
      <p>Enter the code your other device or app shows.</p>
      <input className="form-input" autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" aria-label="Code" />
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || code.replace(/[^0-9A-Z]/gi, '').length < 10}>Continue</button></div>
    </form>
  );
  const device = l.kind === 'device';
  return (
    <div className="e2-fields">
      {device ? <p><b>{l.label}</b> will be able to read all your DMs, old and new. Only approve this if it's your own device, and you asked for this code just now.</p>
        : <p><b>{l.label}</b> is an app that isn't made by Nookara. It will be able to read and send your DMs from now on, until you unlink it. Only approve it if you trust whoever made it. Nookara doesn't check what it does with them.</p>}
      {!device && <label className="e2-check"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /> Let it read my old DMs too</label>}
      {err && <p className="e2-err">{err}</p>}
      <div className="vc-dialog-btns">
        <button type="button" className="btn btn-surface" onClick={() => { S.denyLink(l.code).catch(() => {}); onClose(); }}>Deny</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={approve}>{busy ? 'Approving...' : 'Approve'}</button>
      </div>
    </div>
  );
}

// Settings > Privacy > Encrypted DMs
export function E2eeSettings() {
  const status = useChat(s => s.e2eeStatus);
  const [dlg, setDlg] = useState(null);
  const [, bump] = useState(0);
  const [recovery, setRecovery] = useState(null);
  const close = () => { setDlg(null); setRecovery(null); bump(x => x + 1); };
  if (status !== 'ready') return (
    <div className="e2-settings">
      <p><Lock size={15} /> {status === 'none' ? "You haven't set up encrypted DMs yet." : "This device isn't unlocked yet."}</p>
      <button type="button" className="btn btn-primary" onClick={() => openE2eeGate()}>{status === 'none' ? 'Set up' : 'Unlock'}</button>
    </div>
  );
  const clients = S.linkedClients();
  const unlink = async c => {
    if (!(await ask({ title: `Unlink ${c.label}?`, text: "It won't be able to read new DMs. Anything it already read, it may have kept.", confirm: 'Unlink', danger: true }))) return;
    try { await S.revokeClient(c.kid); bump(x => x + 1); } catch (e) { toast(say(e)); }
  };
  const genRecovery = async () => {
    if (!(await ask({ title: 'Make a new recovery code?', text: 'Your old code stops working.', confirm: 'Make a new one' }))) return;
    try { setRecovery(await S.newRecovery()); setDlg('recovery'); } catch (e) { toast(say(e)); }
  };
  return (
    <div className="e2-settings">
      <p><ShieldCheck size={15} /> Your DMs are end-to-end encrypted and this device is unlocked.</p>
      <div className="e2-row">
        <button type="button" className="btn btn-surface" onClick={() => setDlg('approve')}><Smartphone size={15} /> Approve a device</button>
        <button type="button" className="btn btn-surface" onClick={() => setDlg('passcode')}><KeyRound size={15} /> Change PIN or password</button>
        <button type="button" className="btn btn-surface" onClick={genRecovery}><KeyRound size={15} /> New recovery code</button>
      </div>
      <h4>Linked apps</h4>
      {clients.length === 0 ? <p className="vc-dialog-sub">No other apps can read your DMs. Apps you've signed in to can't read them unless you link them here.</p> : (
        <ul className="e2-clients">
          {clients.map(c => <li key={c.kid}><AppWindow size={16} /><span><b>{c.label}</b><small>Linked {new Date(c.added_at).toLocaleDateString()}</small></span><button type="button" className="btn btn-danger" onClick={() => unlink(c)}><Trash2 size={14} /> Unlink</button></li>)}
        </ul>
      )}
      <h4>What encryption doesn't hide</h4>
      <p className="vc-dialog-sub">Nookara still sees who you message, when, how big messages and files are, reactions and pins, and that a call happened. If you report a message, your app unlocks it and the messages around it for moderators.</p>
      {dlg === 'approve' && <Dialog title="Approve a device or app" onClose={close}><ApproveLink onClose={close} /></Dialog>}
      {dlg === 'passcode' && <Dialog title="Change PIN or password" onClose={close}><NewPasscode onDone={close} /></Dialog>}
      {dlg === 'recovery' && recovery && <Dialog title="New recovery code" onClose={close}><RecoveryCode code={recovery} onDone={close} /></Dialog>}
    </div>
  );
}
