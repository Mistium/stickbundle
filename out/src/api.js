import { onWebClientPath } from './chat/hosts.js';
import { noteServerClock } from './chat/server-clock.js';
import { VELORA, registry, hooks, routePath, unNsBody, instPath, fromInstance } from './chat/ids.js';

function getFingerprint() {
  return [
    navigator.userAgent.slice(0, 100),
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
}

// Ember in a browser (/chat) never touches the website's session: it keeps its own token (localStorage['bonfire_token'],
// from Velora's "approve this app" screen - see chat/session.js). The desktop / Android shells keep their own token storage,
// and every other page (/me, /admin...) keeps velora_token.
// Android installs its gesture API after the page finishes loading, but React
// needs the native session during startup. The shell's UA is present on the
// very first request, including in already-installed APKs. This only chooses
// local storage; the server still validates every token and permission.
const isAndroidBonfire = () => /\bBonfireAndroid\//.test(navigator.userAgent);
export const isWebBonfire = () => onWebClientPath() && !window.bonfireDesktop && !window.bonfireMobile && !isAndroidBonfire();
export const TOKEN_KEY = () => (isWebBonfire() ? 'bonfire_token' : 'velora_token');
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY()); } catch { return null; }
}
// web Ember: Velora said the token is no good (or there never was one) - chat/store.js drops to signed-out mode
let authLostHook = null;
export const onAuthLost = fn => { authLostHook = fn; };

// The server says "your token doesn't have that permission" (403 insufficient_scope): Ember registers a handler that
// shows "This needs a new permission - log in again" once, for any request, so no feature has to deal with it.
let scopeHook = null;
export const onScopeError = fn => { scopeHook = fn; };
export function reportScopeError(data) { try { scopeHook?.(data || {}); } catch { /* fine */ } }

// opts.inst: an instance origin (or 'velora', the default). Ids that came from an instance (origin|id) pick the instance by
// themselves, so a request for a community can't go anywhere else. A /chat/... path on an instance is rewritten to
// /api/v1/... with that instance's own session.
async function instanceRequest(origin, rel, options, retry = true) {
  const c = registry.get(origin);
  if (!c?.session) throw Object.assign(new Error('instance_not_connected'), { status: 401 });
  const form = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(form ? {} : { 'Content-Type': 'application/json' }),
    'X-Device-Fingerprint': getFingerprint(),
    Authorization: `Bearer ${c.session}`,
    ...(options.headers || {}),
  };
  let res;
  try { res = options.onProgress ? await xhrFetch(origin + instPath(rel), { ...options, headers }) : await fetch(origin + instPath(rel), { ...options, headers }); } catch (e) { if (e.name === 'AbortError') throw e; throw Object.assign(new Error('instance_unreachable'), { status: 0 }); }
  if (res.status === 401 && retry && hooks.refresh && await hooks.refresh(origin).catch(() => false)) return instanceRequest(origin, rel, options, false);
  if (res.status === 403) res.clone().json().then(d => { if (d?.error === 'account_restricted') hooks.restricted?.(origin, d.message); }).catch(() => {}); // staff switched Ember off for this account: one notice, not an error per request
  return res;
}
const relOf = p => p.replace(/^\/(chat|api\/v1)(?=\/|$)/, '') || '/';
async function instanceJson(origin, rel, options, fallback) {
  const res = await instanceRequest(origin, rel, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error === 'insufficient_scope' ? 'inst_scope' : data.error || fallback);
    err.status = res.status;
    Object.assign(err, data, { error: data.error }); keepPlanCode(err);
    throw err;
  }
  return fromInstance(origin, data, relOf(rel).split('?')[0]);
}

export async function apiFetch(path, options = {}) {
  const { inst: want, ...opts } = options;
  const r = routePath(path, want);
  if (r.inst !== VELORA) return instanceJson(r.inst, r.path, { ...opts, body: unNsBody(r.inst, opts.body) }, 'request_failed');
  const token = getToken();
  if (!token && isWebBonfire()) throw Object.assign(new Error('signed_out'), { status: 401 }); // signed-out Ember never calls Velora
  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': getFingerprint(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(r.path, { ...opts, headers });
  noteServerClock(res.headers.get('date'), res.headers.get('age'));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.status = res.status;
    Object.assign(err, data); keepPlanCode(err);
    if (res.status === 401 && token && isWebBonfire() && ['unauthorized', 'invalid_token'].includes(data.error)) authLostHook?.(); // only Velora rejecting the token signs out (never a network error / 5xx)
    if (res.status === 403 && data.error === 'insufficient_scope') reportScopeError(data);
    throw err;
  }
  return data;
}

// fetch() can't report upload progress: an XHR with the same shape of answer (ok / status / json()). onProgress(sent, total);
// signal aborts it (an AbortError, like fetch)
function xhrFetch(url, { method = 'POST', headers = {}, body, onProgress, signal }) {
  // OriginChats answers uploads from the in-page bridge, which is a normal
  // fetch shim: the progress-reporting XHR would bypass it.
  if (__ORIGINCHATS__) {
    return fetch(url, { method, headers, body, signal }).then(
      res => ({ ok: res.ok, status: res.status, json: async () => res.json() }),
      e => { if (e.name === 'AbortError') throw e; throw Object.assign(new Error('upload_failed'), { status: 0 }); },
    );
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    const abort = () => x.abort();
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.onload = () => {
      signal?.removeEventListener('abort', abort);
      resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => JSON.parse(x.responseText) });
    };
    x.onerror = () => { signal?.removeEventListener('abort', abort); reject(new TypeError('network_error')); };
    x.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    x.send(body);
  });
}

// a file (FormData) to Velora or to an instance: same routing as apiFetch, resolves to the JSON answer.
// options.onProgress(sent, total) follows the upload, options.signal cancels it
export async function uploadFetch(path, form, options = {}) {
  const { inst: want, method = 'POST', headers: extra, onProgress, signal } = options;
  const r = routePath(path, want);
  if (r.inst !== VELORA) return instanceJson(r.inst, r.path, { method, body: form, headers: extra, onProgress, signal }, 'upload_failed');
  const init = { method, headers: { Authorization: `Bearer ${getToken()}`, 'X-Device-Fingerprint': getFingerprint(), ...(extra || {}) }, body: form, signal };
  const res = onProgress ? await xhrFetch(r.path, { ...init, onProgress }).catch(e => { if (e.name === 'AbortError') throw e; throw Object.assign(new Error('upload_failed'), { status: 0 }); }) : await fetch(r.path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || (res.status === 413 ? 'file_too_large' : 'upload_failed'));
    err.status = res.status;
    Object.assign(err, data); keepPlanCode(err);
    if (res.status === 403 && data.error === 'insufficient_scope') reportScopeError(data);
    throw err;
  }
  return data;
}

// a download that needs the Authorization header (exports): { blob, filename }
export async function downloadFetch(path, options = {}) {
  const r = routePath(path, options.inst);
  let res;
  if (r.inst !== VELORA) res = await instanceRequest(r.inst, r.path, { method: 'GET' });
  else res = await fetch(r.path, { headers: { Authorization: `Bearer ${getToken()}`, 'X-Device-Fingerprint': getFingerprint() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'export_failed');
    err.status = res.status;
    throw err;
  }
  const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: m ? m[1] : options.filename || 'export.zip' };
}

// crop = { x, y, w, h } in the picture's own pixels (the profile editor's cropper) - optional
export async function uploadMedia(endpoint, file, crop) {
  const formData = new FormData();
  if (crop) formData.append('crop', `${crop.x},${crop.y},${crop.w},${crop.h}`);
  formData.append('file', file);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'X-Device-Fingerprint': getFingerprint(),
    },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'upload_failed');
    err.status = res.status;
    if (res.status === 403 && data.error === 'insufficient_scope') reportScopeError(data);
    throw err;
  }
  return data;
}

// The export is an attachment that still needs the Authorization header, so it
// cannot be a plain <a href> - fetch it and hand the caller the blob plus the
// filename the server chose.
async function fetchAccountExport() {
  const res = await fetch('/account/export', {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'X-Device-Fingerprint': getFingerprint(),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'export_failed');
    err.status = res.status;
    throw err;
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await res.blob(), filename: match ? match[1] : 'velora-export.json' };
}

export const api = {
  getMe: () => apiFetch('/account/me').then(d => { rememberMe(d); return d; }),
  changeUsername: (username) => apiFetch('/account/change-username', { method: 'POST', body: JSON.stringify({ username }) }),
  completeOnboarding: () => apiFetch('/account/onboarding/complete', { method: 'POST' }),
  exportAccountData: fetchAccountExport,
  updateMe: (body) => apiFetch('/account/update', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (password) => apiFetch('/account/change-password', { method: 'POST', body: JSON.stringify({ password }) }),
  deleteAccount: (password) => apiFetch('/account/me', { method: 'DELETE', body: JSON.stringify({ password }) }),

  getFriends: () => apiFetch('/friends'),
  getFriendRequests: () => apiFetch('/friends/requests'),
  sendFriendRequest: (username) => apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  acceptRequest: (id) => apiFetch(`/friends/request/${id}/accept`, { method: 'PATCH' }),
  declineRequest: (id) => apiFetch(`/friends/request/${id}/decline`, { method: 'PATCH' }),
  removeFriend: (username) => apiFetch(`/friends/${username}`, { method: 'DELETE' }),

  getTransactions: () => apiFetch('/currency/transactions'),
  getEconomy: () => apiFetch('/currency/economy'),
  getOutgoingSubs: () => apiFetch('/currency/subscriptions/outgoing'),
  getIncomingSubs: () => apiFetch('/currency/subscriptions/incoming'),
  claimDaily: () => apiFetch('/currency/daily-claim', { method: 'POST' }),
  transfer: (to, amount, note, captcha_token) => apiFetch('/currency/transfer', { method: 'POST', body: JSON.stringify({ to, amount, note, captcha_token }) }),
  cancelSub: (username) => apiFetch(`/currency/subscribe/user/${username}`, { method: 'DELETE' }),
  clearBanner: () => apiFetch('/media/banner', { method: 'DELETE' }),
  clearPfp: () => apiFetch('/media/pfp', { method: 'DELETE' }),
  revokeSession: (tokenId) => apiFetch(`/account/sessions/${tokenId}`, { method: 'DELETE' }),

  getConversations: () => apiFetch('/im/conversations'),
  getThread: (username, before) => apiFetch(`/im/with/${encodeURIComponent(username)}?limit=100${before ? `&before=${before}` : ''}`),
  markConversationRead: (username) => apiFetch(`/im/with/${encodeURIComponent(username)}/read`, { method: 'POST' }),
  deleteMessage: (id) => apiFetch(`/im/${id}`, { method: 'DELETE' }),

  // group chats (members-only chat rooms)
  getGroups: () => apiFetch('/groups'),
  getGroupMessages: (room) => apiFetch(`/groups/${encodeURIComponent(room)}/messages?limit=200`),
  sendGroupMessage: (room, message) => apiFetch(`/groups/${encodeURIComponent(room)}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
  createGroup: (name, members) => apiFetch('/groups', { method: 'POST', body: JSON.stringify({ name, members }) }),
  addGroupMember: (room, username) => apiFetch(`/groups/${encodeURIComponent(room)}/members`, { method: 'POST', body: JSON.stringify({ username }) }),
  removeGroupMember: (room, username) => apiFetch(`/groups/${encodeURIComponent(room)}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  renameGroup: (room, name) => apiFetch(`/groups/${encodeURIComponent(room)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteGroup: (room) => apiFetch(`/groups/${encodeURIComponent(room)}`, { method: 'DELETE' }),


  getRandomUsernames: () => apiFetch('/stats/random-usernames'),

  getStorageBreakdown: () => apiFetch('/storage-info/info/usage'),
  deleteStorageKey: (storageId, key) => apiFetch(`/storage/${encodeURIComponent(storageId)}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  getMedia: () => apiFetch('/media/list'),
  deleteMedia: (id) => apiFetch(`/media/${id}`, { method: 'DELETE' }),
};

// The last /account/me for the session on this device: pages draw signed in (name, picture, accent
// colour) straight away instead of flashing "signed out" while the real request is on its way.
// Only used while the token (velora_token, or bonfire_token on web Ember) is still the session it was saved for.
const ME_CACHE = () => (isWebBonfire() ? 'bonfire_me_cache_v2' : 'velora_me_cache_v2');
function rememberMe(d) {
  try { if (d && d.account) localStorage.setItem(ME_CACHE(), JSON.stringify({ t: getToken(), d })); } catch { /* private mode / full */ }
}
export function cachedMe() {
  try {
    const c = JSON.parse(localStorage.getItem(ME_CACHE()) || 'null');
    return c && c.t && c.t === getToken() ? c.d : null;
  } catch { return null; }
}

// plan_feature answers carry a human `message`; Object.assign would replace the error code in e.message with it. The code stays in
// e.message (everything switches on it), the sentence goes to e.detail (chat/PlanGate.jsx reads e.error / e.what / e.limit).
function keepPlanCode(err) {
  if (err.error === 'plan_limit' || err.error === 'plan_feature') { if (err.message !== err.error) err.detail = err.message; err.message = err.error; }
}
