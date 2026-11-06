// "Search users…" suggestions: real usernames as you type, each row showing the person's
// profile picture + name, with their banner as the row's background. Click / Enter opens
// their profile. Used by the dashboard nav (Nav.jsx) and the plain pages' nav (shared-nav.js):
//   attachUserSuggest(inputElement)
(function () {
  'use strict';
  if (window.attachUserSuggest) return;

  var style = document.createElement('style');
  style.textContent =
    '.vsug{position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:260px;z-index:1000;background:#151517;border:1px solid #292930;box-shadow:0 10px 30px rgba(0,0,0,.55);display:flex;flex-direction:column;padding:4px;gap:4px}' +
    '.vsug[hidden]{display:none}' +
    '.vsug-item{position:relative;display:flex;align-items:center;gap:10px;height:48px;padding:0 10px;overflow:hidden;text-decoration:none;color:#e7e7ea;background:#1c1c20;border:1px solid transparent}' +
    '.vsug-item .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}' +
    '.vsug-item::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(14,14,16,.94) 30%,rgba(14,14,16,.6))}' +
    '.vsug-item>*:not(.bg){position:relative;z-index:2}' +
    '.vsug-item.on,.vsug-item:hover{border-color:var(--accent,#9d8ad1);text-decoration:none}' +
    '.vsug-pfp{width:32px;height:32px;flex:none;object-fit:cover;background:#26262b;display:grid;place-items:center;font-weight:700;font-size:14px}' +
    '.vsug-name{font-weight:700;font-size:13.5px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.vsug-rank{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#a1a1aa;border:1px solid #3a3a42;padding:1px 6px;background:rgba(14,14,16,.6)}';
  document.head.appendChild(style);

  var safeUrl = function (u) { return typeof u === 'string' && /^(https:\/\/|\/)/i.test(u) ? u : ''; };

  window.attachUserSuggest = function (input) {
    if (!input || input.dataset.vsug) return;
    input.dataset.vsug = '1';
    input.setAttribute('autocomplete', 'off');
    var host = input.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var box = document.createElement('div');
    box.className = 'vsug';
    box.hidden = true;
    box.setAttribute('role', 'listbox');
    host.appendChild(box);
    var timer = null, seq = 0, items = [], sel = -1;

    function go(name) { window.location.href = '/u/' + encodeURIComponent(name); }
    function render() {
      box.replaceChildren();
      items.forEach(function (u, i) {
        var a = document.createElement('a');
        a.className = 'vsug-item' + (i === sel ? ' on' : '');
        a.href = '/u/' + encodeURIComponent(u.username);
        a.setAttribute('role', 'option');
        var banner = safeUrl(u.banner_url);
        if (banner) { var bg = document.createElement('img'); bg.className = 'bg'; bg.src = banner; bg.alt = ''; bg.onerror = function () { bg.remove(); }; a.appendChild(bg); }
        var pfpUrl = safeUrl(u.pfp_url), pfp;
        if (pfpUrl) { pfp = document.createElement('img'); pfp.src = pfpUrl; pfp.alt = ''; }
        else { pfp = document.createElement('span'); pfp.textContent = (u.username || '?').charAt(0).toUpperCase(); }
        pfp.className = 'vsug-pfp';
        var name = document.createElement('span');
        name.className = 'vsug-name';
        name.textContent = u.username;
        if (/^#[0-9a-f]{6}$/i.test(u.color || '')) name.style.color = u.color;
        a.appendChild(pfp); a.appendChild(name);
        if (u.rank && u.rank !== 'free') { var r = document.createElement('span'); r.className = 'vsug-rank'; r.textContent = u.rank; a.appendChild(r); }
        a.addEventListener('mousedown', function (e) { e.preventDefault(); go(u.username); }); // before the input blurs
        box.appendChild(a);
      });
      box.hidden = !items.length;
    }
    function search() {
      var q = input.value.trim();
      clearTimeout(timer);
      if (!q) { items = []; sel = -1; render(); return; }
      timer = setTimeout(function () {
        var my = ++seq;
        fetch('/account/search?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (d) { if (my !== seq) return; items = (d && d.users) || []; sel = -1; render(); })
          .catch(function () {});
      }, 150);
    }
    input.addEventListener('input', search);
    input.addEventListener('focus', function () { if (items.length) box.hidden = false; });
    input.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 120); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); go(items[sel].username); }
      else if (e.key === 'Escape') { box.hidden = true; }
    });
  };
})();
