// Site-wide accent color. Defaults to the original purple; when the current
// user has a saved Accent Color (profile.color), that becomes --accent
// everywhere instead - nav, links, buttons, all of it, since the whole app
// already themes off these two CSS custom properties.
const DEFAULT_ACCENT = '#9d8ad1';

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// White is what an account has before anyone picks a colour, and as an accent
// it makes every button white-on-white. Treat it as "not set".
function isWhite(color) {
  return /^#?(fff|ffffff)$/i.test(String(color || '').trim());
}

export function applyAccentColor(color) {
  const hex = hexToRgb(color) && !isWhite(color) ? color : DEFAULT_ACCENT;
  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, .12)`);
  root.setProperty('--purple', hex);
  root.setProperty('--purple-dim', `rgba(${r}, ${g}, ${b}, .12)`);
  // the plain-HTML pages (/assets/js/accent.js) read this, so they're in the same colour straight away
  try {
    if (hex === DEFAULT_ACCENT) localStorage.removeItem('velora_accent');
    else localStorage.setItem('velora_accent', hex);
    localStorage.setItem('velora_accent_at', String(Date.now()));
  } catch { /* private mode */ }
}
