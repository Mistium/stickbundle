// Remote files are imported by the destination instance, never fetched by the browser.
// Keep Klipy's existing link-only contract; every imported file uses its stored hash.
export function prepareInstanceAttachments(attachments, instance, pageOrigin, importAttachment) {
  return Promise.all(attachments.map(a => {
    const url = new URL(a.url, pageOrigin);
    if ((url.origin === instance && url.pathname.startsWith('/uploads/')) || /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(url.href)) return a;
    return importAttachment({ ...a, url: url.href });
  }));
}
