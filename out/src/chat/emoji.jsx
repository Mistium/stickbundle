// Standard emojis: Discord-style names (:sob:, :joy:...) and Twemoji pictures (served from Velora, /assets/twemoji).
// emoji.json rows are [char, label, group, tags, names] - names[0] is the Discord/GitHub-style short name.

// a whole emoji: flag pair, keycap, or a pictograph with its variation selector / skin tone / ZWJ joins
export const UNI_EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*/u;

// Twemoji's file naming: codepoints in hex joined by "-", without FE0F unless it's a ZWJ sequence
export function twemojiUrl(char) {
  const s = String(char).includes('‍') ? String(char) : String(char).replace(/️/g, '');
  return `/assets/twemoji/${[...s].map(c => c.codePointAt(0).toString(16)).join('-')}.svg`;
}
export const shortName = e => (Array.isArray(e?.[4]) && e[4][0]) || String(e?.[1] || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const allNames = e => (Array.isArray(e?.[4]) && e[4].length ? e[4] : [shortName(e)]);

// the name of a standard emoji character (for hover titles / the info pop-up)
let byChar = null;
export function nameOfChar(char, data) {
  if (!data) return null;
  if (!byChar || byChar.size !== data.length) byChar = new Map(data.map(e => [e[0], e]));
  const e = byChar.get(char) || byChar.get(String(char).replace(/️/g, '')) || byChar.get(`${char}️`);
  return e ? shortName(e) : null;
}

// a Twemoji picture; falls back to the plain character if Twemoji doesn't have it
export function Twemoji({ char, className = 'vc-temoji', title, onClick, lazy }) {
  return (
    <img className={className} src={twemojiUrl(char)} alt={char} title={title} draggable={false} loading={lazy ? 'lazy' : undefined} onClick={onClick}
      onError={e => { const t = document.createElement('span'); t.textContent = char; t.className = `${className} txt`; e.currentTarget.replaceWith(t); }} />
  );
}
