// Plain text for the client info shown to people with Manage users (no React, so it can be tested).
// via: { official?, kind?, name?, token?, url?, app? } from Velora (client-via.js) or an Ember server ({ url, kind? }).
// list = Velora's official clients (officialClients.js); null/undefined = not loaded yet.
import { describeVia } from './officialClients.js';

export function viaLabel(via, list) {
  if (!via) return '';
  return describeVia(via, list).name;
}
export function viaTitle(via, list) {
  if (!via) return 'Sent from an unknown client';
  const d = describeVia(via, list);
  if (d.known) return `Sent from ${d.name}${d.verified ? ' (official)' : ''}`;
  if (via.token) return `Sent with the sign-in token "${via.token}"${via.url ? ` from ${via.url}` : ''}`;
  return via.url ? `Sent from ${via.url}` : 'Sent from an unknown client';
}
export const STATE_TEXT = { notifications: 'Notifications only, the app is not open', background: 'In the background' };
export const STATE_SHORT = { notifications: 'Notifications only', background: 'Background' };
export const sessionLine = s => [s.platform, s.device, s.browser && s.browser !== 'Electron' ? s.browser : null, s.version ? `v${String(s.version).slice(0, 12)}` : null].filter(Boolean).join(', ');
// the short text beside a client: the browser if it has one, else the device or platform. The rest is in sessionDetails
export const sessionShort = s => (s.browser && s.browser !== 'Electron' ? s.browser : s.device || s.platform) || '';
// which icon a client gets: 'mobile', 'desktop' (an installed app) or 'browser'. An Ember page in a phone's browser counts as mobile
export const sessionKind = s => {
  const kind = s.via?.kind;
  if (s.mobile || kind === 'android' || kind === 'ios' || /^(android|ios)$/i.test(s.platform || '')) return 'mobile';
  if (kind === 'desktop' || s.browser === 'Electron') return 'desktop';
  return 'browser';
};
export const sessionIsIdle = s => !!STATE_SHORT[s.state];
export const sessionDetails = s =>[s.app, sessionLine(s), STATE_TEXT[s.state]].filter(Boolean).join('\n');
