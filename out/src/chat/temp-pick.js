// A file waiting in the composer to go to Velora's temporary storage: how long it will last, and the expiry a Velora Pro
// member can pick for it (TempAttPopover.jsx). Pure, no imports, so it can be tested on its own (test/temp-pick.test.js).
// The rules themselves live on Velora (temp-files-policy.js); /chat/media/destinations hands us `temp` with the numbers.
const MB = 1024 * 1024;

// days the file lasts from the day it is sent (the normal lifetime; opening it never moves it).
// days = destinations' temp.days ({ image, media, file, large }); kind = store.fileKind (image | gif | video | audio | file)
export function normalDays(days, kind, size) {
  if (!days) return null;
  const n = Number(size) || 0;
  if ((kind === 'image' || kind === 'gif') && n <= 10 * MB) return days.image;
  if ((kind === 'video' || kind === 'audio') && n <= 50 * MB) return days.media;
  if (n <= 25 * MB) return days.file;
  return days.large;
}

const num = d => (Number.isInteger(d) ? String(d) : String(Math.round(d * 10) / 10));
// "1 day", "1 week", "30 days", "12 hours"
export function daysText(d) {
  if (!(d > 0)) return '';
  if (d < 1) { const h = Math.max(1, Math.round(d * 24)); return h === 1 ? '1 hour' : `${h} hours`; }
  if (d === 1) return '1 day';
  if (d === 7) return '1 week';
  return `${num(d)} days`;
}
// the little label on the attachment's clock: "1d", "7d", "120d"
export const shortDays = d => (d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${num(d)}d`);

// what the popover lists: "default" first, then the presets (the longest one is sent as 'max', so a server whose Pro
// maximum changed still gives the longest it allows). -> [{ value: 'default' | number | 'max', days }]
export function expiryChoices(presets, maxDays) {
  const list = [...new Set((presets || []).map(Number).filter(d => d > 0 && (!maxDays || d <= maxDays)))].sort((a, b) => a - b);
  if (maxDays && !list.includes(maxDays)) list.push(maxDays);
  return [{ value: 'default', days: null }, ...list.map(d => ({ value: d === maxDays ? 'max' : d, days: d }))];
}
// the days a picked value stands for ('max' -> maxDays), or null for the default
export const pickedDays = (v, maxDays) => (v == null || v === 'default' ? null : v === 'max' ? maxDays : Number(v) || null);
