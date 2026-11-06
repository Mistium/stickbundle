// What shows where there's nothing to show yet: a server whose instance isn't connected / signed in (instead of its channels),
// and Velora-only places (friends, DMs, groups) while you're signed out of Velora.
import { useEffect, useState } from 'react';
import { ShieldCheck, LogIn, RefreshCw, Users, Server, TriangleAlert, Trash2, KeyRound, Globe, Ban, LifeBuoy, LogOut, UserRound, Cake, ExternalLink } from 'lucide-react';
import { useChat, go, toast, errorText, ask, RESTRICTED_TEXT } from './store.js';
import { initials } from './Parts.jsx';
import { reconnect, joinCommunity, removeInstance } from './instances.js';
import { joinLabel, joinHint } from './Community.jsx';
import { startSignIn } from './session.js';
import { BootMark } from './Boot.jsx';
import { signOut, savedAccounts, switchTo } from './ProfilePopout.jsx';
import { siteHref } from './hosts.js';

export const SUPPORT_URL = 'https://nookara.cc/support';
// where the birthday is set (Nookara account settings; a website session, the Ember token can't set it)
export const BIRTHDAY_URL = siteHref('/me#settings/birthday');

// The lockout notice by reason (store.js lockReason). Staff restrictions keep the old wording; Nookara's birthday gate
// (no birthday yet / under the minimum age for their region) says what to do instead.
export function lockText(reason) {
  if (reason === 'birthday_required') return {
    icon: <Cake size={34} />, title: 'Set your birthday to use Ember',
    text: 'Ember and direct messages are off until you add your date of birth in your Nookara account settings. Only you can see it. Ember unlocks as soon as it is saved.',
    action: <a className="btn btn-primary" href={BIRTHDAY_URL} target="_blank" rel="noopener noreferrer"><Cake size={15} /> Set your birthday <ExternalLink size={13} /></a>,
  };
  if (reason === 'under_minimum_age') return {
    icon: <Ban size={34} />, title: "Ember isn't available for your account",
    text: "You're under the minimum age for chat in your region, so Ember and direct messages are off. The rest of your Nookara account works as usual. Contact Nookara support if your birthday is wrong.",
    action: <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>,
  };
  return {
    icon: <Ban size={34} />, title: 'Ember is switched off',
    text: `${RESTRICTED_TEXT} Contact Nookara support if you think this is a mistake.`,
    action: <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>,
  };
}
const dialog = (kind, extra) => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind, ...extra } }));

function Box({ icon, spin, title, children }) {
  return (
    <div className="vc-gate" role="status">
      <div className="vc-gate-box vl-rise">
        {spin ? <BootMark size={52} /> : icon}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Ember and DMs are off for the account (store.js lockAccount: staff switched them off, or Nookara's birthday gate): this is
// the whole app, nothing else of Ember shows. Signing out / another saved account on this device still works (that's the
// account, not Ember); it lifts by itself (the `restrictions` push, e.g. the moment the birthday is saved).
export function LockedScreen() {
  const me = useChat(s => s.me);
  const reason = useChat(s => s.lockReason);
  const [busy, setBusy] = useState('');
  const others = savedAccounts().filter(a => a.username.toLowerCase() !== String(me?.username || '').toLowerCase()).slice(0, 3);
  const L = lockText(reason);
  return (
    <Box icon={L.icon} title={L.title}>
      <p>{L.text}</p>
      <div className="vc-gate-btns">{L.action}</div>
      <div className="vc-gate-links">
        {others.map(a => <button key={a.username} type="button" className="vc-gate-link" disabled={!!busy} onClick={() => switchTo(a, setBusy)}><UserRound size={12} /> {busy === a.username ? 'Switching...' : `Use ${a.username}`}</button>)}
        <button type="button" className="vc-gate-link" disabled={!!busy} onClick={() => { setBusy('-'); signOut(); }}><LogOut size={12} /> {busy === '-' ? 'Signing out...' : me?.username ? `Sign out of ${me.username}` : 'Sign out'}</button>
      </div>
    </Box>
  );
}

// "retrying in 12 s" (it never gives up; the network / tab coming back tries at once too)
export function RetryIn({ at, busy }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.ceil(((at || 0) - now) / 1000));
  return <small>{busy || !at || !s ? 'Trying again...' : `Retrying in ${s} s`}</small>;
}

export function SignInPrompt({ what = 'direct messages, group chats and friends', back }) {
  return (
    <Box icon={<ShieldCheck size={34} />} title="Sign in with Nookara">
      <p>Your Nookara account is needed for {what}. Servers with their own accounts work without it.</p>
      <div className="vc-gate-btns"><button type="button" className="btn btn-primary" onClick={() => startSignIn(back)}><ShieldCheck size={15} /> Sign in with Nookara</button></div>
      <small>Ember asks you to approve it first and keeps its own sign-in - the website's session isn't used.</small>
    </Box>
  );
}

// the whole sidebar of Home while signed out
export function SignedOutSidebar() {
  return (
    <div className="vc-side">
      <div className="vc-side-head" />
      <div className="vc-side-list"><div className="vc-side-empty">Sign in with Nookara to use direct messages, group chats and friends.</div></div>
    </div>
  );
}

// view.kind === 'instance': the server's sidebar and channels stay out until its socket is up and signed in
export function InstanceGate({ origin }) {
  const inst = useChat(s => s.instances.find(i => i.origin === origin));
  const srv = useChat(s => s.servers.find(x => x.inst === origin));
  const lockReason = useChat(s => s.lockReason);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  if (!inst) return null;
  const { host, status, community } = inst;
  const name = community?.name || inst.name;
  const retry = <button type="button" className="btn btn-surface" onClick={() => reconnect(origin)}><RefreshCw size={15} /> Retry</button>;
  const remove = <button type="button" className="btn btn-surface" onClick={async () => { if (await ask({ title: `Remove ${name}?`, text: `${host} leaves your server list. Your account there stays as it is - you can add it again any time.`, confirm: 'Remove from list', danger: true })) removeInstance(origin); }}><Trash2 size={15} /> Remove from list</button>;

  if ((status === 'connecting' && !inst.failed) || (srv && status === 'open')) return <Box spin title={`Connecting to ${name || host}`}><small className="vc-gate-host"><Globe size={12} /> {host}</small></Box>;
  if (status === 'login') {
    return (
      <Box icon={<KeyRound size={34} />} title={`Signed out of ${host}`}>
        <p>{inst.needsVelora ? 'This server signs you in with your Nookara account.' : 'Log in to open this server.'}</p>
        <div className="vc-gate-btns">
          {inst.needsVelora ? <button type="button" className="btn btn-primary" onClick={() => startSignIn()}><ShieldCheck size={15} /> Sign in with Nookara</button>
            : <button type="button" className="btn btn-primary" onClick={() => dialog('add-instance', { url: origin })}><LogIn size={15} /> Log in</button>}
          {retry}
        </div>
      </Box>
    );
  }
  if (status === 'restricted') { // Ember is off for this account: calm and final until it's switched back (the socket tells us)
    const L = lockReason && lockReason !== 'staff' ? lockText(lockReason) : null; // (Nookara's birthday gate: its own words, not the instance's)
    return (
      <Box icon={L ? L.icon : <Ban size={34} />} title={L ? L.title : 'Ember is switched off'}>
        <small className="vc-gate-host"><Globe size={12} /> {host}</small>
        <p>{L ? L.text : `${inst.restricted || RESTRICTED_TEXT} Contact Nookara support if you think this is a mistake.`}</p>
        <div className="vc-gate-btns">{L ? L.action : <a className="btn btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer"><LifeBuoy size={15} /> Nookara support</a>}</div>
      </Box>
    );
  }
  if (status === 'banned') return <Box icon={<TriangleAlert size={34} />} title={`You're banned from ${host}`}><div className="vc-gate-btns">{remove}</div></Box>;
  if (status !== 'open') { // (also while it retries by itself: the box stays put until a try works)
    return (
      <Box icon={<Server size={34} />} title={`Couldn't reach ${host}`}>
        {inst.error && inst.error !== 'instance_unreachable' && <p>{errorText(inst.error === 'insufficient_scope' ? 'inst_scope' : inst.error)}</p>}
        <RetryIn at={inst.retryAt} busy={status === 'connecting'} />
        <div className="vc-gate-btns"><button type="button" className="btn btn-primary" onClick={() => reconnect(origin)}><RefreshCw size={15} /> Retry now</button>{remove}</div>
      </Box>
    );
  }
  // connected, signed in, but not in the community yet (or there isn't one yet)
  if (!community) {
    return (
      <Box icon={<Server size={34} />} title={inst.claimed ? `${host} isn't set up yet` : `Nobody owns ${host} yet`}>
        <p>{inst.claimed ? 'Its owner has not made the server yet.' : 'Whoever has its setup code can claim it and set it up.'}</p>
        <div className="vc-gate-btns">{(!inst.claimed || inst.isAdmin) && <button type="button" className="btn btn-primary" onClick={() => dialog('setup', { origin })}>Set it up</button>}{remove}</div>
      </Box>
    );
  }
  async function join(c) {
    setBusy(true);
    try {
      const r = await joinCommunity(origin, c, c ? undefined : pass);
      if (r.pending) toast(`Asked to join ${name}.`, true); else go({ kind: 'server', sid: r.sid });
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  return (
    <Box icon={<span className="vc-srv-ico lg">{community.icon_url ? <img src={community.icon_url} alt="" /> : initials(name)}</span>} title={name}>
      {community.description && <p>{community.description}</p>}
      <small><Users size={13} className="vc-inline-ico" /> {community.member_count} member{community.member_count === 1 ? '' : 's'} - {host}</small>
      {joinHint(community.join_policy) && <p className="vc-hint">{joinHint(community.join_policy)}</p>}
      {community.join_policy === 'password' && !inst.pending && (
        <form className="vc-row vc-gate-code" onSubmit={e => { e.preventDefault(); if (pass) join(); }}>
          <input className="form-input" type="password" autoComplete="off" placeholder="Server password" aria-label="Server password" value={pass} onChange={e => setPass(e.target.value)} />
        </form>
      )}
      <div className="vc-gate-btns">
        {inst.pending ? <button type="button" className="btn btn-surface" disabled>Request sent</button>
          : community.join_policy !== 'invite' && <button type="button" className="btn btn-primary" disabled={busy || (community.join_policy === 'password' && !pass)} onClick={() => join()}>{joinLabel(community.join_policy, 'Join server')}</button>}
        {remove}
      </div>
      <form className="vc-row vc-gate-code" onSubmit={e => { e.preventDefault(); if (code.trim()) join(code); }}>
        <input className="form-input" placeholder="Invite code or link" value={code} onChange={e => setCode(e.target.value)} />
        <button type="submit" className="btn btn-surface" disabled={!code.trim() || busy}>Join with invite</button>
      </form>
    </Box>
  );
}
