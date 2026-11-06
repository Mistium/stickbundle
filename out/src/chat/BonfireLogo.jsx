// Ember's logo: a chat bubble drawn as one soft outline (the tail's corner is rounded off). It is plain inline SVG in
// currentColor, so it takes the surrounding text colour and costs nothing to load. `tile` adds the dark rounded square behind it.
export const BONFIRE_MARK = 'M50 14A36 36 0 0 1 86 50A36 36 0 0 1 50 86H25Q14 86 14 75V50A36 36 0 0 1 50 14Z';
export function BonfireLogo({ size = 16, tile = false, className = '' }) {
  return (
    <svg className={`bf-logo ${tile ? 'tile' : ''} ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {tile && <rect width="100" height="100" rx="22" fill="#141417" />}
      <path d={BONFIRE_MARK} fill="none" stroke="currentColor" strokeWidth={tile ? 7.5 : 8.5} strokeLinejoin="round" strokeLinecap="round" transform={tile ? 'translate(50 50) scale(.84) translate(-50 -50)' : undefined} />
    </svg>
  );
}
// the old flame logo, drawn (kept for reference)
export function BonfireLogoDrawn({ size = 16, tile = false, className = '' }) {
  return (
    <svg className={`bf-logo ${className}`} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bf-f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff7a45" /><stop offset=".55" stopColor="#ff5fa2" /><stop offset="1" stopColor="#f7a6ff" /></linearGradient>
        <linearGradient id="bf-c" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ffd27a" /><stop offset="1" stopColor="#ffb3e6" /></linearGradient>
      </defs>
      {tile && <rect width="512" height="512" fill="#141417" />}
      <g transform="rotate(-16 256 398)"><rect x="104" y="378" width="304" height="42" fill="#6e4434" /><rect x="104" y="378" width="304" height="12" fill="#8a5a45" /></g>
      <g transform="rotate(16 256 398)"><rect x="104" y="378" width="304" height="42" fill="#7d4f3c" /><rect x="104" y="378" width="304" height="12" fill="#9b6a52" /></g>
      <path fill="url(#bf-f)" d="M262 58c10 70 92 108 106 196 10 66-34 132-112 132S136 334 144 270c6-46 34-74 52-98 4 40 18 66 44 76-14-58-10-122 22-190z" />
      <path fill="url(#bf-c)" d="M258 210c4 34 52 54 56 102 3 36-24 62-58 62s-60-24-56-58c2-24 16-38 28-50 2 20 10 32 24 36-6-30-4-62 6-92z" />
    </svg>
  );
}
export const isDesktopApp = () => typeof window !== 'undefined' && !!window.bonfireDesktop?.isDesktop;
