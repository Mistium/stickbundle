import { h } from "../vendor/react.js";
import { roturMe } from "./rotur.js";
import { setProfile, setRoturToken } from "./storage.js";

// Sign-in for the OriginChats build. Rotur accounts work on every server; the
// key is only sent to api.rotur.dev, which turns it into per-server validators.
// "Continue without Rotur" leaves sign-in to each server's local accounts.
function LoginPage() {
  const [key, setKey] = h.useState("");
  const [busy, setBusy] = h.useState(false);
  const [error, setError] = h.useState(null);

  const next = () => {
    const n = new URLSearchParams(location.search).get("next");
    location.href = n && n.startsWith("/") ? n : "/chat";
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const token = key.trim();
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await roturMe(token);
      // Server-account logins stay; they belong to their servers.
      setRoturToken(token);
      setProfile({ kind: "rotur", ...me });
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
      <form className="onb-card" onSubmit={submit}>
        <div className="onb-mark">
          <img src="/assets/bonfire/icon.svg" alt="" width={44} height={44} />
        </div>
        <h1 className="onb-title">Sign in to OriginChats</h1>
        <p className="onb-sub">
          Use your Rotur account key to sign in to every OriginChats server you add.
        </p>
        {error && <div className="onb-error">{error}</div>}
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
        <p className="oc-login-hint">
          Find it on{" "}
          <a href="https://rotur.dev/auth" target="_blank" rel="noreferrer">
            rotur.dev
          </a>
          . It stays in this browser and is only sent to Rotur.
        </p>
        <button className="btn btn-primary onb-continue" disabled={busy || !key.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn btn-surface onb-continue oc-login-guest" onClick={guest} disabled={busy}>
          Continue with server accounts only
        </button>
      </form>
    </div>
  );
}

export { LoginPage };
