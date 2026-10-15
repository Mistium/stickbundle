// Velora's UI expects its own id formats: servers `s…`, channels `c…`, roles
// `r…` and emoji `e…` (10 lowercase hex digits each), and all-digit message
// ids. OriginChats uses URLs, names and UUIDs, so each gets a stable derived
// id plus a lookup table back to the real one.

function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hex10(str) {
  const a = fnv(str, 2166136261).toString(16).padStart(8, "0");
  const b = fnv(str, 3735928559).toString(16).padStart(8, "0");
  return (a + b).slice(0, 10);
}

const sidFor = (url) => `s${hex10(`srv|${url}`)}`;
const cidFor = (url, channel) => `c${hex10(`ch|${url}|${channel}`)}`;
const ridFor = (url, roleId) => `r${hex10(`role|${url}|${roleId}`)}`;
const eidFor = (url, emojiId) => `e${hex10(`emoji|${url}|${emojiId}`)}`;

// Message ids: the save time in milliseconds followed by three digits from the
// UUID, so they sort like Velora's snowflakes and survive reloads. A reply can
// point at a message we haven't loaded (no timestamp yet); it gets a
// provisional id that the message keeps once it does load.
const numByUuid = new Map();
const uuidByNum = new Map();

function msgNum(uuid, timestamp) {
  const known = numByUuid.get(uuid);
  if (known) {
    return known;
  }
  let n;
  if (timestamp != null && isFinite(timestamp)) {
    n = BigInt(Math.round(Number(timestamp) * 1000)) * 1000n + BigInt(fnv(uuid, 7) % 1000);
  } else {
    n = 9000000000000000n + BigInt(fnv(uuid, 11) % 999999999) * 1000n + BigInt(fnv(uuid, 13) % 1000);
  }
  while (uuidByNum.has(String(n)) && uuidByNum.get(String(n)) !== uuid) {
    n += 1n;
  }
  const id = String(n);
  numByUuid.set(uuid, id);
  uuidByNum.set(id, uuid);
  return id;
}

const uuidOf = (num) => uuidByNum.get(String(num)) || null;

// The read marker as an id: anything saved after `lastViewed` sorts above it.
function readMarker(lastViewed) {
  if (lastViewed == null) {
    return null;
  }
  return String(BigInt(Math.floor(Number(lastViewed) * 1000)) * 1000n + 999n);
}

export { cidFor, eidFor, msgNum, readMarker, ridFor, sidFor, uuidOf };
