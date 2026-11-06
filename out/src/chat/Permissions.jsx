// The apps sign in through Velora's approve-this-app screen and keep a scoped token. These are the two places it shows:
//  - "New permission updates": a permission Ember needs isn't on this login yet (a new feature, or an old login from before
//    the approve screen existed) -> Log in again / Later
//  - a small card when something you tried needs a permission this login doesn't have -> Log in again
// The data + actions live in store.js (checkPermissions, scopeDenied, loginAgain).
import { createPortal } from 'react-dom';
import { ShieldCheck, ShieldAlert, X, LogIn, Loader2 } from 'lucide-react';
import { useChat, permLater, dismissScopePrompt, loginAgain, clearReauth } from './store.js';
import { Dialog } from './Dialogs.jsx';

function ReauthNote() {
  const r = useChat(s => s.reauth);
  if (!r) return null;
  return createPortal(
    <div className="vc-upd vc-perm-note" role="status">
      <span className="vc-upd-ico">{r.state === 'failed' ? <ShieldAlert size={26} /> : <Loader2 size={26} className="vc-spin" />}</span>
      <div className="vc-upd-txt">
        <b>{r.state === 'failed' ? "Couldn't log you in again" : r.state === 'working' ? 'Finishing your login...' : 'Finish logging in in your browser'}</b>
        <span>{r.state === 'failed' ? (r.error || 'Try again.') : r.state === 'working' ? 'One moment.' : 'Approve the permissions there, then come back. You stay logged in here until then.'}</span>
      </div>
      <div className="vc-upd-btns">
        {r.state === 'failed' && <button type="button" className="btn btn-primary btn-sm" onClick={loginAgain}><LogIn size={14} /> Try again</button>}
        <button type="button" className="vc-ico-btn" title="Hide" onClick={clearReauth}><X size={15} /></button>
      </div>
    </div>,
    document.body,
  );
}

export function PermissionPrompts() {
  const update = useChat(s => s.permUpdate);
  const prompt = useChat(s => s.scopePrompt);
  const reauth = useChat(s => s.reauth);
  return (
    <>
      {update && (
        <Dialog title="New permission updates" onClose={permLater} className="vc-perm">
          {close => (
            <>
              <p className="vc-dialog-sub">
                {update.legacy
                  ? 'Ember now asks before it gets access to your Nookara account. Log in again to see what it can do and approve it.'
                  : 'Ember has new features that need permissions this login does not have yet. Log in again to approve them. Everything keeps working in the meantime, except the features below.'}
              </p>
              <ul className="vc-perm-list">
                {update.missing.map(m => (
                  <li key={m.id}><ShieldCheck size={16} /><div><b>{m.name}</b><span>{m.reason}</span></div></li>
                ))}
              </ul>
              <div className="vc-dialog-btns">
                <span className="grow" />
                <button type="button" className="btn btn-surface" onClick={close}>Later</button>
                <button type="button" className="btn btn-primary" autoFocus onClick={loginAgain}><LogIn size={15} /> Log in again</button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {prompt && !update && !reauth && createPortal(
        <div className="vc-upd vc-perm-note" role="alert">
          <span className="vc-upd-ico"><ShieldAlert size={26} /></span>
          <div className="vc-upd-txt">
            <b>This needs a new permission</b>
            <span>{prompt.name ? `${prompt.name}: ${prompt.reason}` : 'This login does not have it yet.'} Log in again to use it.</span>
          </div>
          <div className="vc-upd-btns">
            <button type="button" className="btn btn-primary btn-sm" onClick={loginAgain}><LogIn size={14} /> Log in again</button>
            <button type="button" className="vc-ico-btn" title="Not now" onClick={dismissScopePrompt}><X size={15} /></button>
          </div>
        </div>,
        document.body,
      )}
      <ReauthNote />
    </>
  );
}
