// Ember's home connection normally opens one WebSocket to Velora. In this
// build there is no Velora: the page itself is the backend (backend.js), so
// the same socket is an in-memory object that hands Ember's frames to the
// OriginChats bridge and the bridge's events back to Ember.

import { sendFromVelora } from "./backend.js";

const RealWebSocket = typeof window !== "undefined" ? window.WebSocket : null;
let current = null;

function isHomeSocket(url) {
  try {
    const u = new URL(url, location.href);
    return u.host === location.host && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

class OCSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;

  constructor(url, protocols) {
    if (!isHomeSocket(url)) {
      return new RealWebSocket(url, protocols);
    }
    this.url = String(url);
    this.readyState = OCSocket.CONNECTING;
    this.binaryType = "blob";
    this.bufferedAmount = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._listeners = new Map();
    current = this;
    queueMicrotask(() => {
      if (current !== this || this.readyState !== OCSocket.CONNECTING) {
        return;
      }
      this.readyState = OCSocket.OPEN;
      this._fire("open", { type: "open" });
    });
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  _fire(type, event) {
    try {
      this[`on${type}`]?.(event);
    } catch (e) {
      console.error("[originchats socket]", e);
    }
    for (const fn of this._listeners.get(type) || []) {
      try {
        fn(event);
      } catch (e) {
        console.error("[originchats socket]", e);
      }
    }
  }

  send(data) {
    if (typeof data !== "string") {
      return; // voice frames have no OriginChats equivalent
    }
    let frame;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    try {
      sendFromVelora(frame);
    } catch (e) {
      console.error("[originchats]", frame && frame.type, e);
    }
  }

  close() {
    if (this.readyState === OCSocket.CLOSED) {
      return;
    }
    this.readyState = OCSocket.CLOSED;
    if (current === this) {
      current = null;
    }
    queueMicrotask(() => this._fire("close", { type: "close", code: 1000, reason: "" }));
  }
}

// Deliver one bridge event to Ember, as if it came from the socket.
export function deliver(frame) {
  if (!current || current.readyState !== OCSocket.OPEN) {
    return;
  }
  current._fire("message", { type: "message", data: JSON.stringify(frame) });
}

export function installSocket() {
  if (typeof window === "undefined" || !RealWebSocket) {
    return;
  }
  if (window.WebSocket === OCSocket) {
    return;
  }
  window.__OC_REAL_WEBSOCKET__ = RealWebSocket;
  window.WebSocket = OCSocket;
}
