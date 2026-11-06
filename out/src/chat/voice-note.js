// Voice messages, the parts that are just rules. A voice message is an ordinary audio attachment whose file name says what it is
// (voice-message-<when>-<length in ms>.<ext>), so servers, DMs and group chats need nothing new and old clients still get a player.
// The length in the name matters: a recorded webm has no duration in it, so a browser reports Infinity until it has read the whole file.
// (a plain voice-message.ogg too: some senders end up with that name, and it has no length in it)
const NAME = /^voice-message(?:-\d{10,16}(?:-(\d{1,8}))?(?:[^/]*)| ?(?:\(\d+\))?)\.(weba|webm|m4a|mp4|ogg|opus|mp3|aac)$/i;
const clean = n => String(n || '').replace(/^(SPOILER_)+/, '');
export const isVoiceName = n => NAME.test(clean(n));
export const isVoiceAtt = a => !!a && (a.type === 'audio' || a.type === 'video') && isVoiceName(a.name);
// seconds, or 0 when the name doesn't say
export const voiceSeconds = n => { const m = NAME.exec(clean(n)); return m?.[1] ? Number(m[1]) / 1000 : 0; };
// a DM / group message carries the file as a link, with the name in it (#n=) or as its last path part
export function isVoiceLink(u) {
  const [path, frag] = String(u || '').split('#');
  let name = path.split('?')[0].split('/').pop();
  try { name = decodeURIComponent(/^n=(.+)$/.exec(frag || '')?.[1] || name); } catch { /* as it is */ }
  return isVoiceName(name);
}
// what previews and notifications say instead of the link
export const voiceSummary = body => String(body || '').replace(/https?:\/\/\S+/g, u => (isVoiceLink(u) ? 'Voice message' : u));

// `type` is what the file is sent as: without the codec part, which upload checks don't know. webm goes up as .weba because the
// servers class .webm links as video; ones that sniff the bytes call it video anyway, which is why isVoiceAtt allows that.
const FORMATS = [
  { mime: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'weba' },
  { mime: 'audio/webm', type: 'audio/webm', ext: 'weba' },
  { mime: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' }, // Safari
  { mime: 'audio/ogg;codecs=opus', type: 'audio/ogg', ext: 'ogg' },
];
export const pickFormat = supported => FORMATS.find(f => { try { return supported(f.mime); } catch { return false; } }) || null;
export const voiceFileName = (when, ms, ext) => `voice-message-${Math.floor(when)}-${Math.max(0, Math.round(ms))}.${ext}`;

export const MAX_MS = 5 * 60 * 1000;
export const MIN_MS = 400; // a shorter press was an accident, or someone finding out what the button does
export const SWIPE_CANCEL_PX = 90;
// press and hold, on letting go: what happens to the recording
export const holdOutcome = ({ recordedMs, dx = 0 }) => (dx <= -SWIPE_CANCEL_PX ? 'discard' : recordedMs < MIN_MS ? 'too_short' : 'send');

export function micErrorText(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError': return "Nookara isn't allowed to use your microphone. Allow it in your browser or device settings for this site, then try again.";
    case 'NotFoundError': case 'OverconstrainedError': return 'No microphone was found. Plug one in or pick another in your voice settings, then try again.';
    case 'NotReadableError': case 'AbortError': return "Your microphone couldn't be started. Another app may be using it - close that and try again.";
    case 'unsupported': return "This browser can't record voice messages.";
    default: return "Your microphone couldn't be started. Try again.";
  }
}

// the loudest sample in each of n slices, scaled so the loudest bar is full height
export function peaksOf(samples, n) {
  const out = new Array(n).fill(0), size = samples.length / n;
  if (!samples.length) return out;
  for (let i = 0; i < n; i++) {
    let top = 0;
    for (let j = Math.floor(i * size), end = Math.min(samples.length, Math.floor((i + 1) * size)); j < end; j++) { const v = Math.abs(samples[j]); if (v > top) top = v; }
    out[i] = top;
  }
  const max = Math.max(...out) || 1;
  return out.map(v => Math.max(0.08, v / max));
}
// a file that can't be read here (another server without CORS): steady made-up bars, the same each time for the same file
export function seededPeaks(seed, n) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: n }, () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return 0.2 + (((h >>> 0) % 1000) / 1000) * 0.7; });
}
