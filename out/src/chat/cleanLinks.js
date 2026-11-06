// Removes tracking junk from links (?utm_source=..., ?si=..., fbclid, ...). Pure functions, no imports.
//   cleanUrl(url)   -> the url without tracking (the same string if nothing was there / it can't be parsed)
//   cleanText(text) -> every http(s) link inside the text cleaned
//   hasTracking(text) -> true if cleanText would change something
// Only the parts that are known junk go; every other parameter, the path and the #fragment stay exactly as written.

// parameters that are tracking on every site
const GENERIC = /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|_hsenc|_hsmi|mkt_tok|yclid|twclid|ttclid|li_fat_id|s_cid|ref_src|ref_url|spm)$/i;

const isHost = (h, d) => h === d || h.endsWith(`.${d}`);
const anyHost = (h, list) => list.some(d => isHost(h, d));

// our own links (invites, signed / uploaded files, /t/ temporary files, old catbox #n= names): only the utm_* junk may go
const OWN_HOSTS = ['nookara.cc', 'velora.ikelene.net', 'ikelene.net', 'ikelene.dev', 'catbox.moe'];

// per site: extra parameter names (regex on the lower-cased name) that are junk there
const SITE_RULES = [
  { hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], drop: /^(si|feature|pp|ab_channel)$/ },
  { hosts: ['spotify.com', 'spotify.link'], drop: /^(si|context|nd)$/ },
  { hosts: ['x.com', 'twitter.com'], drop: /^(s|t)$/ },
  { hosts: ['instagram.com'], drop: /^(igsh|igshid)$/ },
  { hosts: ['tiktok.com'], drop: /^(_r|_t|is_from_webapp|sender_device|share_.*)$/ },
  { hosts: ['reddit.com', 'redd.it'], drop: /^(share_id|rdt)$/ },
];
const AMAZON = /(^|\.)amazon\.[a-z.]{2,6}$|(^|\.)amzn\.(to|com|eu|asia)$/;
const AMAZON_DROP = /^(ref|ref_|tag|linkcode|linkid|ascsubtag|pd_rd_.*|pf_rd_.*|_encoding|content-id)$/;
const GOOGLE = /(^|\.)google\.[a-z.]{2,6}$/;

// split "a=1&b=2" keeping every pair as written
function filterQuery(query, drop) {
  if (!query) return { kept: [], changed: false };
  const pairs = query.split('&');
  const kept = pairs.filter(p => {
    if (!p) return false;
    let k = p.split('=')[0];
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* raw name */ }
    return !drop(k.toLowerCase());
  });
  return { kept, changed: kept.length !== pairs.length };
}

export function cleanUrl(input) {
  const url = String(input ?? '');
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  // google.com/url?q=<real link>: go straight to the real link
  if (GOOGLE.test(host) && u.pathname === '/url') {
    const real = u.searchParams.get('q') || u.searchParams.get('url');
    if (real && /^https?:\/\//i.test(real)) return cleanUrl(real);
    const hashAt = url.indexOf('#');
    const noHash = hashAt < 0 ? url : url.slice(0, hashAt);
    const qAt = noHash.indexOf('?');
    const { kept } = filterQuery(qAt < 0 ? '' : noHash.slice(qAt + 1), k => /^(ved|ei|sa|usg)$/.test(k) || GENERIC.test(k));
    return (qAt < 0 ? noHash : noHash.slice(0, qAt)) + (kept.length ? `?${kept.join('&')}` : '') + (hashAt < 0 ? '' : url.slice(hashAt));
  }

  const own = anyHost(host, OWN_HOSTS);
  const amazon = !own && AMAZON.test(host);
  let drop;
  if (own) drop = k => /^utm_/.test(k);
  else {
    const site = SITE_RULES.find(r => anyHost(host, r.hosts));
    drop = k => GENERIC.test(k) || (site ? site.drop.test(k) : false) || (amazon && AMAZON_DROP.test(k));
  }

  const hashAt = url.indexOf('#');
  const noHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const frag = hashAt < 0 ? '' : url.slice(hashAt);
  const qAt = noHash.indexOf('?');
  let base = qAt < 0 ? noHash : noHash.slice(0, qAt);
  const { kept, changed } = filterQuery(qAt < 0 ? '' : noHash.slice(qAt + 1), drop);

  // amazon: /dp/B00XXXX/ref=sr_1_1 -> /dp/B00XXXX
  let pathChanged = false;
  if (amazon) {
    const b2 = base.replace(/\/ref=[^/?#]*/i, '');
    if (b2 !== base) { base = b2; pathChanged = true; }
  }
  if (!changed && !pathChanged) return url;
  return base + (kept.length ? `?${kept.join('&')}` : '') + frag;
}

const LINK = /https?:\/\/[^\s<>]+/gi;
// characters that end a sentence / a markdown wrapper rather than the link
function trimEnd(s) {
  let end = s.length;
  for (;;) {
    const c = s[end - 1];
    const part = s.slice(0, end);
    if (c && '.,;:!?\'"*|~'.includes(c)) { end--; continue; }
    if (c === ')' && part.split('(').length < part.split(')').length) { end--; continue; }
    if (c === ']' && part.split('[').length < part.split(']').length) { end--; continue; }
    break;
  }
  return end;
}

export function cleanText(text) {
  const s = String(text ?? '');
  if (!/https?:\/\//i.test(s)) return s;
  return s.replace(LINK, m => {
    const end = trimEnd(m);
    return cleanUrl(m.slice(0, end)) + m.slice(end);
  });
}

export const hasTracking = text => cleanText(text) !== String(text ?? '');
