// Covers the channel view while an OriginChats server is connecting or asks
// for a sign-in (a Rotur account, its own account, an invite or a password).
import { useEffect, useState } from "react";
import { Globe, KeyRound, ShieldCheck } from "lucide-react";
import { useChat, go, loadServers, toast } from "../chat/store.js";
import { loginLocal, reconnect, retryAccess, serverInfo } from "./backend.js";
import { signInWithRotur } from "./rotur.js";

const STATE_TEXT = {
  idle: "Not connected",
  connecting: "Connecting…",
  authing: "Signing in…",
  ready: "Connected",
  needs_login: "Sign-in needed",
  error: "Can't connect",
  closed: "Disconnected",
};

export function OcServerGate({ sid }) {
  const server = useChat((s) => s.servers.find((x) => x.sid === sid));
  const detail = useChat((s) => s.detail[sid]);
  const view = useChat((s) => s.view);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const state = server && server.oc_state;

  // Signed in: leave the placeholder channel for a real one.
  useEffect(() => {
    if (state === "ready" && detail && view.sid === sid && !detail.channels.some((c) => c.cid === view.cid)) {
      if (detail.channels.length) {
        go({ kind: "server", sid }, { replace: true });
      }
    }
  }, [state, detail, view.sid, view.cid, sid]);

  if (!server || state === "ready") {
    return null;
  }
  // A server that was open before keeps its messages on screen while it
  // reconnects, with a thin bar instead of the full sign-in screen.
  if (server.oc_loaded && (state === "connecting" || state === "authing" || state === "idle")) {
    return <div className="vc-sign-banner vc-reconnect-bar" role="status">Reconnecting to {server.name}…</div>;
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

  const withRotur = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithRotur();
      reconnect(sid);
      loadServers().catch(() => {});
    } catch (e) {
      if (e && (e.code === "aborted" || e.name === "AbortError")) {
        setError(null);
      } else {
        setError(e?.code === "popup_blocked" ? "Allow pop-ups to sign in with Rotur." : "Couldn't sign in with Rotur.");
      }
    }
    setBusy(false);
  };

  return (
    <div className="vc-gate">
      <div className="vc-gate-box vl-rise">
        <span className="vc-srv-ico lg">
          {server.icon ? <img src={server.icon} alt="" /> : <ServerMark name={server.name} />}
        </span>
        <h2>{server.name}</h2>
        <p className="vc-gate-host">
          <Globe size={12} /> {info.url ? info.url.replace(/^https?:\/\//, "") : ""}
        </p>
        {waiting && <p>{STATE_TEXT[state]}</p>}
        {!waiting && server.oc_error && <p className="vc-err">{server.oc_error}</p>}
        {state === "error" && (
          <div className="vc-gate-btns">
            <button type="button" className="btn btn-primary" onClick={() => reconnect(sid)}>
              Try again
            </button>
          </div>
        )}

        {state === "needs_login" && needsAccess && (
          <form onSubmit={submitAccess}>
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
            <div className="vc-gate-btns">
              <button className="btn btn-primary" disabled={!access.trim()}>
                Join
              </button>
            </div>
          </form>
        )}

        {state === "needs_login" && !needsAccess && info.canLogin && (
          <form onSubmit={submitLocal}>
            <p>
              {info.canRotur && !info.hasRotur
                ? "Sign in with a Rotur account, or use an account on this server."
                : "This server uses its own accounts."}
            </p>
            {error && <p className="vc-err">{error}</p>}
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
            <div className="vc-gate-btns">
              {info.canRegister && (
                <button type="button" className="btn btn-surface" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                  {mode === "login" ? "Create an account" : "I have an account"}
                </button>
              )}
              <button className="btn btn-primary" disabled={busy || !username.trim() || !password}>
                {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
            </div>
          </form>
        )}

        {state === "needs_login" && !needsAccess && !info.canLogin && (
          <>
            <p>This server only accepts Rotur accounts.</p>
            <div className="vc-gate-btns">
              {info.hasRotur ? (
                <button type="button" className="btn btn-primary" onClick={() => reconnect(sid)}>
                  Try again
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={withRotur} disabled={busy}>
                  <ShieldCheck size={15} /> {busy ? "Waiting for Rotur…" : "Sign in with Rotur"}
                </button>
              )}
            </div>
          </>
        )}

        {state === "needs_login" && !needsAccess && info.canLogin && info.canRotur && !info.hasRotur && (
          <div className="vc-gate-btns">
            <button type="button" className="btn btn-surface" onClick={withRotur} disabled={busy}>
              <ShieldCheck size={15} /> {busy ? "Waiting for Rotur…" : "Use a Rotur account"}
            </button>
          </div>
        )}

        {state === "needs_login" && !info.connected && (info.canLogin || needsAccess) && (
          <div className="vc-gate-btns">
            <button type="button" className="btn btn-surface" onClick={() => reconnect(sid)}>
              <KeyRound size={15} /> Reconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServerMark({ name }) {
  return <span style={{ fontSize: 22, fontWeight: 700 }}>{String(name || "?").slice(0, 2)}</span>;
}
