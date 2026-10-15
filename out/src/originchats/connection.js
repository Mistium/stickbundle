// One WebSocket to one OriginChats server: handshake, sign-in, requests
// matched by `listener`, and reconnects with backoff.
//
// Protocol reference: https://docs.originchats.com/protocol/model/

import { roturAccount, roturValidator } from "./rotur.js";
import {
  getLocalLogin,
  getSession,
  setLocalLogin,
  setSession,
} from "./storage.js";

// Shown to other people as this connection's client; matches the client's
// name in clients.originchats.com/openable.json.
const CLIENT_NAME = "stickbundle";
const REQUEST_TIMEOUT = 15000;

function deviceKind() {
  try {
    return /iPhone|iPod|Android.*Mobile|Mobi|Windows Phone/i.test(navigator.userAgent)
      ? "mobile"
      : "computer";
  } catch {
    return "computer";
  }
}

function socketUrl(url) {
  return url.replace(/^http/i, "ws") + "/";
}

let listenerSeq = 0;

// Wall-clock seconds from a monotonic source, so changes to the device clock
// mid-session don't move it.
const localNow = () => (performance.timeOrigin + performance.now()) / 1000;

class OCConnection {
  constructor(url, { onEvent, onState }) {
    this.url = url;
    this.onEvent = onEvent;
    this.onState = onState;
    this.ws = null;
    this.state = "idle"; // idle | connecting | authing | ready | needs_login | error | closed
    this.error = null;
    this.handshake = null;
    this.me = null;
    this.uploadToken = null;
    this.pending = new Map();
    this.retries = 0;
    this.retryTimer = null;
    this.closedByUser = false;
    this.authAttempt = null;
    this.extraAuth = {};
    // Server clock: offset from this device's clock, in seconds.
    this.clockOffset = 0;
  }

  // The server's time now, in Unix seconds, for signed timestamps. The
  // device clock can be wrong; the offset comes from the handshake and is
  // refined with a timed ping after sign-in.
  serverNow() {
    return localNow() + this.clockOffset;
  }

  syncClock() {
    const t0 = localNow();
    this.request("ping", { sent_at: t0 }, { timeout: 8000 })
      .then((f) => {
        const t3 = localNow();
        const t1 = Number(f.server_received_at);
        const t2 = Number(f.server_sent_at);
        if (!isFinite(t1) || !isFinite(t2) || t3 < t0 || t2 < t1) {
          return;
        }
        const rtt = t3 - t0 - (t2 - t1);
        if (rtt < 0 || rtt > 5) {
          return;
        }
        this.clockOffset = (t1 - t0 + (t2 - t3)) / 2;
      })
      .catch(() => {});
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onState(this);
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.closedByUser = false;
    if (this.ws && this.ws.readyState <= 1) {
      return;
    }
    this.setState("connecting");
    let ws;
    try {
      ws = new WebSocket(socketUrl(this.url));
    } catch (e) {
      this.setState("error", "That server address doesn't work.");
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== "string") {
        return;
      }
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleFrame(frame);
    };
    ws.onclose = () => {
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      this.handshake = null;
      this.uploadToken = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Object.assign(new Error("offline"), { status: 0 }));
      }
      this.pending.clear();
      if (this.closedByUser || this.state === "needs_login") {
        if (this.state !== "needs_login") {
          this.setState("closed");
        }
        return;
      }
      this.setState(this.state === "error" ? "error" : "connecting", this.error);
      const delay = Math.min(30000, 1000 * 2 ** this.retries++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.setState("closed");
  }

  rawSend(frame) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  // Sends a command and resolves with its direct response. `expect` lists the
  // response `cmd`s that count as the answer (default: the command itself).
  request(cmd, fields = {}, { expect, timeout = REQUEST_TIMEOUT } = {}) {
    if (this.state !== "ready") {
      return Promise.reject(Object.assign(new Error("offline"), { status: 0 }));
    }
    const listener = `v${++listenerSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(listener);
        reject(Object.assign(new Error("timeout"), { status: 504 }));
      }, timeout);
      this.pending.set(listener, {
        cmd,
        expect: expect || [cmd],
        resolve,
        reject,
        timer,
      });
      if (!this.rawSend({ cmd, ...fields, listener })) {
        clearTimeout(timer);
        this.pending.delete(listener);
        reject(Object.assign(new Error("offline"), { status: 0 }));
      }
    });
  }

  // Fire-and-forget command; the result arrives as an event if at all.
  send(cmd, fields = {}) {
    if (this.state !== "ready") {
      return false;
    }
    return this.rawSend({ cmd, ...fields });
  }

  has(capability) {
    var e;
    return !!((e = this.handshake) != null && e.capabilities && this.handshake.capabilities.includes(capability));
  }

  handleFrame(frame) {
    const p = frame.listener != null ? this.pending.get(frame.listener) : null;
    let isResponse = false;
    if (p) {
      if (frame.cmd === "error" || frame.cmd === "rate_limit") {
        clearTimeout(p.timer);
        this.pending.delete(frame.listener);
        const err = new Error(frame.val || frame.reason || "request_failed");
        err.status = frame.cmd === "rate_limit" ? 429 : 400;
        err.frame = frame;
        p.reject(err);
        return;
      }
      if (p.expect.includes(frame.cmd)) {
        clearTimeout(p.timer);
        this.pending.delete(frame.listener);
        p.resolve(frame);
        isResponse = true;
      }
      // Responses that are also broadcasts (message_edit, reaction_add, ...)
      // still go through the event path, flagged, so every view updates the
      // same way.
    }
    switch (frame.cmd) {
      case "handshake":
        this.handshake = frame.val || {};
        if (isFinite(Number(this.handshake.server_time))) {
          this.clockOffset = Number(this.handshake.server_time) - localNow();
        }
        this.onEvent(this, frame, false);
        this.signIn();
        return;
      case "auth_success":
        return;
      case "ready":
        this.retries = 0;
        this.me = frame.user;
        this.uploadToken = frame.local_upload_token || null;
        if (frame.session_token) {
          setSession(this.url, {
            token: frame.session_token,
            username: frame.user && frame.user.username,
            rotur: roturAccount(),
          });
        }
        if (this.authAttempt && this.authAttempt.kind === "local" && this.authAttempt.save) {
          setLocalLogin(this.url, this.authAttempt.save);
        }
        this.authAttempt = null;
        this.setState("ready");
        this.syncClock();
        this.onEvent(this, frame);
        return;
      case "auth_error":
        this.handleAuthError(frame);
        return;
      case "ping":
        if (frame.server_time == null && frame.sent_at == null) {
          return;
        }
        break;
    }
    this.onEvent(this, frame, isResponse);
  }

  // Validates that the validator key names the server we dialled before a
  // Rotur validator is spent on it.
  keyMatchesServer() {
    const key = String(this.handshake.validator_key || "");
    // Like the official client, only keys bound to an http(s) URL are
    // checked; the DM server's key names its wss:// address.
    if (!/^originChats-https?:\/\//i.test(key)) {
      return true;
    }
    // `originChats-<url>-<nonce>`: the nonce is always 32 characters and may
    // contain "-" and "_", so split at that fixed boundary.
    const value = key.slice("originChats-".length);
    const sep = value.length - 33;
    if (sep <= 0 || value[sep] !== "-" || !/^[A-Za-z0-9_-]{32}$/.test(value.slice(sep + 1))) {
      return false;
    }
    try {
      return new URL(value.slice(0, sep)).host === new URL(this.url).host;
    } catch {
      return false;
    }
  }

  async signIn() {
    const hs = this.handshake;
    this.setState("authing");
    const base = { client: CLIENT_NAME, device: deviceKind(), ...this.extraAuth };
    const account = roturAccount();
    const session = getSession(this.url);
    const caps = hs.capabilities || [];

    // A session only resumes for the Rotur account (or none) that made it.
    if (session && session.token && (session.rotur || null) === (account || null)) {
      this.authAttempt = { kind: "session" };
      this.rawSend({ cmd: "auth", session: session.token, ...base });
      return;
    }
    // Like the official client, sign-in methods follow auth_mode (default
    // "rotur"); some servers don't list `auth`/`login` as capabilities.
    const authMode = hs.auth_mode || "rotur";
    const canRotur = authMode !== "cracked-only";
    const canLocal = authMode === "cracked" || authMode === "cracked-only" || caps.includes("login");
    const local = getLocalLogin(this.url);
    if (local && canLocal) {
      this.authAttempt = { kind: "local" };
      this.rawSend({ cmd: "login", username: local.username, password: local.password, ...base });
      return;
    }
    if (account && canRotur) {
      if (!this.keyMatchesServer()) {
        this.setState("error", "This server's identity doesn't match its address, so you won't be signed in to it.");
        return;
      }
      this.authAttempt = { kind: "rotur" };
      try {
        const validator = await roturValidator(hs.validator_key);
        if (this.handshake !== hs) {
          return;
        }
        this.rawSend({ cmd: "auth", validator, ...base });
      } catch (e) {
        this.setState(
          "error",
          e.name === "RoturPermissionError"
            ? "Rotur needs your permission to sign you in here - sign in with Rotur again."
            : e.status === 401 || e.status === 403
              ? "Your Rotur sign-in expired - sign in again."
              : "Couldn't reach Rotur to sign in.",
        );
      }
      return;
    }
    this.setState("needs_login");
  }

  handleAuthError(frame) {
    const attempt = this.authAttempt;
    this.authAttempt = null;
    if (attempt && attempt.kind === "session") {
      // The session expired; sign in from scratch on the same socket.
      setSession(this.url, null);
      this.signIn();
      return;
    }
    // Only a credential failure (no access-control reason) means the saved
    // login is wrong; a password or invite prompt keeps it.
    if (attempt && attempt.kind === "local" && !attempt.save && !frame.reason) {
      setLocalLogin(this.url, null);
    }
    const reason = frame.reason || "";
    if (reason === "kicked" || reason === "banned") {
      this.onEvent(this, frame);
    }
    if (["password_required", "password_incorrect", "invite_required", "invite_invalid", "invite_expired", "application_required", "application_pending", "not_whitelisted"].includes(reason)) {
      this.accessNeeded = { reason, mode: frame.mode, message: frame.val };
    }
    this.setState("needs_login", frame.val || "Sign-in failed");
  }

  // Sign in with a server account, or create one. Resolves on `ready`.
  loginLocal(username, password, { register = false } = {}) {
    return this.authWith({
      kind: "local",
      frame: { cmd: register ? "register" : "login", username, password },
      save: { username, password },
    });
  }

  // Retry Rotur sign-in with access-control fields (password or invite).
  retryWith(extra) {
    this.extraAuth = { ...this.extraAuth, ...extra };
    if (this.ws && this.ws.readyState === 1 && this.handshake) {
      this.signIn();
    } else {
      this.connect();
    }
  }

  authWith(attempt) {
    return new Promise((resolve, reject) => {
      const go = () => {
        this.authAttempt = attempt;
        this.setState("authing");
        this.rawSend({ ...attempt.frame, client: CLIENT_NAME, device: deviceKind(), ...this.extraAuth });
      };
      const prev = this.onState;
      let settled = false;
      const done = (ok, err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.onState = prev;
        if (ok) {
          resolve();
        } else {
          reject(new Error(err || "Sign-in failed"));
        }
      };
      const timer = setTimeout(() => done(false, "The server didn't answer in time."), 20000);
      this.onState = (c) => {
        prev(c);
        if (c.state === "ready") {
          done(true);
        } else if (c.state === "needs_login" || c.state === "error" || c.state === "closed") {
          done(false, c.error);
        }
      };
      if (this.ws && this.ws.readyState === 1 && this.handshake) {
        go();
      } else {
        // Wait for the handshake of a fresh socket, then sign in.
        const origSignIn = this.signIn.bind(this);
        this.signIn = () => {
          this.signIn = origSignIn;
          go();
        };
        this.connect();
      }
    });
  }
}

export { OCConnection };
