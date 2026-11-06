// Channel settings: the same dialog as Server settings (SettingsShell) for editing a channel - Overview (name, topic, category,
// icon, type, who can post, the type's own settings), Permissions, Bridge and Delete. Changes are saved from the "unsaved changes"
// bar. Making a new channel stays the small ChannelEditor dialog (Dialogs.jsx).
import { useMemo, useState } from 'react';
import { Hash, Upload, Trash2, Shield, ArrowLeftRight, LayoutGrid, Settings, Image as ImageIcon, MessageSquare, TriangleAlert } from 'lucide-react';
import { apiFetch, uploadFetch } from '../api.js';
import { useChat, getState, go, ask, toast, errorText, refreshServer } from './store.js';
import { P, has, CHANNEL_ICONS, ChannelIcon, Toggle } from './roles.jsx';
import { TYPES, TypePicker, TypeSettings } from './ChannelTypes.jsx';
import { ChannelBridge } from './Bridge.jsx';
import { ChannelPerms } from './ChannelPerms.jsx';
import { SettingsShell, Card } from './SettingsShell.jsx';
import { useUnsaved, UnsavedBar } from './unsaved.jsx';

const LINK_OK = /^https?:\/\/\S+\.\S+/;
// the PATCH body for a channel (the config shaped per type), also used to tell whether anything changed
const bodyOf = ({ name, topic, category, locked, icon, type, config }) => JSON.stringify({ name, topic, category, locked: type === 'text' ? locked : false, icon: icon || null, type, config: type === 'text' ? {} : type === 'logs' ? (config.mode === 'cloudlink' ? { mode: 'cloudlink', url: config.url || '', room: config.room || '', username: config.username || '' } : {}) : config });
const startOf = (channel, cats) => ({ name: channel.name || '', topic: channel.topic || '', category: channel.category || cats?.[0] || 'Text channels', locked: !!channel.locked, icon: channel.icon || '', type: channel.type || 'text', config: { ...(channel.config || {}) } });

export function ChannelSettings({ sid, channel: opened, onClose, tab }) {
  const d = useChat(s => s.detail[sid]);
  const channel = d?.channels.find(c => c.cid === opened.cid); // (live: the saved values)
  const canBridge = has(d?.server.perms, P.MANAGE_SERVER) && (channel?.type || 'text') === 'text';
  const groups = useMemo(() => [
    ['Channel', [['overview', 'Overview', LayoutGrid, ['Name', 'Topic', 'Category', 'Icon', 'Type', 'Webhooks', 'Post', 'Messages']], ['perms', 'Permissions', Shield, ['Private', 'Roles', 'See', 'Send', 'Attach']]]],
    ['Integrations', canBridge ? [['bridge', 'Bridge', ArrowLeftRight, ['Discord', 'Fluxer', 'Link']]] : []],
    ['Manage', [['danger', 'Delete channel', TriangleAlert, ['Remove']]]],
  ].filter(([, items]) => items.length), [canBridge]);
  return (
    <SettingsShell label="Channel settings" groups={groups} startTab={tab} onClose={onClose} gone={!d || !channel}
      head={channel && <>
        <span className="vc-srv-ico"><ChannelIcon c={channel} size={18} /></span>
        <span><b>#{channel.name}</b><small>{d.server.name}</small></span>
      </>}>
      {(page, { onDirty, close }) => channel && (<>
        {page === 'overview' && <Overview sid={sid} channel={channel} onDirty={onDirty} />}
        {page === 'perms' && <ChannelPerms sid={sid} channel={channel} onDirty={onDirty} />}
        {page === 'bridge' && <div className="bf-ss-page"><Card title="Bridge" icon={ArrowLeftRight} className="bf-ss-bridge"><ChannelBridge sid={sid} channel={channel} /></Card></div>}
        {page === 'danger' && <DeleteChannel sid={sid} channel={channel} close={close} />}
      </>)}
    </SettingsShell>
  );
}

function Overview({ sid, channel, onDirty }) {
  const cats0 = useChat(st => st.detail[sid]?.categories);
  const chans = useChat(s => s.detail[sid]?.channels);
  const cats = useMemo(() => [...new Set([...(cats0 || []), ...(chans || []).map(c => c.category).filter(Boolean)])], [chans, cats0]);
  const [f, setF] = useState(() => startOf(channel, cats0));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const { name, topic, category, locked, icon, type, config } = f;
  const changed = bodyOf(f) !== bodyOf(startOf(channel, cats0));
  const [bar, flashSaved] = useUnsaved(changed, onDirty);
  const bad = !name.trim() || !category.trim() || (type === 'link' && !LINK_OK.test(config.url || ''));
  async function save() {
    setBusy(true);
    try {
      await apiFetch(`/chat/channels/${channel.cid}`, { method: 'PATCH', body: bodyOf(f) });
      await refreshServer(sid);
      flashSaved();
    } catch (e) { toast(errorText(e.message)); }
    setBusy(false);
  }
  // a picture is uploaded straight away (not part of the bar)
  async function upload(file) {
    if (!file) return;
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await uploadFetch(`/chat/channels/${channel.cid}/icon`, fd);
      set('icon', res.channel.icon); await refreshServer(sid);
    } catch (er) { toast(errorText(er.message)); }
  }
  const typeName = TYPES.find(t => t.id === type)?.label || 'Channel';
  return (
    <div className="bf-ss-page">
      <Card title="Channel" icon={Hash}>
        <label className="vc-field"><span>Name</span><div className="vc-input-ico"><Hash size={15} /><input className="form-input" maxLength={40} value={name} placeholder="new-channel" onChange={e => set('name', e.target.value.toLowerCase().replace(/\s+/g, '-'))} /></div></label>
        <label className="vc-field"><span>Topic</span><input className="form-input" maxLength={300} value={topic} placeholder="What's it for?" onChange={e => set('topic', e.target.value)} /></label>
        <label className="vc-field"><span>Category</span><input className="form-input" maxLength={40} list="vc-cats" value={category} placeholder="Pick or type a category" onChange={e => set('category', e.target.value)} />
          <datalist id="vc-cats">{cats.map(c => <option key={c} value={c} />)}</datalist></label>
      </Card>
      <Card title="Icon" icon={ImageIcon}>
        <div className="vc-icon-grid">
          <button type="button" className={!icon ? 'on' : ''} title="Default" onClick={() => set('icon', '')}><ChannelIcon c={{ locked, name, type }} size={16} /></button>
          {Object.keys(CHANNEL_ICONS).map(k => <button type="button" key={k} className={icon === k ? 'on' : ''} title={k} onClick={() => set('icon', k)}><ChannelIcon c={{ icon: k }} size={16} /></button>)}
          <label className={`vc-icon-up${/^https?:\/\//.test(icon) ? ' on' : ''}`} title="Upload a picture">
            {/^https?:\/\//.test(icon) ? <img src={icon} alt="" /> : <Upload size={15} />}
            <input type="file" hidden accept="image/*" onChange={e => upload(e.target.files[0])} />
          </label>
        </div>
      </Card>
      <Card title="Channel type" icon={LayoutGrid}>
        <TypePicker value={type} onChange={v => set('type', v)} />
      </Card>
      {type === 'text' && (
        <Card title="Posting" icon={MessageSquare}>
          <Toggle label="Let everyone send messages here?" hint={locked ? "Off: everyone can read, but only the server's admins can post." : 'On: every member can post.'} on={!locked} onChange={on => set('locked', !on)} />
        </Card>
      )}
      <Card title={type === 'text' ? 'Webhooks' : `${typeName} settings`} icon={Settings}>
        <TypeSettings type={type} config={config} setConfig={c => set('config', c)} sid={sid} channel={channel} />
      </Card>
      <UnsavedBar changed={changed} bar={bar} busy={busy} disabled={bad} onReset={() => setF(startOf(channel, getState().detail[sid]?.categories))} onSave={save} />
    </div>
  );
}

function DeleteChannel({ sid, channel, close }) {
  const del = async () => {
    if (!(await ask({ title: `Delete #${channel.name}?`, text: 'The channel and all of its messages go for good.', confirm: 'Delete channel', danger: true }))) return;
    try { await apiFetch(`/chat/channels/${channel.cid}`, { method: 'DELETE' }); await refreshServer(sid); go({ kind: 'server', sid }); close(); } catch (e) { toast(errorText(e.message)); }
  };
  return (
    <div className="bf-ss-page">
      <Card title="Delete" icon={Trash2} className="bf-ss-danger">
        <div className="cs-row"><div className="cs-text"><b>Delete this channel</b><span>The channel and all of its messages go for good. This can't be undone.</span></div>
          <button type="button" className="btn btn-danger" onClick={del}><Trash2 size={14} /> Delete channel</button></div>
      </Card>
    </div>
  );
}
