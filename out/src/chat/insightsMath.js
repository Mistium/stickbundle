// Server settings > Insights: the plain maths behind the charts (no React, so node --test can check it).

// a round axis top: 1, 2, 2.5, 5 x 10^k at or above v
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return Math.max(1, m * p);
  return 10 * p;
}

// change vs the previous range of the same length: null when there's nothing to compare against
export function pctChange(now, prev) {
  if (!prev) return now ? null : 0;
  return Math.round(((now - prev) / prev) * 100);
}

// which bucket indexes get an x-axis label: at most `room` of them, evenly spaced, always the last one
export function labelEvery(n, room) {
  const k = Math.max(1, Math.ceil(n / Math.max(1, room)));
  const out = [];
  for (let i = n - 1; i >= 0; i -= k) out.unshift(i);
  return out;
}

// the bucket under an x position inside the plot (null outside it)
export function bucketAt(x, left, width, n) {
  if (x < left || x > left + width || n <= 0) return null;
  return Math.min(n - 1, Math.max(0, Math.floor(((x - left) / width) * n)));
}

// 12k / 1.2M; small numbers as they are
export function short(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return String(n);
}

// the heatmap shown Monday first: rows [Mon..Sun] from the server's [Sun..Sat]
export const mondayFirst = heat => [1, 2, 3, 4, 5, 6, 0].map(d => ({ day: d, hours: heat?.[d] || new Array(24).fill(0) }));
