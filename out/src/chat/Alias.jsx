// Aliases: a bot can post a message under another name and picture (message.alias = { name, avatar_url } | null).
// The author is still the real bot (mentions, blocks, menus, reports and the profile card use it); the alias only changes the
// name and picture people see, next to a mask whose tooltip (Tooltip.jsx, data-tip-alias) names the real sender.
// The plain helpers (which alias, which name / picture) live in aliases.js so store.js can use them too.
export { aliasOf, replyAliasOf, aliasKey, aliasFace, shownName, shownPfp, isUnmarked, aliasMemberOf } from './aliases.js';

// lucide has no mask: a drama mask drawn the lucide way (24 grid, stroke 2, round caps / joins, currentColor)
export function MaskIcon({ size = 14, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5c3 1.3 6 1.3 9 0s6-1.3 9 0v5.5C21 16 17 20 12 20S3 16 3 10.5Z" />
      <path d="M7 10.5c.9-.8 2.1-.8 3 0" />
      <path d="M14 10.5c.9-.8 2.1-.8 3 0" />
      <path d="M9 14.5c1.8 1.4 4.2 1.4 6 0" />
    </svg>
  );
}

// the mask after an aliased name: hover or focus it for "Alias - Posted by <real> as <alias>"
export function AliasMark({ alias, by, size = 14 }) {
  if (!alias || alias.unmarked) return null; // unmarked aliases (server setting) carry no mark
  const tip = JSON.stringify({ name: alias.name, by: by?.username || 'a bot', pfp: by?.pfp || null });
  return (
    <span className="vc-alias-mark" tabIndex={0} role="img" aria-label={`Alias. Posted by ${by?.username || 'a bot'} as ${alias.name}`} data-tip-alias={tip}>
      <MaskIcon size={size} />
    </span>
  );
}

// tooltip body (Tooltip.jsx renders it for [data-tip-alias])
export function AliasTip({ a }) {
  return (
    <div className="vc-tip-alias">
      <b>Alias</b>
      <span>Posted by <i className="vc-tip-alias-av">{a.pfp ? <img src={a.pfp} alt="" /> : (a.by || '?').charAt(0).toUpperCase()}</i><strong>{a.by}</strong> as {a.name}</span>
    </div>
  );
}
