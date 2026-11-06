// Servers hosted by Velora: "Create a server" (a plan, an address -> Velora starts an Ember server for you, then the normal
// setup dialog names it - or a backup is restored into it), Server settings > Hosting (time left, buy weeks, plan, voice
// minutes, backups, delete) and the "running out" note above you at the bottom left. Like Velora Pro bought with credits,
// Plus is prepaid weeks and never renews by itself: when the time is up the server is overdue for 2 days, then read-only,
// and a week later Velora keeps a backup in your account and shuts it down. Velora's side: /bonfire/hosting/* (PROTOCOL §19).
import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Rocket, Sparkles, Users, Volume2, Upload, Smile, Bot, ArrowLeftRight, KeyRound, TriangleAlert, ScrollText, RefreshCw, Trash2, Coins, Server, ShieldCheck, Archive, Download, CalendarClock, X, Lock, HardDrive, Clock, Pencil } from 'lucide-react';
import { apiFetch, getToken } from '../api.js';
import { Dialog } from './Dialogs.jsx';
import { useChat, patchState, toast, errorText, ask, go } from './store.js';
import { discover, veloraSession, addInstance, moveInstance } from './instances.js';
import { normOrigin, instOf, isInst } from './ids.js';
import { hasVelora, startSignIn } from './session.js';
import { OperatorTermsCheck, TermsLink } from './OperatorTerms.jsx';

// a hosted server's address is e-<slug>.nookara.cc (the host template from /bonfire/hosting/plans); choosing <slug> is a Nookara Pro perk
const DEFAULT_TEMPLATE = 'e-{slug}.nookara.cc';
const tplParts = cfg => (cfg?.host_template || DEFAULT_TEMPLATE).split('{slug}');
// the same rules Nookara checks (bonfire-hosting-slugs.js), so most mistakes show before asking it
export function slugIssue(s) {
  if (s.length < 3) return 'too_short';
  if (s.length > 32) return 'too_long';
  if (!/^[a-z0-9-]+$/.test(s)) return 'invalid_chars';
  if (s.startsWith('-') || s.endsWith('-')) return 'hyphen_edge';
  if (s.includes('--')) return 'double_hyphen';
  return null;
}
const SLUG_DETAIL = { too_short: 'At least 3 characters.', too_long: 'At most 32 characters.', invalid_chars: 'Only lowercase letters, numbers and dashes.', hyphen_edge: "It can't start or end with a dash.", double_hyphen: "Two dashes in a row aren't allowed." };
const until = ms => { const h = Math.floor(ms / 3600000), m = Math.max(1, Math.ceil((ms % 3600000) / 60000)); return h ? `${h} h ${m} min` : `${m} min`; };
const DAY = 86400000;
const slugFrom = name => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const per = p => (p?.period === 'month' ? 'month' : 'week'); // what a paid plan's price buys
const day = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const daysLeft = t => Math.max(0, Math.ceil((t - Date.now()) / DAY));
const sizeOf = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const HOSTING_TEXT = {
  operator_terms_required: 'Accept the Ember Server Operator Terms to create a server.',
  hosting_unavailable: "Nookara can't host servers right now - try again later.", slug_taken: 'That address is taken.', slug_reserved: "That address can't be used.",
  invalid_slug: 'Use 3-32 letters, numbers or dashes (not at the start or end).', pro_required: 'Choosing your own address needs Nookara Pro.',
  address_cooldown: 'You can change the address once every 24 hours.', address_locked: 'This address stays yours, but changing it needs Nookara Pro again.', nothing_to_change: "That's already its address.", insufficient_balance: "You don't have enough credits for that.", insufficient_credits: "You don't have enough credits for that.",
  starter_limit_reached: 'You already have a free Starter server. Pick Plus for another one.', use_weeks: 'Buy weeks of Plus to upgrade.', suspended: "Nookara's staff have suspended this server.",
  hosting_failed: "Nookara couldn't do that on the server right now - try again in a bit.", backup_failed: "The backup didn't work, so nothing was deleted - try again in a bit.",
  insufficient_scope: 'Ember needs the "Spend Credits" permission for that. Sign out of Ember and sign in again, and tick it on the approval screen.', not_owner: "You aren't this server's owner.", backup_not_found: 'That backup is gone.',
};
const hostingError = e => (e?.error === 'insufficient_balance' && e.cost ? `That costs ${Number(e.cost).toLocaleString()} credits - you have ${Number(e.balance || 0).toLocaleString()} credits.` : (e?.detail && SLUG_DETAIL[e.detail]) || HOSTING_TEXT[e?.message || e] || errorText(e?.message || e));

// ── your hosted servers, shared by the settings page and the note at the bottom left (refreshed now and then) ──
let hostedAt = 0;
export function loadHosted(force) {
  if (!getToken() || (!force && Date.now() - hostedAt < 5 * 60000)) return Promise.resolve();
  hostedAt = Date.now();
  return apiFetch('/bonfire/hosting/servers').then(d => patchState({ hosted: d.servers || [], hostedYou: d.you || null })).catch(() => {}); // you: { pro, pro_until }
}
const NONE = []; // (a selector must return the same empty list every time, or the store re-renders forever)
const useHostedFor = origin => useChat(s => (origin ? (s.hosted || NONE).find(h => normOrigin(h.url) === origin) : null));
if (typeof window !== 'undefined') { addEventListener('focus', () => loadHosted()); }

// what a plan gives, as short lines with icons
function limitLines(l = {}) {
  return [
    [Users, l.member_cap ? `Up to ${plural(l.member_cap, 'member')}` : 'No member limit'],
    [Volume2, l.voice_minutes ? `${l.voice_minutes.toLocaleString()} voice minutes a month` : 'Voice chat'],
    [Upload, `Files up to ${l.max_upload_mb || 25} MB`],
    [HardDrive, l.storage_mb ? `${l.storage_mb >= 1024 ? `${+(l.storage_mb / 1024).toFixed(1)} GB` : `${l.storage_mb} MB`} of file storage` : null],
    [Smile, l.emojis ? `${l.emojis} custom emojis, ${l.sounds || 0} sounds` : 'Unlimited emojis and sounds'],
    [Bot, l.bots ? plural(l.bots, 'bot') : 'Unlimited bots'],
    [ArrowLeftRight, l.bridges ? 'Discord and Fluxer bridges' : 'No Discord / Fluxer bridges'],
    [KeyRound, l.custom_voice_keys ? 'Your own Cloudflare voice keys' : null],
  ].filter(([, t]) => t);
}
// Self-hosted isn't a Velora plan: it's the card for running Ember Server yourself (everything, free)
const SELF_REPO = 'https://github.com/Ikelene/bonfire-server';
const selfLines = starterVoice => [
  [Server, 'Runs on your own machine (Docker or Node.js)'],
  [Sparkles, 'Every feature, no limits'],
  [Volume2, `${starterVoice ? starterVoice.toLocaleString() : 'Some'} voice minutes a month from Nookara - unlimited with your own Cloudflare keys`],
  [Archive, 'Your data stays with you; backups any time'],
  [KeyRound, 'Nookara accounts or its own accounts'],
];
function PlanCard({ plan, on, onPick, current, disabled, note, pro }) {
  const paid = plan.price_credits > 0 && !(pro && plan.free_with_pro); // with Velora Pro, Plus costs nothing
  return (
    <button type="button" className={`bf-plan${on ? ' on' : ''}${paid ? ' paid' : ''}`} disabled={disabled} onClick={onPick} aria-pressed={on}>
      <span className="bf-plan-head">
        {plan.self ? <Server size={18} /> : paid ? <Sparkles size={18} /> : <Rocket size={18} />}
        <b>{plan.name}</b>
        {current && <small className="vc-chip">Current</small>}
        <span className="grow" />
        <span className="bf-plan-price">{paid ? <><Coins size={13} /> {plan.price_credits.toLocaleString()}<small> / {per(plan)}</small></> : plan.price_credits > 0 ? <><Sparkles size={13} /> Free with Pro</> : 'Free'}</span>
      </span>
      {plan.free_with_pro && !pro && <small className="bf-plan-note">Free with Nookara Pro</small>}
      <ul>{(plan.self ? plan.lines : limitLines(plan.limits)).map(([I, t]) => <li key={t}><I size={14} /> {t}</li>)}</ul>
      {note && <small className="bf-plan-note">{note}</small>}
    </button>
  );
}
// how many weeks to buy: a few quick picks, and what it costs
const WEEK_PICKS = [1, 4, 12, 26, 52];
function WeeksPicker({ plan, weeks, setWeeks }) {
  return (
    <div className="vc-field"><span>How long</span>
      <div className="bf-weeks">
        {WEEK_PICKS.map(w => <button type="button" key={w} className={weeks === w ? 'on' : ''} onClick={() => setWeeks(w)}>{plural(w, per(plan))}</button>)}
      </div>
      <small className="vc-hint"><Coins size={12} className="vc-inline-ico" /> {(weeks * plan.price_credits).toLocaleString()} from your Nookara credits. It doesn't renew by itself - buy more time whenever you like.</small>
    </div>
  );
}

// ── Create a server: plan (or a backup) -> address -> Velora starts it -> sign in -> the normal setup (name, icon, import) ──
export function CreateServer({ onClose, onSetup, onAddByAddress }) {
  const [cfg, setCfg] = useState(null); // { available, domain, url_template, plans, starter_limit_per_account }
  const [backups, setBackups] = useState([]);
  const [plan, setPlan] = useState('starter');
  useEffect(() => { if (cfg && !cfg.available) setPlan('self'); }, [cfg]);
  const [weeks, setWeeks] = useState(4);
  const [restore, setRestore] = useState(null); // a backup to bring back
  const [step, setStep] = useState('plan'); // plan | address | work
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [terms, setTerms] = useState(false); // Ember Server Operator Terms (required to host a server)
  const [touched, setTouched] = useState(false); // typed an address of their own (stop following the name)
  const [check, setCheck] = useState(null); // { slug, available, reason }
  const [progress, setProgress] = useState(0); // 0 reserve, 1 start, 2 sign in
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const signedIn = hasVelora();
  const mine = useChat(s => s.hosted || NONE);
  const pro = useChat(s => !!s.hostedYou?.pro); // Velora Pro: Plus is free

  useEffect(() => {
    apiFetch('/bonfire/hosting/plans').then(setCfg).catch(e => setCfg({ available: false, error: e.message }));
    if (signedIn) { loadHosted(true); apiFetch('/bonfire/hosting/backups').then(d => setBackups(d.backups || [])).catch(() => {}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plans = cfg?.plans || [];
  const selfPlan = { id: 'self', self: true, name: 'Self-hosted', price_credits: 0, lines: selfLines(plans.find(p => p.id === 'starter')?.limits?.voice_minutes) };
  const chosen = plan === 'self' ? selfPlan : plans.find(p => p.id === plan);
  const starters = mine.filter(s => s.plan === 'starter' && s.billing !== 'archived').length;
  const starterFull = cfg?.starter_limit_per_account != null && starters >= cfg.starter_limit_per_account;
  useEffect(() => { if (starterFull && plan === 'starter') setPlan('plus'); }, [starterFull]); // eslint-disable-line react-hooks/exhaustive-deps
  const urlFor = s => (cfg?.url_template ? cfg.url_template.replace('{slug}', s || 'your-server') : `https://${(cfg?.host_template || DEFAULT_TEMPLATE).replace('{slug}', s || 'your-server')}`);
  const [pre, post] = tplParts(cfg);
  // Nookara Pro: the address follows the name until it's edited (empty = a random one); availability is checked as you type.
  // Everyone else gets a random address.
  useEffect(() => { if (!touched && pro) setSlug(slugFrom(name)); }, [name, pro]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimeout(timer.current);
    if (!slug || !pro) { setCheck(null); return undefined; }
    const issue = slugIssue(slug);
    if (issue) { setCheck({ slug, available: false, reason: 'invalid_slug', detail: issue }); return undefined; }
    setCheck({ slug, checking: true });
    timer.current = setTimeout(() => apiFetch(`/bonfire/hosting/slug/${encodeURIComponent(slug)}`).then(d => setCheck({ slug, ...d, reason: d.reason && ({ invalid: 'invalid_slug', reserved: 'slug_reserved', taken: 'slug_taken' }[d.reason] || d.reason) })).catch(e => setCheck({ slug, available: false, reason: e.message })), 350);
    return () => clearTimeout(timer.current);
  }, [slug, pro]);
  function pickBackup(b) { setRestore(b); setName(b.name || b.slug); setTouched(true); setSlug(pro && b.slug && !slugIssue(b.slug) ? b.slug : ''); setStep('address'); }
  const addressOk = !pro || !slug || !!check?.available;

  async function create() {
    setStep('work'); setErr(''); setProgress(0);
    try {
      const d = await apiFetch('/bonfire/hosting/servers', { method: 'POST', body: JSON.stringify({ accept_operator_terms: true, ...(pro && slug ? { host_slug: slug } : {}), name: name.trim(), plan, ...(chosen?.price_credits > 0 ? { weeks } : {}), ...(restore ? { restore_backup: restore.id } : {}) }) });
      const origin = normOrigin(d.url || d.server?.url);
      loadHosted(true);
      setProgress(1);
      let found = null; // Velora waited for it to answer; it may still be warming up here (a restore takes a little longer)
      for (let i = 0; i < 45 && !(found && (!restore || found.info.community)); i++) { found = await discover(origin).catch(() => null); if (!(found && (!restore || found.info.community))) await new Promise(r => setTimeout(r, 2000)); }
      if (!found) throw new Error('instance_unreachable');
      setProgress(2);
      await addInstance(found.origin, found.info, await veloraSession(found.origin));
      onClose();
      if (found.info.community) setTimeout(() => go({ kind: 'instance', inst: found.origin }), 200); // restored: it's ready
      else setTimeout(() => onSetup?.(found.origin, name.trim()), 200);
    } catch (e) { setErr(hostingError(e)); setStep('address'); }
  }


  const sub = step === 'plan' ? 'Nookara runs it for you. Pick a plan - you can change it any time.' : step === 'address' ? (restore ? `Bringing back ${restore.name || restore.slug} from its backup.` : 'Name it and pick its address. People add it to Ember with this address.') : 'Setting up your server...';
  return (
    <Dialog title={restore ? 'Restore a server' : 'Create a server'} sub={sub} onClose={onClose} wide className="bf-create">
      {close => (
        <>
          {!cfg && <div className="vc-loading"><i /><i /><i /></div>}
          {cfg && step === 'plan' && (
            <>
              {!cfg.available && <p className="vc-note"><TriangleAlert size={14} /> {hostingError(cfg.error || 'hosting_unavailable')} You can still run one yourself.</p>}
              <div className="bf-plans">
                {cfg.available && plans.map(p =>
 <PlanCard key={p.id} plan={p} pro={pro} on={plan === p.id} onPick={() => setPlan(p.id)} disabled={p.id === 'starter' && starterFull} note={p.id === 'starter' && starterFull ? 'You already have a free server.' : null} />)}
                <PlanCard plan={selfPlan} on={plan === 'self'} onPick={() => setPlan('self')} note="Free and open source (AGPL-3.0). Needs the operator terms." />
              </div>
              {plan === 'self' && <p className="vc-note"><ScrollText size={14} /> <span>Self-hosting an Ember server means accepting the <TermsLink />.</span></p>}
              {backups.length > 0 && (
                <div className="vc-field"><span>Or bring one back</span>
                  <div className="vc-rows">{backups.map(b => (
                    <button type="button" key={b.id} className="vc-list-row bf-backup-pick" onClick={() => pickBackup(b)}>
                      <Archive size={18} /><span className="vc-list-txt"><b>{b.name || b.slug}</b><small>{b.slug} - saved {day(b.created_at)} - {sizeOf(b.size || 0)}</small></span><span className="grow" /><RefreshCw size={14} /> Restore
                    </button>))}</div></div>
              )}
              <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={close}>Cancel</button><span className="grow" />
                {plan !== 'self' && !signedIn
                  ? <button type="button" className="btn btn-primary" onClick={() => startSignIn({ create: 1 })}><ShieldCheck size={15} /> Sign in with Nookara to continue</button>
                  : <button type="button" className="btn btn-primary" disabled={!chosen} onClick={() => { setRestore(null); setStep(plan === 'self' ? 'self' : 'address'); }}>Continue</button>}</div>

            </>
          )}
          {step === 'self' && (
            <>
              <ol className="bf-self-steps">
                <li><b>Get Ember Server</b><span>Download it from <a href={SELF_REPO} target="_blank" rel="noreferrer">GitHub</a> (or clone it) on the machine that will run it.</span></li>
                <li><b>Start it</b><span>With Docker, in its folder:</span><code className="bf-code">docker compose up -d --build</code><span>Or with Node.js 22.13 or newer: <code>npm install</code> then <code>npm start</code>. Set <code>public_url</code> in <code>data/config.json</code> to the address people will use (https).</span></li>
                <li><b>Accept the operator terms</b><span>Running an Ember server means accepting the <TermsLink />. The first time you claim it here, you'll tick a box to say you have.</span></li>
                <li><b>Add it here</b><span>Add a server by its address, sign in, and claim it with the setup code it prints the first time it starts. Then name it or import a server.</span></li>
              </ol>
              <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={() => setStep('plan')}>Back</button><span className="grow" />
                <a className="btn btn-surface" href={SELF_REPO} target="_blank" rel="noreferrer"><Download size={14} /> Ember Server</a>
                <button type="button" className="btn btn-primary" onClick={() => { close(); setTimeout(() => onAddByAddress?.(), 200); }}><Globe size={14} /> Add it by its address</button></div>

            </>
          )}
          {cfg?.available && step === 'address' && (
            <form onSubmit={e => { e.preventDefault(); if (addressOk && name.trim() && terms) create(); }}>
              {restore && (
                <div className="bf-plans">{plans.map(p => <PlanCard key={p.id} plan={p} pro={pro} on={plan === p.id} onPick={() => setPlan(p.id)} disabled={p.id === 'starter' && starterFull} />)}</div>
              )}
              <label className="vc-field"><span>Server name</span><input className="form-input" autoFocus maxLength={60} placeholder="My server" value={name} onChange={e => setName(e.target.value)} /></label>
              {pro ? (
                <label className="vc-field"><span>Address</span>
                  <div className="bf-slug">{pre && <span className="bf-slug-pre">{pre}</span>}<input className="form-input" maxLength={32} value={slug} placeholder="random" spellCheck={false} onChange={e => { setTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} aria-label="Address" />
                    <span className="bf-slug-rest">{post}</span></div>
                  <small className={`vc-hint${check && !check.checking && !check.available ? ' vc-err' : ''}`}>
                    {!slug ? <><Sparkles size={12} className="vc-inline-ico" /> Nookara Pro: pick the address, or leave it empty for a random one. You can change it once a day.</> : !check ? 'Letters, numbers and dashes.' : check.checking ? 'Checking...' : check.available ? <><Check size={12} className="vc-inline-ico" /> <Globe size={12} className="vc-inline-ico" /> {urlFor(slug)} is free.</> : hostingError({ message: check.reason || 'slug_taken', detail: check.detail })}
                  </small></label>
              ) : (
                <div className="vc-field"><span>Address</span>
                  <small className="vc-hint"><Globe size={12} className="vc-inline-ico" /> It gets a random address like {urlFor('x7k2m9qp').replace(/^https?:\/\//, '')}. <a href="/upgrade" target="_blank" rel="noreferrer">Nookara Pro</a> lets you choose your own (e.g. {(pre || '') + 'yourname' + (post || '')}) and change it once a day.</small></div>
              )}
              {chosen?.price_credits > 0 && !(pro && chosen.free_with_pro) ? <WeeksPicker plan={chosen} weeks={weeks} setWeeks={setWeeks} />
                : chosen && <p className="vc-note">{chosen.price_credits > 0 ? <><Sparkles size={14} /> {chosen.name}: free with your Nookara Pro, for as long as you have it.</> : <><Rocket size={14} /> {chosen.name}: free.</>}</p>}

              <OperatorTermsCheck checked={terms} onChange={setTerms} />
              {err && <p className="vc-err"><TriangleAlert size={14} /> {err}</p>}
              <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" onClick={() => { setRestore(null); setStep('plan'); }}>Back</button><span className="grow" />
                <button type="submit" className="btn btn-primary" disabled={!addressOk || !name.trim() || !terms}>{restore ? <><RefreshCw size={15} /> Restore server</> : <><Rocket size={15} /> Create server</>}</button></div>
            </form>
          )}
          {step === 'work' && (
            <ol className="bf-steps">
              {['Reserving the address', restore ? 'Starting it and restoring the backup' : 'Starting your server', 'Signing you in'].map((t, i) => (
                <li key={t} className={progress > i ? 'done' : progress === i ? 'on' : ''}>{progress > i ? <Check size={15} /> : progress === i ? <i className="vc-gate-spin" /> : <span className="bf-step-dot" />} {t}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </Dialog>
  );
}

// the state of a hosted server's paid time, in words: [level '' | 'near' | 'warn' | 'full', title, text]
export function billingState(h) {
  if (!h || h.billing === 'pro' || (h.plan === 'starter' && h.billing === 'active')) return null; // (Velora Pro covers it: nothing runs out)
  if (h.billing === 'read_only') return ['full', 'Read-only - time ran out', `Nobody can post until you buy more time.${h.archive_at ? ` On ${day(h.archive_at)} Nookara saves a backup to your account and shuts the server down.` : ''}`];
  if (h.billing === 'overdue') return ['warn', 'Plus time ran out', `The server goes read-only${h.read_only_at ? ` on ${day(h.read_only_at)}` : ' soon'} unless you buy more time.`];
  if (h.billing === 'archived') return ['full', 'Shut down', 'Nookara kept a backup in your account - restore it from Create a server.'];
  if (h.paid_until && h.paid_until - Date.now() < 3 * DAY) { const n = daysLeft(h.paid_until); return ['near', n <= 1 ? 'Plus ends tomorrow' : `Plus ends in ${n} days`, `Paid until ${day(h.paid_until)}. It doesn't renew by itself.`]; }
  return null;
}

// ── the owner, looking at their hosted server: its Plus time is nearly up / ran out. Above you at the bottom left, next to
// the voice-minutes note; dismissed per server, state and day, so it comes back daily until it's sorted ──
export function HostingNote() {
  const view = useChat(s => s.view);
  const origin = view.kind === 'channel' && view.sid && isInst(view.sid) ? instOf(view.sid) : null;
  const inst = useChat(s => (origin ? s.instances.find(i => i.origin === origin) : null));
  const h = useHostedFor(inst?.isOwner && inst.managed ? origin : null);
  const [, redraw] = useState(0);
  useEffect(() => { if (inst?.isOwner && inst.managed) loadHosted(); }, [origin, inst?.isOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = billingState(h);
  if (!st) return null;
  const key = `bf_host_note:${origin}:${h.billing}:${new Date().toISOString().slice(0, 10)}`;
  try { if (localStorage.getItem(key)) return null; } catch { /* fine */ }
  const dismiss = () => { try { localStorage.setItem(key, '1'); } catch { /* fine */ } redraw(n => n + 1); };
  return (
    <div className={`vc-quota-note ${st[0] === 'near' ? 'near' : 'full'}`} role="status">
      <button type="button" className="vc-quota-x" aria-label="Dismiss" onClick={dismiss}><X size={14} /></button>
      <b>{h.billing === 'read_only' ? <Lock size={14} /> : <CalendarClock size={14} />} {st[1]}</b>
      <span>{st[2]}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'settings', sid: view.sid, tab: 'hosting' } }))}>Buy more time</button>
    </div>
  );
}

// a backup, saved to a file (it's the owner's data: the same zip Ember's export makes)
async function downloadBackup(b) {
  try {
    const r = await fetch(`/bonfire/hosting/backups/${b.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'request_failed');
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `${b.slug}-${new Date(b.created_at).toISOString().slice(0, 10)}.zip` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) { toast(hostingError(e)); }
}

// ── Server settings > Hosting > Address: e-<slug>.nookara.cc. Nookara Pro owners pick <slug> and change it once per 24 hours
// (the old address redirects for 14 days); without Pro the address is random; after Pro ends a chosen one stays, frozen ──
function AddressCard({ h, cfg, origin }) {
  const a = h.address || { state: 'pro_only', url: h.url, host_slug: h.host_slug };
  const [pre, post] = tplParts(cfg || { host_template: a.template });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(a.host_slug || '');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const timer = useRef(null);
  useEffect(() => { if (a.state !== 'cooldown') return undefined; const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t); }, [a.state]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!editing || !val || val === a.host_slug) { setCheck(null); return undefined; }
    const issue = slugIssue(val);
    if (issue) { setCheck({ available: false, reason: 'invalid_slug', detail: issue }); return undefined; }
    setCheck({ checking: true });
    timer.current = setTimeout(() => apiFetch(`/bonfire/hosting/slug/${encodeURIComponent(val)}?server=${encodeURIComponent(h.slug)}`).then(d => setCheck({ ...d, reason: d.reason && ({ invalid: 'invalid_slug', reserved: 'slug_reserved', taken: 'slug_taken' }[d.reason] || d.reason) })).catch(e => setCheck({ available: false, reason: e.message })), 350);
    return () => clearTimeout(timer.current);
  }, [val, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = a.next_change_at ? a.next_change_at - Date.now() : 0;
  async function save() {
    if (!(await ask({ title: `Move to ${pre}${val}${post}?`, text: `People reach the server at the new address right away. The old one, ${(a.url || '').replace(/^https?:\/\//, '')}, redirects for 14 days, then stops working. You can change it again in 24 hours.`, confirm: 'Change address' }))) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/bonfire/hosting/servers/${h.slug}/address`, { method: 'PUT', body: JSON.stringify({ host_slug: val }) });
      setEditing(false);
      await loadHosted(true);
      toast('Address changed. The old one redirects for 14 days.', true);
      const to = normOrigin(d.server?.url), from = normOrigin(d.old_url) || origin;
      if (to && from && to !== from) moveInstance(from, to); // this device follows right away (everyone else on their next connect)
    } catch (e) { setCheck({ available: false, reason: e.message, detail: e.detail }); }
    setBusy(false);
  }
  return (
    <div className="card bf-ss-card">
      <div className="card-header"><span className="card-title"><Globe size={15} /> Address</span></div>
      <div className="card-body">
        {!editing && (
          <div className="cs-row"><div className="cs-text"><b>{(a.url || h.url || '').replace(/^https?:\/\//, '')}</b>
            <span>{a.state === 'editable' ? 'Your own address, with Nookara Pro. You can change it once every 24 hours.'
              : a.state === 'cooldown' ? <><Clock size={12} className="vc-inline-ico" /> Changed recently - you can change it again in {until(left)}{a.next_change_at ? ` (${new Date(a.next_change_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}.</>
              : a.state === 'locked' ? <><Lock size={12} className="vc-inline-ico" /> You chose this address with Nookara Pro. It stays yours, but changing it needs <a href="/upgrade" target="_blank" rel="noreferrer">Nookara Pro</a> again.</>
              : <>A random address. With <a href="/upgrade" target="_blank" rel="noreferrer">Nookara Pro</a> you choose your own ({pre}yourname{post}) and can change it once a day.</>}</span></div>
            {(a.state === 'editable' || a.state === 'cooldown') && <button type="button" className="btn btn-surface" disabled={a.state !== 'editable'} onClick={() => { setVal(a.host_slug || ''); setEditing(true); }}><Pencil size={14} /> Change</button>}
          </div>
        )}
        {editing && (
          <form onSubmit={e => { e.preventDefault(); if (check?.available && !busy) save(); }}>
            <div className="bf-addr-row">
              <div className="bf-slug">{pre && <span className="bf-slug-pre">{pre}</span>}<input className="form-input" autoFocus maxLength={32} value={val} spellCheck={false} aria-label="New address" onChange={e => setVal(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /><span className="bf-slug-rest">{post}</span></div>
            </div>
            <small className={`vc-hint${check && !check.checking && !check.available ? ' vc-err' : ''}`}>
              {!check ? '3-32 lowercase letters, numbers and dashes.' : check.checking ? 'Checking...' : check.available ? <><Check size={12} className="vc-inline-ico" /> {pre}{val}{post} is free.</> : hostingError({ message: check.reason || 'slug_taken', detail: check.detail })}
            </small>
            <div className="vc-dialog-btns"><button type="button" className="btn btn-surface" disabled={busy} onClick={() => { setEditing(false); setCheck(null); }}>Cancel</button><span className="grow" />
              <button type="submit" className="btn btn-primary" disabled={busy || !check?.available}>{busy ? 'Moving...' : 'Change address'}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Server settings > Hosting (the owner of a Velora-hosted server) ──
export function HostingPage({ origin }) {
  const h = useHostedFor(origin);
  const you = useChat(s => s.hostedYou);

  const [loaded, setLoaded] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [weeks, setWeeks] = useState(4);
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState('');
  const loadBackups = () => apiFetch('/bonfire/hosting/backups').then(d => setBackups(d.backups || [])).catch(() => setBackups([]));
  useEffect(() => { loadHosted(true).then(() => setLoaded(true)); apiFetch('/bonfire/hosting/plans').then(setCfg).catch(() => {}); loadBackups(); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!h && !loaded) return <div className="vc-loading"><i /><i /><i /></div>;
  if (!h) return <div className="bf-ss-page"><p className="vc-hint">Only the server's owner sees its hosting. Sign in to Ember with the owner's Nookara account.</p></div>;
  const plans = cfg?.plans || [];
  const plus = plans.find(p => p.price_credits > 0);
  const cur = plans.find(p => p.id === h.plan);
  const v = h.voice || {};
  const pct = v.cap_minutes ? Math.min(100, (v.used_minutes / v.cap_minutes) * 100) : 0;
  const st = billingState(h);
  const mineBackups = (backups || []).filter(b => b.slug === h.slug);
  const pro = !!you?.pro;
  const saved = Math.round((h.paused_ms || 0) / 86400000);
  async function proUpgrade() {
    if (!(await ask({ title: `Switch to ${plus.name}?`, text: `It's free with your Nookara Pro, for as long as you have it. ${h.name || h.slug} moves to ${plus.name} right away.`, confirm: `Switch to ${plus.name}` }))) return;
    setBusy('buy');
    try { await apiFetch(`/bonfire/hosting/servers/${h.slug}/weeks`, { method: 'POST', body: JSON.stringify({ weeks: 1 }) }); await loadHosted(true); toast(`Welcome to ${plus.name}!`, true); }
    catch (e) { toast(hostingError(e)); }
    setBusy('');
  }
  async function buy() {
    if (!plus) return;
    const cost = weeks * plus.price_credits;
    if (!(await ask({ title: `Buy ${plural(weeks, per(plus))} of ${plus.name}?`, text: `${cost.toLocaleString()} credits from your Nookara credits.${h.plan === 'starter' ? ` ${h.name || h.slug} moves to ${plus.name} right away.` : ''} It doesn't renew by itself.`, confirm: `Pay ${cost.toLocaleString()} credits` }))) return;
    setBusy('buy');
    try { await apiFetch(`/bonfire/hosting/servers/${h.slug}/weeks`, { method: 'POST', body: JSON.stringify({ weeks }) }); await loadHosted(true); toast(h.billing === 'read_only' ? 'Paid - the server is open again.' : 'Paid. Thank you!', true); }
    catch (e) { toast(hostingError(e)); }
    setBusy('');
  }
  async function toStarter() {
    const s = plans.find(p => p.price_credits === 0);
    if (!s || !(await ask({ title: `Switch to ${s.name}?`, text: `It's free, and it switches now - any ${cur?.name || 'Plus'} time left is not refunded.${s.limits?.member_cap ? ` Past ${s.limits.member_cap} members, nobody new can join until it's under the limit again.` : ''}`, confirm: `Switch to ${s.name}` }))) return;
    setBusy('plan');
    try { await apiFetch(`/bonfire/hosting/servers/${h.slug}`, { method: 'PATCH', body: JSON.stringify({ plan: s.id }) }); await loadHosted(true); toast('Saved.', true); }
    catch (e) { toast(hostingError(e)); }
    setBusy('');
  }
  async function restart() {
    if (!(await ask({ title: 'Restart the server?', text: 'Everyone is disconnected for a moment while it starts again.', confirm: 'Restart' }))) return;
    setBusy('restart');
    try { await apiFetch(`/bonfire/hosting/servers/${h.slug}/restart`, { method: 'POST' }); toast('Restarting...', true); setTimeout(() => loadHosted(true), 4000); } catch (e) { toast(hostingError(e)); }
    setBusy('');
  }
  async function del() {
    const word = h.host_slug || h.slug;
    if (!(await ask({ title: `Delete ${h.name || word}?`, text: 'Nookara saves a backup to your account first, then shuts the server down and deletes it. You can restore the backup later from Create a server.', match: word, confirm: 'Delete server', danger: true }))) return;
    try { await apiFetch(`/bonfire/hosting/servers/${h.slug}`, { method: 'DELETE', body: JSON.stringify({ confirm: word }) }); loadHosted(true); toast('Deleted. A backup is in your account.', true); go({ kind: 'home' }); } catch (e) { toast(hostingError(e)); }
  }
  async function dropBackup(b) {
    if (!(await ask({ title: 'Delete this backup?', text: "It's gone for good - download it first if you might want it.", confirm: 'Delete backup', danger: true }))) return;
    try { await apiFetch(`/bonfire/hosting/backups/${b.id}`, { method: 'DELETE' }); loadBackups(); } catch (e) { toast(hostingError(e)); }
  }
  const status = { running: ['ok', 'Running'], provisioning: ['', 'Starting...'], stopped: ['warn', 'Stopped'], suspended: ['warn', "Suspended by Nookara's staff"], error: ['warn', 'Something went wrong'] }[h.status] || ['', h.status];
  return (
    <div className="bf-ss-page">
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Server size={15} /> Hosted by Nookara</span></div>
        <div className="card-body">
          <div className="cs-row"><div className="cs-text"><b><Globe size={13} className="vc-inline-ico" /> {h.url}</b><span className={`bf-host-status ${status[0]}`}>{status[1]}{h.last_error && h.status === 'error' ? ` - ${h.last_error}` : ''}</span></div>
            <button type="button" className="btn btn-surface" disabled={!!busy} onClick={restart}><RefreshCw size={14} /> Restart</button></div>
        </div>
      </div>
      <AddressCard h={h} cfg={cfg} origin={origin} />
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Sparkles size={15} /> Plan</span></div>
        <div className="card-body">
          {h.billing === 'pro' && <p className="vc-note"><Sparkles size={14} /> <span><b>Covered by your Nookara Pro.</b> {saved > 0 ? `Your ${plural(saved, 'day')} of paid ${plus?.name || 'Plus'} time are saved and pick up again if Pro ends.` : `If Pro ends, buy weeks to keep ${plus?.name || 'Plus'}.`}</span></p>}
          {st && <p className={`vc-note ${st[0] === 'near' ? '' : 'warn'}`}>{h.billing === 'read_only' ? <Lock size={14} /> : <CalendarClock size={14} />} <span><b>{st[1]}.</b> {st[2]}</span></p>}
          <div className="bf-plans">
            {plans.map(p => <PlanCard key={p.id} plan={p} pro={pro} current={h.plan === p.id} on={h.plan === p.id} disabled
              note={h.plan === p.id && p.price_credits > 0 && h.paid_until ? (h.paid_until > Date.now() ? `Paid until ${day(h.paid_until)}` : `Ran out ${day(h.paid_until)}`) : null} />)}
          </div>
          {plus && pro && (
            <div className="vc-dialog-btns">
              {h.plan !== 'starter' && <button type="button" className="btn btn-surface" disabled={!!busy} onClick={toStarter}>Switch to the free plan</button>}
              <span className="grow" />
              {h.plan === 'starter' && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={proUpgrade}><Sparkles size={14} /> {busy === 'buy' ? 'Switching...' : `Switch to ${plus.name} - free with Pro`}</button>}
            </div>
          )}
          {plus && !pro && (
            <>
              <h4 className="bf-ss-sub">{h.plan === 'starter' ? `Upgrade to ${plus.name}` : 'Buy more time'}</h4>
              <WeeksPicker plan={plus} weeks={weeks} setWeeks={setWeeks} />
              <div className="vc-dialog-btns">
                {h.plan !== 'starter' && <button type="button" className="btn btn-surface" disabled={!!busy} onClick={toStarter}>Switch to the free plan</button>}
                <span className="grow" />
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={buy}><Coins size={14} /> {busy === 'buy' ? 'Paying...' : `Pay ${(weeks * plus.price_credits).toLocaleString()} credits`}</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Volume2 size={15} /> Voice this month</span></div>
        <div className="card-body">
          {v.cap_minutes ? (
            <>
              <div className={`vc-quota-bar lg${pct >= 100 ? ' full' : pct >= 80 ? ' near' : ''}`}><i style={{ width: `${pct}%` }} /></div>
              <small className="vc-hint">{(v.used_minutes || 0).toLocaleString()} of {v.cap_minutes.toLocaleString()} minutes used. Each person in a voice channel counts, every minute; it starts again on the 1st.</small>
            </>
          ) : <small className="vc-hint">No limit.</small>}
        </div>
      </div>
      <div className="card bf-ss-card">
        <div className="card-header"><span className="card-title"><Archive size={15} /> Backups</span></div>
        <div className="card-body">
          <small className="vc-hint">Nookara saves one to your account when a server is deleted or shut down for running out of time. Make, save and restore backups any time under Backups; a backup also restores into a new server from Create a server.</small>
          {backups === null ? <div className="vc-loading"><i /><i /><i /></div> : !mineBackups.length ? <p className="vc-hint">No backups of this server yet.</p> : (
            <div className="vc-rows vc-gap-top">{mineBackups.map(b => (
              <div key={b.id} className="vc-list-row">
                <Archive size={18} /><span className="vc-list-txt"><b>{day(b.created_at)}</b><small>{{ archived: 'Time ran out', deleted: 'Deleted', manual: 'Saved by you' }[b.reason] || b.reason} - {sizeOf(b.size || 0)}</small></span><span className="grow" />
                <button type="button" className="btn btn-surface btn-sm" onClick={() => downloadBackup(b)}><Download size={13} /> Download</button>
                <button type="button" className="vc-ico-btn danger" title="Delete backup" onClick={() => dropBackup(b)}><Trash2 size={15} /></button>
              </div>))}</div>
          )}
        </div>
      </div>
      <div className="card bf-ss-card bf-ss-danger">
        <div className="card-header"><span className="card-title"><Trash2 size={15} /> Delete</span></div>
        <div className="card-body"><div className="cs-row"><div className="cs-text"><b>Delete this server</b><span>Nookara saves a backup to your account, then shuts it down and deletes it.</span></div>
          <button type="button" className="btn btn-danger" onClick={del}><Trash2 size={14} /> Delete server</button></div></div>
      </div>
    </div>
  );
}
