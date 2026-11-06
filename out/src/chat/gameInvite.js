// Hyperfocus game invites. The launcher sends them as an ordinary message (main.js sendGameInvite):
//   "<emoji> <inviter> invited you to play <Game Name>! hyperfocus://join/<gameId>[/<code>]"
// gameId = an apps.json id or a community id (c-xxxxxxxx, or bare), code = [A-Za-z0-9_-]{1,64} (the launcher's JOIN_RE).
// Pure helpers only (no React) so text.jsx can use them. Nothing here ever makes a hyperfocus:// link clickable:
// the invite is cut out of the text and Join (GameInvite.jsx) builds its URL from the validated id + code.
const INVITE = String.raw`(?:[\p{Extended_Pictographic}️‍]+[ \t]*)?(\S{1,40}) invited you to play ([^\n]{1,80}?)! hyperfocus:\/\/join\/([A-Za-z0-9._-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?`;
const flags = 'giu';

// -> { text: the message without invite lines, invites: [{ from, game, id, code }] }
// A line that was only an invite disappears; a line with other words keeps them.
export function extractInvites(text) {
  const src = String(text || '');
  if (!/hyperfocus:\/\/join\//i.test(src)) return { text: src, invites: [] };
  const invites = [];
  const lines = [];
  for (const line of src.split('\n')) {
    let hit = false;
    const out = line.replace(new RegExp(INVITE, flags), (_, from, game, id, code) => {
      hit = true;
      const inv = { from, game: game.trim(), id, code: code || '' };
      if (!invites.some(x => x.id === inv.id && x.code === inv.code && x.from === inv.from)) invites.push(inv);
      return '';
    });
    if (!hit) lines.push(line);
    else if (out.trim()) lines.push(out.replace(/\s+$/, '').replace(/^[ \t]+/, ''));
  }
  if (!invites.length) return { text: src, invites };
  return { text: lines.join('\n').replace(/^\n+|\n+$/g, ''), invites: invites.slice(0, 3) };
}

// one-line text for places that must not show the raw link (reply previews, notifications, overlay toasts)
export function inviteSummary(text) {
  const src = String(text || '');
  if (!/hyperfocus:\/\/join\//i.test(src)) return src;
  return src.replace(new RegExp(INVITE, flags), (_, from, game) => `Game invite: ${game.trim()}`);
}

// the only URL Join may open
export const JOIN_URL = /^hyperfocus:\/\/join\/[A-Za-z0-9._-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})?$/;
export const joinUrl = inv => `hyperfocus://join/${inv.id}${inv.code ? `/${inv.code}` : ''}`;
