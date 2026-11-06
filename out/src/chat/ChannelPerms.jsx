// Channel settings > Permissions: per role (and @everyone) - see the channel, send messages, attach files.
// Each can be allowed, denied, or left to the role's server-wide permissions.
// With onDirty (inside Channel settings) it is a card with the "unsaved changes" bar instead of its own save button.
import { useMemo, useState } from 'react';
import { Check, X, Slash, EyeOff, Shield } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, refreshServer, toast, errorText } from './store.js';
import { Toggle } from './roles.jsx';
import { Card } from './SettingsShell.jsx';
import { useUnsaved, UnsavedBar } from './unsaved.jsx';

const BITS = [[1024, 'See it'], [1, 'Send messages'], [256, 'Attach files']];

const same = (a, b) => { const n = m => JSON.stringify(Object.entries(m).filter(([, o]) => o.allow || o.deny).map(([rid, o]) => [rid, o.allow | 0, o.deny | 0]).sort()); return n(a) === n(b); };

export function ChannelPerms({ sid, channel, onDirty }) {
  const roles = useChat(s => s.detail[sid]?.roles);
  const [base, setBase] = useState(() => Object.fromEntries((channel.overwrites || []).map(o => [o.rid, { allow: o.allow, deny: o.deny }]))); // as saved
  const [ow, setOw] = useState(base);
  const [busy, setBusy] = useState(false);
  const dirty = !same(ow, base);
  const [bar, flashSaved] = useUnsaved(dirty, onDirty);
  const list = useMemo(() => [...(roles || [])].sort((a, b) => (b.is_default - a.is_default) || b.position - a.position), [roles]);
  const everyone = list.find(r => r.is_default);
  const state = (rid, bit) => { const o = ow[rid] || {}; return o.deny & bit ? 'deny' : o.allow & bit ? 'allow' : 'inherit'; };
  function set(rid, bit, to) {
    setOw(x => {
      const o = { allow: 0, deny: 0, ...(x[rid] || {}) };
      o.allow &= ~bit; o.deny &= ~bit;
      if (to === 'allow') o.allow |= bit; if (to === 'deny') o.deny |= bit;
      return { ...x, [rid]: o };
    });
  }
  const cycle = (rid, bit) => set(rid, bit, { inherit: 'allow', allow: 'deny', deny: 'inherit' }[state(rid, bit)]);
  const priv = everyone && state(everyone.rid, 1024) === 'deny';
  async function save() {
    setBusy(true);
    try {
      await apiFetch(`/chat/channels/${channel.cid}/perms`, { method: 'PUT', body: JSON.stringify({ overwrites: Object.entries(ow).map(([rid, o]) => ({ rid, allow: o.allow, deny: o.deny })).filter(o => o.allow || o.deny) }) });
      await refreshServer(sid); setBase(ow);
      if (onDirty) flashSaved(); else toast('Permissions saved.', true);
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  if (!roles || !everyone) return null;
  const table = (
    <>
      <Toggle label="Private channel" hint="Only the roles you allow below (and admins) can see it. Everyone else won't even see its name." on={priv}
        onChange={v => { set(everyone.rid, 1024, v ? 'deny' : 'inherit'); }} />
      <div className="vc-cperms-table">
        <div className="vc-cperms-row head"><span>Role</span>{BITS.map(([b, l]) => <span key={b}>{l}</span>)}</div>
        {list.map(r => (
          <div key={r.rid} className="vc-cperms-row">
            <span className="vc-cperms-role" style={r.color ? { color: r.color } : undefined}>{r.is_default ? '@everyone' : r.name}</span>
            {BITS.map(([b]) => {
              const st = state(r.rid, b);
              return (
                <button type="button" key={b} className={`vc-cperm ${st}`} title={st === 'allow' ? 'Allowed here' : st === 'deny' ? 'Not allowed here' : 'Uses the role\'s normal permission'} onClick={() => cycle(r.rid, b)}>
                  {st === 'allow' ? <Check size={14} /> : st === 'deny' ? <X size={14} /> : <Slash size={12} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
  const hint = <small className="vc-hint">Click to switch: tick = allowed, cross = not allowed, slash = the role's normal permission. A tick on any of someone's roles wins over @everyone's cross.{priv ? <> <EyeOff size={11} /> Private: tick "See it" for the roles that should get in.</> : ''}</small>;
  if (onDirty) {
    return (
      <div className="bf-ss-page">
        <Card title="Permissions" icon={Shield}>{table}<div className="vc-cperms-foot">{hint}</div></Card>
        <UnsavedBar changed={dirty} bar={bar} busy={busy} onReset={() => setOw(base)} onSave={save} />
      </div>
    );
  }
  return (
    <div className="vc-field vc-cperms"><span>Permissions</span>
      {table}
      <div className="vc-cperms-foot">
        {hint}
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving...' : 'Save permissions'}</button>
      </div>
    </div>
  );
}
