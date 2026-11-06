// The settings dialog shell shared by Server settings and Channel settings (the same dialog as Ember's own settings:
// sidebar of grouped pages + the page with its title and a close X; on phones the list first, then a page slides in).
// The caller says which pages there are and renders the open one; the shell owns search, history, Esc and the
// "Discard your changes?" question (pages report unsaved changes with onDirty, see unsaved.jsx).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { matches } from '../components/tabs/ChatSettingsTab.jsx';
import { useNarrow } from './SettingsDialog.jsx';
import { getState, ask } from './store.js';
import './SettingsDialog.css';

// a section of a page: Ember settings' card (title, then rows)
export const Card = ({ title, icon: I, children, className = '' }) => (
  <div className={`card bf-ss-card ${className}`}>
    <div className="card-header"><span className="card-title">{I && <I size={15} />} {title}</span></div>
    <div className="card-body">{children}</div>
  </div>
);

// label: "Server settings" / "Channel settings"; groups: [[group, [[id, label, Icon, search words], ...]], ...] (memoised);
// head: the identity block under the search; gone: the thing was deleted, close; children(page, { onDirty, goTo, close })
export function SettingsShell({ label, groups, startTab, onClose, gone, head, children }) {
  const lower = label.toLowerCase();
  const all = groups.flatMap(([, items]) => items);
  const narrow = useNarrow();
  const [page, setPage] = useState(() => (all.some(p => p[0] === startTab) ? startTab : all[0]?.[0]));
  const [mview, setMview] = useState(startTab ? 'page' : 'list');
  const [q, setQ] = useState('');
  const [closing, setClosing] = useState(false);
  const depth = useRef(0), closingRef = useRef(false), closeRef = useRef(null), content = useRef(null), search = useRef(null);
  const dirty = useRef({ on: false, nudge: null });
  const shown = useMemo(() => groups.map(([g, items]) => [g, items.filter(([, name, , words]) => matches(q, name, ...words))]).filter(([, items]) => items.length), [groups, q]);
  const found = shown.flatMap(([, items]) => items);
  useEffect(() => { if (!narrow && q.trim() && found.length && !found.some(it => it[0] === page)) setPage(found[0][0]); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [page]);
  useEffect(() => { if (gone) onClose(); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (page && !all.some(p => p[0] === page) && all[0]) setPage(all[0][0]); }, [all.map(p => p[0]).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  async function leaveOk() {
    if (!dirty.current.on) return true;
    dirty.current.nudge?.();
    return ask({ title: 'Discard your changes?', text: "Your changes aren't saved yet.", confirm: 'Discard', danger: true });
  }
  async function goTo(id) {
    if (narrow) {
      if (id !== page && !(await leaveOk())) return;
      dirty.current.on = false; setPage(id);
      if (mview !== 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; setMview('page'); }
      return;
    }
    if (id !== page && (await leaveOk())) { dirty.current.on = false; setPage(id); }
  }
  async function close(fromPop) {
    if (closingRef.current) return;
    if (!(await leaveOk())) {
      if (fromPop === true) { history.pushState({ bfSd: 'open' }, '', location.href); depth.current = 1; if (mview === 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; } }
      return;
    }
    closingRef.current = true;
    setClosing(true);
    if (fromPop !== true && depth.current > 0) { const n = depth.current; depth.current = 0; history.go(-n); }
    setTimeout(onClose, 160);
  }
  closeRef.current = close;
  // phones: the dialog and an opened page are history entries (back steps back), like Ember's settings
  useEffect(() => {
    if (!narrow) return undefined;
    history.pushState({ bfSd: 'open' }, '', location.href); depth.current = 1;
    if (mview === 'page') { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; }
    const onPop = () => {
      const st = history.state?.bfSd;
      if (st === 'page') { setMview('page'); depth.current = 2; }
      else if (st === 'open') { depth.current = 1; leaveOk().then(ok => { if (ok) { dirty.current.on = false; setMview('list'); } else { history.pushState({ bfSd: 'page' }, '', location.href); depth.current = 2; } }); }
      else { depth.current = 0; closeRef.current(true); }
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const backToList = () => { if (depth.current >= 2) history.back(); else setMview('list'); };
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || getState().ask || document.querySelector('.crop-back, .vc-ctx, .vc-modal-back:not(.bf-sd-back)')) return;
      if (q && document.activeElement === search.current) { setQ(''); return; }
      close();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  if (gone) return null;
  const cur = all.find(it => it[0] === page);
  const Icon = cur?.[2];
  const onDirty = (on, nudge) => { dirty.current = { on, nudge }; };

  return createPortal(
    <div className={`vc-modal-back bf-sd-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className={`bf-sd bf-ss${narrow ? ` m m-${mview}` : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <nav className="bf-sd-side" aria-label={`${label} pages`}>
          <header className="bf-sd-mhead"><h2>{label}</h2><button type="button" className="bf-sd-x" aria-label={`Close ${lower}`} onClick={() => close()}><X size={20} /></button></header>
          <label className="bf-sd-search">
            <Search size={15} />
            <input ref={search} type="search" placeholder="Search settings..." value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${lower}`} />
            {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(''); search.current?.focus(); }}><X size={14} /></button>}
          </label>
          <div className="bf-sd-me bf-ss-srv">{head}</div>
          {shown.map(([g, items]) => (
            <div className="bf-sd-group" key={g}>
              <div className="bf-sd-group-t">{g}</div>
              {items.map(([id, name, ItemIcon]) => (
                <button type="button" key={id} className={`${page === id ? 'on' : ''}${id === 'danger' ? ' danger' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => goTo(id)}>
                  <ItemIcon size={17} /> {name}<ChevronRight className="bf-sd-chev" size={18} />
                </button>
              ))}
            </div>
          ))}
          {!shown.length && <div className="bf-sd-none">No settings match "{q.trim()}".</div>}
        </nav>
        <div className="bf-sd-main">
          <header className="bf-sd-head">
            <button type="button" className="bf-sd-backbtn" aria-label={`Back to ${lower}`} onClick={backToList}><ChevronLeft size={22} /></button>
            <h2>{Icon && <Icon size={19} />} {cur?.[1] || label}</h2>
            <button type="button" className="bf-sd-x" aria-label={`Close ${lower}`} data-tip="Close (Esc)" onClick={() => close()}><X size={18} /></button>
          </header>
          <div className="bf-sd-content bf-ss-content" ref={content} key={page}>
            {children(page, { onDirty, goTo, close })}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
