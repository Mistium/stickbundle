import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, X } from 'lucide-react';

// Crop a picture before it's uploaded: drag it around inside the frame, zoom with the
// slider or the mouse wheel. Gives back the box in the picture's own pixels
// ({ x, y, w, h }) - the server does the actual cut, so animated GIFs stay animated.
//   aspect - width / height of the frame (1 = profile picture, 3 = banner)
//   round  - show a round mask (profile pictures are shown in a circle)
const MAX_ZOOM = 6;

export default function ImageCropper({ file, aspect = 1, round = false, title, onCancel: cancelNow, onDone: doneNow }) {
  // leaving plays the fade + shrink first, then tells the editor
  const [closing, setClosing] = useState(false);
  const leave = fn => { if (closing) return; setClosing(true); setTimeout(fn, 190); };
  const onCancel = () => leave(cancelNow);
  const onDone = box => leave(() => doneNow(box));
  const [url] = useState(() => URL.createObjectURL(file));
  const [nat, setNat] = useState(null);       // { w, h } of the picture
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // picture's top-left inside the frame, in frame px
  const [frameW, setFrameW] = useState(() => Math.min(aspect >= 2 ? 600 : 380, window.innerWidth - 72));
  const frameH = Math.round(frameW / aspect);
  const drag = useRef(null);
  const frameRef = useRef(null);
  const wheelRef = useRef(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const onResize = () => setFrameW(Math.min(aspect >= 2 ? 600 : 380, window.innerWidth - 72));
    const onKey = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, [aspect, onCancel]);

  const base = nat ? Math.max(frameW / nat.w, frameH / nat.h) : 1; // "cover" scale
  const scale = base * zoom;
  const clamp = (p, s = scale) => nat ? {
    x: Math.min(0, Math.max(frameW - nat.w * s, p.x)),
    y: Math.min(0, Math.max(frameH - nat.h * s, p.y)),
  } : p;

  // keep the picture covering the frame when the frame or zoom changes
  useEffect(() => { setPos(p => clamp(p)); }, [frameW, nat]); // eslint-disable-line react-hooks/exhaustive-deps

  function onLoad(e) {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    const b = Math.max(frameW / w, frameH / h);
    setNat({ w, h });
    setPos({ x: (frameW - w * b) / 2, y: (frameH - h * b) / 2 });
  }
  // zoom around a point of the frame (the middle, or where the mouse is)
  function zoomTo(z, cx = frameW / 2, cy = frameH / 2) {
    z = Math.min(MAX_ZOOM, Math.max(1, z));
    const s2 = base * z;
    const px = (cx - pos.x) / scale, py = (cy - pos.y) / scale; // picture px under the point
    setZoom(z);
    setPos(clamp({ x: cx - px * s2, y: cy - py * s2 }, s2));
  }
  // a native listener: React's wheel handler is passive, so the page would scroll too
  wheelRef.current = e => {
    e.preventDefault();
    const r = frameRef.current.getBoundingClientRect();
    zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  };
  useEffect(() => {
    const el = frameRef.current;
    const fn = e => wheelRef.current(e);
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: pos };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    const d = drag.current;
    setPos(clamp({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }));
  }
  const onPointerUp = () => { drag.current = null; };

  function apply() {
    if (!nat) return;
    const x = Math.max(0, Math.round(-pos.x / scale)), y = Math.max(0, Math.round(-pos.y / scale));
    const w = Math.min(nat.w - x, Math.round(frameW / scale)), h = Math.min(nat.h - y, Math.round(frameH / scale));
    onDone({ x, y, w, h });
  }

  return (
    <div className={`crop-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="crop-modal" role="dialog" aria-label={title}>
        <div className="crop-head">
          <span>{title}</span>
          <button type="button" className="crop-x" onClick={onCancel} aria-label="Cancel"><X size={16} /></button>
        </div>
        <div
          className={`crop-frame${round ? ' round' : ''}`}
          ref={frameRef}
          style={{ width: frameW, height: frameH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={onLoad}
            style={nat ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(${pos.x}px, ${pos.y}px)` } : { opacity: 0 }}
          />
          <div className="crop-mask" />
        </div>
        <div className="crop-zoom">
          <button type="button" onClick={() => zoomTo(zoom / 1.25)} aria-label="Zoom out"><ZoomOut size={15} /></button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => zoomTo(Number(e.target.value))} aria-label="Zoom" />
          <button type="button" onClick={() => zoomTo(zoom * 1.25)} aria-label="Zoom in"><ZoomIn size={15} /></button>
        </div>
        <div className="crop-hint">Drag to move it, scroll or use the slider to zoom.{file.type === 'image/gif' ? ' GIFs stay animated.' : ''}</div>
        <div className="crop-actions">
          <button type="button" className="btn btn-surface" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!nat}>Apply</button>
        </div>
      </div>
    </div>
  );
}
