// Ember invite links, recognised in message text so they show as an invite card (LinkEmbeds.jsx InviteEmbed):
//   https://ember.nookara.cc/#/invite/<code>                    (a Velora-hosted server)
//   https://ember.nookara.cc/#/i/<instance origin, encoded>/invite/<code>
//   https://<instance>/invite/<code>                                  (the instance's own invite page)
// The server (unfurl.js) makes the card data - the instance is asked from Velora, never from the browser.
const VELORA_HOST = /^(www\.)?((?:ember\.)?nookara\.cc|velora\.ikelene\.net)$/i;
const CODE = '[A-Za-z0-9]{4,32}';
const HASH_OWN = new RegExp(`^#/invite/(${CODE})/?$`);
const HASH_INST = new RegExp(`^#/i/([^/]+)/invite/(${CODE})/?$`);
const PATH_INV = new RegExp(`^/invite/(${CODE})/?$`);

// -> { inst: origin | null (Velora), code, sure } or null. sure = certainly an Ember invite (so its link can hide behind the card);
// a plain https://host/invite/code only counts as sure on ikelene.net hosts (Ember instances).
export function inviteRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (VELORA_HOST.test(u.hostname)) {
    if (!/^\/(chat\/?)?$/.test(u.pathname)) return null;
    let m = HASH_OWN.exec(u.hash);
    if (m) return { inst: null, code: m[1], sure: true };
    m = HASH_INST.exec(u.hash);
    if (!m) return null;
    try { const o = new URL(decodeURIComponent(m[1])); return o.protocol === 'https:' ? { inst: o.origin, code: m[2], sure: true } : null; } catch { return null; }
  }
  const m = PATH_INV.exec(u.pathname);
  if (!m || u.protocol !== 'https:') return null;
  return { inst: u.origin, code: m[1], sure: /(^|\.)(ikelene\.net|nookara\.cc)$/i.test(u.hostname) };
}
// Velora payment links, shown as a payment card (LinkEmbeds.jsx PaymentEmbed; unfurl.js makes the data):
//   https://nookara.cc/pay/<username>          (pay a person)
//   https://nookara.cc/pay/bp_<32 hex>         (a bot's payment request)
//   https://nookara.cc/payment/<32 hex>        (a payment request, e.g. from a project or a chat bot)
// -> { kind: 'user' | 'bot' | 'request', sure: true } or null
export function paymentRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' || !VELORA_HOST.test(u.hostname) || u.hash) return null;
  if (/^\/payment\/[a-f0-9]{32}\/?$/.test(u.pathname)) return { kind: 'request', sure: true };
  if (/^\/pay\/bp_[a-f0-9]{32}\/?$/.test(u.pathname)) return { kind: 'bot', sure: true };
  if (/^\/pay\/[A-Za-z0-9_.-]{2,32}\/?$/.test(u.pathname)) return { kind: 'user', sure: true };
  return null;
}
// Glint clips, shown as a clip card with Ember's player (LinkEmbeds.jsx GlintEmbed; unfurl.js reads the clip page):
//   https://clips.nookara.cc/c/<10-char id>, or the old https://ikelene.net/glint/c/<10-char id> in older messages
// -> { id, sure: true } or null
export function glintRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' || u.port) return null;
  const onClips = /^clips\.nookara\.cc$/i.test(u.hostname);
  if (!onClips && !/^(www\.)?ikelene\.net$/i.test(u.hostname)) return null;
  const m = (onClips ? /^\/c\/([A-Za-z0-9]{10})\/?$/ : /^\/glint\/c\/([A-Za-z0-9]{10})\/?$/).exec(u.pathname);
  return m ? { id: m[1], sure: true } : null;
}
// Nookara Drive + Forums links, shown as their own cards (LinkEmbeds.jsx; service-embeds.js on the server makes the data). Only the real hosts over https with
// nothing odd in the address count, so a lookalike can't get a card that looks like ours. Ember asks Nookara for these, never the instance a message is on.
function serviceUrl(href, host) {
  let u;
  try { u = new URL(href); } catch { return null; }
  return u.protocol === 'https:' && u.hostname.toLowerCase() === host && !u.port && !u.username && !u.password ? u : null;
}
//   https://drive.nookara.cc/#/s/<32 hex>[/<20 hex>]  a share link, or something inside a shared folder
//   https://drive.nookara.cc/#/drive/<20 hex>         someone's own view of their Drive: its card only ever says "not available", so its link stays in the text
// -> { service: 'drive', sure } or null
export function driveRef(href) {
  const u = serviceUrl(href, 'drive.nookara.cc');
  if (!u || u.pathname !== '/' || u.search) return null;
  if (/^#\/s\/[0-9a-f]{32}(\/[0-9a-f]{20})?\/?$/.test(u.hash)) return { service: 'drive', sure: true };
  return /^#\/drive\/[0-9a-f]{20}\/?$/.test(u.hash) ? { service: 'drive', sure: false } : null;
}
//   https://forums.nookara.cc/t/<id>[?page=n][#p<id>], /c/<slug>, /u/<name>
// -> { service: 'forum', sure: true } or null
export function forumRef(href) {
  const u = serviceUrl(href, 'forums.nookara.cc');
  if (!u) return null;
  const path = u.pathname.replace(/\/+$/, '');
  return /^\/(t\/[1-9][0-9]{0,18}|c\/[^/]+|u\/[^/]+)$/.test(path) ? { service: 'forum', sure: true } : null;
}
// what a link to a card is called where the card itself isn't shown (a reply preview)
export function embedLabel(href) {
  if (inviteRef(href)?.sure) return 'Server Invite';
  if (paymentRef(href)) return 'Payment';
  if (glintRef(href)) return 'Glint Clip';
  if (driveRef(href)) return 'Nookara Drive';
  if (forumRef(href)) return 'Nookara Forums';
  return null;
}
// a line that is only an invite / payment / Glint clip / Drive share / Forums link: the link hides (the card replaces it)
export function isHiddenInviteLine(line) {
  const t = String(line || '').trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  return !!(inviteRef(t)?.sure || paymentRef(t) || glintRef(t) || driveRef(t)?.sure || forumRef(t));
}
