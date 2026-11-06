// The "Expires ..." footer under a message's temporary-storage files (pure, no imports, so it can be tested on its own).
// An entry is the moment (ms) the file is deleted, 'gone' once it expired, or null when it
// couldn't be found out (those are left out). `now` and `locale` are passed in so the tests don't depend on the clock.
const DAY = 86400000;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// when a file dies: Velora's /t/info gives seconds left (expires_in) as of the moment we asked
export const expiryAt = (info, now = Date.now()) => {
  if (!info || info === 'gone') return info || null;
  const t = Number.isFinite(info.expires_at ? Date.parse(info.expires_at) : NaN) ? Date.parse(info.expires_at) : (info.at ?? now) + Number(info.expires_in) * 1000;
  return Number.isFinite(t) ? t : null;
};

export function expiryLabel(entries, { now = Date.now(), locale } = {}) {
  const live = [...new Set((entries || []).filter(e => typeof e === 'number' && Number.isFinite(e) && e > now))].sort((a, b) => a - b);
  if (!live.length) return null; // nothing there any more (the file's own placeholder says so), or nothing known
  const date = t => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(t);
  const time = t => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(t);
  const first = live[0], last = live[live.length - 1];
  if (live.length === 1 || dayStart(first) === dayStart(last)) {
    // less than a day away: say "today" / "tomorrow" with the time (by calendar day, so 11 pm -> 10 pm next day is "tomorrow")
    if (live.length === 1 && first - now < DAY) {
      const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const word = dayStart(first) === dayStart(now) ? rel.format(0, 'day') : rel.format(1, 'day');
      return `Expires ${word} at ${time(first)}`;
    }
    return `Expires ${date(first)}`;
  }
  return `Expires between ${date(first)} and ${date(last)}`;
}
