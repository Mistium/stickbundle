// The in-app picture viewer: clicking a picture opens it here instead of a new tab.
// Zoom (wheel / buttons / double-click), drag to pan, arrows between a message's pictures.
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, ExternalLink, Link2, RotateCw } from 'lucide-react';
import { Avatar } from './Profile.jsx';
import { viaProxy } from './mediaProxy.js';
import { stampOf } from './text.jsx';
import { toast } from './store.js';
import { saveMedia } from './mediaDownload.js';

// viewMedia({ items: [{ url, name, type }], index, author, at })
export function viewMedia(detail) {
  if (!detail?.items?.length) return;
  dispatchEvent(new CustomEvent('vc-view-media', { detail }));
}
// right-click a picture: copy it (as PNG - what the clipboard takes) or save it
export async function copyImage(url) {
  try {
    const blob = await (await fetch(url, { credentials: 'omit' })).blob();
    let png = blob;
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      png = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('Image copied', true);
  } catch { toast("Couldn't copy that image - try Download image instead."); }
}
export async function downloadImage(url, name) {
  try {
    await saveMedia(url, name);
  } catch { window.open(url, '_blank', 'noopener,noreferrer'); }
}
export function viewPicture(url, extra = {}) { viewMedia({ items: [{ url, type: /\.gif(\?|$)/i.test(url) ? 'gif' : 'image' }], index: 0, ...extra }); }

const MIN = 1, MAX = 8; // zoom is relative to the fitted size (1 = fit)
const nameOf = it => it.name || decodeURIComponent(String(it.url).split(/[?#]/)[0].split('/').pop() || 'picture');

export function MediaViewerHost() {
  const [v, setV] = useState(null);
  useEffect(() => {
    const f = e => setV({ ...e.detail, index: Math.max(0, Math.min(e.detail.index || 0, e.detail.items.length - 1)) });
    addEventListener('vc-view-media', f);
    return () => removeEventListener('vc-view-media', f);
  }, []);
  if (!v) return null;
  return <Viewer v={v} setIndex={i => setV(x => ({ ...x, index: i }))} onClose={() => setV(null)} />;
}

function Viewer({ v, setIndex, onClose }) {
  const it = v.items[v.index];
  const many = v.items.length > 1;
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stage = useRef(null);
  const drag = useRef(null);
const moved = useRef(false);
const [nat, setNat] = useState(null);   // displayed (EXIF-oriented) natural size of the picture
const [box, setBox] = useState(null);   // size of the stage area under the toolbar
const fitRef = useRef(1);
// fit = contain inside the stage (rotation-aware), never upscaled past natural size
const swap = Math.abs(rot / 90) % 2 === 1;
const rw = nat ? (swap ? nat.h : nat.w) : 0, rh = nat ? (swap ? nat.w : nat.h) : 0;
const pad = many ? 140 : 24;
const fit = nat && box && rw && rh ? Math.min(1, Math.max(0, box.w - pad) / rw, Math.max(0, box.h - 24) / rh) : 1;
fitRef.current = fit || 1;

useEffect(() => { setZ({ s: 1, x: 0, y: 0 }); setRot(0); setLoaded(false); setNat(null); }, [v.index, it.url]);
useEffect(() => {
  const el = stage.current; if (!el) return;
  const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
  read();
  const ro = new ResizeObserver(read); ro.observe(el);
  return () => ro.disconnect();
}, []);
const close = useCallback(() => { setClosing(true); setTimeout(onClose, 140); }, [onClose]);
const rotate = useCallback(() => { setRot(r => r + 90); setZ({ s: 1, x: 0, y: 0 }); }, []);
  const step = useCallback(d => { if (many) setIndex((v.index + d + v.items.length) % v.items.length); }, [many, v.index, v.items.length, setIndex]);

  // zoom toward a point (stage coords, relative to the centre)
  const zoomAt = useCallback((next, px = 0, py = 0) => setZ(o => {
const s = Math.max(MIN, Math.min(Math.max(MAX, 4 / fitRef.current), next(o.s)));
    if (s === 1) return { s: 1, x: 0, y: 0 };
    const k = s / o.s;
    return { s, x: px - (px - o.x) * k, y: py - (py - o.y) * k };
  }), []);

  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === '+' || e.key === '=') zoomAt(s => s * 1.25);
      else if (e.key === '-') zoomAt(s => s / 1.25);
      else if (e.key === '0') setZ({ s: 1, x: 0, y: 0 });
else if (e.key === 'r') rotate();
    };
    addEventListener('keydown', key, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', key, true); document.body.style.overflow = prev; };
}, [close, step, zoomAt, rotate]);

  // wheel zoom needs a non-passive listener
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(s => s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const down = e => {
    if (e.button !== 0 || !e.target.closest('.vc-mv-img')) return;
    moved.current = false;
    if (z.s === 1) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y };
    setDragging(true);
    const move = ev => {
      const d = drag.current; if (!d) return;
      if (Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) > 3) moved.current = true;
      setZ(o => ({ ...o, x: d.ox + ev.clientX - d.x, y: d.oy + ev.clientY - d.y }));
    };
    const up = () => { drag.current = null; setDragging(false); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const dbl = e => {
    const r = stage.current.getBoundingClientRect();
    if (z.s > 1) setZ({ s: 1, x: 0, y: 0 });
else zoomAt(() => Math.max(2.5, 1 / fitRef.current), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  };

  async function download() {
    try {
      await saveMedia(it.url, nameOf(it));
    } catch { toast("That site won't let Ember save the picture - opening it instead."); window.open(it.url, '_blank', 'noopener,noreferrer'); }
  }
  const copyLink = () => navigator.clipboard.writeText(it.url).then(() => toast('Link copied', true)).catch(() => toast("Couldn't copy that."));

  return (
    <div className={`vc-mv${closing ? ' closing' : ''}`} role="dialog" aria-label="Picture viewer"
      onMouseDown={e => { if (e.target === e.currentTarget || e.target === stage.current) close(); }}>
      <div className="vc-mv-top">
        <div className="vc-mv-who">
          {v.author && <Avatar user={v.author} size={32} />}
          <div>
            <b>{v.author?.username || nameOf(it)}</b>
            <small>{v.author ? <>{nameOf(it)}{v.at ? ` - ${stampOf(v.at)}` : ''}</> : ''}</small>
          </div>
        </div>
        <div className="vc-mv-tools">
          <button type="button" title="Zoom out" onClick={() => zoomAt(s => s / 1.25)} disabled={z.s <= MIN}><ZoomOut size={18} /></button>
<button type="button" className="vc-mv-pct" title="Fit to window" onClick={() => setZ({ s: 1, x: 0, y: 0 })}>{Math.round(fit * z.s * 100)}%</button>
          <button type="button" title="Zoom in" onClick={() => zoomAt(s => s * 1.25)} disabled={z.s >= MAX}><ZoomIn size={18} /></button>
<button type="button" title="Rotate" onClick={rotate}><RotateCw size={18} /></button>
          <span className="vc-mv-sep" />
          <button type="button" title="Download" onClick={download}><Download size={18} /></button>
          <button type="button" title="Copy link" onClick={copyLink}><Link2 size={18} /></button>
          <button type="button" title="Open original" onClick={() => window.open(it.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={18} /></button>
          <span className="vc-mv-sep" />
          <button type="button" title="Close" onClick={close}><X size={20} /></button>
        </div>
      </div>
      <div className={`vc-mv-stage${z.s > 1 ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`} ref={stage} onPointerDown={down}>
        {!loaded && <div className="vc-loading vc-mv-spin"><i /><i /><i /></div>}
        <img key={it.url} className={`vc-mv-img${loaded ? ' on' : ''}`} src={viaProxy(it.url)} alt={it.name || ''} draggable={false}
onLoad={e => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setLoaded(true); }} onError={() => setLoaded(true)} onDoubleClick={dbl}
style={nat ? { width: nat.w, height: nat.h, transform: `translate(-50%, -50%) translate(${z.x}px, ${z.y}px) scale(${fit * z.s}) rotate(${rot}deg)` } : undefined} />
        {many && <>
          <button type="button" className="vc-mv-nav l" title="Previous" onClick={() => step(-1)}><ChevronLeft size={28} /></button>
          <button type="button" className="vc-mv-nav r" title="Next" onClick={() => step(1)}><ChevronRight size={28} /></button>
        </>}
      </div>
      {many && (
        <div className="vc-mv-strip">
          <span className="vc-mv-count">{v.index + 1} / {v.items.length}</span>
          {v.items.map((x, i) => (
            <button type="button" key={x.url + i} className={i === v.index ? 'on' : ''} onClick={() => setIndex(i)}><img src={viaProxy(x.url)} alt="" loading="lazy" /></button>
          ))}
        </div>
      )}
    </div>
  );
}
