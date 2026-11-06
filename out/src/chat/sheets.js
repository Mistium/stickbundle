// Phones (and touch screens up to tablet width): every pop-up (right-click / long-press menus, profile cards, the
// emoji / GIF / reaction / soundboard pickers, your status pop-out and its submenus) turns into a bottom sheet.
// One place does it for all of them: it watches the page for these pop-ups, tags them with data-sheet (the CSS in
// chat.css does the layout), adds a tap-to-close backdrop and a drag handle (swipe down closes), and makes the
// browser / Android back button close the top sheet. Desktop keeps the normal pop-ups.
const SEL = '.vc-pop, .bf-pp-pop, .bf-pp-flyout, .vc-ctx, .vc-sb, .vc-react-pop, .vc-picker';
const QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1100px)';

export function initSheets() {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  const backs = new Map(); // open sheets, in stacking order
  let backdrop = null;     // one dimmer for the entire stack
  let pushed = false;      // we added one history entry for "a sheet is open"
  let selfBack = 0;        // history.back() calls we made ourselves (their popstate is ignored)

  const wanted = el => el.nodeType === 1 && el.matches(SEL) && !(el.matches('.vc-picker') && el.closest('.vc-react-pop'));
  const dismiss = el => { if (el && backdrop) backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); };
  const topSheet = () => { const all = [...backs.keys()]; return all[all.length - 1]; };

  function swipe(el) {
    let y0 = null, dy = 0;
    el.addEventListener('touchstart', e => { const r = el.getBoundingClientRect(); y0 = e.touches[0].clientY - r.top < 34 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (y0 == null) return;
      y0 = null;
      if (dy > 80) dismiss(el);
      else { el.style.transition = 'transform .18s ease-out'; el.style.transform = ''; }
    }, { passive: true });
  }

  function sync() {
    for (const el of backs.keys()) if (!el.isConnected || !mq.matches) {
      el.removeAttribute('data-sheet'); el.style.removeProperty('--vc-sheet-layer'); backs.delete(el);
    }
    if (mq.matches) {
      document.querySelectorAll(SEL).forEach(el => {
        if (!wanted(el) || backs.has(el)) return;
        el.setAttribute('data-sheet', '');
        backs.set(el, true);
        swipe(el);
      });
    }
    if (backs.size && !backdrop) {
      backdrop = document.createElement('div'); backdrop.className = 'vc-sheet-back';
      backdrop.setAttribute('aria-hidden', 'true');
      // Let each popup's existing outside-mousedown handler close it. Dispatching
      // from a pointerdown also works when the touch layer consumes trailing clicks.
      backdrop.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); dismiss(topSheet()); } });
      document.body.appendChild(backdrop);
    } else if (!backs.size && backdrop) { backdrop.remove(); backdrop = null; }
    let layer = 10020;
    for (const el of backs.keys()) el.style.setProperty('--vc-sheet-layer', String(layer++));
    if (backs.size && !pushed) { history.pushState({ vcSheet: 1 }, '', location.href); pushed = true; }
    else if (!backs.size && pushed) { pushed = false; if (history.state?.vcSheet) { selfBack++; history.back(); } }
  }
  const obs = new MutationObserver(() => sync());
  obs.observe(document.body, { childList: true, subtree: true });

  const onPop = () => {
    if (selfBack) { selfBack--; return; }
    if (history.state?.vcSheet) { // landed on a stale sheet entry (the sheet is long gone): step over it
      if (!backs.size) { selfBack++; history.back(); }
      return;
    }
    if (pushed) { // back button: close the top sheet
      pushed = false;
      const t = topSheet();
      if (t) dismiss(t);
      setTimeout(sync, 60);
    }
  };
  addEventListener('popstate', onPop);
  sync();
  return () => { obs.disconnect(); removeEventListener('popstate', onPop); backdrop?.remove(); for (const el of backs.keys()) { el.removeAttribute('data-sheet'); el.style.removeProperty('--vc-sheet-layer'); } backs.clear(); };
}
