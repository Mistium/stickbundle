// Match the server: @everyone is implicit; role allows win over role denies.
export function canAttachInChannel(detail, cid, members, username) {
  if (!detail || detail.server.allow_uploads === false) return false;
  let bits = Number(detail.server.perms) || 0;
  if (bits & 512) return true;
  const channel = detail.channels?.find(c => c.cid === cid);
  const everyone = detail.roles?.find(r => r.is_default);
  const overrides = channel?.overwrites || [];
  const base = overrides.find(o => o.rid === everyone?.rid);
  if (base) bits = (bits & ~base.deny) | base.allow;
  const member = members?.find(m => m.username === username);
  if (!member) return (bits & 256) !== 0; // members not loaded yet: the server still checks on send
  const roles = new Set(member.roles || []);
  let allow = 0, deny = 0;
  for (const o of overrides) if (o.rid !== everyone?.rid && roles.has(o.rid)) { allow |= o.allow; deny |= o.deny; }
  return (((bits & ~deny) | allow) & 256) !== 0;
}
