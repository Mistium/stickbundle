// Ember's own hover tooltips, for everything: any element with a title (or data-tip) gets this
// instead of the browser's. The title moves into data-tip on first hover, so the browser one never
// shows. data-tip-side="right" puts it beside the element; data-tip-server="<sid>" shows a server card; data-tip-alias='{json}'
// shows who really posted an aliased message (Alias.jsx) - that one also shows on keyboard focus; data-tip-via='{json}' is
// the "sent from" card of a message's client chip (ClientVia.jsx).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, Globe } from 'lucide-react';
import { useChat, statusOf, loadMembers } from './store.js';
import { AliasTip } from './Alias.jsx';
import { ViaTip } from './ClientVia.jsx';

export function TooltipHost() {
  const [tip, setTip] = useState(null); // { el, text, side, server, rect }
  useEffect(() => {
    let cur = null, timer = null, shownAt = 0;
    const find = t => (t instanceof Element ? t.closest('[title], [data-tip], [data-tip-server], [data-tip-alias], [data-tip-via]') : null);
    const aliasOf = el => { try { return JSON.parse(el.getAttribute('data-tip-alias') || 'null'); } catch { return null; } };
    const viaOf = el => { try { return JSON.parse(el.getAttribute('data-tip-via') || 'null'); } catch { return null; } };
    const over = e => {
      const el = find(e.target);
      if (el === cur) return;
      cur = el;
      clearTimeout(timer);
      if (!el) { if (shownAt) shownAt = Date.now(); setTip(null); return; }
      if (el.hasAttribute('title')) {
        const t = el.getAttribute('title');
        el.removeAttribute('title');
        if (t) {
          el.setAttribute('data-tip', t);
          if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
        }
      }
      const text = el.getAttribute('data-tip');
      const server = el.getAttribute('data-tip-server');
      const alias = aliasOf(el);
      const via = viaOf(el);
      if (!text && !server && !alias && !via) { setTip(null); return; }
      // moving from one tip straight to the next shows it right away
      const quick = Date.now() - shownAt < 400;
      timer = setTimeout(() => {
        if (cur !== el || !document.contains(el)) return;
        shownAt = Date.now();
        setTip({ el, text, server, alias, via, side: el.getAttribute('data-tip-side') || 'top', rect: el.getBoundingClientRect() });
      }, quick ? 40 : 380);
    };
    const hide = () => { cur = null; clearTimeout(timer); setTip(null); };
    // keyboard: an alias mark shows its tip while it has focus
    const focusIn = e => {
      const el = e.target instanceof Element && e.target.matches('[data-tip-alias]') ? e.target : null;
      const alias = el && aliasOf(el);
      if (!alias) return;
      cur = el; clearTimeout(timer); shownAt = Date.now();
      setTip({ el, alias, side: 'top', rect: el.getBoundingClientRect() });
    };
    const focusOut = e => { if (e.target === cur && e.target.matches?.('[data-tip-alias]')) hide(); };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('focusin', focusIn, true);
    document.addEventListener('focusout', focusOut, true);
    addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('focusin', focusIn, true);
      document.removeEventListener('focusout', focusOut, true);
      removeEventListener('blur', hide);
    };
  }, []);
  // the element went away (re-render, closed menu): drop the tip
  useEffect(() => {
    if (!tip) return undefined;
    const t = setInterval(() => { if (!document.contains(tip.el)) setTip(null); }, 400);
    return () => clearInterval(t);
  }, [tip]);
  if (!tip) return null;
  return createPortal(<Tip tip={tip} />, document.body);
}

function Tip({ tip }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const r = tip.rect;
    const pad = 8, gap = 8;
    let side = tip.side, left, top;
    if (side === 'right') {
      left = r.right + gap + 2; top = r.top + r.height / 2 - h / 2;
      if (left + w > innerWidth - pad) side = 'top';
    }
    if (side === 'top') {
      left = r.left + r.width / 2 - w / 2; top = r.top - h - gap;
      if (top < pad) { side = 'bottom'; }
    }
    if (side === 'bottom') { left = r.left + r.width / 2 - w / 2; top = r.bottom + gap; }
    const clampedLeft = Math.max(pad, Math.min(innerWidth - w - pad, left));
    setPos({ left: clampedLeft, top: Math.max(pad, Math.min(innerHeight - h - pad, top)), side, arrow: side === 'right' ? null : r.left + r.width / 2 - clampedLeft });
  }, [tip]);
  return (
    <div ref={ref} className={`vc-tooltip side-${pos?.side || tip.side}${tip.server ? ' rich' : ''}${tip.alias ? ' alias' : ''}`} role="tooltip"
      style={pos ? { left: pos.left, top: pos.top, '--ax': pos.arrow != null ? `${pos.arrow}px` : undefined } : { left: -9999, top: -9999 }}>
      {tip.server ? <ServerTip sid={tip.server} /> : tip.alias ? <AliasTip a={tip.alias} /> : tip.via ? <ViaTip t={tip.via} /> : tip.text}
    </div>
  );
}

function ServerTip({ sid }) {
  const s = useChat(st => st.servers.find(x => x.sid === sid));
  const members = useChat(st => st.members[sid]);
  const st = useChat(x => x); // presence, Velora names, signed in
  useEffect(() => { if (s?.inst && !members) loadMembers(sid); }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  // with the member list loaded, count who's online right now (an instance: its Velora accounts, from the home socket); otherwise what the server said
  const online = members ? (s.inst && !st.signedIn ? null : members.filter(m => { const v = statusOf(sid, m, st); return v && v !== 'offline'; }).length) : s.online;
  return (
    <div className="vc-tip-server">
      <b>{s.name}</b>
      {s.inst && <em className="vc-tip-host"><Globe size={11} />{s.inst.replace(/^https?:\/\//, '')}</em>}
      <span>
        {online != null && <><i className="dot on" />{online} online</>}
        <i className="dot" />{s.member_count} member{s.member_count === 1 ? '' : 's'}
      </span>
      {(s.mentions > 0) && <small><AtSign size={11} /> {s.mentions} mention{s.mentions === 1 ? '' : 's'} waiting</small>}
    </div>
  );
}
