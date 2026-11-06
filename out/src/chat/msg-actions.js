// What can be done with a message where it is: one list for the right-click menu and the hover toolbar, in a server channel,
// a DM or a group chat. Pure, no imports (the node tests load it). The server still checks all of it when the action arrives.
//
//                 channel                   DM                         group chat
//   reply         if I can post             yes                        yes
//   react         yes                       yes                        yes
//   forward       yes                       yes                        yes
//   edit          my own                    my own                     my own
//   delete        my own, or Manage msgs    my own                     my own
//   pin           Manage msgs               yes (either person)        yes (any member)
//   copy link     the channel               no (#/dm/<name> means      the group (members only)
//                                           someone else to the reader)
export function messageCaps(view, m, { mine = false, canMod = false, canPost = true } = {}) {
  const none = { reply: false, react: false, forward: false, edit: false, del: false, pin: false, copyLink: false };
  if (!view || !m) return none;
  const live = !m.system && !m.ephemeral;
  const saved = live && !m.pending && !m.failed;
  const channel = view.kind === 'channel', group = view.kind === 'group';
  const dm = view.kind === 'dm' && view.username !== 'System' && !!m.imId;
  const row = channel && /^\d+$/.test(String(m.id));
  const saved_group = group && !!m.gid; // (very old group messages have no id to act on)
  return {
    reply: live && (channel ? !!canPost : group ? !!m.gid : dm),
    react: saved && (row || dm || saved_group),
    forward: saved,
    edit: !!mine && (channel || dm || saved_group),
    del: channel ? !!(mine || canMod) : !!mine && (dm || saved_group),
    pin: saved && (channel ? row && !!canMod : dm || saved_group),
    copyLink: channel || group,
  };
}

// how setReaction() and the picker name a message: a channel message id, dm:<id>, or g:<room>:<id>
export const reactionId = m => (m.imId ? `dm:${m.imId}` : m.gid && m.room ? `g:${m.room}:${m.gid}` : m.id);
// the REST path of a message's reactions, from that id
export function reactionBase(id) {
  const s = String(id);
  if (s.startsWith('dm:')) return `/chat/dm/${s.slice(3)}`;
  if (s.startsWith('g:')) { const [, room, gid] = s.split(':'); return `/groups/${encodeURIComponent(room)}/messages/${encodeURIComponent(gid)}`; }
  return `/chat/messages/${id}`;
}
// where a conversation's pins are kept track of (a channel by its cid)
export const pinsKey = view => (view?.kind === 'dm' ? `d:${String(view.username).toLowerCase()}` : view?.kind === 'group' ? `g:${view.room}` : view?.cid);
// the REST paths of pins in a DM / group: the list, and one message
export const pinsPath = view => (view.kind === 'dm' ? `/im/with/${encodeURIComponent(view.username)}/pins` : `/groups/${encodeURIComponent(view.room)}/pins`);
export const pinPath = (view, m) => (view.kind === 'dm' ? `/im/${m.imId}/pin` : view.kind === 'group' ? `/groups/${encodeURIComponent(view.room)}/messages/${encodeURIComponent(m.gid)}/pin` : `/chat/messages/${m.id}/pin`);

// the reactions I've already made on this message (the quick reaction row in the menu marks them)
export const myReactions = (m, me) => (m?.reactions || []).filter(r => r.users?.includes(me)).map(r => r.emoji);
