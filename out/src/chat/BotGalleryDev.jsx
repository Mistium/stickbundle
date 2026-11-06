// A bot's gallery listing, in the developer's bot list: status, the listing form, submit / resubmit / withdraw, review message.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Send, Save, Undo2, Plus, X, BadgeCheck, Clock, Lock, Ban, CircleAlert, EyeOff } from 'lucide-react';
import { apiFetch } from '../api.js';
import { confirmBox } from '../components/confirmBox.jsx';

export const GALLERY_PERMS = [
  ['send_messages', 'Send messages'], ['attach_files', 'Attach files'], ['manage_channels', 'Manage channels'], ['manage_server', 'Manage server'],
  ['manage_roles', 'Manage roles'], ['kick_members', 'Kick members'], ['ban_members', 'Ban members'], ['manage_messages', 'Manage messages'],
  ['mention_everyone', 'Mention everyone'], ['administrator', 'Administrator'],
];

export const STATE_INFO = {
  private: { label: 'Private', Icon: Lock, hint: 'Only you can add it.' },
  pending: { label: 'Pending review', Icon: Clock, hint: 'Waiting for Nookara staff to look at it.' },
  approved: { label: 'Approved', Icon: BadgeCheck, hint: 'Listed in the gallery with a Verified checkmark.' },
  rejected: { label: 'Rejected', Icon: CircleAlert, hint: 'Staff sent it back. Fix what they said and submit it again.' },
  delisted: { label: 'Delisted', Icon: EyeOff, hint: 'Staff took it out of the gallery. You can submit it again.' },
  banned: { label: 'Banned', Icon: Ban, hint: 'This bot can not be listed.' },
};
export function StateChip({ state }) {
  const i = STATE_INFO[state] || STATE_INFO.private;
  return <span className={`bg-state ${state || 'private'}`} title={i.hint}><i.Icon size={12} /> {i.label}</span>;
}

export const SHORT_MIN = 10, SHORT_MAX = 200, LONG_MIN = 20;
// first sentence (or ~160 chars) of the long description, offered as the short one
const suggestShort = long => {
  const t = (long || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.{10,}?[.!?](\s|$)/);
  let out = m ? m[0].trim() : t;
  if ([...out].length > 160) out = [...out].slice(0, 157).join('').trim() + '...';
  return out;
};
const fromGallery = (g, short) => ({
  short: short ?? g?.description ?? '', long: g?.long_description || '', tags: (g?.tags || []).join(', '), support: g?.support_url || '',
  links: (g?.links || []).map(l => ({ label: l.label, url: l.url })), perms: g?.permissions || [],
});
const toBody = f => ({
  description: f.short.trim(), long_description: f.long.trim(), tags: f.tags.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean), support_url: f.support.trim() || null,
  links: f.links.filter(l => l.label.trim() || l.url.trim()).map(l => ({ label: l.label.trim(), url: l.url.trim() })), permissions: f.perms,
});

export function BotGallerySection({ bot, errText, onChange }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { gallery, log }
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const g = data?.gallery;
  const state = g?.state || bot.gallery?.state || 'private';
  const review = g?.review_message ?? bot.gallery?.review_message;
  const apply = d => { setData(d); setF(fromGallery(d.gallery)); };
  const load = () => apiFetch(`/chat/bots/${encodeURIComponent(bot.id)}/gallery`).then(apply).catch(e => setMsg({ text: errText(e) }));
  useEffect(() => { if (open && !data) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(key, path, method, body, ok) {
    setBusy(key); setMsg(null);
    try {
      const d = await apiFetch(`/chat/bots/${encodeURIComponent(bot.id)}/gallery${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (d?.gallery) apply(d); else await load();
      setMsg({ ok: true, text: ok });
      onChange?.();
    } catch (e) {
      setMsg({ text: e.message === 'invalid_permissions' && e.allowed ? `${errText(e)} Allowed: ${e.allowed.join(', ')}` : errText(e) });
    }
    setBusy('');
  }
  const withdraw = async () => {
    if (!(await confirmBox(`Take ${bot.username} out of review / the gallery? Servers that already have it keep it.`, { confirm: 'Withdraw' }))) return;
    run('wd', '/withdraw', 'POST', null, 'Withdrawn - it is private again.');
  };
  const canSubmit = g ? g.can_submit : ['private', 'rejected', 'delisted'].includes(state);
  const canWithdraw = g ? g.can_withdraw : ['pending', 'approved', 'rejected', 'delisted'].includes(state);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const shortLen = f ? [...f.short.trim()].length : 0, longLen = f ? [...f.long.trim()].length : 0;
  const shortErr = !f ? '' : shortLen < SHORT_MIN ? `Short description: write at least ${SHORT_MIN} characters (${shortLen} so far) - the one-line summary shown on the card.` : shortLen > SHORT_MAX ? `Short description: ${SHORT_MAX} characters at most (${shortLen} now).` : '';
  const longErr = !f ? '' : longLen < LONG_MIN ? `Long description: write at least ${LONG_MIN} characters (${longLen} so far) - what the bot does and how to use it.` : '';
  const suggestion = f && shortLen < SHORT_MIN ? suggestShort(f.long) : '';
  const submit = () => {
    const e = shortErr || longErr;
    if (e) { setMsg({ text: e }); return; }
    run('sub', '/submit', 'POST', toBody(f), 'Sent for review.');
  };
  const setLink = (i, k, v) => setF(x => ({ ...x, links: x.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const submitLabel = state === 'rejected' || state === 'delisted' ? 'Resubmit for review' : 'Submit to gallery';
  return (
    <div className={`bg-sec ${state}`}>
      <div className="bg-head">
        <StateChip state={state} />
        <span className="bg-count">In {bot.trusted_in ?? 0} server{bot.trusted_in === 1 ? '' : 's'}</span>
        <span className="grow" />
        <button type="button" className="btn btn-surface btn-sm" onClick={() => setOpen(o => !o)}>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Gallery listing</button>
      </div>
      {(state === 'rejected' || state === 'delisted' || state === 'banned') && (review || g?.banned_reason) && (
        <div className="bg-review"><b>{state === 'rejected' ? 'Why it was rejected' : state === 'banned' ? 'Why it was banned' : 'Why it was delisted'}</b><p>{g?.banned_reason && state === 'banned' ? g.banned_reason : review}</p></div>
      )}
      {state === 'approved' && review && <div className="bg-review ok"><b>Message from staff</b><p>{review}</p></div>}
      {open && (
        <div className="bg-body">
          {!f && !msg && <div>Loading...</div>}
          {f && (
            <>
              <p className="bg-note">The gallery shows the bot's name and picture (edit those above), the short description, and the rest below. Edits to an approved bot go live right away.</p>
              <label className="bg-field"><span>Short description <small>{shortLen}/{SHORT_MAX}, at least {SHORT_MIN} - the one-line text on the card in Discover</small></span>
                <input className="form-input" maxLength={SHORT_MAX} value={f.short} onChange={e => set('short', e.target.value)} placeholder="Plays music from links in your voice channels" /></label>
              {suggestion && (
                <div className="bg-note">Your short description is too short. Use the start of your long description?{' '}
                  <button type="button" className="btn btn-surface btn-sm" onClick={() => set('short', suggestion)}>Use: {suggestion}</button></div>
              )}
              <label className="bg-field"><span>Long description <small>{longLen}/4000, at least {LONG_MIN} - the full text on the bot's page</small></span>
                <textarea className="form-input" rows={5} maxLength={4000} value={f.long} onChange={e => set('long', e.target.value)} placeholder="What it does, its commands, how to set it up..." /></label>
              <label className="bg-field"><span>Tags <small>up to 6, separated by commas: letters, numbers, dashes</small></span>
                <input className="form-input" value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="music, fun, moderation" /></label>
              <label className="bg-field"><span>Support link <small>https://</small></span>
                <input className="form-input" value={f.support} onChange={e => set('support', e.target.value)} placeholder="https://example.com/support" /></label>
              <div className="bg-field"><span>More links <small>up to 5</small></span>
                {f.links.map((l, i) => (
                  <div className="bg-link" key={i}>
                    <input className="form-input" maxLength={30} value={l.label} onChange={e => setLink(i, 'label', e.target.value)} placeholder="Label" />
                    <input className="form-input grow" value={l.url} onChange={e => setLink(i, 'url', e.target.value)} placeholder="https://" />
                    <button type="button" className="btn btn-surface btn-sm" title="Remove" onClick={() => set('links', f.links.filter((_, j) => j !== i))}><X size={13} /></button>
                  </div>
                ))}
                {f.links.length < 5 && <button type="button" className="btn btn-surface btn-sm bg-add" onClick={() => set('links', [...f.links, { label: '', url: '' }])}><Plus size={13} /> Add a link</button>}
              </div>
              <div className="bg-field"><span>Permissions it asks for <small>shown to people adding it</small></span>
                <div className="bg-perms">
                  {GALLERY_PERMS.map(([k, l]) => (
                    <label key={k} className="bm-check"><input type="checkbox" checked={f.perms.includes(k)} onChange={e => set('perms', e.target.checked ? [...f.perms, k] : f.perms.filter(x => x !== k))} /> {l}</label>
                  ))}
                </div>
              </div>
            </>
          )}
          {msg && <div className={`inline-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
          {f && (
            <div className="bm-actions">
              <button type="button" className="btn btn-surface btn-sm" disabled={!!busy || state === 'banned'} onClick={() => (shortLen && shortErr && shortLen > SHORT_MAX ? setMsg({ text: shortErr }) : run('save', '', 'PUT', toBody(f), 'Saved.'))}><Save size={13} /> Save listing</button>
              {canSubmit && state !== 'banned' && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={submit}><Send size={13} /> {submitLabel}</button>}
              {canWithdraw && state !== 'banned' && <button type="button" className="btn btn-surface btn-sm" disabled={!!busy} onClick={withdraw}><Undo2 size={13} /> Withdraw</button>}
              <span className="grow" />
            </div>
          )}
          {data?.log?.length > 0 && (
            <details className="bg-log"><summary>History</summary>
              {data.log.map((l, i) => <div key={i}><b>{l.by === 'admin' ? 'Staff' : 'You'}</b> {l.action}{l.message ? ` - ${l.message}` : ''} <small>{new Date(l.at).toLocaleString()}</small></div>)}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
