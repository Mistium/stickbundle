// Apply account changes only to matching IDs. An old name can belong to somebody
// else after a rename; it must never be used as an identity key for old messages.
// instance = true: an event from an Ember instance, whose ids are principals ("v:12"); Velora's own people / me are left alone
export function applyIdentity(state, user, instance = false) {
  // instance = the origin string of the instance that sent the event (or true): b:16 / u:3 are only unique INSIDE one instance,
  // so an event may only touch that instance own members / messages, never another instance that has a b:16 too
  const origin = typeof instance === "string" ? instance : null;
  const mine = key => !origin || String(key).includes(origin + "|");
  if (!user?.id || !(instance ? /^[a-z]:\d+$/ : /^\d+$/).test(String(user.id))) return state;
  const same = value => value?.id != null && String(value.id) === String(user.id);
  const person = value => same(value) ? { ...value, ...user, username: user.username || 'Deleted account' } : value;
  const message = (value, reply = false) => {
    if (!value) return value;
    const next = { ...value, author: person(value.author) };
    if (same(value.subject) && Array.isArray(value.body_parts)) {
      next.subject = { ...value.subject, username: user.username || null };
      next.body = value.body_parts.map(part => part === null ? user.username ? '@' + user.username : 'Deleted account' : part).join('');
      if (reply) next.body = next.body.slice(0, 200);
    }
    if (value.reply) next.reply = message(value.reply, true);
    return next;
  };
  const people = { ...state.people };
  if (!instance) {
    for (const [name, value] of Object.entries(people)) if (same(value)) delete people[name];
    if (user.username) people[user.username] = { ...(state.people[user.username] || {}), ...user };
  }
  return {
    ...state, ...(instance ? {} : { people, me: person(state.me) }),
    members: Object.fromEntries(Object.entries(state.members).map(([key, list]) => [key, mine(key) ? list.map(person) : list])),
    msgs: Object.fromEntries(Object.entries(state.msgs).map(([key, buffer]) => [key, mine(key) ? { ...buffer, list: buffer.list.map(item => message(item)) } : buffer])),
  };
}
