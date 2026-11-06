// Android saves the original HTTPS file through Download Manager. A blob URL
// belongs to the WebView process and cannot be opened by that service.
export async function saveMedia(url, name) {
  const original = new URL(url, location.href);
  const filename = name || decodeURIComponent(original.pathname.split('/').pop() || 'image');
  if (original.protocol === 'https:' && window.BonfireDownloads?.postMessage) {
    window.BonfireDownloads.postMessage(JSON.stringify({ url: original.href, name: filename }));
    return;
  }
  const response = await fetch(original.href, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error('download_failed');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}
