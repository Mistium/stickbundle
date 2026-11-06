// Pictures from Klipy, Spotify and mc-heads.net load through Nookara, so those companies never see someone's IP address.
// Only for what's shown on screen: a message keeps the original link, because signatures cover it (signing-payload.js).
import { NOOKARA_ORIGIN } from './hosts.js';

const PROXIED = /^https:\/\/(?:[a-z0-9-]+\.)*(?:klipy\.com|mc-heads\.net|scdn\.co|spotifycdn\.com)(?:\/|$)/i;
export const viaProxy = url => (PROXIED.test(String(url || '')) ? `${NOOKARA_ORIGIN}/media-proxy?u=${encodeURIComponent(url)}` : url);
