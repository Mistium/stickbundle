// Reaction frequency is local to this account/device; composing an emoji does
// not count. Storage failures must never prevent sending a reaction.
export const DEFAULT_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '👀'];
// ⭐ is the starboard's vote, not a reaction choice, so it never ranks.
const isStar = emoji => emoji.replace(/\uFE0F/g, '') === '⭐';
const key = account => `bonfire.reaction-usage.v1:${String(account || 'anonymous')}`;
function entries(account) {
  try {
    const data = JSON.parse(localStorage.getItem(key(account)) || '[]');
    return Array.isArray(data) ? data.filter(x => x && typeof x.emoji === 'string' && x.emoji.length <= 128 && !isStar(x.emoji) && Number.isSafeInteger(x.count) && x.count > 0 && Number.isFinite(x.last)).slice(0, 200) : [];
  } catch { return []; }
}
const sort = list => list.sort((a, b) => b.count - a.count || b.last - a.last || a.emoji.localeCompare(b.emoji));
export function frequentReactions(account, limit = 6) {
  return [...new Set([...sort(entries(account)).map(x => x.emoji), ...DEFAULT_REACTIONS])].slice(0, limit);
}
export function recordReaction(account, emoji) {
  if (typeof emoji !== 'string' || !emoji || emoji.length > 128 || isStar(emoji)) return;
  try {
    const list = entries(account), existing = list.find(x => x.emoji === emoji);
    if (existing) { existing.count = Math.min(existing.count + 1, 1000000000); existing.last = Date.now(); }
    else list.push({ emoji, count: 1, last: Date.now() });
    localStorage.setItem(key(account), JSON.stringify(sort(list).slice(0, 200)));
    dispatchEvent(new Event('vc-reaction-usage'));
  } catch { /* Private/limited storage is optional. */ }
}
