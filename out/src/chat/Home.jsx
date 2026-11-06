// Home: your friends (with what they're doing), requests, and "Active now".
import { useEffect, useState } from 'react';
import { MessageCircle, UserPlus, Check, X, Users } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, go, loadFriends, toast, errorText } from './store.js';
import { Avatar, subtitle, ActivityCard } from './Profile.jsx';
import { VeloraConnNote } from './Parts.jsx';

export default function Home({ onUser }) {
  const friends = useChat(s => s.friends);
  const presence = useChat(s => s.presence);
  const [tab, setTab] = useState('online');
  const [reqs, setReqs] = useState({ incoming: [], outgoing: [] });
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState(null);
  const loadReqs = () => apiFetch('/friends/requests').then(setReqs).catch(() => {});
  useEffect(() => { loadReqs(); }, []);
  // message requests (dm-privacy.js): someone who isn't a friend asks before they can DM you. Nothing they wrote comes with it
  const [dmReqs, setDmReqs] = useState(null);
  const loadDmReqs = () => apiFetch('/account/dm-requests').then(setDmReqs).catch(() => {});
  useEffect(() => { loadDmReqs(); }, [tab]);
  async function answerDm(id, yes) {
    try { await apiFetch(`/account/dm-requests/${id}/${yes ? 'accept' : 'decline'}`, { method: 'POST' }); loadDmReqs(); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function setDmOn(on) {
    try { setDmReqs(await apiFetch('/account/dm-requests/settings', { method: 'POST', body: JSON.stringify({ requests_on: on }) }).then(d => ({ ...dmReqs, ...d }))); }
    catch (e) { toast(errorText(e.message)); }
  }
  const dmIn = dmReqs?.requests || [];

  const st = f => presence[f.friend_username]?.status || 'offline';
  const list = friends
    .filter(f => tab === 'all' || st(f) !== 'offline')
    .sort((a, b) => (st(a) === 'offline') - (st(b) === 'offline') || a.friend_username.localeCompare(b.friend_username));
  const active = friends.filter(f => presence[f.friend_username]?.activities?.length);

  async function sendReq(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const d = await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username: add.trim() }) });
      setMsg({ ok: true, text: d.status === 'accepted' ? `You and ${add.trim()} are friends now!` : `Friend request sent to ${add.trim()}.` });
      setAdd(''); loadReqs(); loadFriends();
    } catch (er) {
      setMsg({ ok: false, text: { already_friends: "You're already friends.", user_not_found: "Couldn't find that person.", invalid_target: "That's you!", already_requested: 'You already sent them a request.' }[er.message] || errorText(er.message) });
    }
  }
  async function answer(id, yes) {
    try { await apiFetch(`/friends/request/${id}/${yes ? 'accept' : 'decline'}`, { method: 'PATCH' }); loadReqs(); loadFriends(); }
    catch (e) { toast(errorText(e.message)); }
  }
  const tabs = [['online', 'Online'], ['all', 'All'], ['pending', `Pending${reqs.incoming.length + dmIn.length ? ` (${reqs.incoming.length + dmIn.length})` : ''}`], ['add', 'Add friend']];
  return (
    <div className="vc-home">
      <div className="vc-home-main">
        <div className="vc-head">
          <Users size={20} className="vc-head-ico" /><b className="vc-head-name">Friends</b>
          <div className="vc-tabs inline">{tabs.map(([k, l]) => <button type="button" key={k} className={`${tab === k ? 'on' : ''}${k === 'add' ? ' add' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        </div>
        <div className="vc-home-body" key={tab}>
          <VeloraConnNote className="wide" />
          {tab === 'add' && (
            <form className="vc-add vl-rise" onSubmit={sendReq}>
              <h3>Add a friend</h3>
              <p className="vc-dialog-sub">Friends can see your friends-only profile, and you'll see what they're playing.</p>
              <div className="vc-row"><input className="form-input" placeholder="Their Nookara username" value={add} onChange={e => setAdd(e.target.value)} /><button className="btn btn-primary" disabled={!add.trim()}>Send request</button></div>
              {msg && <div className={`inline-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
            </form>
          )}
          {tab === 'pending' && (
            <>
              <div className="vc-cat-name static">Incoming - {reqs.incoming.length}</div>
              {reqs.incoming.map((r, i) => (
                <div key={r.id} className="vc-friend vl-rise" style={{ '--i': i }}>
                  <Avatar user={{ username: r.from_username, pfp: r.pfp_url }} size={36} />
                  <span className="vc-friend-txt"><b>{r.from_username}</b><small>Wants to be your friend</small></span>
                  <button type="button" className="vc-round ok" title="Accept" onClick={() => answer(r.id, true)}><Check size={17} /></button>
                  <button type="button" className="vc-round no" title="Decline" onClick={() => answer(r.id, false)}><X size={17} /></button>
                </div>
              ))}
              <div className="vc-cat-name static">Sent - {reqs.outgoing.length}</div>
              {reqs.outgoing.map((r, i) => (
                <div key={r.id} className="vc-friend vl-rise" style={{ '--i': i }}>
                  <Avatar user={{ username: r.to_username }} size={36} />
                  <span className="vc-friend-txt"><b>{r.to_username}</b><small>Waiting for them to answer</small></span>
                </div>
              ))}
              <div className="vc-cat-name static">Message requests - {dmIn.length}</div>
              {dmIn.map((r, i) => (
                <div key={r.id} className="vc-friend vl-rise" style={{ '--i': i }}>
                  <Avatar user={{ username: r.username, pfp: r.pfp }} size={36} />
                  <span className="vc-friend-txt"><b>{r.username}</b><small>Wants to message you</small></span>
                  <button type="button" className="vc-round ok" title="Accept" onClick={() => answerDm(r.id, true)}><Check size={17} /></button>
                  <button type="button" className="vc-round no" title="Decline" onClick={() => answerDm(r.id, false)}><X size={17} /></button>
                </div>
              ))}
              {dmReqs?.can_turn_off && (
                <label className="vc-friend">
                  <input type="checkbox" checked={dmReqs.requests_on} onChange={e => setDmOn(e.target.checked)} />
                  <span className="vc-friend-txt"><small>Ask me before people I don't know can message me</small></span>
                </label>
              )}
            </>
          )}
          {(tab === 'online' || tab === 'all') && (
            <>
              <div className="vc-cat-name static">{tab === 'online' ? 'Online' : 'All friends'} - {list.length}</div>
              {!list.length && (
                <div className="vc-empty-big">
                  <UserPlus size={34} />
                  <p>{friends.length ? 'None of your friends are online right now.' : "You haven't added any friends yet."}</p>
                  <button type="button" className="btn btn-primary" onClick={() => setTab('add')}>Add a friend</button>
                </div>
              )}
              {list.map((f, i) => {
                const p = presence[f.friend_username];
                return (
                  <div key={f.friend_username} className="vc-friend vl-rise" style={{ '--i': Math.min(i, 14) }}>
                    <button type="button" className="vc-friend-who" onClick={e => onUser(f.friend_username, e.currentTarget)}>
                      <Avatar user={{ username: f.friend_username, pfp: f.pfp_url }} size={36} status={p?.status || 'offline'} />
                      <span className="vc-friend-txt"><b style={f.color ? { color: f.color } : undefined}>{f.friend_username}</b><small>{subtitle(p) || (p?.status === 'offline' || !p ? 'Offline' : p.status === 'dnd' ? 'Do not disturb' : p.status === 'idle' ? 'Idle' : 'Online')}</small></span>
                    </button>
                    <button type="button" className="vc-round" title="Message" onClick={() => go({ kind: 'dm', username: f.friend_username })}><MessageCircle size={17} /></button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
      <aside className="vc-active">
        <h3>Active now</h3>
        {!active.length && <div className="vc-active-empty"><b>It's quiet for now...</b><p>When friends start playing something - a Hyperfocus game, or anything that shares its activity with Nookara - it'll show here.</p></div>}
        {active.map((f, i) => (
          <button type="button" key={f.friend_username} className="vc-active-card vl-rise" style={{ '--i': i }} onClick={e => onUser(f.friend_username, e.currentTarget, 'left')}>
            <div className="vc-active-who"><Avatar user={{ username: f.friend_username, pfp: f.pfp_url }} size={32} status={presence[f.friend_username]?.status} /><b>{f.friend_username}</b></div>
            {presence[f.friend_username].activities.map((a, activityIndex) => <ActivityCard key={`${a.name}-${activityIndex}`} a={a} compact />)}
          </button>
        ))}
      </aside>
    </div>
  );
}
