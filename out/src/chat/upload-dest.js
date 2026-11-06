// Where a file sent in a DM / group chat goes (pure, no imports, so it can be tested on its own).
//   'account' = Velora account storage, 'temp' = Velora's temporary storage, null = ask (the picker in UploadDest.jsx)
// The account's chat setting dm_upload_dest is the real answer once it has loaded; until then (or on a Velora without the
// setting) this device's copy in localStorage counts.
export const DESTS = ['account', 'temp'];
export function rememberedDest({ fromServer, setting, local }) {
  const pick = v => (DESTS.includes(v) ? v : null);
  return fromServer ? pick(setting) : pick(local);
}
// a temporary-storage link: https://nookara.cc/t/<22 letters/digits>/<name> (older: velora.ikelene.net, ember.nookara.cc), or the
// copy of the file in the CDN bucket: https://cdn.nookara.cc/temp/<22 letters/digits>/<name> (only that host and path; look-alikes never match)
export const TEMP_LINK = /^https:\/\/(?:(?:(?:ember\.)?nookara\.cc|velora\.ikelene\.net)\/t|cdn\.nookara\.cc\/temp)\/([A-Za-z0-9]{22})(\/|$)/;
export const tempId = url => TEMP_LINK.exec(String(url || ''))?.[1] || null;
// the CDN copy: it ignores ?dl=1 (nothing runs in front of the bucket), so a download of it has to be fetched (mediaDownload.js)
export const isCdnTemp = url => /^https:\/\/cdn\.nookara\.cc\/temp\/[A-Za-z0-9]{22}\//.test(String(url || ''));
