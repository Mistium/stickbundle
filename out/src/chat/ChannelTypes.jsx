// Channel types (stage 6): the type picker + per-type settings in the channel editor, the roles shop,
// webhooks (logs channels), link channels and Discord-style embeds.
import { useEffect, useRef, useState } from 'react';
import { StarboardSettings } from './Starboard.jsx';
import { GameTypeSettings } from './GameServer.jsx';
import { Hash, ScrollText, BadgeCheck, DoorOpen, ExternalLink, Volume2, Star, Gamepad2, Webhook, Copy, RefreshCw, Trash2, Plus, Coins, Check, X, Upload, Cloud, Users } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, useScopeStatus, scopeTip, scopeBlocked, toast, errorText, ask } from './store.js';
import { renderBody } from './text.jsx';
import { viewPicture } from './MediaViewer.jsx';
import { has, P } from './roles.jsx';
import { Dialog } from './Dialogs.jsx';
import { instOpt, isInst } from './ids.js';

export const TYPES = [
  { id: 'text', label: 'Text', hint: 'Messages, pictures and GIFs.', Icon: Hash },
  { id: 'logs', label: 'Logs', hint: 'Webhooks post here, members read - or bridge a CloudLink chat.', Icon: ScrollText },
  { id: 'roles', label: 'Roles shop', hint: 'People give themselves roles - free or for credits.', Icon: BadgeCheck },
  { id: 'welcome', label: 'Join & leave', hint: 'Says hi when people join or leave.', Icon: DoorOpen },
  { id: 'link', label: 'Link', hint: 'Opens a website.', Icon: ExternalLink },
  { id: 'voice', label: 'Voice', hint: 'Talk together - join and leave any time.', Icon: Volume2 },
  { id: 'starboard', label: 'Starboard', hint: 'The best messages - once they get enough stars.', Icon: Star },
  { id: 'game', label: 'Game server', hint: 'Link a Minecraft server: join info, console or chat.', Icon: Gamepad2 },
];
export const typeIcon = type => TYPES.find(t => t.id === type && type !== 'text')?.Icon || null;

// soonIds: types shown but not offered yet
export function TypePicker({ value, onChange, soonIds = [] }) {
  return (
    <div className="vc-types">
      {TYPES.map(({ id, label, hint, Icon, soon: s }) => { const soon = s || (soonIds.includes(id) && value !== id); return (
        <button type="button" key={id} className={`vc-type${value === id ? ' on' : ''}`} disabled={soon} onClick={() => onChange(id)}>
          <Icon size={20} />
          <span><b>{label}{soon && <small className="vc-chip">Coming soon</small>}</b><small>{hint}</small></span>
        </button>
      ); })}
    </div>
  );
}

// ── link channels: say where it goes, then open it ──
export async function openLinkChannel(c) {
  const href = c?.config?.url;
  if (!href) { toast('This link channel has no link yet.'); return; }
  let host = href;
  try { host = new URL(href).host; } catch { /* keep it */ }
  if (await ask({ title: `#${c.name} opens a website`, text: 'You are leaving Ember. This channel goes to:', link: { host, href }, confirm: 'Open link' })) window.open(href, '_blank', 'noopener,noreferrer');
}

// ── per-type settings in the channel editor ──
export function TypeSettings({ type, config, setConfig, sid, channel }) {
  if (type === 'link') {
    return (
      <label className="vc-field"><span>Link</span>
        <input className="form-input" maxLength={500} placeholder="https://example.com" value={config.url || ''} onChange={e => setConfig({ ...config, url: e.target.value.trim() })} />
        <small className="vc-field-hint">Clicking the channel shows people where it goes before it opens in a new tab.</small>
      </label>
    );
  }
  if (type === 'welcome') return <WelcomeSettings config={config} setConfig={setConfig} />;
  if (type === 'voice') {
    return (
      <>
        <div className="vc-toggle-row">
          <span><b>Let people call others in?</b><small>{config.allow_call_in ? 'On: anyone in the channel can ring a server member (who allows it) straight into it.' : 'Off: people join by themselves.'}</small></span>
          <button type="button" role="switch" aria-checked={!!config.allow_call_in} className={`cs-switch${config.allow_call_in ? ' on' : ''}`} onClick={() => setConfig({ ...config, allow_call_in: !config.allow_call_in })}><i /></button>
        </div>
        <label className="vc-field"><span>User limit</span>
          <input className="form-input" type="number" min={0} max={99} value={config.user_limit || 0} onChange={e => setConfig({ ...config, user_limit: Math.max(0, Math.min(99, Math.trunc(Number(e.target.value) || 0))) })} />
          <small className="vc-field-hint">0 = no limit. People who can manage channels can always get in.</small></label>
      </>
    );
  }
  if (type === 'roles') return <ShopSettings config={config} setConfig={setConfig} sid={sid} />;
  if (type === 'starboard') return <StarboardSettings config={config} setConfig={setConfig} sid={sid} channel={channel} />;
  if (type === 'game') return <GameTypeSettings config={config} setConfig={setConfig} sid={sid} channel={channel} />;
  if (type === 'logs') return <LogsSettings config={config} setConfig={setConfig} channel={channel} />;
  if (type === 'text' && channel?.cid) return <WebhookManager cid={channel.cid} logs={false} />;
  return null;
}

// ── logs channels: plain webhooks, or a CloudLink bridge ──
const CL_DEFAULT = 'wss://ikelene.net/cl/';
function LogsSettings({ config, setConfig, channel }) {
  const mode = config.mode === 'cloudlink' ? 'cloudlink' : 'webhooks';
  const saved = channel?.type === 'logs' && channel.config?.mode === 'cloudlink';
  const pick = m => setConfig(m === 'cloudlink' ? { mode: 'cloudlink', url: config.url || CL_DEFAULT, room: config.room || '', username: config.username || '' } : {});
  return (
    <>
      <div className="vc-field"><span>What posts here</span>
        <div className="vc-types two">
          <button type="button" className={`vc-type${mode === 'webhooks' ? ' on' : ''}`} onClick={() => pick('webhooks')}>
            <Webhook size={20} /><span><b>Webhooks</b><small>Apps and bots post with a webhook URL. Members only read.</small></span>
          </button>
          <button type="button" className={`vc-type${mode === 'cloudlink' ? ' on' : ''}`} onClick={() => pick('cloudlink')}>
            <Cloud size={20} /><span><b>CloudLink bridge</b><small>Joins a CloudLink chat (like ScratchCord's global chat). Messages go both ways.</small></span>
          </button>
        </div>
      </div>
      {mode === 'cloudlink' ? <CloudLinkSettings config={config} setConfig={setConfig} channel={saved ? channel : null} />
        : channel?.cid ? <WebhookManager cid={channel.cid} logs /> : <p className="vc-dialog-sub">Create the channel first, then open its settings to make webhooks for it.</p>}
    </>
  );
}
const CL_STATES = { connected: 'Connected', connecting: 'Connecting...', handshaking: 'Connecting...', waiting: 'Not connected - trying again soon', off: 'Off', stopped: 'Off' };
const CL_ERRORS = {
  cl_private_address: "That address is on a private network, so Ember won't connect to it.", cl_bad_url: "That address doesn't work.", cl_bad_port: 'Only ports 80 and 443 are allowed.',
  over_limit: 'This server already has 3 CloudLink bridges running.', ENOTFOUND: "That server name doesn't exist.", ECONNREFUSED: 'The server refused the connection.', ETIMEDOUT: 'The server took too long to answer.',
};
const clError = e => CL_ERRORS[e] || (/^http_(\d+)/.test(e || '') ? `The server answered ${e.slice(5)} instead of opening a WebSocket.` : e ? `Lost the connection (${e}).` : '');
function CloudLinkSettings({ config, setConfig, channel }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!channel?.cid) return () => {};
    let live = true;
    const load = () => apiFetch(`/chat/channels/${channel.cid}/cloudlink`).then(d => live && setSt(d.status)).catch(() => live && setSt(null));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [channel?.cid, channel?.config?.url, channel?.config?.room, channel?.config?.username]);
  const changed = !!channel && (channel.config.url !== config.url || (channel.config.room || '') !== (config.room || '') || (channel.config.username || '') !== (config.username || ''));
  const ok = /^wss?:\/\/[^\s/]+/i.test(config.url || '');
  return (
    <>
      <label className="vc-field"><span>CloudLink server</span>
        <input className="form-input" maxLength={300} placeholder={CL_DEFAULT} value={config.url ?? ''} onChange={e => setConfig({ ...config, url: e.target.value.trim() })} />
        <small className="vc-field-hint">{!ok && config.url ? 'It needs to start with wss:// (or ws://).' : "A CloudLink 4 WebSocket address. The default is Ikelene's official one (ScratchCord's global chat). Only ports 80 and 443, and nothing on a private network."}</small>
      </label>
      <div className="vc-field-row">
        <label className="vc-field"><span>Room (optional)</span>
          <input className="form-input" maxLength={60} placeholder="default" value={config.room || ''} onChange={e => setConfig({ ...config, room: e.target.value })} />
        </label>
        <label className="vc-field"><span>Bridge username (optional)</span>
          <input className="form-input" maxLength={40} placeholder={config.room ? 'Ember' : 'Hidden'} value={config.username || ''} onChange={e => setConfig({ ...config, username: e.target.value.replace(/:/g, '') })} />
        </label>
      </div>
      <small className="vc-field-hint">Leave the room empty for the main chat. With a username the bridge shows up in CloudLink's online list (a room needs one, so it's "Ember" if you leave it empty). Messages go out as "Ember | name: message", and typing <code className="vc-code">!online</code> here lists who's on CloudLink. Nothing from CloudLink can ping anyone.</small>
      {channel ? (
        <div className={`vc-cl-status ${st?.state || 'loading'}`}>
          <Cloud size={16} />
          <span className="vc-cl-txt">
            <b>{st ? CL_STATES[st.state] || st.state : 'Checking...'}</b>
            {st?.state === 'connected' && <small><Users size={12} /> {st.online} on CloudLink{st.users?.length ? `: ${st.users.slice(0, 12).join(', ')}${st.users.length > 12 ? ', ...' : ''}` : ''}</small>}
            {st?.error && st.state !== 'connected' && <small className="err">{clError(st.error)}</small>}
            {changed && <small>Save to connect with the new settings.</small>}
          </span>
          <span className="grow" />
          <button type="button" className="btn btn-surface btn-sm" disabled={busy || !st || changed} onClick={async () => {
            setBusy(true);
            try { setSt((await apiFetch(`/chat/channels/${channel.cid}/cloudlink/reconnect`, { method: 'POST' })).status); } catch (e) { toast(errorText(e.message)); }
            setBusy(false);
          }}><RefreshCw size={13} /> Reconnect</button>
        </div>
      ) : <p className="vc-dialog-sub">Ember connects as soon as you save. A server can have up to 3 CloudLink bridges.</p>}
    </>
  );
}

function Templates({ label, list, onChange, example }) {
  const [text, setText] = useState((list || []).join('\n'));
  return (
    <label className="vc-field"><span>{label}</span>
      <textarea className="form-input vc-templates" rows={4} value={text} placeholder={example}
        onChange={e => { setText(e.target.value); onChange(e.target.value.split('\n').map(x => x.trim()).filter(Boolean)); }} />
    </label>
  );
}
function WelcomeSettings({ config, setConfig }) {
  return (
    <>
      <p className="vc-dialog-sub">One message per line - a random one is picked each time. Use <code className="vc-code">{'{user}'}</code> for the person (needed), <code className="vc-code">{'{server}'}</code> and <code className="vc-code">{'{count}'}</code> for the member count. Leave a box empty for Nookara's own messages.</p>
      <Templates label="When someone joins" list={config.join} onChange={join => setConfig({ ...config, join })} example={'{user} just showed up!\nWelcome to {server}, {user}!'} />
      <Templates label="When someone leaves" list={config.leave} onChange={leave => setConfig({ ...config, leave })} example={'{user} left the server.'} />
      {[...(config.join || []), ...(config.leave || [])].some(t => !t.includes('{user}')) && <p className="vc-warn-note">Lines without {'{user}'} are skipped.</p>}
      <div className="vc-toggle-row">
        <span><b>Let everyone chat here too?</b><small>{config.allow_chat ? 'On: members can reply to the join messages.' : "Off: only the join / leave messages (and admins)."}</small></span>
        <button type="button" role="switch" aria-checked={!!config.allow_chat} className={`cs-switch${config.allow_chat ? ' on' : ''}`} onClick={() => setConfig({ ...config, allow_chat: !config.allow_chat })}><i /></button>
      </div>
    </>
  );
}
function ShopSettings({ config, setConfig, sid }) {
  const detail = useChat(s => s.detail[sid]);
  const canRoles = has(detail?.server.perms, P.MANAGE_ROLES);
  const items = config.items || [];
  const roles = (detail?.roles || []).filter(r => !r.is_default && !(r.permissions & P.ADMIN)).sort((a, b) => b.position - a.position);
  const free = roles.filter(r => !items.some(i => i.rid === r.rid));
  const set = (i, patch) => setConfig({ ...config, items: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  if (!canRoles) return <p className="vc-dialog-sub">You need the Manage roles permission to choose what's in the shop.</p>;
  return (
    <div className="vc-field"><span>Roles for sale</span>
      <p className="vc-dialog-sub">Free roles anyone can take or drop. Paid roles cost Nookara credits, which go to the server owner - once bought, people can take them off and back on for free. Roles with Administrator can't be sold.</p>
      <div className="vc-shop-edit">
        {items.map((it, i) => {
          const r = roles.find(x => x.rid === it.rid);
          if (!r) return null;
          return (
            <div key={it.rid} className="vc-shop-row">
              <b style={{ color: r.color || undefined }}>{r.name}</b>
              <input className="form-input" maxLength={200} placeholder="What's it for? (optional)" value={it.desc || ''} onChange={e => set(i, { desc: e.target.value })} />
              <label className="vc-price"><Coins size={13} /><input className="form-input" type="number" min={0} max={1000000} value={it.price || 0} onChange={e => set(i, { price: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></label>
              <button type="button" className="vc-ico-btn" title="Take out of the shop" onClick={() => setConfig({ ...config, items: items.filter((_, j) => j !== i) })}><X size={15} /></button>
            </div>
          );
        })}
        {!items.length && <div className="vc-empty-note">Nothing for sale yet.</div>}
      </div>
      {free.length > 0 && items.length < 25 && (
        <div className="vc-shop-add">
          {free.slice(0, 30).map(r => <button type="button" key={r.rid} className="vc-chip-btn" onClick={() => setConfig({ ...config, items: [...items, { rid: r.rid, price: 0, desc: '' }] })}><Plus size={12} /> <span style={{ color: r.color || undefined }}>{r.name}</span></button>)}
        </div>
      )}
    </div>
  );
}

// ── webhooks ──
function WebhookManager({ cid, logs }) {
  const inst = instOpt(cid); // /hooks/:wid has no namespaced id in it: send it to the channel's instance
  const [list, setList] = useState(null);
  const reload = () => apiFetch(`/chat/channels/${cid}/webhooks`).then(d => setList(d.webhooks)).catch(e => { setList([]); toast(errorText(e.message)); });
  useEffect(() => { reload(); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function create() {
    try { await apiFetch(`/chat/channels/${cid}/webhooks`, { method: 'POST', body: JSON.stringify({ name: 'Webhook' }) }); reload(); } catch (e) { toast(errorText(e.message)); }
  }
  async function patch(h, body) {
    try { await apiFetch(`/chat/hooks/${h.wid}`, { method: 'PATCH', body: JSON.stringify(body), inst }); reload(); } catch (e) { toast(errorText(e.message)); }
  }
  async function avatar(h, f) {
    const fd = new FormData();
    fd.append('file', f);
    try { await uploadFetch(`/chat/hooks/${h.wid}/avatar`, fd, { inst }); reload(); } catch (e) { toast(errorText(e.message)); }
  }
  return (
    <div className="vc-field"><span>Webhooks</span>
      <p className="vc-dialog-sub">{logs ? 'Webhooks are how things post into a logs channel. ' : ''}They work like Discord webhooks: anything that can post to a Discord webhook URL can post to these (content, username, avatar_url and embeds). Keep the URLs secret - anyone with one can post.</p>
      <div className="vc-hooks">
        {list === null && <div className="vc-loading"><i /><i /><i /></div>}
        {list?.map(h => (
          <div key={h.wid} className="vc-hook">
            <label className="vc-hook-av" title="Change picture">
              {h.avatar ? <img src={h.avatar} alt="" /> : <Webhook size={18} />}
              <span><Upload size={12} /></span>
              <input type="file" hidden accept="image/*" onChange={e => { if (e.target.files[0]) avatar(h, e.target.files[0]); e.target.value = ''; }} />
            </label>
            <input className="form-input" maxLength={80} defaultValue={h.name} onBlur={e => { if (e.target.value.trim() && e.target.value !== h.name) patch(h, { name: e.target.value }); }} />
            <button type="button" className="btn btn-surface btn-sm" onClick={() => { navigator.clipboard?.writeText(h.url); toast('Webhook URL copied'); }}><Copy size={13} /> Copy URL</button>
            <button type="button" className="vc-ico-btn" title="New URL (the old one stops working)" onClick={async () => { if (await ask({ title: `New URL for ${h.name}?`, text: 'The old URL stops working straight away.', confirm: 'Make a new URL' })) patch(h, { new_token: true }); }}><RefreshCw size={15} /></button>
            <button type="button" className="vc-ico-btn danger" title="Delete" onClick={async () => {
              if (!(await ask({ title: `Delete ${h.name}?`, text: 'Anything posting to it will stop working. Messages it already sent stay.', confirm: 'Delete webhook', danger: true }))) return;
              try { await apiFetch(`/chat/hooks/${h.wid}`, { method: 'DELETE', inst }); reload(); } catch (e) { toast(errorText(e.message)); }
            }}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-surface" onClick={create}><Plus size={14} /> New webhook</button>
    </div>
  );
}

// ── the roles shop (shown instead of messages) ──
// An instance's paid roles are paid in Velora credits: buying one makes a Velora pay request, which you approve here (signed in
// with Velora) or on Velora's payment page; the instance hands out the role once Velora says it's paid (chat_shop_update).
export function RoleShop({ channel }) {
  const onInst = isInst(channel.cid);
  const signedIn = useChat(s => s.signedIn);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(null);
  const [pay, setPay] = useState(null); // { it, req }: an instance's pay request waiting for approval
  const [credits, setCredits] = useState(null); // my Velora balance (an instance doesn't know it)
  const load = () => apiFetch(`/chat/channels/${channel.cid}/shop`).then(setD).catch(e => toast(errorText(e.message)));
  useEffect(() => { load(); }, [channel.cid, channel.config]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (onInst && signedIn) apiFetch('/account/me').then(x => setCredits(x.account?.credits ?? null)).catch(() => {}); }, [onInst, signedIn, pay]);
  // Ember app logins may lack these (the website always has them): taking a role needs Spend Credits (the server checks it
  // for free roles too), the balance is Viewing Subscriptions. Taking a role OFF needs neither. An instance checks neither.
  const payLack = useScopeStatus('CURRENCY_PAY');
  const readLack = useScopeStatus('CURRENCY_READ');
  async function toggle(it) {
    if (it.pending) { setPay({ it, req: it.pending }); return; }
    if (!onInst && !it.has && payLack) { await scopeBlocked('CURRENCY_PAY'); return; }
    if (!it.has && !it.owned && it.price > 0) {
      if (onInst && d?.payments === 'velora_required') { toast(errorText('velora_required')); return; }
      if (!(await ask({ title: `Buy ${it.role.name}?`, text: `${it.price} credits goes to the server owner${onInst ? ' through Nookara - you approve the payment next' : ''}. You keep it after that - take it off and put it back on whenever you like.${onInst ? (credits != null ? ` You have ${credits} credits.` : '') : readLack || d?.balance == null ? '' : ` You have ${d.balance} credits.`}`, confirm: onInst ? 'Continue' : `Buy for ${it.price} credits` }))) return;
    }
    setBusy(it.role.rid);
    try {
      const r = await apiFetch(`/chat/channels/${channel.cid}/shop/${it.role.rid}`, { method: it.has ? 'DELETE' : 'POST', body: JSON.stringify({ price: it.price }) });
      setD(r);
      if (r.pending && r.pay_request) setPay({ it, req: r.pay_request });
    } catch (e) { toast(errorText(e.message)); load(); }
    setBusy(null);
  }
  const balance = onInst ? (credits != null ? <span className="vc-balance"><Coins size={15} /> {credits.toLocaleString()}</span> : null)
    : d && (readLack || d.balance == null
      ? <span className="vc-balance vc-scope-locked" role="button" tabIndex={0} aria-disabled="true" data-tip={scopeTip(readLack, 'Your credit balance') || 'Your balance is hidden from this login.'} onClick={() => scopeBlocked('CURRENCY_READ')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') scopeBlocked('CURRENCY_READ'); }}><Coins size={15} /> Balance hidden</span>
      : <span className="vc-balance"><Coins size={15} /> {d.balance.toLocaleString()}</span>);
  const paidOff = onInst && d && d.payments !== 'velora';
  return (
    <div className="vc-shop">
      <div className="vc-shop-head">
        <BadgeCheck size={28} />
        <div><h2>#{channel.name}</h2><p>{channel.topic || 'Pick the roles you want.'}</p></div>
        <span className="grow" />
        {balance}
      </div>
      {paidOff && d.items.some(it => it.price > 0 && !it.owned) && <p className="vc-warn-note">{d.payments === 'velora_required' ? 'Paid roles need a Nookara account - yours only exists on this server. Free roles work as usual.' : "This server can't take credit payments right now, so only free roles work."}</p>}
      {!d && <div className="vc-loading"><i /><i /><i /></div>}
      {d && !d.items.length && <div className="vc-empty-note">Nothing in this shop yet.</div>}
      <div className="vc-shop-grid">
        {d?.items.map((it, i) => {
          const locked = !it.has && (onInst ? paidOff && it.price > 0 && !it.owned : !!payLack);
          return (
            <div key={it.role.rid} className={`vc-shop-card vl-rise${it.has ? ' has' : ''}`} style={{ '--i': Math.min(i, 12), '--rc': it.role.color || 'var(--accent)' }}>
              <div className="vc-shop-name">
                {it.role.icon ? <img src={it.role.icon} alt="" /> : <span className="vc-shop-dot" />}
                <b>{it.role.name}</b>
                {it.has && <Check size={15} className="vc-shop-tick" />}
              </div>
              {it.desc && <p>{it.desc}</p>}
              <div className="vc-shop-foot">
                <span className="vc-shop-price">{it.price > 0 ? (it.owned ? 'Bought' : <><Coins size={13} /> {it.price.toLocaleString()}</>) : 'Free'}</span>
                <button type="button" className={`btn btn-sm ${it.has ? 'btn-surface' : 'btn-primary'}${locked ? ' vc-scope-locked' : ''}`} aria-disabled={locked ? 'true' : undefined} data-tip={!it.has && !onInst ? scopeTip(payLack, 'Getting a role') : undefined} disabled={busy === it.role.rid} onClick={() => toggle(it)}>
                  {it.has ? 'Take off' : it.pending ? 'Finish paying' : !it.price ? 'Get role' : it.owned ? 'Put on' : 'Buy'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {pay && <PayRequest channel={channel} it={pay.it} req={pay.req} onDone={r => { if (r) setD(r); setPay(null); }} />}
    </div>
  );
}

// the Cap captcha Velora's payment routes want (skipped while the 2-day captcha pass is active)
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  let el = document.querySelector(`script[data-src="${src}"]`);
  if (!el) { el = Object.assign(document.createElement('script'), { src, async: true }); el.dataset.src = src; document.head.appendChild(el); }
  return new Promise((resolve, reject) => { el.addEventListener('load', () => resolve(), { once: true }); el.addEventListener('error', () => reject(new Error('captcha_unavailable')), { once: true }); if (ready()) resolve(); });
}
const PAY_ERR = { captcha_required: 'Do the captcha first.', captcha_failed: "The captcha didn't go through - try it again.", captcha_unavailable: "The captcha can't be loaded right now - use the payment page instead.", insufficient_balance: "You don't have enough credits for that.", request_paid: 'That payment already went through.', request_expired: 'That payment request ran out - buy the role again.', request_cancelled: 'That payment was cancelled.', wrong_account: 'That payment is for a different Nookara account.', not_found: 'That payment request is gone.' };
const PAY_DONE = { declined: 'The payment was declined - you were not charged.', expired: 'The payment request ran out - buy the role again whenever you like.', failed: "The payment didn't go through - you weren't given the role." };
// "Approve payment of N credits": in-app with the Ember login (needs Spend Credits + a captcha), or on Velora's payment page.
// The id is the only thing taken from the instance: the page is always Velora's own, never a link the instance sent.
function PayRequest({ channel, it, req, onDone }) {
  const signedIn = useChat(s => s.signedIn);
  const payLack = useScopeStatus('CURRENCY_PAY');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({ status: 'pending' });
  const btn = useRef(null);
  const page = /^[\w-]{1,100}$/.test(String(req.id || '')) ? `${location.origin}/payment/${encodeURIComponent(req.id)}` : null;
  const finish = (status, view) => {
    if (status === 'paid') { toast(`You got ${it.role.name}.`, true); onDone(view); return; }
    if (PAY_DONE[status]) setState({ status, view });
  };
  useEffect(() => {
    let live = true;
    const check = () => apiFetch(`/chat/channels/${channel.cid}/shop/${it.role.rid}/status`).then(r => { if (live && r.status !== 'pending' && r.status !== 'none') finish(r.status, r); }).catch(() => {});
    const t = setInterval(check, 4000);
    const on = e => { const m = e.detail; if (m.channel === channel.cid && String(m.rid) === String(it.role.rid)) check(); };
    addEventListener('vc-shop', on);
    return () => { live = false; clearInterval(t); removeEventListener('vc-shop', on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function approve() {
    if (payLack) { await scopeBlocked('CURRENCY_PAY'); return; }
    setBusy(true);
    try {
      await loadScript('/assets/js/captcha-pass.js?v=1', () => !!window.VeloraCaptchaPass);
      await loadScript('/assets/js/velora-cap.js?v=1', () => !!window.VeloraCap);
      const captcha_token = await window.VeloraCap.paymentToken(btn.current);
      await apiFetch(`/bonfire/pay-requests/${encodeURIComponent(req.id)}/approve`, { method: 'POST', body: JSON.stringify({ captcha_token }) });
      setState({ status: 'confirming' });
      const r = await apiFetch(`/chat/channels/${channel.cid}/shop/${it.role.rid}/status`).catch(() => null);
      if (r && r.status !== 'pending') finish(r.status, r);
    } catch (e) { toast(PAY_ERR[e.message] || errorText(e.message)); }
    setBusy(false);
  }
  async function decline() {
    if (signedIn) await apiFetch(`/bonfire/pay-requests/${encodeURIComponent(req.id)}/decline`, { method: 'POST' }).catch(() => {});
    onDone(null);
  }
  const over = PAY_DONE[state.status];
  return (
    <Dialog title={over ? 'Payment not made' : `Approve payment of ${Number(req.amount || it.price).toLocaleString()} credits`} sub={`${it.role.name} - #${channel.name}`} onClose={() => onDone(state.view || null)}>
      {close => (over ? (
        <>
          <p className="vc-dialog-sub">{over}</p>
          <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-primary" onClick={close}>OK</button></div>
        </>
      ) : (
        <>
          <p className="vc-dialog-sub">The credits go from your Nookara account to the server owner. Once Nookara confirms the payment, the role is yours.{req.expires_at ? ` This request runs out at ${new Date(req.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
          {!signedIn && <p className="vc-note"><Coins size={14} /> Sign in to Ember with Nookara to pay here, or approve it on Nookara's payment page.</p>}
          <div className="vc-game-wait"><span className="vc-game-spin" aria-hidden="true" /> {state.status === 'confirming' ? 'Paid - waiting for the server to hand out the role...' : 'Waiting for your approval...'}</div>
          <div className="vc-dialog-btns">
            <button type="button" className="btn btn-surface" onClick={async () => { await decline(); close(); }}>Cancel payment</button>
            <span className="grow" />
            {page && <a className="btn btn-surface" href={page} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Payment page</a>}
            {signedIn && <button ref={btn} type="button" className={`btn btn-primary${payLack ? ' vc-scope-locked' : ''}`} data-tip={scopeTip(payLack, 'Paying')} disabled={busy || state.status === 'confirming'} onClick={approve}><Coins size={14} /> {busy ? 'Paying...' : 'Pay now'}</button>}
          </div>
        </>
      ))}
    </Dialog>
  );
}

// ── Discord-style embeds (webhooks) ──
const hex = n => `#${Number(n).toString(16).padStart(6, '0')}`;
export function Embeds({ list, ctx }) {
  if (!list?.length) return null;
  return list.map((e, i) => (
    <div key={i} className="vc-embed hook" style={e.color != null ? { '--ec': hex(e.color) } : undefined}>
      <div className="vc-embed-main">
        {e.author && (
          <div className="vc-embed-author">
            {e.author.icon_url && <img src={e.author.icon_url} alt="" />}
            {e.author.url ? <a href={e.author.url} target="_blank" rel="noopener noreferrer nofollow">{e.author.name}</a> : <span>{e.author.name}</span>}
          </div>
        )}
        {e.title && (e.url ? <a className="vc-embed-title" href={e.url} target="_blank" rel="noopener noreferrer nofollow">{e.title}</a> : <div className="vc-embed-title">{e.title}</div>)}
        {e.description && <div className="vc-embed-desc">{renderBody(e.description, ctx).nodes}</div>}
        {e.fields?.length > 0 && (
          <div className="vc-embed-fields">
            {e.fields.map((f, j) => <div key={j} className={`vc-embed-field${f.inline ? ' inline' : ''}`}><b>{f.name}</b><div>{renderBody(f.value, ctx).nodes}</div></div>)}
          </div>
        )}
        {e.image && <img className="vc-embed-image vc-viewable" src={e.image.url} alt="" loading="lazy" onClick={() => viewPicture(e.image.url)} />}
        {(e.footer || e.timestamp) && (
          <div className="vc-embed-foot">
            {e.footer?.icon_url && <img src={e.footer.icon_url} alt="" />}
            {e.footer?.text && <span>{e.footer.text}</span>}
            {e.footer?.text && e.timestamp && <span>-</span>}
            {e.timestamp && <span>{new Date(e.timestamp).toLocaleString()}</span>}
          </div>
        )}
      </div>
      {e.thumbnail && <img className="vc-embed-thumb vc-viewable" src={e.thumbnail.url} alt="" loading="lazy" onClick={() => viewPicture(e.thumbnail.url)} />}
    </div>
  ));
}

// locked composer wording for each type
export function lockedTextFor(channel) {
  if (!channel) return null;
  if (channel.type === 'logs' && channel.config?.mode === 'cloudlink') return "You can't send messages in this CloudLink channel.";
  if (channel.type === 'logs') return 'This is a logs channel - only webhooks (and admins) post here.';
  if (channel.type === 'welcome') return 'Join and leave messages show up here.';
  return null;
}
