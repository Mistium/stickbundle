// Everything the OriginChats client keeps in localStorage: the Rotur account
// key, the servers the user added, and per-server sessions and local logins.

const ROTUR_TOKEN = "oc_rotur_token";
const SERVERS = "oc_servers";
const SESSIONS = "oc_sessions";
const LOCAL_LOGINS = "oc_local_logins";
const PROFILE = "oc_profile";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {}
}

// A server URL as the user typed it, reduced to `https://host[:port]`.
function normalizeServerUrl(input) {
  let s = String(input || "").trim();
  if (!s) {
    return "";
  }
  if (!/^[a-z]+:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  s = s.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return "";
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

const getRoturToken = () => read(ROTUR_TOKEN, null);
const setRoturToken = (token) => write(ROTUR_TOKEN, token || null);

const getProfile = () => read(PROFILE, null);
const setProfile = (profile) => write(PROFILE, profile);

function getServers() {
  const list = read(SERVERS, []);
  return Array.isArray(list) ? list.filter((s) => s && s.url) : [];
}
function setServers(list) {
  write(SERVERS, list);
}
function addServer(url) {
  const list = getServers();
  if (!list.some((s) => s.url === url)) {
    list.push({ url, added_at: Date.now() });
    setServers(list);
  }
  return list;
}
function removeServer(url) {
  setServers(getServers().filter((s) => s.url !== url));
  setSession(url, null);
  setLocalLogin(url, null);
}
function moveServers(urls) {
  const list = getServers();
  const byUrl = new Map(list.map((s) => [s.url, s]));
  const ordered = urls.map((u) => byUrl.get(u)).filter(Boolean);
  setServers([...ordered, ...list.filter((s) => !urls.includes(s.url))]);
}

// Session tokens from `ready.session_token`, keyed by server URL. The account
// they belong to is kept alongside so a different Rotur key doesn't reuse them.
function getSession(url) {
  return read(SESSIONS, {})[url] || null;
}
function setSession(url, session) {
  const all = read(SESSIONS, {});
  if (session) {
    all[url] = session;
  } else {
    delete all[url];
  }
  write(SESSIONS, all);
}

// Server-account credentials, only for servers that need them.
function getLocalLogin(url) {
  return read(LOCAL_LOGINS, {})[url] || null;
}
function setLocalLogin(url, login) {
  const all = read(LOCAL_LOGINS, {});
  if (login) {
    all[url] = login;
  } else {
    delete all[url];
  }
  write(LOCAL_LOGINS, all);
}

function signOutEverywhere() {
  write(ROTUR_TOKEN, null);
  write(SESSIONS, null);
  write(LOCAL_LOGINS, null);
  write(PROFILE, null);
}

// Sign out of the identity but keep the servers the user added: the next
// sign-in (or a server account) can use them again.
function signOutIdentity() {
  write(ROTUR_TOKEN, null);
  write(SESSIONS, null);
  write(LOCAL_LOGINS, null);
  write(PROFILE, null);
}

export {
  addServer,
  getLocalLogin,
  getProfile,
  getRoturToken,
  getServers,
  getSession,
  moveServers,
  normalizeServerUrl,
  removeServer,
  setLocalLogin,
  setProfile,
  setRoturToken,
  setServers,
  setSession,
  signOutEverywhere,
  signOutIdentity,
};
