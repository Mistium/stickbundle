// Glint (clips.nookara.cc, Nat's game clipper) from Ember: the user's own clips (media picker "Game Clips" tab, hiding clip
// videos from Saved Media), likes on clip cards, and the Glint mark. Glint's API takes the same Velora token Ember has.
// Everything here fails quietly: if Glint can't be reached the picker just behaves as if there were no clips.
import { uploadKey } from './uploadLinks.js';
import { useEffect, useState } from 'react';
import { getToken } from '../api.js';

export const GLINT_API = 'https://clips.nookara.cc/api';
export const GLINT_DOWNLOAD = 'https://clips.nookara.cc/download';
export const GLINT_BROWSE = 'https://clips.nookara.cc/';
export const glintLink = id => `https://clips.nookara.cc/c/${id}`;

export async function glintFetch(path, { method = 'GET', auth = true } = {}) {
  const token = auth ? getToken() : null;
  if (auth === 'required' && !token) throw Object.assign(new Error('unauthorized'), { status: 401 });
  const res = await fetch(GLINT_API + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'omit' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `http_${res.status}`), { status: res.status });
  return data;
}

// the Glint mark (viewfinder corners + a play triangle, glint/web/static/glint-icon.svg); all currentColor, square corners. Works as a menu icon too ({ size }).
export function GlintMark({ size = 14, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="12" y="12" width="26" height="6" fill="currentColor" />
      <rect x="12" y="12" width="6" height="26" fill="currentColor" />
      <rect x="62" y="12" width="26" height="6" fill="currentColor" />
      <rect x="82" y="12" width="6" height="26" fill="currentColor" />
      <rect x="12" y="82" width="26" height="6" fill="currentColor" />
      <rect x="12" y="62" width="6" height="26" fill="currentColor" />
      <rect x="62" y="82" width="26" height="6" fill="currentColor" />
      <rect x="82" y="62" width="6" height="26" fill="currentColor" />
      <polygon points="41,32 71,50 41,68" fill="currentColor" />
    </svg>
  );
}
export function NewTag() { return <span className="vc-new-tag">NEW</span>; }

// ── my clips: fetched once per session (refreshed in the background when older than 5 minutes) ──
// state: undefined = not asked yet / loading, null = Glint failed (don't filter, no tab), [] / [clips]
let mine; let mineAt = 0; let mineJob = null;
const subs = new Set();
const tell = () => subs.forEach(f => f(mine));
export function loadMyClips({ force = false } = {}) {
  if (!getToken()) { mine = null; tell(); return Promise.resolve(null); }
  if (mineJob) return mineJob;
  if (!force && mine !== undefined && mine !== null && Date.now() - mineAt < 5 * 60 * 1000) return Promise.resolve(mine);
  mineJob = glintFetch('/me/clips', { auth: 'required' })
    .then(d => (Array.isArray(d?.clips) ? d.clips : Array.isArray(d) ? d : null))
    .catch(() => (Array.isArray(mine) ? mine : null)) // a failed refresh keeps what we had
    .then(list => { mine = list; mineAt = Date.now(); mineJob = null; tell(); return list; });
  return mineJob;
}
export function useMyClips() {
  const [v, setV] = useState(mine);
  useEffect(() => { subs.add(setV); setV(mine); loadMyClips(); return () => { subs.delete(setV); }; }, []);
  return v;
}
export const myClipsNow = () => mine;
// clips that still exist (the API leaves deleted ones out; a clip whose render failed doesn't count)
export const liveClips = list => (Array.isArray(list) ? list.filter(c => c && c.id && c.status !== 'failed' && c.visibility !== 'deleted') : []);
// Saved Media items that are really Glint clip videos (drafts too): matched by url or by the Velora upload id
export function glintMediaMatcher(list) {
  if (!Array.isArray(list) || !list.length) return () => false;
  const urls = new Set(), ids = new Set();
  for (const c of list) {
    if (c.videoUrl) urls.add(uploadKey(c.videoUrl)); // by /uploads/ path: the same clip file on nookara.cc and cdn.nookara.cc matches
    if (c.mediaId != null) ids.add(`u${c.mediaId}`);
  }
  return m => ids.has(String(m.id)) || urls.has(uploadKey(m.url));
}

// ── one clip's like state (GET /clips/:id, with the token so it says whether I liked it), cached per session ──
const info = new Map(); // id -> promise of { liked, likes } | null
export function clipLikes(id) {
  if (!info.has(id)) info.set(id, glintFetch(`/clips/${encodeURIComponent(id)}`).then(d => { const c = d?.clip || d; return { liked: !!c?.liked, likes: Number(c?.likes) || 0 }; }).catch(() => null));
  return info.get(id);
}
export async function setClipLike(id, on) {
  const d = await glintFetch(`/clips/${encodeURIComponent(id)}/like`, { method: on ? 'PUT' : 'DELETE', auth: 'required' });
  const v = { liked: !!d.liked, likes: Number(d.likes) || 0 };
  info.set(id, Promise.resolve(v));
  return v;
}

// open a page in the browser (the desktop app sends https links out through openExternal)
export function openOutside(url) {
  const d = window.bonfireDesktop;
  if (d?.openExternal) { Promise.resolve(d.openExternal(url)).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
