// Message text: a little markdown (**bold**, *italic*, __underline__, ~~strike~~, `code`,
// ```blocks```, ||spoilers||), links, @mentions, #channels, and picture links shown as pictures.
import { useMemo, useState } from 'react';
import { onEmberHost } from './hosts.js';
import { ask, customEmoji, loadEmojis, useChat } from './store.js';
import { UNI_EMOJI, Twemoji, nameOfChar } from './emoji.jsx';
import { emojiDataSync } from './EmojiPicker.jsx';
import { extractInvites } from './gameInvite.js';
import { isHiddenInviteLine } from './inviteLink.js';
import { VID, AUD, VUP, NOOKARA_FILE, TEMP_FILE, inLinks } from './uploadLinks.js'; // account uploads also live on cdn.nookara.cc (/uploads/ only)

const IMG = /^https:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?(#\S*)?$/i;
// Files sent in DMs live on Velora: temporary storage (/t/<id>/<name>, or cdn.nookara.cc/temp/<id>/<name>, the name is in the path) or account storage
// (/uploads/..., #n=<name> on the end = the real name). Pictures show as pictures, videos / sounds play, the rest is a file card.
const TMP = TEMP_FILE;
const isVel = u => TMP.test(u) || VUP.test(u);
const velItem = full => {
  const [u, frag] = full.split('#');
  let name = u.split('/').pop();
  try { name = decodeURIComponent(/^n=(.+)$/.exec(frag || '')?.[1] || name).slice(0, 150); } catch { /* as it is */ }
  const type = /\.(mp4|webm|mov)$/i.test(u) ? 'video' : /\.(mp3|ogg|wav|m4a|aac|flac|weba|opus)$/i.test(u) ? 'audio' : 'file';
  return { url: u, type, name, ...(TMP.test(u) ? { host: 'velora-temp' } : {}) };
};
// an old catbox link (where Ember's DM uploads went before Velora's own storage): pictures / videos / sounds play in Velora's
// viewer, anything else is a file card (#n=<name> on the end = the file's real name - catbox only knows its id)
const CB = /^https:\/\/(files|litter)\.catbox\.moe\/[\w-]+\.[a-z0-9]{1,8}(#n=[^\s#]*)?$/i;
const cbItem = full => {
  const [u, frag] = full.split('#');
  let name = u.split('/').pop();
  try { const n = /^n=(.+)$/.exec(frag || '')?.[1]; if (n) name = decodeURIComponent(n).slice(0, 150); } catch { /* the id then */ }
  return VID.test(u) ? { url: u, type: 'video', name } : AUD.test(u) ? { url: u, type: 'audio', name }
    : { url: u, type: 'file', name, host: /litter\./i.test(u) ? 'litterbox' : 'catbox' };
};
const noFrag = u => (CB.test(u) ? u.split('#')[0] : u);
// a stored file's name can hold ( ) ' , which cut URL_RE's match short: "Download (2).mp4" came out as a second file called "Download (2".
// The whole word instead, without what's really sentence punctuation (a closing bracket counts only when nothing in the link opened it).
function wholeLink(text, at) {
  let w = /^\S+/.exec(text.slice(at))?.[0] || '';
  for (;;) {
    const last = w[w.length - 1];
    if ('.,;:!?"'.includes(last)) { w = w.slice(0, -1); continue; }
    if (last === ')' && w.split(')').length > w.split('(').length) { w = w.slice(0, -1); continue; }
    if (last === ']' && w.split(']').length > w.split('[').length) { w = w.slice(0, -1); continue; }
    return w;
  }
}
// a message that's only emoji (up to 27) shows them big
const EMOJI_ONE = /<a?:[A-Za-z0-9_]{1,32}:e[0-9a-f]{10}>|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
const JUMBO = /^\s*(?:(?:<a?:[A-Za-z0-9_]{1,32}:e[0-9a-f]{10}>|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*)+$/u;
const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]/g;

function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  return <span className={`vc-spoiler${shown ? ' shown' : ''}`} onClick={() => setShown(true)} role="button" tabIndex={0}>{children}</span>;
}

// inline: code first (nothing inside code is formatted), then the rest
function inline(text, ctx, k = 'i') {
  const out = [];
  const parts = String(text).split(/(`[^`\n]+`)/g);
  parts.forEach((p, i) => {
    if (/^`[^`\n]+`$/.test(p)) out.push(<code key={`${k}c${i}`} className="vc-code">{p.slice(1, -1)}</code>);
    else out.push(...format(p, ctx, `${k}f${i}`));
  });
  return out;
}
// <t:unix:style> timestamps (Discord style): t 3:05 PM, T 3:05:09 PM, d 10/8/2026, D October 8, 2026,
// f (default) October 8, 2026 3:05 PM, F Thursday, October 8, 2026 3:05 PM, R "in 5 minutes" / "2 hours ago"
function stampText(sec, style) {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const o = { t: { timeStyle: 'short' }, T: { timeStyle: 'medium' }, d: { dateStyle: 'short' }, D: { dateStyle: 'long' }, f: { dateStyle: 'long', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'short' } };
  if (style === 'R') {
    const diff = (d.getTime() - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    const [u, n] = units.find(([, n]) => Math.abs(diff) >= n) || ['second', 1];
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(diff / n), u);
  }
  return new Intl.DateTimeFormat(undefined, o[style] || o.f).format(d);
}
// click an emoji: who it is and where it's from (EmojiInfoHost in Chat.jsx shows it)
function emojiInfo(e, what) {
  e.stopPropagation();
  dispatchEvent(new CustomEvent('vc-emoji-info', { detail: { ...what, rect: e.currentTarget.getBoundingClientRect() } }));
}
// a custom emoji in a message; follows the emoji list so it fixes itself once the instance's pictures have loaded
let emojiRetryAt = 0;
function CustomEmojiImg({ eid, animated, name }) {
  const known = useChat(s => s.emojiUrls[eid]);
  const [tries, setTries] = useState(0);
  const src = customEmoji(eid, animated);
  // a picture that fails (address not known yet, or a hiccup) asks for the list again and tries a few more times
  const retry = () => {
    if (tries >= 3) return;
    if (!known && Date.now() - emojiRetryAt > 3000) { emojiRetryAt = Date.now(); loadEmojis(); }
    setTimeout(() => setTries(t => t + 1), 1500 * (tries + 1));
  };
  return <img className="vc-cemoji" src={tries ? `${src}${src.includes('?') ? '&' : '?'}r=${tries}` : src} onError={retry} alt={`:${name}:`} title={`:${name}:`} draggable={false}
    onClick={e => emojiInfo(e, { eid, name, animated: !!animated })} />;
}
const RULES = [
  [/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/, (m, ctx, k) => {
    const txt = stampText(Number(m[1]), m[2] || 'f');
    return txt ? <time key={k} className="vc-stamp" dateTime={new Date(Number(m[1]) * 1000).toISOString()} title={new Date(Number(m[1]) * 1000).toLocaleString()}>{txt}</time> : m[0];
  }],
  [/<(a?):([A-Za-z0-9_]{1,32}):(e[0-9a-f]{10})>/, (m, ctx, k) => (
    <CustomEmojiImg key={k} eid={m[3]} animated={m[1]} name={m[2]} />
  )],
  // standard emojis show as Twemoji (Discord's look); click one for its name
  [UNI_EMOJI, (m, ctx, k) => {
    const name = nameOfChar(m[0], emojiDataSync());
    return <Twemoji key={k} char={m[0]} title={name ? `:${name}:` : undefined} onClick={e => emojiInfo(e, { char: m[0] })} />;
  }],
  [/<@&(r[0-9a-f]{10})>/, (m, ctx, k) => {
    const r = ctx?.roles?.find(x => x.rid === m[1]);
    return <span key={k} className="vc-mention role" style={r?.color ? { '--rc': r.color } : undefined}>@{r ? r.name : 'deleted-role'}</span>;
  }],
  [/(?:^|(?<=\s))@(everyone|here)\b/, (m, ctx, k) => <span key={k} className="vc-mention all">@{m[1]}</span>],
  [/\|\|([\s\S]+?)\|\|/, (m, ctx, k) => <Spoiler key={k}>{format(m[1], ctx, k)}</Spoiler>],
  [/\*\*([\s\S]+?)\*\*/, (m, ctx, k) => <b key={k}>{format(m[1], ctx, k)}</b>],
  [/__([\s\S]+?)__/, (m, ctx, k) => <u key={k}>{format(m[1], ctx, k)}</u>],
  [/~~([\s\S]+?)~~/, (m, ctx, k) => <s key={k}>{format(m[1], ctx, k)}</s>],
  [/(?:^|(?<=\s))\*([^*\n]+?)\*(?=\s|$|[.,!?])/, (m, ctx, k) => <i key={k}>{format(m[1], ctx, k)}</i>],
  [/(?:^|(?<=\s))_([^_\n]+?)_(?=\s|$|[.,!?])/, (m, ctx, k) => <i key={k}>{format(m[1], ctx, k)}</i>],
  // [text](link): the text can hide where it goes, so it asks first (plain links just open)
  [/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s<>()]+)\)/, (m, ctx, k) => (
    <a key={k} href={m[2]} className="vc-masked" target="_blank" rel="noopener noreferrer nofollow" title={m[2]} onClick={e => { e.preventDefault(); if (!inAppLink(m[2], ctx, e.currentTarget)) maskedLink(m[2]); }}>{format(m[1], ctx, k)}</a>
  )],
  [URL_RE, (m, ctx, k) => <a key={k} href={m[0]} target="_blank" rel="noopener noreferrer nofollow" onClick={e => { if (inAppLink(m[0], ctx, e.currentTarget)) e.preventDefault(); }}>{m[0]}</a>],
  [/(?:^|(?<=[\s(]))@([A-Za-z0-9_.-]{2,32})/, (m, ctx, k) => {
    const me = ctx?.me && m[1].toLowerCase() === ctx.me.toLowerCase();
    const blocked = !me && !!ctx?.isBlocked?.(m[1]); // somebody I blocked, in a server: no name
    return <button type="button" key={k} className={`vc-mention${me ? ' me' : ''}${blocked ? ' blocked' : ''}`} onClick={e => ctx?.onUser?.(m[1], e.currentTarget)}>@{blocked ? 'Blocked User' : m[1]}</button>;
  }],
  [/(?:^|(?<=[\s(]))#([a-z0-9_-]{1,40})/, (m, ctx, k) => {
    const c = ctx?.channels?.find(x => x.name === m[1]);
    return c ? <button type="button" key={k} className="vc-mention ch" onClick={() => ctx.onChannel?.(c)}>#{c.name}</button> : m[0];
  }],
];
function format(text, ctx, k) {
  if (!text) return [];
  let best = null;
  for (const [re, make] of RULES) {
    const r = new RegExp(re.source, re.flags.replace('g', ''));
    const m = r.exec(text);
    if (m && (!best || m.index < best.m.index)) best = { m, make };
  }
  if (!best) return [text];
  const { m, make } = best;
  return [text.slice(0, m.index), make(m, ctx, `${k}-${m.index}`), ...format(text.slice(m.index + m[0].length), ctx, `${k}+`)].filter(x => x !== '');
}

// the whole body: ``` blocks, quotes (> ...), then lines; returns { nodes, images }
export function renderBody(body, ctx) {
  const nodes = [];
  const images = [];
  const media = [];
  // Hyperfocus game invites are cut out of the text (shown as an embed by the caller, see GameInvite.jsx)
  const invites = [];
  const blocks = String(body || '').split(/```/).map((b, bi) => {
    if (bi % 2 === 1 || ctx?.bio) return b;
    const r = extractInvites(b);
    invites.push(...r.invites);
    return r.text;
  });
  blocks.forEach((b, bi) => {
    if (bi % 2 === 1) {
      const lang = (/^([a-z0-9+#-]{1,20})\n/i.exec(b) || [])[1];
      const code = lang ? b.slice(lang.length + 1) : b.replace(/^\n/, '');
      nodes.push(<pre key={`b${bi}`} className="vc-pre">{lang && <span className="vc-pre-lang">{lang}</span>}<code>{code.replace(/\n$/, '')}</code></pre>);
      return;
    }
    // block markdown: # / ## / ### headers, -# small text, - / * / 1. lists (indent to nest), > quote, >>> quote-the-rest
    const lines = b.split('\n');
    let lastInline = false; // a <br> only goes between two plain lines
    let list = null;        // { ordered, items: [{ depth, nodes, n }] } while lines are list items
    const flushList = () => {
      if (!list) return;
      const k = `L${bi}_${nodes.length}`;
      // nested lists from the indent depth
      const build = (items, depth, key) => {
        const out = [];
        let i = 0;
        while (i < items.length) {
          const it = items[i];
          const kids = [];
          let j = i + 1;
          while (j < items.length && items[j].depth > depth) kids.push(items[j++]);
          out.push(<li key={`${key}-${i}`}>{it.nodes}{kids.length > 0 && build(kids, depth + 1, `${key}-${i}`)}</li>);
          i = j;
        }
        const Tag = items[0]?.ordered ? 'ol' : 'ul';
        return <Tag key={key} className="vc-list" start={items[0]?.ordered ? items[0].n : undefined}>{out}</Tag>;
      };
      nodes.push(build(list.items, list.items[0].depth, k));
      list = null;
      lastInline = false;
    };
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const t = line.trim();
      const key = `${bi}_${li}`;
      if (!ctx?.bio && isHiddenInviteLine(t)) continue; // an Ember invite link on its own line: the invite card (LinkEmbeds) replaces it
      if (IMG.test(t) && ctx?.linkImages !== false) { images.push(noFrag(t)); continue; } // a picture on its own line shows as the picture
      if (/^https:\/\/(?:www\.)?klipy\.com\/(gifs|stickers|clips)\/[\w-]{1,160}\/?(?:\?\S*)?$/i.test(t) && ctx?.linkImages !== false) { images.push(t); continue; } // a Klipy GIF page link shows as the GIF
      if (!ctx?.bio && CB.test(t) && !IMG.test(t)) { media.push(cbItem(t)); continue; } // catbox videos / sounds / files (the link hides)
      if (!ctx?.bio && isVel(t) && !IMG.test(t)) { media.push(velItem(t)); continue; } // Velora-stored videos / sounds / files, the same
      if (!ctx?.bio && VID.test(t)) { media.push({ url: t, type: 'video' }); continue; } // so do videos / audio files uploaded to Velora
      if (!ctx?.bio && AUD.test(t)) { media.push({ url: t, type: 'audio', name: decodeURIComponent(t.split('/').pop()) }); continue; }
      const item = /^(\s*)([-*]|(\d{1,3})[.)])\s+(.+)$/.exec(line);
      if (item) {
        const depth = Math.floor(item[1].replace(/\t/g, '  ').length / 2);
        const it = { depth, ordered: !!item[3], n: Number(item[3]) || 1, nodes: inline(item[4], ctx, `li${key}`) };
        if (list && (depth > 0 || list.items[0].ordered === it.ordered)) list.items.push(it);
        else { flushList(); list = { items: [it] }; }
        continue;
      }
      flushList();
      if (/^>>> /.test(line)) { // everything from here to the end of this part is quoted
        const rest = [line.replace(/^>>> /, ''), ...lines.slice(li + 1)];
        nodes.push(<blockquote key={`qq${key}`} className="vc-quote">{rest.flatMap((x, i) => [i ? <br key={`qb${key}_${i}`} /> : null, ...inline(x, ctx, `qq${key}_${i}`)]).filter(Boolean)}</blockquote>);
        lastInline = false;
        break;
      }
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) { const H = `h${h[1].length}`; nodes.push(<H key={`h${key}`} className={`vc-h vc-h${h[1].length}`}>{inline(h[2], ctx, `h${key}`)}</H>); lastInline = false; continue; }
      const sub = /^-#\s+(.+)$/.exec(line);
      if (sub) { nodes.push(<small key={`s${key}`} className="vc-subtext">{inline(sub[1], ctx, `s${key}`)}</small>); lastInline = false; continue; }
      if (/^> /.test(line)) { nodes.push(<blockquote key={`q${key}`} className="vc-quote">{inline(line.replace(/^> /, ''), ctx, `q${key}`)}</blockquote>); lastInline = false; continue; }
      if (lastInline) nodes.push(<br key={`br${key}`} />);
      else if (!t && li > 0 && li < lines.length - 1) { nodes.push(<br key={`br${key}`} />); continue; } // a blank line after a block = a gap
      nodes.push(...inline(line, ctx, `l${key}`));
      lastInline = true;
    }
    flushList();
  });
  // trim leading <br>s left by picture lines
  while (nodes.length && nodes[0]?.type === 'br') nodes.shift();
  // links that get a preview (made by the server): not in code, not pictures / uploads / GIFs, not <wrapped>
  const links = [];
  blocks.forEach((b, bi) => {
    if (bi % 2 === 1) return;
    const text = b.replace(/`[^`\n]+`/g, ' ');
    for (const m of text.matchAll(URL_RE)) {
      let u = m[0];
      if (text[m.index - 1] === '<' && text[m.index + u.length] === '>') continue;
      if (isVel(u)) { const w = wholeLink(text, m.index); if (isVel(w)) u = w; }
      // a picture already taken whole from its own line (its name can hold ) ' which cut the match short here): not again
      if (inLinks(images, u)) continue;
      // catbox links in the middle of a sentence keep their text, and still get shown underneath
      if (CB.test(u)) { const it = cbItem(u); if (!images.includes(it.url) && !media.some(x => x.url === it.url)) { if (IMG.test(u)) images.push(it.url); else media.push(it); } continue; }
      // so do Velora-stored DM files (never unfurled: Velora fetching its own temporary file would count as someone opening it)
      if (isVel(u)) { const it = velItem(u); if (!images.includes(u) && !images.includes(it.url) && !media.some(x => x.url === it.url)) { if (IMG.test(u)) images.push(u); else media.push(it); } continue; }
      if (IMG.test(u) || VID.test(u) || AUD.test(u) || /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(u) || NOOKARA_FILE.test(u)) continue;
      if (!links.includes(u)) links.push(u);
    }
  });
  return { nodes, images, media, invites: invites.slice(0, 3), links: links.slice(0, 3), jumbo: JUMBO.test(String(body || '')) && (String(body).match(EMOJI_ONE) || []).length <= 27 };
}

// a profile bio: the same markdown as chat (bold, italic, underline, strike, code, spoilers, links, lists, quotes,
// small headers, -# subtext), but a link on its own line stays a link (no pictures / players) and headers stay small.
// inert = a preview (the /me profile tab): links don't do anything, there is no Ember pop-up host there.
const BIO_CTX = { linkImages: false, bio: true };
export function BioText({ text, className = 'pe-bio', inert = false }) {
  const nodes = useMemo(() => renderBody(text || '', BIO_CTX).nodes, [text]);
  return <div className={`${className} vc-bio`} onClickCapture={inert ? e => { if (e.target.closest?.('a')) { e.preventDefault(); e.stopPropagation(); } } : undefined}>{nodes}</div>;
}

const pad = n => String(n).padStart(2, '0');
export function timeOf(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function stampOf(ts) {
  const d = new Date(ts);
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today at ${timeOf(ts)}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${timeOf(ts)}`;
  return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${timeOf(ts)}`;
}
export function dayOf(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
export function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// links to Ember / profiles open right here instead of a new page
export function inAppLink(href, ctx, el) {
  let u;
  try { u = new URL(href, location.href); } catch { return false; }
  if (u.host !== location.host) return false;
  if (u.pathname === '/chat' || u.pathname === '/chat/' || (onEmberHost() && u.pathname === '/')) { ctx?.onLink?.(u.hash || '#/home'); return true; }
  const prof = /^\/u\/([^/]+)\/?$/.exec(u.pathname);
  if (prof && ctx?.onUser) { ctx.onUser(decodeURIComponent(prof[1]), el); return true; }
  return false;
}

// clicking a [text](link): show where it really goes before leaving
async function maskedLink(href) {
  let host = href;
  try { host = new URL(href).host; } catch { /* keep the whole thing */ }
  if (await ask({ title: 'Leaving Ember', text: "This link's text doesn't show where it goes. It really goes to:", link: { host, href }, confirm: 'Open link' })) window.open(href, '_blank', 'noopener,noreferrer');
}
