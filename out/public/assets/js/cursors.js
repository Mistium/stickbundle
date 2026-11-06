// Velora multiplayer cursors: see everyone else who's on the same page as you.
// Guests join anonymously; signed-in accounts attach a short-lived name ticket.
// Talks to the relay (cursor-ws) through this site (/cursors-ws), in its own
// room per page ("velora:/me#settings", "velora:/u/ikelene", ...), showing your name in your accent
// colour (a ticket from /account/cursor-ticket - your login token never goes to the relay).
// One connection per account: opening Velora in another tab takes the cursor over, and the older tab
// stays quiet until you come back to it.
// Positions: x from the page's centre line (Velora pages are centred columns), y from the top.
(function () {
  'use strict';
  if (window.__veloraCursors) return;
  window.__veloraCursors = true;

  var WS_URL = 'wss://velora.ikelene.net/cursors-ws';
  var SEND_MS = 45;
  var STALE_MS = 45000;

  function roomName() {
    var p = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    var h = location.hash.slice(1).split('/')[0].toLowerCase();
    if (p === '/me' && h) p += '#' + h; // the account page's sections are separate pages
    return 'velora:' + p.slice(0, 100);
  }
  function token() { try { return localStorage.getItem('velora_token') || ''; } catch (e) { return ''; } }

  // ── drawing ──
  var layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none';
  var style = document.createElement('style');
  style.textContent =
    '.vc-cur{position:absolute;left:0;top:0;pointer-events:none;transition:transform .09s linear;will-change:transform}' +
    '.vc-cur svg{display:block;width:18px;height:18px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}' +
    '.vc-cur span{position:absolute;left:14px;top:16px;padding:1px 6px;font:600 11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)}' +
    '@media (prefers-reduced-motion:reduce){.vc-cur{transition:none}}';
  var cursors = {}; // id -> { el, x, y, at }

  function readable(color) {
    // dark text on light colours, light text on dark ones
    var c = color, r, g, b, m;
    if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c))) { r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16); }
    else if ((m = /^hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%\s*\)$/i.exec(c))) return parseFloat(m[1]) > 55 ? '#16141c' : '#fff';
    else return '#fff';
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#16141c' : '#fff';
  }
  function place(cur) {
    var w = document.documentElement.clientWidth;
    cur.el.style.transform = 'translate(' + Math.round(cur.x + w / 2) + 'px,' + Math.round(cur.y) + 'px)';
  }
  function upsert(m) {
    var cur = cursors[m.id];
    var color = typeof m.c === 'string' ? m.c : '#9d8ad1';
    var name = typeof m.n === 'string' ? m.n : '';
    if (!cur) {
      var el = document.createElement('div');
      el.className = 'vc-cur';
      el.innerHTML = '<svg viewBox="0 0 18 18"><path d="M1.5 1.5 L1.5 15 L5.2 11.4 L7.8 17 L10.2 15.9 L7.7 10.4 L13 10.4 Z" stroke="#0e0e10" stroke-width="1.2" stroke-linejoin="round"/></svg><span></span>';
      layer.appendChild(el);
      cur = cursors[m.id] = { el: el, color: '', name: null };
    }
    if (cur.color !== color) { cur.color = color; cur.el.querySelector('path').setAttribute('fill', color); var sp = cur.el.querySelector('span'); sp.style.background = color; sp.style.color = readable(color); }
    if (cur.name !== name) { cur.name = name; var s = cur.el.querySelector('span'); s.textContent = name; s.style.display = name ? '' : 'none'; }
    cur.x = m.x; cur.y = m.y; cur.at = Date.now();
    cur.el.style.opacity = '1';
    place(cur);
  }
  function drop(id) { var c = cursors[id]; if (c) { c.el.remove(); delete cursors[id]; } }
  function dropAll() { for (var id in cursors) drop(id); }
  addEventListener('resize', function () { for (var id in cursors) place(cursors[id]); });
  setInterval(function () { var now = Date.now(); for (var id in cursors) if (now - cursors[id].at > STALE_MS) drop(id); }, 5000);

  // ── connection ──
  var ws = null, room = roomName(), retry = 1000, ticketTimer = null, taken = false, noAuth = false;
  function send(o) { if (ws && ws.readyState === 1) try { ws.send(JSON.stringify(o)); } catch (e) {} }
  function sendTicket() {
    clearTimeout(ticketTimer);
    var t = token();
    if (!t || noAuth) return;
    fetch('/account/cursor-ticket', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { if (r.status === 401 || r.status === 403) { noAuth = true; try { ws && ws.close(); } catch (e) {} } return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ticket) return;
        send({ t: 'hello', ticket: d.ticket });
        ticketTimer = setTimeout(sendTicket, Math.max(60, (d.expiresIn || 600) - 60) * 1000); // renew before it runs out
      }).catch(function () {});
  }
  function connect() {
    taken = false;
    try { ws = new WebSocket(WS_URL + '?room=' + encodeURIComponent(room)); } catch (e) { return; }
    ws.onopen = function () { retry = 1000; sendTicket(); if (last) push(true); };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'm' && typeof m.x === 'number' && typeof m.y === 'number') upsert(m);
      else if (m.t === 'bye') drop(m.id);
      else if (m.t === 'dup') taken = true; // another tab of this account took over
    };
    ws.onclose = function () {
      ws = null; dropAll();
      if (taken || document.visibilityState === 'hidden') return; // reconnect when they come back
      setTimeout(connect, retry); retry = Math.min(retry * 2, 30000);
    };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !ws) { retry = 1000; noAuth = false; connect(); }
    else if (document.visibilityState === 'hidden') send({ t: 'leave' });
  });

  // single-page app navigation (the dashboard): switch rooms
  function checkRoom() {
    var r = roomName();
    if (r === room) return;
    room = r; dropAll();
    send({ t: 'room', room: room });
    if (last) push(true);
  }
  addEventListener('hashchange', checkRoom);
  addEventListener('popstate', checkRoom);
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function () { var r = orig.apply(this, arguments); setTimeout(checkRoom, 0); return r; };
  });

  // ── our own pointer ──
  var last = null, lastSent = 0, pending = null;
  function push(force) {
    if (!last) return;
    var now = Date.now();
    if (!force && now - lastSent < SEND_MS) { if (!pending) pending = setTimeout(function () { pending = null; push(true); }, SEND_MS); return; }
    lastSent = now;
    var w = document.documentElement.clientWidth;
    send({ x: last.cx + scrollX - w / 2, y: last.cy + scrollY });
  }
  addEventListener('mousemove', function (e) { last = { cx: e.clientX, cy: e.clientY }; push(false); }, { passive: true });
  addEventListener('scroll', function () { push(false); }, { passive: true });
  document.addEventListener('mouseleave', function () { last = null; send({ t: 'leave' }); });

  function start() { document.head.appendChild(style); document.body.appendChild(layer); connect(); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
