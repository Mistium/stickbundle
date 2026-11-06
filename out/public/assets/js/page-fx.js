/* Page-to-page slide for browsers without cross-document view transitions (Firefox, older Safari).
   Chrome / Edge use the CSS @view-transition in site-theme.css; this does the same look by hand:
   the old page slides + fades out when you follow a Velora link, the new one slides + fades in.
   Going "back" along the header (a page to the left) slides the other way. Loaded by accent.js
   (plain pages) and the React app's index.html. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var native = 'CSSViewTransitionRule' in window && 'onpagereveal' in window;
  if (native || reduce || window.__vlPageFx) return;
  window.__vlPageFx = true;
  var KEY = 'vl-nav-dir';
  var ORDER = ['/', '/docs', '/embed', '/tos', '/privacy', '/community/', '/me', '/admin'];
  function at(u) {
    try {
      var p = new URL(u, location.href);
      if (p.origin !== location.origin) return -1;
      var path = p.pathname.replace(/index\.html$/, '');
      if (path !== '/' && path !== '/community/') path = path.replace(/\/+$/, '');
      return ORDER.indexOf(path);
    } catch (e) { return -1; }
  }
  var root = document.documentElement;

  // coming in: start hidden (no flash of the finished page), then slide in once there's something to show
  var dir = null;
  try { dir = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* fine */ }
  if (dir) {
    var hide = document.createElement('style');
    hide.textContent = 'html.vl-fx-in body { opacity: 0; }';
    (document.head || root).appendChild(hide);
    root.classList.add('vl-fx-in');
    var shown = false;
    var show = function () {
      if (shown) return;
      shown = true;
      root.classList.remove('vl-fx-in');
      if (document.body && document.body.animate) {
        document.body.animate([{ opacity: 0, transform: 'translateX(' + (dir === 'back' ? -26 : 26) + 'px)' }, { opacity: 1, transform: 'none' }],
          { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { requestAnimationFrame(show); });
    else requestAnimationFrame(show);
    setTimeout(show, 900); // never leave a page invisible
  }

  // going out: a plain click on a link to another Velora page
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.dataset.noFx != null) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (er) { return; }
    if (url.origin !== location.origin || /^(mailto|tel|javascript):/i.test(a.getAttribute('href') || '')) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // same page (hash links, tabs)
    if (/^\/(uploads|assets|chat\/api|auth|oauth)\//.test(url.pathname)) return;
    e.preventDefault();
    var from = at(location.href), to = at(url.href);
    var back = from > -1 && to > -1 && to < from;
    try { sessionStorage.setItem(KEY, back ? 'back' : 'fwd'); } catch (er) { /* fine */ }
    var gone = false;
    var go = function () { if (!gone) { gone = true; location.href = url.href; } };
    if (!document.body || !document.body.animate) return go();
    var anim = document.body.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + (back ? 32 : -32) + 'px)' }],
      { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    anim.onfinish = go;
    setTimeout(go, 400);
  }); // bubbling, so in-app links (React Router) that handle themselves are left alone
  // coming back with the browser's Back button from the cache: don't stay faded out
  window.addEventListener('pageshow', function (ev) { if (ev.persisted && document.body) document.body.getAnimations().forEach(function (x) { x.cancel(); }); });
})();
