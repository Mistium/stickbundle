// Site-wide accent colour for the plain-HTML pages (the React dashboard does the same in
// dashboard-src/src/theme.js). Load it in <head>, before the page's CSS is used:
//   <script src="/assets/js/accent.js"></script>
// The signed-in user's Accent Color (profile.color) replaces the default purple in every colour
// variable the pages use. It's cached in localStorage so pages start in the right colour (no purple
// flash), and refreshed from /account/me every few minutes; the dashboard updates the cache as
// soon as the colour is changed there.
// Also the site-wide loader, since every Velora page already loads this first in <head>:
//   /assets/css/site-theme.css - gradient boxes, the square Pro tag, notice + page-switch animations
//   /assets/js/motion.js       - notices fade/grow in and fade/collapse out
//   /assets/js/account-menu.js - the header's account menu (account management, switch account, sign out)
// and the direction of the page-switch slide (going "back" along the header = slides the other way).
(function () {
  var V = '2';
  var head = document.head || document.getElementsByTagName('head')[0];
  // The Velora site theme, motion and account-menu files aren't part of this
  // build, so nothing else is injected here.
  // header order: a page to the left of this one = "back"
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
  function mark(vt, from, to) {
    var a = at(from), b = at(to);
    if (vt && vt.types && a > -1 && b > -1 && b < a) vt.types.add('back');
  }
  window.addEventListener('pageswap', function (e) { if (e.activation && e.activation.entry) mark(e.viewTransition, location.href, e.activation.entry.url); });
  window.addEventListener('pagereveal', function (e) {
    var act = window.navigation && window.navigation.activation;
    if (act && act.from) mark(e.viewTransition, act.from.url, location.href);
  });
})();

(function () {
  var DEFAULT = '#9d8ad1';
  var KEY = 'velora_accent';
  var TIME_KEY = 'velora_accent_at';
  var REFRESH_MS = 5 * 60 * 1000;

  function rgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  // white is what an account has before anyone picks a colour - treat it as "not set" (same as theme.js)
  function usable(c) { return !!rgb(c) && !/^#?(fff|ffffff)$/i.test(String(c).trim()); }
  function lighter(c, t) { return 'rgb(' + c.map(function (v) { return Math.round(v + (255 - v) * t); }).join(',') + ')'; }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  function apply(color) {
    var hex = usable(color) ? (color.charAt(0) === '#' ? color : '#' + color) : DEFAULT;
    var c = rgb(hex);
    var a = function (o) { return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + o + ')'; };
    var s = document.documentElement.style;
    var lite = lighter(c, 0.14);
    // every name the pages use for the accent
    s.setProperty('--accent', hex);
    s.setProperty('--accent-dim', a(0.12));
    s.setProperty('--accent-glow', a(0.35));
    s.setProperty('--purple', hex);
    s.setProperty('--purple-lite', lite);
    s.setProperty('--purple-dim', a(0.12));
    s.setProperty('--purple-glow', a(0.35));
    s.setProperty('--btn-bg', hex);
    s.setProperty('--btn-hover', lite);
    s.setProperty('--inp-focus', hex);
    s.setProperty('--sn-accent', hex);
    s.setProperty('--sn-accent-hover', lite);
    s.setProperty('--vl-accent', hex); // Velora embeds shown on Velora's own pages
    return hex;
  }

  // remember + apply (the dashboard and the header call this too)
  window.veloraApplyAccent = function (color) {
    var hex = apply(color);
    set(KEY, usable(color) ? hex : null);
    set(TIME_KEY, String(Date.now()));
    return hex;
  };

  var token = get('velora_token');
  if (!token) { set(KEY, null); apply(null); return; }
  apply(get(KEY));

  // refresh from the account now and then (colour changed on another device, etc.)
  var last = +get(TIME_KEY) || 0;
  if (Date.now() - last > REFRESH_MS && typeof fetch === 'function') {
    fetch('/account/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.profile) window.veloraApplyAccent(d.profile.color); })
      .catch(function () {});
  }
})();
