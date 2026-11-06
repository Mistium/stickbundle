// Site-wide notice for credit-bought Pro subscriptions that are about
// to run out. Self-contained so it can be dropped into any page (plain HTML
// or the React dashboard shell) with a single <script> tag - it does its own
// /account/me fetch and injects its own DOM/styles.
//
// Behaviour (per product spec):
//  - While a credit-bought tier has < WARN_DAYS left and hasn't been
//    acknowledged, a blocking popup appears on every page load.
//  - Once acknowledged (POST /currency/credit-sub/ack), the popup stops -
//    but a persistent top banner keeps showing until the tier either
//    expires or the user buys more weeks (which resets the ack flag).
(function () {
  var WARN_DAYS = 3;
  var WARN_MS = WARN_DAYS * 24 * 60 * 60 * 1000;

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  }

  function daysLeft(ms) {
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  function injectStyles() {
    if (document.getElementById('vcsn-styles')) return;
    var css = document.createElement('style');
    css.id = 'vcsn-styles';
    css.textContent =
      '.vcsn-banner{position:sticky;top:0;left:0;right:0;z-index:9998;display:flex;align-items:center;' +
      'justify-content:center;gap:14px;flex-wrap:wrap;background:#3d2f16;color:#f1e3c4;font-size:13px;' +
      'padding:9px 16px;border-bottom:1px solid #5c481f;font-family:-apple-system,BlinkMacSystemFont,' +
      '"Segoe UI",Arial,sans-serif;}' +
      '.vcsn-banner a,.vcsn-banner button{color:#f1e3c4;text-decoration:underline;background:none;border:none;' +
      'cursor:pointer;font-size:13px;font-family:inherit;padding:0;}' +
      '.vcsn-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;' +
      'align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,' +
      '"Segoe UI",Arial,sans-serif;}' +
      '.vcsn-modal{background:#151517;border:1px solid #292930;border-radius:0;max-width:420px;width:100%;' +
      'padding:26px 24px;color:#e7e7ea;}' +
      '.vcsn-modal h2{font-size:18px;margin-bottom:10px;}' +
      '.vcsn-modal p{font-size:13.5px;color:#a1a1aa;line-height:1.6;margin-bottom:18px;}' +
      '.vcsn-actions{display:flex;flex-direction:column;gap:8px;}' +
      '.vcsn-btn{display:block;width:100%;padding:10px 16px;border-radius:0;font-size:13.5px;font-weight:700;' +
      'text-align:center;cursor:pointer;border:none;font-family:inherit;text-decoration:none;}' +
      '.vcsn-btn-primary{background:#9d8ad1;color:#16141c;}' +
      '.vcsn-btn-kofi{background:#1a1a1d;color:#e7e7ea;border:1px solid #292930;}' +
      '.vcsn-btn-ack{background:transparent;color:#71717a;}';
    document.head.appendChild(css);
  }

  function renderBanner(u, msLeft) {
    if (document.getElementById('vcsn-banner')) return;
    var days = daysLeft(msLeft);
    var el = document.createElement('div');
    el.id = 'vcsn-banner';
    el.className = 'vcsn-banner';
    el.innerHTML =
      'Your credit-bought Velora Pro' +
      ' runs out in ' + days + ' day' + (days === 1 ? '' : 's') + ' (' + fmtDate(u.credit_tier_expires_at) + ').' +
      ' <a href="/upgrade#credit-sub">Buy more with credits</a> or ' +
      '<a href="https://ko-fi.com/ikelene/" target="_blank" rel="noopener">get it on Ko-fi</a>.';
    document.body.insertBefore(el, document.body.firstChild);
  }

  function renderPopup(u, msLeft) {
    if (document.getElementById('vcsn-overlay')) return;
    var days = daysLeft(msLeft);
    var overlay = document.createElement('div');
    overlay.id = 'vcsn-overlay';
    overlay.className = 'vcsn-overlay';
    overlay.innerHTML =
      '<div class="vcsn-modal">' +
        '<h2>Your Pro is running out</h2>' +
        '<p>The Pro you bought with credits runs out in ' +
        days + ' day' + (days === 1 ? '' : 's') + ', on ' + fmtDate(u.credit_tier_expires_at) + '. ' +
        'Buy more weeks to keep it going, or switch to a real Ko-fi subscription so it never expires.</p>' +
        '<div class="vcsn-actions">' +
          '<a class="vcsn-btn vcsn-btn-primary" href="/upgrade#credit-sub">Buy more weeks with credits</a>' +
          '<a class="vcsn-btn vcsn-btn-kofi" href="https://ko-fi.com/ikelene/" target="_blank" rel="noopener">Get it on Ko-fi instead</a>' +
          '<button class="vcsn-btn vcsn-btn-ack" type="button" id="vcsn-ack-btn">Got it, don\'t show this again</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var token = localStorage.getItem('velora_token');
    document.getElementById('vcsn-ack-btn').addEventListener('click', function () {
      fetch('/currency/credit-sub/ack', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
        .catch(function () {})
        .then(function () {
          overlay.remove();
          renderBanner(u, msLeft);
        });
    });
  }

  function run() {
    var token = localStorage.getItem('velora_token');
    if (!token) return;

    fetch('/account/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var u = d && d.sys;
        if (!u || !u.credit_tier || !u.credit_tier_expires_at) return;

        var msLeft = new Date(u.credit_tier_expires_at).getTime() - Date.now();
        if (msLeft <= 0 || msLeft > WARN_MS) return;

        injectStyles();
        if (u.credit_tier_ack) {
          renderBanner(u, msLeft);
        } else {
          renderPopup(u, msLeft);
        }
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
