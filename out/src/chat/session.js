// Ember on the web signs in with Velora the way the apps do (PROTOCOL.md §2.5): the "approve this app" screen, then a token
// of its own (localStorage['bonfire_token']). The website's own session (velora_token) is never read or written here.
// The desktop / Android shells keep their own sign-in (store.js loginAgain); none of this runs for them.
import { clientPath, clientUrl, onEmberHost, AUTH_POPUP_URL, AUTH_ORIGINS } from './hosts.js';
import { getToken, isWebBonfire } from '../api.js';
import { dropVeloraSessions } from './instances.js';
import { toast } from './store.js';
import { signOutOriginChats } from '../originchats/session.js';

const STATE = 'bonfire_signin_state', BACK = 'bonfire_signin_back';
export const hasVelora = () => !!getToken();
const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// "Sign in with Velora": back = where to come back to (e.g. { add: 'http://host' } reopens the add-a-server dialog there)
// ember.nookara.cc never leaves for a site page: sign-in is a popup on nookara.cc that posts { type: 'nookara-auth', token, user } back
let popupListener = false;
function onAuthMessage(ev) {
  if (!AUTH_ORIGINS.includes(ev.origin)) return; // only nookara.cc (or the old velora.ikelene.net), never any other origin
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.type !== 'nookara-auth' || typeof d.token !== 'string' || !d.token) return;
  const name = typeof d.user === 'string' ? d.user : d.user && (d.user.username || d.user.name);
  try {
    localStorage.setItem('bonfire_token', d.token);
    if (name) { localStorage.setItem('bonfire_user', String(name)); rememberAccount(String(name), d.token, (d.user && d.user.pfp) || null); }
    localStorage.removeItem('bonfire_me_cache_v2');
    let back = {}; try { back = JSON.parse(sessionStorage.getItem(BACK) || '{}') || {}; sessionStorage.removeItem(BACK); } catch { /* none */ }
    history.replaceState(null, '', clientUrl(back.hash && !back.hash.startsWith('#/signin') ? back.hash : '#/home'));
  } catch { return; }
  location.reload(); // boots again, signed in
}
function popupSignIn(back) {
  if (!popupListener) { popupListener = true; addEventListener('message', onAuthMessage); }
  try { sessionStorage.setItem(BACK, JSON.stringify({ hash: location.hash, ...back })); } catch { /* fine */ }
  const w = 480, h = 640;
  const left = Math.max(0, Math.round(screenX + (outerWidth - w) / 2)), top = Math.max(0, Math.round(screenY + (outerHeight - h) / 2));
  let win = null;
  try { win = window.open(AUTH_POPUP_URL(), 'nookara-signin', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top); } catch { /* blocked */ }
  if (!win) {
    try { win = window.open(AUTH_POPUP_URL(), '_blank'); } catch { /* blocked */ }
    toast(win ? 'Your browser blocked the pop-up, so Nookara sign-in opened in a new tab.' : 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.');
  }
}
export function startSignIn(back = {}) {
  if (__ORIGINCHATS__) { signOutOriginChats(); location.assign('/'); return; } // OriginChats: back to the login screen
  if (onEmberHost()) { popupSignIn(back); return; }
  if (!isWebBonfire()) { location.href = `/login?next=${encodeURIComponent(clientPath())}`; return; }
  const state = rand();
  try { sessionStorage.setItem(STATE, state); sessionStorage.setItem(BACK, JSON.stringify({ hash: location.hash, ...back })); } catch { /* private mode: the state check will fail and say so */ }
  location.href = `/bonfire/app-login?client=web&state=${state}`;
}
// page load: /chat#/signin?code=..&state=.. (or ?error=declined) -> null (not a sign-in return) | { ok, error, back }
let finishing = null; // (one run per page load, even if the page effect runs twice)
export const finishSignIn = () => (finishing ||= finish());
async function finish() {
  if (!isWebBonfire() || !/^#\/signin(\?|$)/.test(location.hash)) return null;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  let want = null, back = {};
  try { want = sessionStorage.getItem(STATE); back = JSON.parse(sessionStorage.getItem(BACK) || '{}') || {}; sessionStorage.removeItem(STATE); sessionStorage.removeItem(BACK); } catch { /* none */ }
  history.replaceState(null, '', clientUrl(back.hash && !back.hash.startsWith('#/signin') ? back.hash : '#/home'));
  const code = q.get('code'), state = q.get('state');
  if (q.get('error')) return { back, error: q.get('error') === 'declined' ? 'declined' : 'failed' };
  if (!code || !state || !want || state !== want) return { back, error: 'state' };
  try {
    const r = await fetch('/bonfire/app-exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || 'invalid_code');
    localStorage.setItem('bonfire_token', d.token);
    if (d.username) { localStorage.setItem('bonfire_user', d.username); rememberAccount(d.username, d.token, null); }
    return { back, ok: true };
  } catch { return { back, error: 'failed' }; }
}
// the Ember accounts signed in on this browser (the account switcher's list). Separate from the website's velora_saved:
// web Ember has tokens of its own.
const SAVED = 'bonfire_saved';
export function savedBonfireAccounts() {
  try { const a = JSON.parse(localStorage.getItem(SAVED) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.username && x.token) : []; } catch { return []; }
}
export function rememberAccount(username, token, pfp) {
  try {
    if (!token || !username) return;
    const old = savedBonfireAccounts();
    const keep = pfp || old.find(a => a.username.toLowerCase() === username.toLowerCase())?.pfp || null;
    const list = old.filter(a => a.username.toLowerCase() !== username.toLowerCase());
    list.unshift({ username, token, pfp: keep });
    localStorage.setItem(SAVED, JSON.stringify(list.slice(0, 10)));
  } catch { /* private mode */ }
}
export function forgetAccount(username) {
  try { localStorage.setItem(SAVED, JSON.stringify(savedBonfireAccounts().filter(a => a.username.toLowerCase() !== username.toLowerCase()))); } catch { /* fine */ }
}
// switch this browser to a saved account: its token is checked first; a dead one is dropped from the list. Reloads on success.
export async function switchBonfireAccount(a) {
  const r = await fetch('/bonfire/session', { headers: { Authorization: `Bearer ${a.token}` } }).catch(() => null);
  if (!r) throw new Error('unreachable');
  if (r.status === 401 || r.status === 403) { forgetAccount(a.username); throw new Error('ended'); }
  if (!r.ok) throw new Error('unreachable');
  localStorage.setItem('bonfire_token', a.token);
  localStorage.setItem('bonfire_user', a.username);
  localStorage.removeItem('bonfire_me_cache_v2');
  history.replaceState(null, '', clientUrl('#/home'));
  location.reload();
}
export const SIGNIN_TEXT = { declined: 'Sign-in was cancelled.', state: "That sign-in didn't match this browser - try again.", failed: "Couldn't sign in with Nookara - try again." };

// forget Ember's Velora sign-in (and the sessions it opened on Velora-login servers) and start over signed out
export function endSession(notice) {
  if (__ORIGINCHATS__) signOutOriginChats(); // OriginChats identity, not a Velora account
  dropVeloraSessions(); // (while bonfire_user still says whose sessions they are)
  try { indexedDB.deleteDatabase('nke1'); window.BonfireNotifications?.postMessage(JSON.stringify({ type: 'dm_key', kid: '', jwk: null })); } catch { /* */ } // this device's DM keys go too, it takes a PIN to read them again
  try { forgetAccount(localStorage.getItem('bonfire_user') || ''); localStorage.removeItem('bonfire_token'); localStorage.removeItem('bonfire_user'); localStorage.removeItem('bonfire_me_cache_v2'); if (notice) sessionStorage.setItem('bonfire_notice', notice); } catch { /* fine */ }
  history.replaceState(null, '', clientUrl('#/home'));
  location.reload();
}
// Settings > Sign out: tell Velora, drop Ember's token. The website's own session is untouched.
export async function signOutVelora() {
  const t = getToken();
  if (t) await fetch('/bonfire/sign-out', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } }).catch(() => {});
  endSession();
}
