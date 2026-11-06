// Pop-up dialogs: make / find / join servers, invites, server + channel settings, new DM / group.
import { TypePicker, TypeSettings } from './ChannelTypes.jsx';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import serverCreationPolicy from '../server-creation-policy.json';
import { Users, Copy, Check, Upload, Trash2, Hash, Search, Globe, ShieldCheck, Bot } from 'lucide-react';
import { BotGallery } from './BotGallery.jsx';
import { apiFetch } from '../api.js';
import { getState, useChat, go, loadServersOf, refreshServer, loadGroups, toast, errorText, ask, answerAsk, loadFriends, sendMessage, linkFor } from './store.js';
import { VELORA, instOf, isInst, fromInstance, normOrigin } from './ids.js';
import { SignInPrompt } from './Gate.jsx';
import { Avatar } from './Profile.jsx';
import { initials } from './Parts.jsx';
import { P, has, CHANNEL_ICONS, ChannelIcon } from './roles.jsx';
import { ChannelBridge } from './Bridge.jsx';
import { ChannelPerms } from './ChannelPerms.jsx';

export function Dialog({ title, sub, onClose, children, wide, className = '' }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 180); };
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className={`vc-modal-back${closing ? ' out' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className={`vc-dialog${wide ? ' wide' : ''} ${className}`}>
        <h3>{title}</h3>
        {sub && <p className="vc-dialog-sub">{sub}</p>}
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>,
    document.body,
  );
}

// Discover: every Ember server listed in Velora's public directory, in one list (works signed out; a card opens Add a server
// for its address)
export function Discover({ onClose }) {
  const [tab, setTab] = useState('servers');
  return (
    <Dialog title="Discover" sub={tab === 'servers' ? 'Ember servers that list themselves in the directory. Each runs on its own - adding one shows you how it signs you in.' : 'Bots approved by Nookara staff. Verified bots have been looked at before they were listed.'} onClose={onClose} wide>
      {close => (
        <>
          <div className="vc-tabs bg-disc-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'servers'} className={tab === 'servers' ? 'on' : ''} onClick={() => setTab('servers')}><Globe size={14} /> Servers</button>
            <button type="button" role="tab" aria-selected={tab === 'bots'} className={tab === 'bots' ? 'on' : ''} onClick={() => setTab('bots')}><Bot size={14} /> Bots</button>
          </div>
          {tab === 'servers' ? <Directory close={close} /> : <BotGallery />}
        </>
      )}
    </Dialog>
  );
}
// every field is the listing's own text (untrusted): shown as text, the address only opens the Add a server box
function Directory({ close }) {
  const [q, setQ] = useState('');
  const [deb, setDeb] = useState('');
  const [d, setD] = useState(null); // { results, page, has_more }
  const [err, setErr] = useState(false);
  const mine = useChat(s => s.instances);
  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = (page = 1) => fetch(`/bonfire/directory?q=${encodeURIComponent(deb)}&page=${page}`).then(r => (r.ok ? r.json() : Promise.reject()))
    .then(x => { setErr(false); setD(cur => ({ ...x, results: page > 1 && cur ? [...cur.results, ...x.results] : x.results })); }).catch(() => setErr(true));
  useEffect(() => { setD(null); load(1); }, [deb]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = r => {
    const url = normOrigin(r.url);
    if (!url) return;
    close();
    setTimeout(() => (mine.some(i => i.origin === url) ? go({ kind: 'instance', inst: url }) : dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url } }))), 200);
  };
  return (
    <>
      <label className="vc-search"><Search size={15} /><input autoFocus placeholder="Search by name, description or tag" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="vc-disc-grid">
        {!d && !err && <div className="vc-loading"><i /><i /><i /></div>}
        {err && <div className="vc-empty-note">Couldn't load the directory - try again in a bit.</div>}
        {d && !d.results.length && <div className="vc-empty-note">{deb ? 'No servers match that.' : 'No servers are listed yet.'}</div>}
        {d?.results.map(r => {
          const url = normOrigin(r.url);
          const added = mine.some(i => i.origin === url);
          return (
            <div key={r.id || r.url} className="vc-disc-card vl-rise">
              <div className="vc-disc-banner" />
              <span className="vc-srv-ico lg">{/^https:\/\//i.test(r.icon_url || '') ? <img src={r.icon_url} alt="" /> : initials(r.name)}</span>
              <div className="vc-disc-body">
                <b>{r.name}{r.trusted && <ShieldCheck size={13} className="vc-inline-ico vc-disc-trusted" title="Trusted by Nookara" />}</b>
                <small className="vc-disc-host"><Globe size={11} /> {url ? url.replace(/^https?:\/\//, '') : ''}</small>
                <p>{r.description || 'No description.'}</p>
                {r.tags?.length > 0 && <div className="vc-disc-tags">{r.tags.slice(0, 8).map(t => <span key={t} className="vc-chip">{t}</span>)}</div>}
                <div className="vc-disc-foot">
                  <span><Users size={13} /> {Number(r.member_count) || 0} member{Number(r.member_count) === 1 ? '' : 's'}</span>
                  <button type="button" className={`btn ${added ? 'btn-surface' : 'btn-primary'}`} disabled={!url} onClick={() => pick(r)}>{added ? 'Open' : 'Add server'}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {d?.has_more && <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={() => load((d.page || 1) + 1)}>Load more</button><span className="grow" /></div>}
    </>
  );
}
// (Create a server: Hosting.jsx - Velora hosts it; Add a server by its address is Instances.jsx)
// creating a server hosted inside Velora itself is paused (server-creation-policy.json): legacy entry points show why
export function ServerCreationNotice({ onClose }) {
  return <Dialog title={serverCreationPolicy.title} onClose={onClose}>
    {close => <><div className="vc-br-note" role="status">{serverCreationPolicy.notice.map(text => <p key={text}>{text}</p>)}</div><div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Got it</button></div></>}
  </Dialog>;
}

export function Invite({ sid, onClose }) {
  const d = useChat(s => s.detail[sid]);
  const [copied, setCopied] = useState('');
  const code = d?.server.invite;
  const inst = instOf(sid);
  const link = code ? linkFor({ kind: 'invite', code, inst }) : '';
  const copy = (t, what) => { navigator.clipboard?.writeText(t); setCopied(what); setTimeout(() => setCopied(''), 1500); };
  return (
    <Dialog title={`Invite people to ${d?.server.name || 'this server'}`} sub={inst === VELORA ? "Send them this link. They'll need a Nookara account." : `Send them this link. They'll need an account on ${inst.replace(/^https?:\/\//, '')}.`} onClose={onClose}>
      {code ? (
        <>
          <div className="vc-row"><input className="form-input" readOnly value={link} onFocus={e => e.target.select()} /><button type="button" className="btn btn-primary" onClick={() => copy(link, 'link')}>{copied === 'link' ? <Check size={15} /> : <Copy size={15} />} Copy</button></div>
          <p className="vc-dialog-sub" style={{ marginTop: 10 }}>Or share the code <button type="button" className="vc-code-btn" onClick={() => copy(code, 'code')}>{code}</button>{copied === 'code' ? ' - copied!' : ''}</p>
        </>
      ) : <p className="vc-dialog-sub">Only this server's admins can invite people.</p>}
      {code && <InviteFriends sid={sid} link={link} />}
    </Dialog>
  );
}
// the invite dialog's friends list: send the invite straight into a DM
function InviteFriends({ sid, link }) {
  const friends = useChat(s => s.friends);
  const members = useChat(s => s.members[sid]);
  const presence = useChat(s => s.presence);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState({});
  useEffect(() => { if (!getState().friends.length) loadFriends(); }, []);
  const list = useMemo(() => (friends || []).map(f => ({ username: f.friend_username, pfp: f.pfp_url, status: presence[f.friend_username]?.status || 'offline', here: !!members?.some(m => m.username === f.friend_username) }))
    .filter(f => f.username.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.here - b.here) || ((b.status !== 'offline') - (a.status !== 'offline')) || a.username.localeCompare(b.username)), [friends, members, presence, q]);
  function send(f) {
    sendMessage({ kind: 'dm', username: f.username }, link);
    setSent(x => ({ ...x, [f.username]: true }));
  }
  return (
    <div className="vc-invite-friends">
      <div className="vc-invite-friends-head"><b>Send to a friend</b><label className="vc-search sm"><Search size={14} /><input placeholder="Find a friend" value={q} onChange={e => setQ(e.target.value)} /></label></div>
      <div className="vc-invite-friends-list">
        {list.map((f, i) => (
          <div key={f.username} className="vc-invite-friend vl-rise" style={{ '--i': Math.min(i, 12) }}>
            <Avatar user={f} size={32} status={f.status} />
            <b>{f.username}</b>
            <span className="grow" />
            {f.here ? <small className="vc-muted">Already here</small>
              : <button type="button" className={`btn btn-sm ${sent[f.username] ? 'btn-surface' : 'btn-primary'}`} disabled={sent[f.username]} onClick={() => send(f)}>{sent[f.username] ? <><Check size={13} /> Sent</> : 'Send'}</button>}
          </div>
        ))}
        {friends && !friends.length && <div className="vc-empty-note">No friends yet - add some from their profiles.</div>}
        {friends?.length > 0 && !list.length && <div className="vc-empty-note">No friend called that.</div>}
      </div>
    </div>
  );
}

// someone opened /chat#/invite/<code> (or #/i/<instance>/invite/<code>)
export function JoinInvite({ code, inst, onClose }) {
  const [s, setS] = useState(null);
  const [bad, setBad] = useState(false);
  const servers = useChat(x => x.servers);
  const signedIn = useChat(x => x.signedIn);
  const conn = useChat(x => (inst ? x.instances.find(i => i.origin === inst) : null));
  const ready = !inst || conn?.status === 'open';
  useEffect(() => {
    if (!inst && !signedIn) return; // a Velora-hosted server's invite needs the Velora sign-in first
    // an instance I haven't added yet: its invite page is public, so look at it without an account
    const look = inst && !conn
      ? fetch(`${inst}/api/v1/invite/${encodeURIComponent(code)}`).then(r => (r.ok ? r.json() : Promise.reject())).then(d => fromInstance(inst, d, '/invite'))
      : apiFetch(`/chat/invite/${encodeURIComponent(code)}`, { inst: inst || undefined });
    look.then(d => setS(d.server)).catch(() => setBad(true));
  }, [code, inst, !!conn, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const joined = s && servers.some(x => x.sid === s.sid);
  if (!inst && !signedIn) return <Dialog title="Sign in to join" onClose={onClose}>{() => <SignInPrompt what="servers hosted by Nookara" back={{}} />}</Dialog>;
  return (
    <Dialog title={bad ? 'Invite not valid' : "You've been invited to join"} onClose={onClose}>
      {close => (bad ? <p className="vc-dialog-sub">That invite link doesn't work any more - ask for a new one.</p> : !s ? <div className="vc-loading"><i /><i /><i /></div> : (
        <>
          <div className="vc-invite-srv"><span className="vc-srv-ico lg">{s.icon ? <img src={s.icon} alt="" /> : initials(s.name)}</span><div><b>{s.name}</b><small><Users size={13} /> {s.member_count} members{inst ? ` - ${inst.replace(/^https?:\/\//, '')}` : ''}</small></div></div>
          {s.description && <p className="vc-dialog-sub">{s.description}</p>}
          {inst && !conn && <p className="vc-dialog-sub">This server isn't in your list yet. Add it first, then you're in.</p>}
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Not now</button>
            <button type="button" className="btn btn-primary" disabled={!!conn && !ready} onClick={async () => {
              if (inst && !conn) { close(); setTimeout(() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'add-instance', url: inst, invite: code } })), 200); return; }
              try { if (!joined) await apiFetch(`/chat/join/${encodeURIComponent(code)}`, { method: 'POST', inst: inst || undefined }); await loadServersOf(s.sid); close(); go({ kind: 'server', sid: s.sid }); }
              catch (e) { toast(errorText(e.message)); }
            }}>{inst && !conn ? 'Add server' : joined ? 'Open it' : 'Join server'}</button></div>
        </>
      ))}
    </Dialog>
  );
}

// (Server settings: ServerSettings.jsx)

// channel: null = new (optionally { category }), or a channel to edit
export function ChannelEditor({ sid, channel, onClose }) {
  const editing = channel?.cid;
  const [name, setName] = useState(channel?.name || '');
  const [topic, setTopic] = useState(channel?.topic || '');
  const [category, setCategory] = useState(() => channel?.category || getState().detail[sid]?.categories?.[0] || 'Text channels');
  const [locked, setLocked] = useState(!!channel?.locked);
  const [icon, setIcon] = useState(channel?.icon || '');
  const [type, setType] = useState(channel?.type || 'text');
  const [config, setConfig] = useState(() => ({ ...(channel?.config || {}) }));
  const [busy, setBusy] = useState(false);
  const cats0 = useChat(st => st.detail[sid]?.categories);
  const chans = useChat(s => s.detail[sid]?.channels);
  const cats = useMemo(() => [...new Set([...(cats0 || []), ...(chans || []).map(c => c.category).filter(Boolean)])], [chans, cats0]);
  async function save(close) {
    setBusy(true);
    try {
      const body = JSON.stringify({ name, topic, category, locked: type === 'text' ? locked : false, icon: icon || null, type, config: type === 'text' ? {} : type === 'logs' ? (config.mode === 'cloudlink' ? { mode: 'cloudlink', url: config.url || '', room: config.room || '', username: config.username || '' } : {}) : config });
      if (editing) await apiFetch(`/chat/channels/${channel.cid}`, { method: 'PATCH', body });
      else {
        const d = await apiFetch(`/chat/servers/${sid}/channels`, { method: 'POST', body });
        await refreshServer(sid);
        go({ kind: 'channel', sid, cid: d.channel.cid });
      }
      await refreshServer(sid);
      close();
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return (
    <Dialog title={editing ? `Edit #${channel.name}` : 'Create a channel'} onClose={onClose} wide className="vc-srv-settings">
      {close => (
        <form onSubmit={e => { e.preventDefault(); save(close); }}>
          <div className="vc-field"><span>Channel type</span><TypePicker value={type} onChange={setType} /></div>
          <label className="vc-field"><span>Name</span><div className="vc-input-ico"><Hash size={15} /><input className="form-input" autoFocus maxLength={40} value={name} placeholder="new-channel" onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} /></div></label>
          <label className="vc-field"><span>Topic</span><input className="form-input" maxLength={300} value={topic} placeholder="What's it for?" onChange={e => setTopic(e.target.value)} /></label>
          <label className="vc-field"><span>Category</span><input className="form-input" maxLength={40} list="vc-cats" value={category} placeholder="Pick or type a category" required onChange={e => setCategory(e.target.value)} />
            <datalist id="vc-cats">{cats.map(c => <option key={c} value={c} />)}</datalist></label>
          <div className="vc-field"><span>Icon</span>
            <div className="vc-icon-grid">
              <button type="button" className={!icon ? 'on' : ''} title="Default" onClick={() => setIcon('')}><ChannelIcon c={{ locked, name, type }} size={16} /></button>
              {Object.keys(CHANNEL_ICONS).map(k => <button type="button" key={k} className={icon === k ? 'on' : ''} title={k} onClick={() => setIcon(k)}><ChannelIcon c={{ icon: k }} size={16} /></button>)}
              {editing && (
                <label className={`vc-icon-up${/^https?:\/\//.test(icon) ? ' on' : ''}`} title="Upload a picture">
                  {/^https?:\/\//.test(icon) ? <img src={icon} alt="" /> : <Upload size={15} />}
                  <input type="file" hidden accept="image/*" onChange={async e => { const f = e.target.files[0]; if (!f) return; try { const res = await uploadTo(`/chat/channels/${channel.cid}/icon`, f); setIcon(res.channel.icon); } catch (er) { toast(errorText(er.message)); } }} />
                </label>
              )}
            </div></div>
          {type === 'text' && <div className="vc-toggle-row">
            <span><b>Let everyone send messages here?</b><small>{locked ? 'Off: everyone can read, but only the server\'s admins can post.' : 'On: every member can post.'}</small></span>
            <button type="button" role="switch" aria-checked={!locked} className={`cs-switch${!locked ? ' on' : ''}`} onClick={() => setLocked(l => !l)}><i /></button>
          </div>}
          <TypeSettings type={type} config={config} setConfig={setConfig} sid={sid} channel={channel} />
          {editing && (channel.type || 'text') === 'text' && type === 'text' && has(getState().detail[sid]?.server.perms, P.MANAGE_SERVER) && <ChannelBridge sid={sid} channel={channel} />}
          {editing && <ChannelPerms sid={sid} channel={channel} />}
          <div className="vc-dialog-btns">
            {editing && <button type="button" className="btn btn-danger" onClick={async () => {
              if (!(await ask({ title: `Delete #${channel.name}?`, text: 'The channel and all of its messages go for good.', confirm: 'Delete channel', danger: true }))) return;
              try { await apiFetch(`/chat/channels/${channel.cid}`, { method: 'DELETE' }); await refreshServer(sid); close(); go({ kind: 'server', sid }); } catch (e) { toast(errorText(e.message)); }
            }}><Trash2 size={14} /> Delete</button>}
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !category.trim() || (type === 'link' && !/^https?:\/\/\S+\.\S+/.test(config.url || ''))}>{editing ? 'Save' : 'Create channel'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// a DM with someone / a new group chat: pick people (with suggestions)
function PeoplePicker({ multi, onDone, button }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [picked, setPicked] = useState([]);
  const friends = useChat(s => s.friends);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setHits(friends.slice(0, 8).map(f => ({ username: f.friend_username, pfp_url: f.pfp_url }))); return undefined; }
    const timer = setTimeout(() => apiFetch(`/account/search?q=${encodeURIComponent(t)}`).then(d => {
      const fr = friends.filter(f => f.friend_username.toLowerCase().includes(t.toLowerCase())).map(f => ({ username: f.friend_username, pfp_url: f.pfp_url }));
      const all = [...fr, ...d.users.filter(u => !fr.some(f => f.username === u.username))];
      setHits(all.slice(0, 8));
    }).catch(() => {}), 200);
    return () => clearTimeout(timer);
  }, [q, friends]);
  const pick = u => {
    if (!multi) { onDone([u]); return; }
    setPicked(p => (p.includes(u) ? p.filter(x => x !== u) : [...p, u].slice(0, 49)));
  };
  return (
    <>
      <label className="vc-search"><Search size={15} /><input autoFocus placeholder="Type a username" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !multi && q.trim()) onDone([q.trim()]); }} /></label>
      {multi && picked.length > 0 && <div className="vc-picked">{picked.map(u => <button type="button" key={u} className="vc-chip" onClick={() => pick(u)}>{u} &times;</button>)}</div>}
      <div className="vc-pick-list">
        {hits.map(u => (
          <button type="button" key={u.username} className={`vc-pick${picked.includes(u.username) ? ' on' : ''}`} onClick={() => pick(u.username)}>
            <span className="vc-av" style={{ width: 30, height: 30 }}>{u.pfp_url ? <img src={u.pfp_url} alt="" /> : <span className="vc-av-l">{u.username[0].toUpperCase()}</span>}</span>
            <span>{u.username}</span>{picked.includes(u.username) && <Check size={14} />}
          </button>
        ))}
        {!hits.length && q.trim() && !multi && <button type="button" className="vc-pick" onClick={() => onDone([q.trim()])}>Message "{q.trim()}"</button>}
      </div>
      {multi && button(picked)}
    </>
  );
}
export function NewDM({ onClose }) {
  return (
    <Dialog title="New message" sub="Pick a friend, or anyone on Nookara." onClose={onClose}>
      {close => <PeoplePicker onDone={([u]) => { close(); go({ kind: 'dm', username: u }); }} />}
    </Dialog>
  );
}
export function NewGroup({ onClose }) {
  const [name, setName] = useState('');
  return (
    <Dialog title="New group chat" sub="A private chat for a few people (up to 50)." onClose={onClose}>
      {close => (
        <>
          <label className="vc-field"><span>Group name</span><input className="form-input" maxLength={50} value={name} onChange={e => setName(e.target.value)} placeholder="The squad" /></label>
          <PeoplePicker multi onDone={() => {}} button={picked => (
            <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={close}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={async () => {
                try { const d = await apiFetch('/groups', { method: 'POST', body: JSON.stringify({ name, members: picked }) }); await loadGroups(); close(); go({ kind: 'group', room: d.group.room }); }
                catch (e) { toast(errorText(e.message)); }
              }}>Create group{picked.length ? ` (${picked.length + 1})` : ''}</button></div>
          )} />
        </>
      )}
    </Dialog>
  );
}

// Ctrl+K: jump to any channel, DM, group chat or friend
export function QuickSwitcher({ onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const detail = useChat(s => s.detail);
  const servers = useChat(s => s.servers);
  const dms = useChat(s => s.dms);
  const groups = useChat(s => s.groups);
  const friends = useChat(s => s.friends);
  const items = useMemo(() => {
    const out = [];
    dms.forEach(c => out.push({ k: `d${c.username}`, label: c.username === 'System' ? 'Nookara' : c.username, hint: 'Direct message', v: { kind: 'dm', username: c.username } }));
    friends.filter(f => !dms.some(c => c.username === f.friend_username)).forEach(f => out.push({ k: `f${f.friend_username}`, label: f.friend_username, hint: 'Friend', v: { kind: 'dm', username: f.friend_username } }));
    groups.forEach(g => out.push({ k: `g${g.room}`, label: g.name, hint: 'Group chat', v: { kind: 'group', room: g.room } }));
    servers.forEach(s => {
      out.push({ k: `s${s.sid}`, label: s.name, hint: 'Server', v: { kind: 'server', sid: s.sid } });
      (detail[s.sid]?.channels || []).forEach(c => out.push({ k: `c${c.cid}`, label: `#${c.name}`, hint: s.name, v: { kind: 'channel', sid: s.sid, cid: c.cid } }));
    });
    const t = q.trim().toLowerCase().replace(/^[#@]/, '');
    if (!t) return out.slice(0, 12);
    return out.filter(i => i.label.toLowerCase().replace(/^#/, '').includes(t))
      .sort((a, b) => a.label.toLowerCase().replace(/^#/, '').indexOf(t) - b.label.toLowerCase().replace(/^#/, '').indexOf(t)).slice(0, 12);
  }, [q, detail, servers, dms, groups, friends]);
  useEffect(() => setSel(0), [q]);
  return (
    <Dialog title="Where to?" onClose={onClose} className="vc-quick-dlg">
      {close => (
        <>
          <label className="vc-search"><Search size={15} /><input autoFocus placeholder="Channels, people, servers" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => Math.min(items.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => Math.max(0, x - 1)); }
              if (e.key === 'Enter' && items[sel]) { close(); go(items[sel].v); }
            }} /></label>
          <div className="vc-pick-list">
            {items.map((it, i) => (
              <button type="button" key={it.k} className={`vc-pick${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { close(); go(it.v); }}>
                <span>{it.label}</span><small className="vc-pick-hint">{it.hint}</small>
              </button>
            ))}
            {!items.length && <div className="vc-empty-note">Nothing matches that.</div>}
          </div>
        </>
      )}
    </Dialog>
  );
}

// the in-app confirm box (store.ask)
export function AskHost() {
  const a = useChat(s => s.ask);
  const [typed, setTyped] = useState('');
  const [pick, setPick] = useState(null); // choices: the picked one's id
  const [cat, setCat] = useState('');
  const [amount, setAmount] = useState(''); // a choice with custom: a number and a unit
  const [unit, setUnit] = useState('');
  const [sel, setSel] = useState(''); // a.select = { label, options: [[value, label]], optional? }: a dropdown; the answer is { text, select }
  useEffect(() => { setTyped(a?.input?.value || ''); setPick(a?.choices?.find(c => !c.disabled)?.id ?? null); setCat(''); setAmount(''); setUnit(a?.choices?.find(c => c.custom)?.custom?.units?.[0]?.[0] || ''); setSel(''); }, [a]);
  if (!a) return null;
  const chosen = a.choices?.find(c => c.id === pick);
  const ok = (a.input ? (a.input.optional || !!typed.trim()) : (!a.match || typed.trim() === a.match)) && (!a.select || a.select.optional || !!sel) && (!a.choices || (!!chosen && (!chosen.categories || !!cat) && (!chosen.custom || (Number(amount) > 0 && Number(amount) <= (chosen.custom.max || Infinity)))));
  const answer = () => {
    const v = a.select ? { text: a.input ? typed.trim() : '', select: sel } : a.input ? (a.input.optional ? { text: typed.trim() } : typed.trim()) : true;
    return a.choices ? { ...(typeof v === 'object' ? v : { text: '' }), choice: pick, category: cat, amount: Number(amount), unit } : v;
  };
  return (
    <Dialog key={a.title} title={a.title} onClose={() => { if (getState().ask === a) answerAsk(false); }} className="vc-ask">
      {close => (
        <form onSubmit={e => { e.preventDefault(); if (ok) { answerAsk(answer()); close(); } }}>
          {a.text && <p className="vc-dialog-sub">{a.text}</p>}
          {a.choices && (
            <div className={`bf-sr-choices${a.compact ? ' compact' : ''}`} role="radiogroup" aria-label={a.title}>
              {a.choices.map(c => (
                <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} disabled={c.disabled} className={`bf-sr-mode${pick === c.id ? ' on' : ''}`} onClick={() => { setPick(c.id); setCat(''); }}>
                  <b>{c.label}</b>{(c.hint || (c.disabled && c.why)) && <small>{c.disabled && c.why ? c.why : c.hint}</small>}
                </button>
              ))}
            </div>
          )}
          {chosen?.custom && (
            <div className="vc-row vc-field">
              <input className="form-input vc-narrow" type="number" min={1} autoFocus placeholder={chosen.custom.placeholder || 'How long'} aria-label="How long" value={amount} onChange={e => setAmount(e.target.value)} />
              <select className="form-input" value={unit} onChange={e => setUnit(e.target.value)} aria-label="Unit">{chosen.custom.units.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
          )}
          {chosen?.categories && (
            <label className="vc-field"><span>What's wrong?</span>
              <select className="form-input" value={cat} onChange={e => setCat(e.target.value)}><option value="">Pick one...</option>{chosen.categories.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          )}
          {a.select && (
            <label className="vc-field"><span>{a.select.label || 'Pick one'}</span>
              <select className="form-input" autoFocus value={sel} onChange={e => setSel(e.target.value)}><option value="">Pick one...</option>{a.select.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          )}
          {a.link && <div className="vc-ask-link"><b>{a.link.host}</b><span>{a.link.href}</span></div>}
          {a.match && (
            <label className="vc-field"><span>Type <b className="vc-ask-match">{a.match}</b> to confirm</span>
              <input className="form-input" autoFocus value={typed} onChange={e => setTyped(e.target.value)} /></label>
          )}
          {a.input && (a.input.multiline
            ? <textarea className="form-textarea" autoFocus={!a.select} rows={3} maxLength={a.input.max || 40} placeholder={a.input.placeholder} value={typed} onChange={e => setTyped(e.target.value)} />
            : <input className="form-input" autoFocus maxLength={a.input.max || 40} placeholder={a.input.placeholder} value={typed} onChange={e => setTyped(e.target.value)} />)}
          <div className="vc-dialog-btns">
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>{a.cancel || 'Cancel'}</button>
            <button type="submit" autoFocus={!a.match && !a.input} className={`btn ${a.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok}>{a.confirm || 'OK'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
