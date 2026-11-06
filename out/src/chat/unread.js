// Does a server's rail icon get the white "new messages" pip? Only for unread channels that aren't muted
// (a muted channel / server stays quiet; mentions have their own red badge). Pure, so it can be tested.
//   srv       the server row: { sid, unread, unread_channels? } (unread_channels = the server's list of unread cids, newer servers send it)
//   channels  its loaded channel list (detail), or null when it isn't loaded
//   unread    store.unread: `c:<cid>` -> true for channels that got messages live
//   unreadN   store.unreadN: cid -> { sid, n } for live messages in servers whose channels aren't loaded
//   muted     (cid, sid) -> true when that channel is muted (by itself or through its server)
// Returns true / false, or null when it can't tell (no channel list, no unread_channels): the caller loads the channels.
export function loudUnread(srv, { channels = null, unread = {}, unreadN = {}, muted = () => false, serverMuted = false } = {}) {
  if (!srv?.unread || serverMuted) return false;
  const sid = srv.sid;
  if (channels) return channels.some(c => (c.unread || unread[`c:${c.cid}`]) && !muted(c.cid, sid));
  // live messages (the socket handler already skips muted channels, but a channel can be muted after they came in)
  if (Object.entries(unreadN).some(([cid, u]) => u?.sid === sid && !muted(cid, sid))) return true;
  if (Array.isArray(srv.unread_channels)) return srv.unread_channels.some(cid => !muted(cid, sid));
  return null;
}
