// Aliases (see Alias.jsx): which alias a message shows, and the name / picture to draw for it.
// the alias to show for a message, or null (only bots can post under one; the server enforces it, this is belt and braces)
export const aliasOf = m => (m && !m.system && m.author?.bot && !m.author?.webhook && m.alias?.name ? m.alias : null);
export const replyAliasOf = r => (r && r.author?.bot && r.alias?.name ? r.alias : null);
// unmarked (the server's Danger zone setting is on and the bot may use it): drawn like a normal message - no mask, no BOT tag,
// and alias.member (when the name matched one member of that server) gives the colour, picture fallback and profile card.
// The real author stays m.author: blocks, mentions, notifications and reports key on it; staff see it under Message info.
export const isUnmarked = a => !!(a && a.unmarked);
export const aliasMemberOf = a => (isUnmarked(a) && a.member?.username ? a.member : null);
// grouping key: the same bot under two different aliases must not share a header (unmarked ones group by name, like people)
export const aliasKey = m => { const a = aliasOf(m); return a ? (isUnmarked(a) ? `u\n${a.name.trim().toLowerCase()}` : `${a.name}\n${a.avatar_url || ''}`) : ''; };
// the face (name + picture) to draw for an aliased message; no avatar_url = the matched member's picture (unmarked), else the
// bot's own. member: the matched member's live face when the caller has it (useFace), else alias.member
export const aliasFace = (alias, face, member = aliasMemberOf(alias)) => (alias ? { ...face, username: alias.name, display_name: alias.name, pfp: alias.avatar_url || member?.pfp || face?.pfp || null, color: member ? member.color : face?.color } : face);
// the name a message is shown under (notifications, search, pins, the reply bar)
export const shownName = (m, fallback = 'Nookara') => aliasOf(m)?.name || m?.author?.username || fallback;
export const shownPfp = m => { const a = aliasOf(m); return (a && (a.avatar_url || aliasMemberOf(a)?.pfp)) || m?.author?.pfp || null; };
