// The look of Ember: rounded (flat greys, small radii; chat/rounded.css) or the original square one. A per-device choice kept in
// localStorage ('bf_design'); the class on <html> is what rounded.css hangs off. index.html sets it before the first paint.
const KEY = 'bf_design';
const subs = new Set();
export const getDesign = () => { try { return localStorage.getItem(KEY) === 'rounded' ? 'rounded' : 'square'; } catch { return 'square'; } };
export const applyDesign = (d = getDesign()) => document.documentElement.classList.toggle('vc-rounded', d === 'rounded');
export const clearDesign = () => document.documentElement.classList.remove('vc-rounded');
export function setDesign(d) {
  const v = d === 'rounded' ? 'rounded' : 'square';
  try { localStorage.setItem(KEY, v); } catch { /* private mode: it lasts until the page closes */ }
  applyDesign(v);
  subs.forEach(f => f(v));
}
export const subscribeDesign = f => { subs.add(f); return () => subs.delete(f); };
