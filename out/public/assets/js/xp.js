/* Velora "expanding boxes" experiment (2026-10-07): a card you click grows into the box
   that holds that section's content, and going back shrinks it into its card again.
   On for everyone since 2026-10-08 (was an opt-in experiment); ?ui=classic turns it off in a browser,
   ?ui=expand back on. Used by the account + admin pages (React) and /community/.

   VeloraXP.on()            - is the experiment on?
   VeloraXP.expand(cardEl)  - start growing from a card (call right before switching)
   VeloraXP.land(boxEl)     - finish: fly to the new content box, then fade its content in
   VeloraXP.collapse(boxEl) - start shrinking from the content box (right before going back)
   VeloraXP.landCard(cardEl)- finish: fly into that card
*/
(function () {
  'use strict';
  var KEY = 'velora_ui';
  var EASE = 'cubic-bezier(.2,.8,.2,1)';
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var pend = null;

  function on() {
    try {
      var q = new URLSearchParams(location.search).get('ui');
      if (q === 'expand' || q === 'classic') localStorage.setItem(KEY, q);
      return localStorage.getItem(KEY) !== 'classic'; // on for everyone now (2026-10-08); ?ui=classic turns it off
    } catch (e) { return true; }
  }
  // only the part that's on screen (a long content box would otherwise fly in from far below)
  function onScreen(r) {
    var top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
    return { left: r.left, top: top, width: r.width, height: Math.max(40, bottom - top) };
  }
  function px(r) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }; }
  function frozenCopy(el) {
    var r = el.getBoundingClientRect();
    var c = el.cloneNode(true);
    c.removeAttribute('id');
    c.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    c.querySelectorAll('[name]').forEach(function (n) { n.removeAttribute('name'); });
    c.querySelectorAll('iframe, script, video, audio').forEach(function (n) { n.remove(); });
    c.setAttribute('aria-hidden', 'true');
    c.inert = true;
    Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: r.width + 'px', height: r.height + 'px', margin: '0', transform: 'none', transition: 'none' });
    return c;
  }
  // a plain box that looks like el (same background + border), fixed over the page
  function shellFor(el) {
    var cs = getComputedStyle(el);
    var s = document.createElement('div');
    s.className = 'vxp-shell';
    var bg = cs.backgroundColor;
    var transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    Object.assign(s.style, px(onScreen(el.getBoundingClientRect())), {
      position: 'fixed', zIndex: '60', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box',
      backgroundColor: transparent && cs.backgroundImage === 'none' ? 'var(--card, #151517)' : bg,
      backgroundImage: cs.backgroundImage,
      border: (parseFloat(cs.borderTopWidth) || 1) + 'px solid ' + (cs.borderTopColor || '#292930'),
      boxShadow: '0 18px 50px rgba(0,0,0,.35)',
    });
    document.body.appendChild(s);
    return s;
  }
  function cleanup() {
    if (pend) { clearTimeout(pend.timer); if (pend.shell) pend.shell.remove(); }
    pend = null;
  }
  function begin(kind, shell) {
    cleanup();
    pend = { kind: kind, shell: shell };
    pend.timer = setTimeout(cleanup, 4000); // nothing landed (an error page?) - don't leave it hanging
  }

  function expand(cardEl) {
    if (!cardEl || !cardEl.animate || reduce.matches || !on()) return;
    var copy = frozenCopy(cardEl);
    var shell = shellFor(cardEl);
    var b = -(parseFloat(shell.style.borderTopWidth) || 0) + 'px';
    copy.style.left = copy.style.top = b; // its own border sits right on the shell's
    shell.appendChild(copy);
    copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' });
    begin('expand', shell);
  }
  function land(boxEl) {
    if (!pend || pend.kind !== 'expand') return;
    var p = pend;
    clearTimeout(p.timer);
    pend = null;
    if (!boxEl) { p.shell.remove(); return; }
    var from = p.shell.getBoundingClientRect();
    var to = onScreen(boxEl.getBoundingClientRect());
    boxEl.style.visibility = 'hidden';
    p.shell.animate([px(from), px(to)], { duration: 400, easing: EASE, fill: 'forwards' }).finished.then(function () {
      boxEl.style.visibility = '';
      var kids = Array.prototype.slice.call(boxEl.children, 0, 8);
      kids.forEach(function (k, i) {
        k.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: i * 35, easing: EASE, fill: 'backwards' });
      });
      p.shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' }).finished.then(function () { p.shell.remove(); });
    }, function () { boxEl.style.visibility = ''; p.shell.remove(); });
  }

  function collapse(boxEl) {
    if (!boxEl || !boxEl.animate || reduce.matches || !on()) return;
    var shell = shellFor(boxEl);
    shell.style.boxShadow = 'none';
    begin('collapse', shell);
  }
  function landCard(cardEl) {
    if (!pend || pend.kind !== 'collapse') return;
    var p = pend;
    clearTimeout(p.timer);
    pend = null;
    if (!cardEl) {
      p.shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(function () { p.shell.remove(); });
      return;
    }
    var from = p.shell.getBoundingClientRect();
    var to = cardEl.getBoundingClientRect();
    var copy = frozenCopy(cardEl);
    copy.style.left = copy.style.top = -(parseFloat(p.shell.style.borderTopWidth) || 0) + 'px';
    copy.style.opacity = '0';
    p.shell.appendChild(copy);
    cardEl.style.visibility = 'hidden';
    p.shell.animate([px(from), px(to)], { duration: 360, easing: EASE, fill: 'forwards' });
    copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 230, easing: 'ease-out', fill: 'forwards' }).finished.then(function () {
      cardEl.style.visibility = '';
      p.shell.remove();
    }, function () { cardEl.style.visibility = ''; p.shell.remove(); });
  }

  window.VeloraXP = { on: on, expand: expand, land: land, collapse: collapse, landCard: landCard, busy: function () { return !!pend; } };
})();
