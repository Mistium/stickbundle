// Encrypted DMs where they meet the message list and the composer. Separate from Messages.jsx so E2ee.jsx's dialogs stay out of its imports.
import { useEffect, useState } from 'react';
import { Lock, LockOpen, AlertTriangle, Clock, File as FileIcon, Download, Link2 } from 'lucide-react';
import { useChat, openE2eeGate, dismissKeyChange, dropFailed } from './store.js';
import { LinkEmbeds } from './LinkEmbeds.jsx';
import { E2eeLabel, openSafety, E2eeLockedPanel } from './E2ee.jsx';
import * as E2EE from './e2ee/session.js';
import { opensByItself } from './e2ee/files.js';
import { shownName } from './spoiler.js';
import './E2ee.css';

export { E2eeLockedPanel };

// what isn't a normal message: locked here, can't be opened, a signature that's wrong, waiting for them to set up, from before encryption
export function E2eeMessageNote({ m, view }) {
  const s = m.sealed;
  if (m.waiting) return (
    <div className="e2-msg-note"><Clock size={13} /> <span>Waiting for @{view.username} to set up encrypted DMs. It sends by itself once they have, while Ember is open on this device. <button type="button" onClick={() => dropFailed(view, m.nonce)}>Remove</button></span></div>
  );
  if (m.notEncrypted && !m.pending && view.kind === 'dm') return <div className="e2-msg-note"><LockOpen size={13} /> Not encrypted yet: sent before encrypted DMs, and it's encrypted once you've both set up.</div>;
  if (!s) return null;
  if (s.state === 'locked') return <div className="e2-msg-note"><Lock size={13} /> <span>Encrypted. <button type="button" onClick={() => openE2eeGate()}>Unlock your DMs</button> to read this.</span></div>;
  if (s.state === 'failed') return <div className="e2-msg-note bad"><AlertTriangle size={13} /> This device can't open this message. It was sealed to a key you don't have any more.</div>;
  if (s.signature === 'invalid') return <div className="e2-msg-note bad"><AlertTriangle size={13} /> This message's signature doesn't match. It might not really be from them.</div>;
  return null;
}

// Files in a DM: the encrypted ones are fetched and opened here, and from then on they're ordinary attachments with a local address.
function useOpened(list) {
  const [got, setGot] = useState({}); // link -> object URL | 'gone' | 'failed' | 'wait'
  const wanted = list.filter(a => a.sealed && opensByItself(a)).map(a => a.url).join('\n');
  const open = link => {
    setGot(g => (g[link] ? g : { ...g, [link]: 'wait' }));
    E2EE.openFile(link).then(u => setGot(g => ({ ...g, [link]: u }))).catch(e => setGot(g => ({ ...g, [link]: e.message === 'gone' ? 'gone' : 'failed' })));
  };
  useEffect(() => { if (wanted) wanted.split('\n').forEach(open); }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return [got, open];
}
export function OpenedAttachments({ list, extra, m, Attachments }) {
  const [got, open] = useOpened(list);
  const shown = [], waiting = [];
  for (const a of list) {
    if (!a.sealed) { shown.push(a); continue; }
    const g = got[a.url];
    if (g === 'gone') shown.push({ url: a.url, name: a.name, expired: true });
    else if (g && g !== 'wait' && g !== 'failed') shown.push({ ...a, url: g, sealed: false, opened: true });
    else waiting.push({ ...a, state: g });
  }
  return (
    <>
      {waiting.map(a => (
        <div key={a.url} className="e2-file">
          <FileIcon size={18} />
          <span title={shownName(a.name)}>{shownName(a.name)}</span>
          {a.state === 'failed' ? <small>Couldn't open it.</small> : a.state === 'wait' ? <small>Opening...</small> : !opensByItself(a) ? <button type="button" className="btn btn-surface btn-sm" onClick={() => open(a.url)}><Download size={14} /> Open</button> : null}
        </div>
      ))}
      <Attachments list={shown} extra={extra} m={m} />
    </>
  );
}

// Link previews are off in settings: nothing is fetched until someone asks. In a DM, say what asking does: the server makes previews, so Nookara sees that link.
export function PreviewOnAsk({ urls, inst, priv }) {
  const [on, setOn] = useState(false);
  if (!urls?.length) return null;
  if (on) return <LinkEmbeds urls={urls} inst={inst} priv={priv} />;
  return <div className="e2-msg-note"><Link2 size={13} /> <span><button type="button" onClick={() => setOn(true)}>Show link preview</button>{priv && ' (Nookara fetches it, so Nookara sees the link)'}</span></div>;
}

export function E2eeComposerNotes({ view }) {
  const changed = useChat(s => (view.kind === 'dm' ? s.e2eeKeyChanged[String(view.username).toLowerCase()] : false));
  if (view.kind !== 'dm' && view.kind !== 'group') return null;
  if (view.kind === 'dm' && view.username === 'System') return null;
  return (
    <>
      {changed && (
        <div className="e2-keychange"><AlertTriangle size={14} />
          <span>@{view.username}'s encryption key changed. They may have started over or lost their old one. <button type="button" onClick={() => openSafety(view.username)}>Compare keys</button> <button type="button" onClick={() => dismissKeyChange(view.username)}>Dismiss</button></span>
        </div>
      )}
      <E2eeLabel kind={view.kind} username={view.username} />
    </>
  );
}
