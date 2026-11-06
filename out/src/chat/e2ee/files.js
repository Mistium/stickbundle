// what an encrypted file shows as. Pure, the node tests load it.
export const fileKindOfMime = mime => (/^image\/gif$/.test(mime || '') ? 'gif' : /^image\//.test(mime || '') ? 'image' : /^video\//.test(mime || '') ? 'video' : /^audio\//.test(mime || '') ? 'audio' : 'file');
// pictures and sounds open by themselves. Videos and other files can be big, so those wait for a click (they have to be downloaded whole to be opened).
export const opensByItself = a => ['image', 'gif', 'audio'].includes(a.type);
