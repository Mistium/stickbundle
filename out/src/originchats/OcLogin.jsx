// The OriginChats sign-in screen, shown before Ember boots. A Rotur account
// works on every server; "server accounts only" lets each server's own login
// gate ask when you open it.
import { useRef, useState } from "react";
import { signInWithKey, signInWithRotur } from "./rotur.js";
import { setProfile } from "./storage.js";
import { ensureToken } from "./session.js";

const AUTH_ERRORS = {
  popup_blocked: "Your browser blocked Rotur's sign-in window. Allow popups for this site and try again.",
  timeout: "Rotur sign-in timed out. Try again.",
  cancelled: "Sign-in was cancelled.",
  access_denied: "Sign-in was cancelled.",
  rate_limited: "Too many sign-ins just now. Wait a minute and try again.",
};

function signInError(e) {
  if (e && (e.code === "aborted" || e.name === "AbortError")) {
    return null;
  }
  return (e && AUTH_ERRORS[e.code]) || "Couldn't sign in with Rotur. Try again in a moment.";
}

export function OcLogin({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const abort = useRef(null);

  const finish = () => {
    ensureToken();
    onDone();
  };

  const rotur = async () => {
    setBusy(true);
    setError(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await signInWithRotur({ signal: ctl.signal });
      finish();
    } catch (e) {
      setError(signInError(e));
      setBusy(false);
    }
    abort.current = null;
  };

  const cancel = () => {
    abort.current?.abort();
    setBusy(false);
  };

  const submitKey = async (ev) => {
    ev.preventDefault();
    const token = key.trim();
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithKey(token);
      finish();
    } catch (e) {
      setError(e.status === 401 || e.status === 403 ? "Rotur didn't accept that key." : "Couldn't reach Rotur. Try again in a moment.");
      setBusy(false);
    }
  };

  const guest = () => {
    setProfile({ kind: "local" });
    finish();
  };

  return (
    <div className="vc">
      <div className="vc-gate oc-login-gate">
        <div className="vc-gate-box vl-rise">
          <img src="/assets/bonfire/icon.svg" alt="" width={56} height={56} />
          <h2>Sign in to OriginChats</h2>
          <p>Your Rotur account signs you in to every OriginChats server you add.</p>
          {error && <p className="vc-err">{error}</p>}
          {busy && !showKey ? (
            <div className="vc-gate-btns">
              <button type="button" className="btn btn-surface" onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="vc-gate-btns">
              <button type="button" className="btn btn-primary" onClick={rotur} disabled={busy}>
                Sign in with Rotur
              </button>
            </div>
          )}
          <div className="vc-gate-btns">
            <button type="button" className="btn btn-surface" onClick={guest} disabled={busy}>
              Continue with server accounts only
            </button>
          </div>
          {showKey ? (
            <form className="oc-login-key" onSubmit={submitKey}>
              <label className="vc-field">
                <span>Rotur account key</span>
                <input
                  className="form-input"
                  type="password"
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste your key"
                  autoFocus
                />
              </label>
              <button type="submit" className="btn btn-surface" disabled={busy || !key.trim()}>
                Sign in with key
              </button>
            </form>
          ) : (
            <button type="button" className="vc-gate-link oc-login-link" onClick={() => setShowKey(true)}>
              Use an account key instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
