// Where a Nookara account-storage upload (/uploads/...) can be linked from. Pure, no imports (the node tests load it).
// cdn.nookara.cc serves /uploads/ (account storage) and /temp/<id>/<name> (temporary files, see upload-dest.js TEMP_LINK) - no /t/, no API.
// Every pattern is anchored on "https://" and the host is followed straight by "/", so look-alikes (cdn.nookara.cc.evil.example,
// evilcdn.nookara.cc, cdn.nookara.cc@evil.example, http://) never match.
const R = String.raw;
const TEMP_CDN_SRC = R`cdn\.nookara\.cc\/temp`; // a temporary file's copy in the bucket (the id is checked by upload-dest.js TEMP_LINK)
export const HOME_ORIGIN_SRC = R`(?:ember\.)?nookara\.cc|velora\.ikelene\.net`; // old + current hosts (also serve /t/)
export const UPLOAD_ORIGIN_SRC = R`(?:ember\.|cdn\.)?nookara\.cc|velora\.ikelene\.net`; // hosts that serve /uploads/
const VID_EXT = 'mp4|webm|mov', AUD_EXT = 'mp3|ogg|wav|m4a|aac|flac|weba|opus';
export const VID = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|files\.catbox\.moe)\/\S+\.(${VID_EXT})$`, 'i');
export const AUD = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|files\.catbox\.moe)\/\S+\.(${AUD_EXT})$`, 'i');
export const VUP = new RegExp(R`^https:\/\/(?:${UPLOAD_ORIGIN_SRC})\/uploads\/(images|videos|audio|files)\/[^\s?#]+(#n=[^\s#]*)?$`, 'i');
// an account-storage or old catbox link: gets "#n=<real name>" appended when sent
export const NAMED_LINK = new RegExp(R`^https:\/\/((files|litter)\.catbox\.moe|(?:${UPLOAD_ORIGIN_SRC})\/uploads)\/`);
// a picture the "Save to Saved Media" button works on (account uploads, /t/ temp files, catbox)
export const SAVEABLE = new RegExp(R`^https:\/\/((?:${UPLOAD_ORIGIN_SRC})\/uploads|(?:${HOME_ORIGIN_SRC})\/t|${TEMP_CDN_SRC}|files\.catbox\.moe)\/`);
// any Nookara upload / temp link (never unfurled)
export const NOOKARA_FILE = new RegExp(R`^https:\/\/(?:(?:${UPLOAD_ORIGIN_SRC})\/uploads|(?:${HOME_ORIGIN_SRC})\/t|${TEMP_CDN_SRC})\/`, 'i');
// a temporary file as it is linked in message text (the name is in the path): /t/ on the site hosts, or the bucket copy on the CDN
export const TEMP_FILE = new RegExp(R`^https:\/\/(?:(?:${HOME_ORIGIN_SRC})\/t|${TEMP_CDN_SRC})\/[A-Za-z0-9]{22}\/[^\s?#]+$`, 'i');
// the same file on any of the hosts compares equal: "/uploads/videos/x.mp4"; anything else comes back without ?query / #fragment
export function uploadKey(url) {
  const bare = String(url || '').split(/[?#]/)[0];
  const m = new RegExp(R`^https:\/\/(?:${UPLOAD_ORIGIN_SRC})(\/uploads\/.+)$`, 'i').exec(bare);
  return m ? m[1] : bare;
}
// a link without its #fragment: a picture on its own line keeps "#n=<name>" in `images`, but the text scan cuts a link at ) ' etc., so
// the two only compare equal by what is before the #
export const linkBase = u => String(u || '').split('#')[0];
export const inLinks = (list, u) => list.some(x => linkBase(x) === linkBase(u));
