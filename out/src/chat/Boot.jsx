// The loading screen: the Ember logo picture (a small 17 KB jpg) breathing gently, switched off for prefers-reduced-motion.
// index.html paints the same markup before the scripts have loaded; both start the animation at the same point of one clock
// (--boot-t) so the hand-over doesn't restart it. BootMark (the bubble with a light running round it) is the small spinner
// the "connecting to a server" card uses.
import { BONFIRE_MARK } from './BonfireLogo.jsx';

export function BootMark({ size = 88, className = '' }) {
  return (
    <svg className={`vc-bootmark ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ '--boot-t': `${-(Math.round(performance.now()) % 2400)}ms` }}>
      <path className="base" d={BONFIRE_MARK} pathLength="100" />
      <path className="run" d={BONFIRE_MARK} pathLength="100" />
    </svg>
  );
}

export function BootScreen() {
  return (
    <div className="vc-boot" role="status" aria-label="Loading Ember">
      <div className="vc-boot-in"><img className="vc-boot-logo" src="/assets/bonfire/logo-photo-256.jpg?v=2" alt="" width={112} height={112} draggable={false} style={{ '--boot-t': `${-(Math.round(performance.now()) % 2600)}ms` }} /><span className="vc-boot-name">Ember</span></div>
    </div>
  );
}
