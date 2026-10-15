import { h } from "../vendor/react.js";
import { signInWithKey, signInWithRotur } from "./rotur.js";
import { setProfile, setRoturToken } from "./storage.js";

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

// Sign-in for the OriginChats build. A Rotur account works on every server
// you add; "server accounts only" leaves sign-in to each server's own logins.
function LoginPage() {
  const [busy, setBusy] = h.useState(false);
  const [error, setError] = h.useState(null);
  const [showKey, setShowKey] = h.useState(false);
  const [key, setKey] = h.useState("");
  const abort = h.useRef(null);

  const next = () => {
    const n = new URLSearchParams(location.search).get("next");
    location.href = n && n.startsWith("/") ? n : "/chat";
  };

  const rotur = async () => {
    setBusy(true);
    setError(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      // Opens the popup straight away, inside this click.
      await signInWithRotur({ signal: ctl.signal });
      next();
    } catch (e) {
      setError(signInError(e));
      setBusy(false);
    }
    abort.current = null;
  };

  const cancel = () => {
    if (abort.current) {
      abort.current.abort();
    }
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
      next();
    } catch (e) {
      setError(
        e.status === 401 || e.status === 403
          ? "Rotur didn't accept that key."
          : "Couldn't reach Rotur. Try again in a moment.",
      );
      setBusy(false);
    }
  };

  const guest = () => {
    setRoturToken(null);
    setProfile({ kind: "local" });
    next();
  };

  return (
    <div className="onb-overlay oc-login">
      <div className="onb-card">
        <div className="onb-mark">
          <img src="/assets/bonfire/icon.svg" alt="" width={44} height={44} />
        </div>
        <h1 className="onb-title">Sign in to OriginChats</h1>
        <p className="onb-sub">Your Rotur account signs you in to every OriginChats server you add.</p>
        {error && <div className="onb-error">{error}</div>}
        {busy && !showKey ? (
          <div className="oc-login-wait">
            <p>Finish signing in in the Rotur window.</p>
            <button type="button" className="btn btn-surface onb-continue" onClick={cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary onb-continue" onClick={rotur} disabled={busy}>
            Sign in with Rotur
          </button>
        )}
        <button type="button" className="btn btn-surface onb-continue oc-login-guest" onClick={guest} disabled={busy}>
          Continue with server accounts only
        </button>
        {showKey ? (
          <form className="oc-login-key" onSubmit={submitKey}>
            <label className="oc-login-field">
              <span>Rotur account key</span>
              <input
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your key"
                autoFocus
              />
            </label>
            <button className="btn btn-surface onb-continue" disabled={busy || !key.trim()}>
              Sign in with key
            </button>
          </form>
        ) : (
          <button type="button" className="oc-login-link" onClick={() => setShowKey(true)}>
            Use an account key instead
          </button>
        )}
      </div>
    </div>
  );
}

export { LoginPage };
