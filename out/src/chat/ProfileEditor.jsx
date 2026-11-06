import { siteHref } from './hosts.js';
// Settings > Profile in Ember: the Velora profile editor (same fields + endpoints as /me#profile,
// components/tabs/ProfileTab.jsx) laid out like Fluxer: fields on the left, live "Profile preview" on the
// right (the same card as your bottom-left pop-out). Saving goes through the unsaved-changes bar.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, LogIn } from 'lucide-react';
import { api, uploadMedia } from '../api.js';
import { applyAccentColor } from '../theme.js';
import ImageCropper from '../components/ImageCropper.jsx';
import { COUNTRIES, TIMEZONES } from '../profile-locales.js';
import { useChat, useScopeStatus, loginAgain, ask, patchState, getState, remember, forgetProfile } from './store.js';
import { PopoutCard, localTimeFrom } from './ProfilePopout.jsx';

const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');
const UPLOAD_ERRORS = {
  gif_pro_only: type => `Animated ${type === 'banner' ? 'banners' : 'profile pictures'} need Nookara Pro.`,
  file_too_large: () => 'That file is too big.',
  upload_suspended: () => 'Uploads are currently suspended on your account.',
};
const RENAME_ERRORS = { invalid_username: 'Usernames are 2-32 letters, numbers, _ - or .', username_taken: 'That username is taken - pick another.', same_username: 'That is already your username.', no_free_rename: 'Your free username change has expired.' };

// onDirty(bool) lets the dialog ask before leaving with unsaved changes
export default function ProfileEditor({ onDirty }) {
  const [user, setUser] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const presence = useChat(s => s.presence[s.me?.username]);

  const load = () => api.getMe().then(d => {
    setUser(d);
    // the rest of Ember (your panel, member lists, cached profile cards) picks up the new look
    const me = getState().me;
    if (me) {
      patchState({ me: { ...me, username: d.account.username, pfp: d.profile.pfp || null, color: d.profile.color || null, rank: d.account.rank, pro: !!d.account.pro } });
      remember([{ username: d.account.username, pfp: d.profile.pfp || null, color: d.profile.color || null }]);
      forgetProfile(d.account.username);
      dispatchEvent(new CustomEvent('vc-profile-changed', { detail: { username: d.account.username } })); // message headers refetch your pronouns
    }
    applyAccentColor(d.profile.color);
    return d;
  });
  useEffect(() => { load().catch(() => setLoadErr("Couldn't load your profile.")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loadErr) return <div className="inline-msg error">{loadErr}</div>;
  if (!user) return <div className="bf-sd-loading">Loading your profile...</div>;
  return <Editor user={user} reload={load} presence={presence} onDirty={onDirty} />;
}

function Editor({ user, reload, presence, onDirty }) {
  const lock = useScopeStatus('ACCOUNT_WRITE'); // this login (Ember app token) may not be allowed to edit the account
  const locked = !!lock;
  const profile = user.profile || {};
  const account = user.account || {};
  const username = account.username || '';
  const bioLimit = user.bio_limit ?? 200;
  const initial = () => ({ bio: profile.bio || '', pronouns: (profile.pronouns || '').trim(), website: (profile.website || '').trim(), country: profile.country || '', timezone: profile.timezone || '', color: profile.color || '' });
  const [f, setF] = useState(initial);
  const [base, setBase] = useState(initial);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const dirty = Object.keys(f).some(k => (k === 'website' || k === 'pronouns' ? f[k].trim() : f[k]) !== base[k]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [shake, setShake] = useState(0);
  useEffect(() => { onDirty?.(dirty, () => setShake(n => n + 1)); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (!shake) return undefined; const t = setTimeout(() => setShake(0), 700); return () => clearTimeout(t); }, [shake]);

  async function save() {
    if (f.color && !isHex(f.color)) { setMsg({ type: 'error', text: 'Accent colours look like #9d8ad1.' }); setShake(n => n + 1); return; }
    setSaving(true); setMsg(null);
    try {
      await api.updateMe({ bio: f.bio, pronouns: f.pronouns.trim(), timezone: f.timezone || undefined, country_code: f.country || undefined, website: f.website.trim(), color: f.color || null });
      setBase({ ...f, website: f.website.trim(), pronouns: f.pronouns.trim() });
      setJustSaved(true); setTimeout(() => setJustSaved(false), 1400);
      reload().catch(() => {});
    } catch (e) {
      const m = { bio_too_long: `Bio too long (max ${bioLimit} characters).`, invalid_website: "That website link doesn't look right - use something like https://your-site.com" };
      setMsg({ type: 'error', text: m[e.message] || "Couldn't save - try again." });
      setShake(n => n + 1);
    }
    setSaving(false);
  }

  // username (only while a free change is available, same as /me)
  const renameUntil = account.free_rename_until;
  const canRename = !!renameUntil && new Date(renameUntil) > new Date();
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(username);
  const [renaming, setRenaming] = useState(false);
  const [renameMsg, setRenameMsg] = useState(null);
  async function doRename(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!(await ask({ title: `Change your username to "${name}"?`, text: "This is your one free change and it can't be undone.", confirm: 'Change it' }))) return;
    setRenaming(true); setRenameMsg(null);
    try { await api.changeUsername(name); setRenameOpen(false); setRenameMsg({ type: 'success', text: 'Username changed.' }); await reload(); }
    catch (err) { setRenameMsg({ type: 'error', text: RENAME_ERRORS[err.message] || "Couldn't change it - try again." }); }
    setRenaming(false);
  }

  // avatar + banner: pick -> crop -> upload (the server cuts it, GIFs stay animated)
  const pfpInput = useRef(null);
  const bannerInput = useRef(null);
  const [cropping, setCropping] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [mediaMsg, setMediaMsg] = useState(null);
  const pick = (e, type) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { setMediaMsg(null); setCropping({ type, file }); } };
  async function upload(type, file, crop) {
    setCropping(null); setUploading(type); setMediaMsg(null);
    try { await uploadMedia(`/media/${type}`, file, crop); await reload(); }
    catch (err) { setMediaMsg({ type: 'error', text: (UPLOAD_ERRORS[err.message] || (() => 'Upload failed. Try a smaller image.'))(type) }); }
    setUploading(null);
  }
  async function remove(type) {
    if (!(await ask({ title: type === 'banner' ? 'Remove your banner?' : 'Remove your avatar?', confirm: 'Remove', danger: true }))) return;
    setUploading(type); setMediaMsg(null);
    try { await (type === 'banner' ? api.clearBanner() : api.clearPfp()); await reload(); }
    catch { setMediaMsg({ type: 'error', text: `Couldn't remove your ${type === 'banner' ? 'banner' : 'avatar'}.` }); }
    setUploading(null);
  }

  const [visibility, setVisibility] = useState(profile.visibility || 'public');
  const [visMsg, setVisMsg] = useState(null);
  async function saveVisibility(v) {
    const prev = visibility;
    setVisibility(v); setVisMsg(null);
    try { await api.updateMe({ profile_visibility: v }); setVisMsg({ type: 'success', text: 'Saved.' }); }
    catch { setVisibility(prev); setVisMsg({ type: 'error', text: "Couldn't save that - try again." }); }
  }

  const card = {
    username,
    pfp: profile.pfp || null,
    banner: profile.banner || null,
    color: f.color,
    bio: f.bio,
    pronouns: f.pronouns.trim(),
    website: f.website.trim(),
    badges: account.badges || [],
    rank: account.rank,
    created: account.joined_at || null,
    localTime: localTimeFrom({ timeZone: f.timezone }),
  };

  return (
    <div className="bf-pe">
      <div className="bf-pe-intro">
        <h3>Profile customization</h3>
        <p>Edit your profile appearance and see a live preview</p>
      </div>
      {locked && (
        <div className="bf-pe-lock" role="status">
          <ShieldAlert size={18} />
          <span>{lock === 'disabled' ? 'An admin turned off profile editing for your account.' : "Ember doesn't have permission to edit your profile."}</span>
          {lock !== 'disabled' && <button type="button" className="btn btn-primary btn-sm" onClick={loginAgain}><LogIn size={14} /> Log in again</button>}
        </div>
      )}
      <div className="bf-pe-cols">
        <fieldset className={`bf-pe-form${locked ? ' locked' : ''}`} disabled={locked}>
          <div className="bf-pe-sec">
            <div className="bf-pe-label">Username</div>
            <button type="button" className="btn btn-primary btn-sm" disabled={!canRename || renaming} onClick={() => { setRenameMsg(null); setNewName(username); setRenameOpen(true); }}>Change username</button>
            <div className="bf-pe-hint">{canRename ? `One free change, until ${new Date(renameUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.` : "You don't have a username change available."}</div>
            {canRename && renameOpen && (
              <form onSubmit={doRename} className="bf-pe-row">
                <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} maxLength={32} autoComplete="off" autoFocus />
                <button className="btn btn-primary btn-sm" type="submit" disabled={renaming || !newName.trim() || newName.trim() === username}>{renaming ? 'Changing...' : 'Change'}</button>
                <button className="btn btn-surface btn-sm" type="button" disabled={renaming} onClick={() => setRenameOpen(false)}>Cancel</button>
              </form>
            )}
            {renameMsg && <div className={`inline-msg ${renameMsg.type}`}>{renameMsg.text}</div>}
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Pronouns</div>
            <input className="form-input" type="text" placeholder="e.g. she/her" maxLength={40} autoComplete="off" value={f.pronouns} onChange={e => set('pronouns', e.target.value)} />
            <div className="bf-pe-hint">Shown under your name on your profile.</div>
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Avatar</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-primary btn-sm" disabled={!!uploading} onClick={() => pfpInput.current?.click()}>{uploading === 'pfp' ? 'Uploading...' : 'Change avatar'}</button>
              {profile.pfp && <button type="button" className="btn btn-surface btn-sm" disabled={!!uploading} onClick={() => remove('pfp')}>Remove avatar</button>}
            </div>
            <input ref={pfpInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={e => pick(e, 'pfp')} />
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Banner</div>
            <div className="bf-pe-row">
              <button type="button" className="btn btn-primary btn-sm" disabled={!!uploading} onClick={() => bannerInput.current?.click()}>{uploading === 'banner' ? 'Uploading...' : 'Change banner'}</button>
              {profile.banner && <button type="button" className="btn btn-surface btn-sm" disabled={!!uploading} onClick={() => remove('banner')}>Remove banner</button>}
            </div>
            <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={e => pick(e, 'banner')} />
            {mediaMsg && <div className={`inline-msg ${mediaMsg.type}`}>{mediaMsg.text}</div>}
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Accent colour</div>
            <div className="bf-pe-row">
              <input type="text" className="form-input bf-pe-hex" value={f.color} onChange={e => set('color', e.target.value.trim())} placeholder="#9d8ad1" maxLength={7} spellCheck={false} />
              <label className="bf-pe-swatch" style={{ background: isHex(f.color) ? f.color : 'var(--surface-3)' }} data-tip="Pick a colour">
                <input type="color" value={isHex(f.color) ? f.color : '#9d8ad1'} onChange={e => set('color', e.target.value)} />
              </label>
              {f.color && <button type="button" className="btn btn-surface btn-sm" onClick={() => set('color', '')}>Reset</button>}
            </div>
            <div className="bf-pe-hint">Your name colour on your profile, and Nookara's theme colour everywhere for you.</div>
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">About me</div>
            <textarea className="form-textarea" placeholder="Tell people a little about yourself..." value={f.bio} onChange={e => set('bio', e.target.value)} maxLength={bioLimit} rows={5} />
            <div className="bf-pe-hint">{f.bio.length} / {bioLimit} characters. {'Supports markdown: **bold**, *italic*, __underline__, ~~strike~~, `code`, ||spoiler||, [links](https://...), lists, > quotes, -# small text and # headers.'}</div>
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Website</div>
            <input className="form-input" type="url" inputMode="url" placeholder="https://your-site.com" maxLength={200} value={f.website} onChange={e => set('website', e.target.value)} />
          </div>

          <div className="bf-pe-sec bf-pe-two">
            <div>
              <div className="bf-pe-label">Country</div>
              <select className="form-select" value={f.country} onChange={e => set('country', e.target.value)}>
                <option value="">Not specified</option>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            <div>
              <div className="bf-pe-label">Profile local time</div>
              <select className="form-select" value={f.timezone} onChange={e => set('timezone', e.target.value)}>
                <option value="">Not shown</option>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
          <div className="bf-pe-hint bf-pe-hint-up">Other people only see your UTC offset (your local time), never the time zone itself.</div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Profile visibility</div>
            <div className="bf-pe-vis">
              {[['public', 'Public', 'Anyone can see your full profile.'], ['friends', 'Friends only', 'Only friends see more than your name and picture.']].map(([v, title, desc]) => (
                <label key={v} className={`bf-pe-vis-opt${visibility === v ? ' on' : ''}`}>
                  <input type="radio" name="bf-profile-visibility" value={v} checked={visibility === v} onChange={() => saveVisibility(v)} />
                  <span><b>{title}</b><small>{desc}</small></span>
                </label>
              ))}
            </div>
            {visMsg && <div className={`inline-msg ${visMsg.type}`}>{visMsg.text}</div>}
          </div>

          <div className="bf-pe-sec">
            <div className="bf-pe-label">Profile badges</div>
            <a className="btn btn-surface btn-sm" href={siteHref(`/u/${encodeURIComponent(username)}?edit=badges`)} target="_blank" rel="noopener">Customize your Badge Arcade badges</a>
          </div>
        </fieldset>

        <aside className="bf-pe-preview">
          <div className="bf-pe-preview-label">Profile preview</div>
          <PopoutCard preview p={card} status={presence?.status || 'online'} custom={presence?.custom} />
        </aside>
      </div>

      <div className={`bf-pe-bar${dirty || justSaved ? ' on' : ''}${shake ? ' shake' : ''}${justSaved && !dirty ? ' saved' : ''}`} key={shake ? `s${shake}` : 'bar'} role="status" aria-hidden={!(dirty || justSaved)}>
        <span className="bf-pe-bar-text">{justSaved && !dirty ? 'Saved!' : msg?.type === 'error' ? msg.text : 'Careful - you have unsaved changes!'}</span>
        {dirty && <button type="button" className="bf-pe-bar-reset" onClick={() => { setF(base); setMsg(null); }} disabled={saving}>Reset</button>}
        {dirty && <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>}
      </div>

      {cropping && createPortal(
        <div className="bf-pe-crop">
          <ImageCropper
            file={cropping.file}
            aspect={cropping.type === 'banner' ? 3 : 1}
            round={cropping.type === 'pfp'}
            title={cropping.type === 'banner' ? 'Crop your banner' : 'Crop your avatar'}
            onCancel={() => setCropping(null)}
            onDone={crop => upload(cropping.type, cropping.file, crop)}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
