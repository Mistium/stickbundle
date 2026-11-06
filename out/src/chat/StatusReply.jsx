// Reply icon on someone's custom-status bubble (mini + large profile). Hover the bubble to see it
// (always visible on touch screens). It only exists when the server says a reply would go through:
// not you, not a bot, a status you can see, and their "who can message me" setting lets you in.
// Click = open the DM with the composer in "status reply" mode (see startStatusReply in store.js).
import { useEffect, useState } from 'react';
import { Reply } from 'lucide-react';
import { useChat, useScope, statusReplyInfo, startStatusReply } from './store.js';

export default function StatusReply({ username, custom, onOpenDm }) {
  const me = useChat(s => s.me?.username);
  const scopeOk = useScope('VMAIL_SEND');
  const [can, setCan] = useState(false);
  const status = String(custom || '').trim();

  useEffect(() => {
    let gone = false;
    setCan(false);
    if (!status || !scopeOk || !me || me === username) return undefined;
    statusReplyInfo(username, status).then(d => { if (!gone) setCan(!!d?.can && String(d.text || '').trim() === status); });
    return () => { gone = true; };
  }, [username, status, scopeOk, me]);

  if (!can) return null;
  return (
    <button type="button" className="vc-bubble-reply" data-tip="Reply to status" aria-label={`Reply to ${username}'s status`}
      onClick={() => { onOpenDm?.(); startStatusReply(username, status); }}>
      <Reply size={13} />
    </button>
  );
}
