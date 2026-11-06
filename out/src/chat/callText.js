// DM call lines. The server stores ONE message per event, "[Voice call] <what>", sent by the CALLER
// and shared by both people, so the wording depends on who is looking:
//   missed call   caller: "Ikelene missed your call"   callee: "You missed a call from lunaCSS"
//   started       caller: "You started a call"         callee: "lunaCSS started a call"
//   ended         both:   "Call ended · 3 minutes"
// Returns null when the body isn't a call line. `name` is the person to show in bold (or null).
export const CALL_LINE = /^\[Voice call\] (.+)$/;

export function callLineText(body, { caller, me, other } = {}) {
  const m = CALL_LINE.exec(String(body || '').trim());
  if (!m) return null;
  const what = m[1].trim();
  const lower = s => String(s || '').toLowerCase();
  const mine = !!caller && !!me && lower(caller) === lower(me);
  const them = mine ? other || null : caller || null;
  if (/^missed (a )?call$/i.test(what)) {
    return mine
      ? { before: '', name: them || 'They', after: ' missed your call', missed: true }
      : { before: 'You missed a call from ', name: them || 'someone', after: '', missed: true };
  }
  if (/^started a call$/i.test(what)) return mine ? { before: 'You started a call', name: null, after: '' } : { before: '', name: them || 'Someone', after: ' started a call' };
  const ended = /^call ended(?: - (.+))?$/i.exec(what);
  if (ended) return { before: ended[1] ? `Call ended · ${ended[1]}` : 'Call ended', name: null, after: '' };
  return mine ? { before: `You ${what}`, name: null, after: '' } : { before: '', name: them || 'Someone', after: ` ${what}` };
}

// plain text (notifications)
export function callLinePlain(body, who) {
  const t = callLineText(body, who);
  return t ? `${t.before}${t.name || ''}${t.after}` : null;
}
