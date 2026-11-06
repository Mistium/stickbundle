// Plan limits on Velora-hosted ("managed") Ember servers. The server answers 403 `plan_limit` { what, limit, used?, plan? } (a number
// reached, or limit false / 0 for a feature the plan doesn't have) or `plan_feature` { what, limit: 0|null, plan, message } (a feature the
// plan doesn't include at all). This file turns those into one clear card over the dimmed page: "Not included in your plan" with Upgrade / Self-host,
// and an inline notice for "you've used N of M". Pages use usePlan(what, used): it knows the answer up front (from the plan the server
// reports) and also catches the error from a request (catchPlan). Everything is read defensively: unknown fields are ignored.
import { createContext, useContext, useState } from 'react';
import { Lock, Rocket, Server, TriangleAlert } from 'lucide-react';

export const SELF_HOST_URL = 'https://github.com/Ikelene/bonfire-server#readme'; // (no Ember self-hosting guide on /guides yet: the server's own README)

// feature key -> [Name at the start of a sentence, plural noun for "used N of M ___"]
const NAMES = {
  bots: ['Bots', 'bots'], bridges: ['Bridges to Discord and Fluxer', 'bridges'], emojis: ['Custom emojis', 'emojis'], sounds: ['The soundboard', 'sounds'],
  custom_voice_keys: ['Your own voice keys', 'voice keys'], member_cap: ['More members', 'members'], max_upload_mb: ['Larger uploads', 'MB per file'],
  backups: ['Backups', 'backups'], game: ['Game servers (Ember Link)', 'game servers'], webhooks: ['Webhooks', 'webhooks'],
};
const ALIAS = {
  bot: 'bots', bridge: 'bridges', emoji: 'emojis', sound: 'sounds', soundboard: 'sounds', members: 'member_cap', member: 'member_cap', cap: 'member_cap',
  upload: 'max_upload_mb', uploads: 'max_upload_mb', upload_mb: 'max_upload_mb', upload_size: 'max_upload_mb', voice_keys: 'custom_voice_keys', voice: 'custom_voice_keys',
  backup: 'backups', game_servers: 'game', game_server: 'game', bonfire_link: 'game', link: 'game', minecraft: 'game', webhook: 'webhooks',
};
export const canon = what => { const k = String(what || '').toLowerCase().replace(/[\s-]+/g, '_'); return ALIAS[k] || k; };
export const featureName = what => NAMES[canon(what)]?.[0] || (String(what || '') ? `${String(what).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}` : 'This');
const nounOf = what => NAMES[canon(what)]?.[1] || String(what || 'items').replace(/_/g, ' ');
const planLabel = p => { const n = typeof p === 'string' ? p : p?.name || p?.id; return n ? String(n).replace(/^./, c => c.toUpperCase()) : ''; };

// What a failed request says about plans: null (not a plan error) or { kind: 'feature' | 'limit', what, limit, used, plan }.
// (The error code is e.error: a `message` field in the answer replaces e.message, see api.js.)
export function planOf(e) {
  const code = e?.error || e?.message;
  if (code !== 'plan_limit' && code !== 'plan_feature') return null;
  const what = canon(e.what);
  let limit = e.limit === false ? 0 : typeof e.limit === 'number' ? e.limit : e.limit == null ? null : Number(e.limit);
  if (Number.isNaN(limit)) limit = null;
  const used = typeof e.used === 'number' ? e.used : null;
  const feature = code === 'plan_feature' || limit === 0 || limit === null;
  return { kind: feature ? 'feature' : 'limit', what, limit: feature ? 0 : limit, used: used ?? (feature ? null : limit), plan: planLabel(e.plan), message: typeof e.detail === 'string' ? e.detail : '' };
}
export const isPlanError = e => !!planOf(e);

// ServerSettings provides: { name, limits: { what: { limit, used } }, features: { what: bool }, managed, canUpgrade, goTo }
export const PlanCtx = createContext(null);
export function buildPlanCtx(inst, goTo) {
  const m = inst?.managed, p = inst?.serverInfo?.plan; // m: public { plan, limits }; p: the admin-only block of /instance/info
  const limits = {}, features = {};
  for (const [k, v] of Object.entries(m?.limits || {})) limits[canon(k)] = { limit: v };
  for (const [k, v] of Object.entries(p?.limits || {})) limits[canon(k)] = v && typeof v === 'object' ? { limit: v.limit, used: v.used } : { limit: v };
  for (const [k, v] of Object.entries(p?.features || {})) features[canon(k)] = !!v;
  return { name: planLabel(p?.name || m?.plan), limits, features, managed: !!m || !!p, canUpgrade: !!m && !!inst?.isOwner, goTo };
}

// the plan of this page for one feature. `used` = how many exist now (when the page knows).
// gate: the feature isn't in the plan (show <PlanGate />); full: the number is reached (show <PlanNotice />, disable "add");
// catchPlan(e): call in a catch - true when it was a plan error (and the page now shows it); limit / used for a usage line
export function usePlan(what, used) {
  const ctx = useContext(PlanCtx);
  const [hit, setHit] = useState(null);
  const key = canon(what);
  const entry = ctx?.limits?.[key];
  const limit = entry ? entry.limit : undefined;
  const have = typeof used === 'number' ? used : typeof entry?.used === 'number' ? entry.used : null;
  let pre = null;
  if (ctx && (ctx.features[key] === false || limit === false || limit === 0)) pre = { kind: 'feature', what: key, limit: 0, used: null, plan: ctx.name };
  else if (typeof limit === 'number' && limit > 0 && have !== null && have >= limit) pre = { kind: 'limit', what: key, limit, used: have, plan: ctx.name };
  const block = hit || pre;
  return {
    gate: block?.kind === 'feature' ? block : null,
    full: block?.kind === 'limit' ? block : null,
    limit: typeof limit === 'number' ? limit : null, used: have,
    catchPlan: e => { const p = planOf(e); if (!p) return false; setHit({ ...p, what: key }); return true; },
    clear: () => setHit(null),
  };
}

function Actions({ ctx }) {
  return (
    <div className="bf-pg-actions">
      {ctx?.canUpgrade && ctx.goTo && <button type="button" className="btn btn-primary" onClick={() => ctx.goTo('hosting')}><Rocket size={14} /> Upgrade plan</button>}
      <a className="btn btn-surface" href={SELF_HOST_URL} target="_blank" rel="noopener noreferrer"><Server size={14} /> Self-host</a>
      {ctx?.managed && !ctx.canUpgrade && <small className="vc-hint">Only the server's owner can change the plan.</small>}
    </div>
  );
}

// A whole feature isn't in the plan: the page's normal content stays rendered (so people can see what it looks like), dimmed and inert
// under a dark overlay with the "Not included in your plan" card. `block` null = no gate: the children render as they are.
// The children must render safely with empty data (pages stop loading / polling while gated).
export function PlanGate({ block, title, children }) {
  const ctx = useContext(PlanCtx);
  if (!block) return <>{children}</>;
  const plan = block.plan || ctx?.name;
  return (
    <div className="bf-pg-wrap">
      <div className="bf-pg-under" inert="" aria-hidden="true">{children}</div>
      <div className="bf-pg-overlay">
        <div className="card bf-ss-card bf-pg" role="region" aria-label="Not included in your plan">
          <div className="card-header"><span className="card-title"><Lock size={15} /> Not included in your plan</span></div>
          <div className="card-body">
            <p className="bf-pg-text"><b>{title || featureName(block.what)}</b> isn't included in this server's plan{plan ? ` (${plan})` : ''}. Upgrade the plan to unlock it, or self-host your own Ember server to get every feature.</p>
            <Actions ctx={ctx} />
          </div>
        </div>
      </div>
    </div>
  );
}

// "You've used N of M" - the number is reached; creating one more is refused
export function PlanNotice({ block }) {
  const ctx = useContext(PlanCtx);
  if (!block) return null;
  const plan = block.plan || ctx?.name;
  return (
    <div className="vc-note warn bf-pg-note">
      <TriangleAlert size={14} />
      {canon(block.what) === 'max_upload_mb'
        ? <span><b>Your plan allows files up to {block.limit} MB</b>{plan ? ` (${plan})` : ''}. Upgrade the plan for bigger files, or self-host your own Ember server for no limit.</span>
        : <span><b>You've used {block.used ?? block.limit} of {block.limit} {nounOf(block.what)}</b> on your plan{plan ? ` (${plan})` : ''}. Upgrade the plan to add more, or self-host your own Ember server for no limits.</span>}
      <Actions ctx={ctx} />
    </div>
  );
}

// "Bots: 1 / 2" in a page's header, when the plan says how many there can be
export function PlanUsage({ what, used, label }) {
  const p = usePlan(what, used);
  if (p.limit === null) return null;
  const u = p.used;
  return <span className={`bf-pg-use${u !== null && u >= p.limit ? ' full' : ''}`} title="What this server's plan allows">{label || featureName(what).replace(/^The /, '')}: {u !== null ? `${u} / ${p.limit}` : `up to ${p.limit}`}</span>;
}
