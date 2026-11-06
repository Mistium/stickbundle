// Hyperfocus game invite cards (see gameInvite.js for the message format). Name / banner / logo come from
// GET /chat/hf-game/:id (Velora caches the launcher's game lists); an unknown game shows the name from the
// message and a gamepad icon. Join opens hyperfocus://join/... - in the Ember desktop app through the app
// (only that exact URL shape is allowed out), in a browser through the OS protocol handler.
import { useEffect, useRef, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { apiFetch } from '../api.js';
import { JOIN_URL, joinUrl } from './gameInvite.js';

const GET_HYPERFOCUS = 'https://ikelene.net/launcher/';
const cache = new Map(); // game id -> { done, value, p }
function useGame(id) {
  const [g, setG] = useState(() => (cache.get(id)?.done ? cache.get(id).value : undefined));
  useEffect(() => {
    let live = true;
    if (!cache.has(id)) {
      const entry = { done: false };
      entry.p = apiFetch(`/chat/hf-game/${encodeURIComponent(id)}`).then(d => (d?.found ? d : null)).catch(() => null)
        .then(v => { entry.done = true; entry.value = v; return v; });
      cache.set(id, entry);
    }
    cache.get(id).p.then(v => { if (live) setG(v); });
    return () => { live = false; };
  }, [id]);
  return g; // undefined = loading, null = not found
}

export function GameInvites({ invites, inert = false }) {
  if (!invites?.length) return null;
  return invites.map(inv => <GameInvite key={`${inv.id}/${inv.code}/${inv.from}`} inv={inv} inert={inert} />);
}

function GameInvite({ inv, inert }) {
  const g = useGame(inv.id);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const name = g?.name || inv.game;

  function join() {
    const url = joinUrl(inv);
    if (busy || !JOIN_URL.test(url)) return;
    setBusy(true); setHint(false);
    const desktop = window.bonfireDesktop;
    if (desktop?.openExternal) {
      // the app can't tell whether Hyperfocus is installed (Windows shows its own "get an app" prompt if not)
      Promise.resolve(desktop.openExternal(url)).catch(() => {});
      timer.current = setTimeout(() => { setBusy(false); setHint(true); }, 1500);
      return;
    }
    // browsers: the page loses focus when the OS / browser hands the link to an app; if it never does, nothing handled it
    let left = false;
    const gone = () => { left = true; };
    window.addEventListener('blur', gone);
    document.addEventListener('visibilitychange', gone);
    const a = document.createElement('a');
    a.href = url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    timer.current = setTimeout(() => {
      window.removeEventListener('blur', gone);
      document.removeEventListener('visibilitychange', gone);
      setBusy(false);
      if (!left) setHint(true);
    }, 1500);
  }

  return (
    <div className="vc-invite-card vc-game-invite vl-rise" style={g?.accent ? { '--ga': g.accent } : undefined}>
      {g?.banner && <div className="vc-invite-banner vc-game-banner" style={{ backgroundImage: `url(${g.banner})` }} />}
      <div className="vc-invite-main">
        <span className="vc-game-logo">{g?.logo ? <img src={g.logo} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <Gamepad2 size={26} />}</span>
        <div className="vc-invite-info">
          <small className="vc-game-kicker">Game invite</small>
          <span className="vc-game-line"><b>{inv.from}</b> invited you to play <b>{name}</b></span>
        </div>
        {!inert && <button type="button" className="btn btn-primary" disabled={busy} onClick={join}>Join</button>}
      </div>
      {hint && !inert && <div className="vc-game-hint">Don't have Hyperfocus? <a href={GET_HYPERFOCUS} target="_blank" rel="noopener noreferrer">Get it</a></div>}
    </div>
  );
}
