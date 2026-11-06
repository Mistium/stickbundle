// Where Ember / Nookara live. Three hosts count as "home": the old velora.ikelene.net, nookara.cc (the app under /chat)
// and ember.nookara.cc (the app at its root, same backend, so API + websocket are same-origin there too).
export const EMBER_HOST = 'ember.nookara.cc';
export const NOOKARA_ORIGIN = 'https://nookara.cc';
export const EMBER_ORIGIN = `https://${EMBER_HOST}`;
export const HOME_HOSTS = [EMBER_HOST, 'nookara.cc', 'velora.ikelene.net'];
export const isHomeHost = h => HOME_HOSTS.includes(String(h || '').toLowerCase().replace(/^www\./, ''));
const here = () => { try { return location.hostname.toLowerCase(); } catch { return ''; } };
export const onEmberHost = () => here() === EMBER_HOST;
// This build always runs as the web client. It is served at the site root and
// keeps its history under /chat (Cloudflare Pages serves index.html for it).
export const onWebClientPath = () => true;
// path the client lives at, for history.pushState and sign-in return links
export const clientPath = () => '/chat';
// shareable link to a view hash such as '#/s/1' (this OriginChats build has no
// fixed canonical host: it is wherever the bundle is deployed)
export const shareLink = hash => `${location.origin}/chat${hash}`;
// a hosted instance's address: <slug> -> https://e-<slug>.nookara.cc (older ones: e_<slug>.nookara.cc, <slug>-bonfire.ikelene.net)
export const INSTANCE_DOMAIN = 'nookara.cc';
// e_<slug>.nookara.cc (2026-10-30/31, before the dash: OpenSSL clients reject underscores) is read as e-<slug>.nookara.cc, so saved
// entries, invites and typed addresses go straight to the dash host. -> the host to use
export const hostedAlias = host => String(host || '').toLowerCase().replace(/^e_([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9]))\.nookara\.cc$/, 'e-$1.nookara.cc');
// URL for history.pushState / replaceState of a view hash ('#/home'): /chat#.. on the Velora-era hosts, /#.. on ember.nookara.cc
export const clientUrl = hash => `${clientPath() === '/' ? '/' : '/chat'}${hash || ''}`;
// a path on the Nookara website (/me, /u/name, /upgrade...). ember.nookara.cc serves only the chat, so there it becomes an
// absolute nookara.cc link (callers open it in a new tab); elsewhere it stays relative.
export const siteHref = p => (onEmberHost() ? `${NOOKARA_ORIGIN}${p}` : p);
export const notifLinkUrl = link => {
  const l = typeof link === 'string' ? link.trim() : '';
  if (l.startsWith('/') && !l.startsWith('//')) return `${NOOKARA_ORIGIN}${l}`;
  return /^https?:\/\//i.test(l) ? l : null;
};
export const openSite = p => { window.open(siteHref(p), '_blank', 'noopener,noreferrer'); };
// "Sign in with Nookara" on ember.nookara.cc: a popup on nookara.cc posts the token back (no navigation, no site login page)
export const AUTH_POPUP_URL = () => `${NOOKARA_ORIGIN}/auth/popup?client=ember&origin=${encodeURIComponent(location.origin)}`;
export const AUTH_ORIGINS = [NOOKARA_ORIGIN, 'https://velora.ikelene.net'];
