// Pure helpers for the greyed-out "sending" copy of my own DM (no store / React imports: the node tests load this).
import { NAMED_LINK } from './uploadLinks.js';

// encodeURIComponent leaves ! ' ( ) * alone, but those end a link in message text (URL_RE stops at ) and '), so encode them too
export const encName = n => encodeURIComponent(n).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// an attachment as a link (DMs / group chats are plain text). Files in account storage (and old catbox ones) keep
// their real name as #n=<name>; a temporary-storage link (/t/<id>/<name>) already carries it in the path.
export const attLink = a => {
  if (a.sealed) return a.url; // an encrypted file: everything it needs is already in its link
  const tail = a.url.split('/').pop();
  let last = tail;
  try { last = decodeURIComponent(tail); } catch { /* as it is */ }
  return NAMED_LINK.test(a.url) && a.name && a.name !== last ? `${a.url}#n=${encName(a.name)}` : a.url;
};

// what actually goes over the wire for a DM / group message: the text, then one link per attachment
export const wireText = (text, attachments) => text + (attachments?.length ? `${text ? '\n' : ''}${attachments.map(attLink).join('\n')}` : '');

// the pending copy that the real message `msg` (mine) stands for: the server's echoed nonce when it has one, else the same
// text as sent. Index in list, or -1.
export function findPending(list, msg) {
  if (msg.nonce) { const i = list.findIndex(x => x.pending && x.nonce === msg.nonce); if (i >= 0) return i; }
  return list.findIndex(x => x.pending && !x.uploads && !x.failed && (x.wire ?? x.body) === (msg.wire ?? msg.body));
}

// A fresh fetch of the conversation: drop pending copies whose real message is already in `fetched` (the ack can be lost
// when the socket drops, which would leave both showing). One real message settles one pending copy, and only a real
// message of mine from around the time it was sent counts, so an old identical message never eats a new send.
export function dropSettled(live, fetched, isMine, slack = 120000) {
  const used = new Set();
  return live.filter(p => {
    if (!p.pending || p.uploads || p.failed) return true;
    const i = fetched.findIndex((m, k) => !used.has(k) && isMine(m) && (m.wire ?? m.body) === (p.wire ?? p.body) && Number(m.created_at) >= Number(p.created_at) - slack);
    if (i < 0) return true;
    used.add(i);
    return false;
  });
}

// my message came back (the ack): drop the greyed-out copy (the real one may have arrived first)
export function settle(list, n, real) {
  const has = list.some(x => x.id === real.id);
  return has ? list.filter(x => x.nonce !== n) : list.map(x => (x.nonce === n ? real : x));
}
