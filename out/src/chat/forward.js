// The text of a forwarded message (pure, no store imports, so the node tests can load it). A forward is an ordinary message
// sent the ordinary way (im_send / roomMessage / chat_send): Nookara checks blocks, DM privacy, the age gate and disabled
// scopes the same as for anything typed, so forwarding can't reach anyone that typing couldn't.
import { NOOKARA_FILE, NAMED_LINK } from './uploadLinks.js';

// what the server keeps per message: a group chat cuts at 2000 (silently), DMs and channels refuse past 4000
export const forwardLimit = v => (v?.kind === 'group' ? 2000 : 4000);

const URL_LINE = /^https?:\/\/\S+$/;
// the header line + the text, within limit. The links on their own lines at the end are how DM and group files travel, so a
// long message loses text, never its files.
export function fitForward(head, body, limit) {
  const whole = `${head}\n${body}`.trim();
  if (whole.length <= limit) return whole;
  const lines = String(body).split('\n');
  let keep = lines.length;
  while (keep > 0 && URL_LINE.test(lines[keep - 1].trim())) keep--;
  const links = lines.slice(keep).join('\n');
  const room = limit - head.length - 2 - (links ? links.length + 1 : 0); // 2 = the line break + the ellipsis
  const text = lines.slice(0, keep).join('\n').slice(0, Math.max(0, room)).trimEnd();
  return [head, `${text}…`, links].filter(Boolean).join('\n').slice(0, limit);
}

// where = '' or ' in #general (My Server)'; a private conversation's own name stays out (it isn't the destination's business).
// @everyone / @here inside a forward never ping again.
export function forwardText({ author, where = '', body = '' }, limit = 4000) {
  return fitForward(`-# Forwarded from @${author || 'Nookara'}${where}`, String(body).replace(/@(everyone|here)\b/g, '@​$1'), limit);
}

// is a file travelling with this message? (attachments on channel messages; links in the text for DMs and groups)
export function forwardHasFiles(m) {
  if (m?.attachments?.length) return true;
  return String(m?.body || '').split(/\s+/).some(w => NOOKARA_FILE.test(w) || NAMED_LINK.test(w));
}
export const FORWARD_FILES_NOTE = "Files are forwarded as links, not copied: they stay the original sender's, keep their original expiry, and disappear for everyone if removed.";
