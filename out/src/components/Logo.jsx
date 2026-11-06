// Same mark as public/assets/logo.svg, inlined so the top bar can pick up
// var(--accent) live - an <img src="..."> can't reach the page's CSS custom
// properties, but an inline <svg> in the same document can.
export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="20" y="20" width="60" height="16" fill="var(--accent, #9d8ad1)" />
      <rect x="20" y="42" width="60" height="16" fill="#8a8a92" />
      <rect x="20" y="64" width="60" height="16" fill="#8a8a92" fillOpacity="0.5" />
    </svg>
  );
}
