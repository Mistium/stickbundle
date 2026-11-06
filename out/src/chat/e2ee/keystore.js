// This device's end-to-end encryption state, in IndexedDB (public/sw.js reads the same database to open a push notification, so keep the names in step with it).
//   keys    per account id: { uid, kid, enc_pub, sig_pub, encPriv, sigPriv (non-extractable CryptoKeys), deviceKey + sealed }
//           sealed = the private keys locked with deviceKey, a non-extractable key that never leaves this browser. It's only opened to pass the keys to
//           another device you approve.
//   pins    per conversation partner: the key I first saw for them, so a change gets noticed
//   outbox  messages waiting for someone to set up encrypted DMs. They never left this device, and they're readable to anyone who can read this browser's storage.
const DB = 'nke1';
let opened = null;
function open() {
  opened = opened || new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys', { keyPath: 'uid' });
      if (!d.objectStoreNames.contains('pins')) d.createObjectStore('pins', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'nonce' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { opened = null; no(r.error); };
  });
  return opened;
}
const run = async (store, mode, fn) => {
  const d = await open();
  return new Promise((ok, no) => {
    const t = d.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => ok(q?.result);
    t.onabort = t.onerror = () => no(t.error);
  });
};
export const getKeys = uid => run('keys', 'readonly', s => s.get(String(uid)));
export const putKeys = v => run('keys', 'readwrite', s => s.put({ ...v, uid: String(v.uid) }));
export const dropKeys = uid => run('keys', 'readwrite', s => s.delete(String(uid)));
const pinId = (me, other) => `${me}:${other}`;
export const getPin = (me, other) => run('pins', 'readonly', s => s.get(pinId(me, other)));
export const putPin = (me, other, v) => run('pins', 'readwrite', s => s.put({ ...v, id: pinId(me, other) }));
export const outboxAll = () => run('outbox', 'readonly', s => s.getAll());
export const outboxPut = v => run('outbox', 'readwrite', s => s.put(v));
export const outboxDrop = nonce => run('outbox', 'readwrite', s => s.delete(nonce));
