import { bare } from './ids.js';

// the same canonical JSON the instance uses: keys sorted recursively, no spaces, integers
export function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(Math.trunc(v));
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
export const payloadOf = ({ iss, instance, community, channel, author, ts, nonce, body, attachments, reply_to, edit_of }) => ({
  v: 1, iss, instance, community, channel, author: String(author), ts: Number(ts), nonce: String(nonce), body: String(body),
  attachments: (attachments || []).map(String), reply_to: reply_to == null ? null : String(reply_to), edit_of: edit_of == null ? null : String(edit_of),
});

// Upload hashes keep v1 signatures unchanged; link-only GIFs bind their exact URL.
export function attachmentRefs(attachments = []) {
  return attachments.map(a => {
    if (/^[0-9a-f]{64}$/.test(String(a.sha256 || ''))) return a.sha256;
    if (/^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(a.url || '')) return `url:${a.url.slice(0, 512)}`;
    throw new Error('missing_attachment_hash');
  });
}

export function receivedPayload(m, iss) {
  return payloadOf({ iss, instance: m.inst, community: bare(m.server), channel: bare(m.channel), author: m.author.velora_id,
    ts: m.signature.ts, nonce: m.signature.nonce, body: m.body, attachments: attachmentRefs(m.attachments || []),
    reply_to: m.reply_to ?? m.reply?.id ?? null, edit_of: m.edited_at ? m.id : null });
}
