// The server's time, learned from the Date header of API answers. A PC's clock can be off even when it reads right on the wall (say a
// time zone without the right offset, with the hours moved by hand), and instances refuse a signature more than 5 minutes from their own time.
const MIN_SKEW = 30 * 1000; // Date only has whole seconds: smaller differences are noise
let skew = 0;

// age: the answer's Age header, set when it came from a cache, so its Date is old
export function noteServerClock(date, age, now = Date.now()) {
  if (Number(age) > 0) return;
  const at = Date.parse(date || '');
  if (Number.isNaN(at)) return;
  const off = at - now;
  skew = Math.abs(off) > MIN_SKEW ? off : 0;
}
export const serverNow = (now = Date.now()) => now + skew;
