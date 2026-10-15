// The few screens Velora has no counterpart for: the home view (your
// OriginChats servers instead of friends and DMs), and the sign-in gate for
// servers that need a server account, a password or an invite.

import { h } from "../vendor/react.js";
import { t } from "../vendor/react-jsx-runtime.js";
import { V, me, se } from "../components/vc/VcEmGrid.jsx";
import { Pr } from "../components/vc/VcSide.jsx";
import { loginLocal, reconnect, retryAccess, serverInfo } from "./backend.js";
import { signInWithRotur } from "./rotur.js";
import { checkSigningAccess, onSigningBlocked } from "./signing.js";

const STATE_TEXT = {
  idle: "Not connected",
  connecting: "Connecting…",
  authing: "Signing in…",
  ready: "Connected",
  needs_login: "Sign-in needed",
  error: "Can't connect",
  closed: "Disconnected",
};

function dialog(kind) {
  dispatchEvent(new CustomEvent("vc-dialog", { detail: { kind } }));
}

function ServerIcon({ server, size }) {
  return (
    <span className={`vc-srv-ico${size === "lg" ? " lg" : ""}`}>
      {server.icon ? <img src={server.icon} alt="" /> : Pr(server.name)}
    </span>
  );
}

function OCSide() {
  const servers = V((s) => s.servers);
  return (
    <div className="vc-side oc-side">
      <div className="vc-side-head">
        <b className="oc-side-title">OriginChats</b>
      </div>
      <div className="vc-side-list">
        <div className="vc-cat-name static">Your servers</div>
        {servers.map((s) => (
          <button
            type="button"
            key={s.sid}
            className="vc-dm oc-side-server"
            onClick={() => me({ kind: "server", sid: s.sid })}
          >
            <ServerIcon server={s} />
            <span className="vc-dm-txt">
              <b>{s.name}</b>
              <small className={`oc-state oc-state-${s.oc_state}`}>{STATE_TEXT[s.oc_state] || ""}</small>
            </span>
          </button>
        ))}
        <button type="button" className="vc-ch oc-side-action" onClick={() => dialog("create")}>
          + Add a server
        </button>
        <button type="button" className="vc-ch oc-side-action" onClick={() => dialog("discover")}>
          Browse public servers
        </button>
      </div>
    </div>
  );
}

function OCHome() {
  const servers = V((s) => s.servers);
  const me_ = V((s) => s.me);
  return (
    <div className="vc-home oc-home">
      <div className="vc-home-main">
        <div className="vc-head">
          <b className="vc-head-name">Home</b>
        </div>
        <div className="vc-home-body">
          <div className="oc-home-hero vl-rise">
            <h2>{me_ && me_.username && me_.username !== "you" ? `Hey, ${me_.username}` : "Welcome"}</h2>
            <p>
              Each server here is its own OriginChats server. Add one by its address, or browse the public ones.
            </p>
            <div className="oc-home-actions">
              <button type="button" className="btn btn-primary" onClick={() => dialog("create")}>
                Add a server
              </button>
              <button type="button" className="btn btn-surface" onClick={() => dialog("discover")}>
                Browse public servers
              </button>
            </div>
          </div>
          {servers.length > 0 && <div className="vc-cat-name static">Your servers - {servers.length}</div>}
          {servers.map((s, i) => (
            <button
              type="button"
              key={s.sid}
              className="vc-friend vl-rise oc-home-server"
              style={{ "--i": Math.min(i, 14) }}
              onClick={() => me({ kind: "server", sid: s.sid })}
            >
              <ServerIcon server={s} />
              <span className="vc-friend-txt">
                <b>{s.name}</b>
                <small>
                  {s.oc_url ? s.oc_url.replace(/^https?:\/\//, "") : ""}
                  {" · "}
                  <span className={`oc-state oc-state-${s.oc_state}`}>{STATE_TEXT[s.oc_state] || ""}</span>
                  {s.oc_state === "ready" && s.member_count ? ` · ${s.member_count} members` : ""}
                </small>
              </span>
              {s.mentions > 0 && <span className="vc-count">{s.mentions}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Covers the channel view while a server isn't signed in yet.
function OCServerGate({ sid }) {
  const server = V((s) => s.servers.find((x) => x.sid === sid));
  const detail = V((s) => s.detail[sid]);
  const view = V((s) => s.view);
  const [mode, setMode] = h.useState("login");
  const [username, setUsername] = h.useState("");
  const [password, setPassword] = h.useState("");
  const [access, setAccess] = h.useState("");
  const [busy, setBusy] = h.useState(false);
  const [error, setError] = h.useState(null);
  const state = server && server.oc_state;

  // Once signed in, leave the placeholder channel for a real one.
  h.useEffect(() => {
    if (state === "ready" && detail && view.sid === sid && !detail.channels.some((c) => c.cid === view.cid)) {
      if (detail.channels.length) {
        me({ kind: "server", sid }, { replace: true });
      }
    }
  }, [state, detail, view.cid]);

  if (!server || state === "ready") {
    return null;
  }
  const info = serverInfo(sid) || {};
  const waiting = state === "connecting" || state === "authing" || state === "idle";
  const accessReason = info.access && info.access.reason;
  const needsAccess = /password|invite/.test(accessReason || "");

  const submitLocal = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginLocal(sid, username.trim(), password, mode === "register");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const submitAccess = (ev) => {
    ev.preventDefault();
    retryAccess(sid, /invite/.test(accessReason) ? { invite_code: access.trim() } : { server_password: access });
  };

  return (
    <div className="oc-gate">
      <div className="oc-gate-card vl-rise">
        <ServerIcon server={server} size="lg" />
        <h2>{server.name}</h2>
        <p className="oc-gate-url">{info.url ? info.url.replace(/^https?:\/\//, "") : ""}</p>
        {waiting && <p className="oc-gate-msg">{STATE_TEXT[state]}</p>}
        {!waiting && server.oc_error && <div className="onb-error">{server.oc_error}</div>}
        {state === "error" && (
          <button type="button" className="btn btn-primary" onClick={() => reconnect(sid)}>
            Try again
          </button>
        )}
        {state === "needs_login" && needsAccess && (
          <form className="oc-gate-form" onSubmit={submitAccess}>
            <label className="vc-field">
              <span>{/invite/.test(accessReason) ? "Invite code" : "Server password"}</span>
              <input
                className="form-input"
                type={/invite/.test(accessReason) ? "text" : "password"}
                value={access}
                onChange={(e) => setAccess(e.target.value)}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" disabled={!access.trim()}>
              Join
            </button>
          </form>
        )}
        {state === "needs_login" && !needsAccess && info.canLogin && (
          <form className="oc-gate-form" onSubmit={submitLocal}>
            <p className="oc-gate-msg">
              {info.canRotur && !info.hasRotur
                ? "Sign in with a Rotur account on the login page, or use an account on this server."
                : "This server uses its own accounts."}
            </p>
            {error && <div className="onb-error">{error}</div>}
            <label className="vc-field">
              <span>Username</span>
              <input className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="vc-field">
              <span>Password</span>
              <input
                className="form-input"
                type="password"
                value={password}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="vc-dialog-btns">
              {info.canRegister && (
                <button
                  type="button"
                  className="btn btn-surface"
                  onClick={() => setMode(mode === "login" ? "register" : "login")}
                >
                  {mode === "login" ? "Create an account instead" : "I have an account"}
                </button>
              )}
              <span className="grow" />
              <button className="btn btn-primary" disabled={busy || !username.trim() || !password}>
                {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
            </div>
          </form>
        )}
        {state === "needs_login" && !needsAccess && !info.canLogin && (
          <t.Fragment>
            <p className="oc-gate-msg">This server only accepts Rotur accounts.</p>
            <a className="btn btn-primary" href="/login?next=/chat">
              Sign in with Rotur
            </a>
          </t.Fragment>
        )}
      </div>
    </div>
  );
}

// Shown when Rotur won't sign for this sign-in (older sign-ins didn't ask for
// signing), so messages would otherwise go out unsigned without a word.
function OCSigningBar() {
  const [blocked, setBlocked] = h.useState(false);
  const [busy, setBusy] = h.useState(false);
  const [hidden, setHidden] = h.useState(false);
  h.useEffect(() => onSigningBlocked(setBlocked), []);
  if (!blocked || hidden) {
    return null;
  }
  const fix = async () => {
    setBusy(true);
    try {
      await signInWithRotur();
      await checkSigningAccess();
    } catch {}
    setBusy(false);
  };
  return (
    <div className="oc-signing-bar" role="status">
      <span>Your messages aren't being signed, so other people see them as unverified.</span>
      <span className="grow" />
      <button type="button" className="btn btn-primary btn-sm" onClick={fix} disabled={busy}>
        {busy ? "Waiting for Rotur…" : "Sign in with Rotur again"}
      </button>
      <button type="button" className="btn btn-surface btn-sm" onClick={() => setHidden(true)}>
        Not now
      </button>
    </div>
  );
}

export { OCHome, OCServerGate, OCSide, OCSigningBar };
