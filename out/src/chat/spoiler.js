// A spoilered attachment is one whose name starts with SPOILER_ (Discord's convention): every server already keeps the
// name, so no server needs to know about spoilers, and bridged files keep it both ways.
const PREFIX = 'SPOILER_';
export const isSpoiler = a => String(a?.name || '').startsWith(PREFIX);
export const spoilerName = (name, on) => {
  const bare = String(name || 'file').replace(/^(SPOILER_)+/, '');
  return on ? PREFIX + bare : bare;
};
// what to show people (the prefix is only a marker)
export const shownName = name => String(name || '').replace(/^(SPOILER_)+/, '');
// a picture link in a DM: the name it carries, if any (#n=<name> on account-storage / old catbox links, the last part of
// the path on a temporary-storage link /t/<id>/<name> or cdn.nookara.cc/temp/<id>/<name>)
export function nameInLink(url) {
  try {
    const u = String(url);
    const n = /#n=([^#\s]+)$/.exec(u)?.[1] || /^https:\/\/(?:(?:(?:ember\.)?nookara\.cc|velora\.ikelene\.net)\/t|cdn\.nookara\.cc\/temp)\/[A-Za-z0-9]{22}\/([^\s?#]+)/.exec(u)?.[1] || '';
    return decodeURIComponent(n);
  } catch { return ''; }
}
