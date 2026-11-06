import { E2eeSettings } from '../../chat/E2ee.jsx';
import { siteHref } from '../../chat/hosts.js';
import AboutBonfire from '../../chat/AboutBonfire.jsx';
import { useEffect, useState, useRef } from 'react';
import { Bell, Gamepad2, LogOut, ShieldCheck, MessagesSquare, Volume2, Pause, Play, Radio, Power, PanelBottomClose, Minimize2 } from 'lucide-react';
import { SOUND_PACKS, getMessageSounds, setMessageSounds, subscribeMessageSounds, playPackSound } from '../../chat/messageSounds.js';
import { getDesign, setDesign, subscribeDesign } from '../../chat/design.js';
import { useRadio, setRadioVolume, toggleRadioPause } from '../../chat/Radio.jsx';
// settings preview of the new-message sound (same files as chat/store.js)
function previewNotifySound(kind) {
  try { const a = new Audio({ long: '/assets/sounds/chat/notify.mp3?v=20261011', classic: '/assets/sounds/chat/message.mp3' }[kind] || '/assets/sounds/chat/message-new.mp3?v=20261103'); a.volume = 0.6; a.play().catch(() => {}); } catch { /* no audio */ }
}
import { apiFetch } from '../../api.js';
import { useChat } from '../../chat/store.js';
import { BotsManager } from '../../chat/Bots.jsx';
import NotificationsTab, { PushPrompt } from './NotificationsTab.jsx';
import './BonfireSettings.css';

// My Account > Chat: Ember settings (saved to the account, so every device gets them)
export const GROUPS = [
  ['Privacy', [
    ['share_activity', 'Share my activity', 'Show what you are playing or doing (Hyperfocus games, projects, integrations) under your name and on your profile.'],
    ['share_typing', 'Let others see when I am typing', 'Turn this off to type without the "is typing..." showing for anyone.'],
    ['allow_vc_calls', 'Let people call me into voice channels', 'Where a voice channel allows it, people in that server can ring you straight into it. Turn off to never get those calls.'],
    ['dm_privacy', 'Who can send me direct messages', 'Friends only stops people you are not friends with from starting a DM or calling you. The servers option also lets in people who share an Ember server with you. Nookara staff can always reach you.', [['everyone', 'Everyone'], ['friends', 'Friends only'], ['servers', "Members in servers I'm in"]]],
  ]],
  ['Notifications', [
    ['sounds', 'Sounds', 'A sound for new direct messages and when someone @mentions you.'],
    ['notify_sound', 'Notification sound', 'The sound for new direct messages and @mentions. Use the speaker to hear it.', [['short', 'Short'], ['long', 'Long'], ['classic', 'Classic']]],
    ['notifications', 'Desktop notifications', 'When Ember is open in the background. Direct messages count as mentions.', [['all', 'Every message'], ['mentions', 'DMs + mentions'], ['none', 'Off']]],
  ]],
  ['Messages', [
    ['show_typing', 'Show typing indicators', 'See who is typing, in the conversation and next to channels in the list.'],
    ['strip_tracking', 'Remove tracking from links', 'Cleans tracking junk (like ?utm_source=, ?si= or fbclid) off links you paste or send. Only the junk goes; the link still works the same.'],
    ['link_previews', 'Show link previews', "A card with the page's title and picture under messages with links, DMs included. Nookara fetches the page, so it sees that link, even in an encrypted DM. Off = a button to show one when you want it."],
    ['link_images', 'Show pictures from links', 'Links to pictures show as the picture instead of a link.'],
    ['yt_mode', 'Play YouTube videos', "Through Nookara: Nookara streams the video for you - no ads, no trackers. YouTube's player: starts instantly, but YouTube can track you and show ads.", [['ask', 'Ask each time'], ['velora', 'Through Nookara'], ['youtube', "YouTube's player"]]],
    ['dm_upload_dest', 'Where files in DMs go', "Nookara account storage: kept until you delete them, counts toward your storage. Temporary storage: free, deleted a set time after you send them (pictures about 30 days, videos and sounds 14, other files 7). The + button can always pick once.", [['ask', 'Ask every time'], ['account', 'Account storage'], ['temp', 'Temporary storage']]],
    ['compact', 'Compact message layout', 'Smaller pictures and tighter spacing, so more messages fit.'],
    ['animations', 'Animations', 'Messages, menus and pop-ups slide and fade in. Off = everything changes instantly.'],
  ]],
  ['Extras', [
    ['radio_enabled', 'Internet Radio', 'Plays a radio stream while Ember is open, with a little visualizer behind your chats.'],
    ['rock_easter_egg', 'The Rock', 'he likes pancakses'],
  ]],
  ['Advanced', [
    ['daily_notice', 'Daily credit messages', 'When your first message of the day earns your daily chat credits, Ember tells you (only you see it). Turn off to claim them quietly.'],
    ['developer_mode', 'Developer mode', 'Adds "Copy ID" options (accounts, servers, channels, messages) to right-click menus.'],
  ]],
];

// The Android app: notification controls that open Android's own settings pages (native bridge: BonfireNotifications)
const inAndroidApp = () => typeof window !== 'undefined' && !!window.BonfireNotifications?.postMessage;
function AndroidNotifications() {
  const send = type => { try { window.BonfireNotifications.postMessage(JSON.stringify({ type })); } catch { /* the app is older than this setting */ } };
  return <div className="card" id="bf-android-notifications">
    <div className="card-header"><span className="card-title">Android notifications</span></div>
    <div className="card-body">
      <p>Get message replies and incoming calls while Ember is in the background. This does not keep you online. The permanent "Background messages and calls" notification is its own Android category (Background connection). Open it below and switch it off to hide it; message and call alerts stay on.</p>
      <div className="bf-notification-controls">
        {[['Enable notifications', 'enable'], ['Hide the Background messages and calls notification', 'connection_settings'], ['Sounds & notification settings', 'settings'], ['Background battery settings', 'battery'], ['Disconnect background connection', 'disconnect']].map(([label, type]) => (
          <button type="button" key={type} className="btn btn-surface" onClick={() => send(type)}>{label}</button>
        ))}
      </div>
    </div>
  </div>;
}

// The desktop app's system: true on macOS. Guessed from the browser straight away, then taken from the app itself
// (bonfireDesktop.info() gives { platform, rpcAvailable, overlayAvailable }); cached for the page's life.
let desktopInfo = null;
const guessMac = () => { try { return /mac/i.test(navigator.userAgentData?.platform || navigator.platform || ''); } catch { return false; } };
export function useDesktopMac() {
  const [mac, setMac] = useState(() => (desktopInfo ? desktopInfo.platform === 'darwin' : guessMac()));
  useEffect(() => {
    const info = window.bonfireDesktop?.info;
    if (desktopInfo || typeof info !== 'function') return undefined;
    let live = true;
    Promise.resolve(info()).then(v => { if (v?.platform) { desktopInfo = v; if (live) setMac(v.platform === 'darwin'); } }).catch(() => {});
    return () => { live = false; };
  }, []);
  return mac;
}
// the desktop app's settings page is 'Windows app' inside (its page id); on a Mac it's called this
export const desktopAppTitle = mac => (mac ? 'macOS app' : 'Windows app');
const pageTitle = (title, mac) => (title === 'Windows app' ? desktopAppTitle(mac) : title);

function DesktopNotifications() {
  const mac = useDesktopMac();
  const osName = mac ? 'macOS' : 'Windows';
  const [notifications, setNotifications] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    window.bonfireDesktop.notificationStatus?.().then(setNotifications).catch(() => setErr(`Could not load ${osName} notification settings.`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="card">
    <div className="card-header"><span className="card-title">Desktop notifications</span></div>
    <div className="card-body cs-rows">
      {err && <div className="inline-msg error" role="alert">{err}</div>}
      <div className="cs-row">
        <div className="cs-text"><b><Bell size={15} /> {osName} notifications</b><span>Show native Ember notifications for DMs and incoming calls while the app is inactive.</span></div>
        <button type="button" className="btn btn-surface btn-sm" disabled={!notifications?.supported || notifications?.enabled} onClick={async () => { try { await window.bonfireDesktop.enableNotifications(); setNotifications(await window.bonfireDesktop.notificationStatus()); } catch { setErr(`${osName} notifications couldn't be enabled.`); } }}>{notifications?.enabled ? 'Enabled' : 'Enable'}</button>
      </div>
    </div>
  </div>;
}

function DesktopSettings() {
  const mac = useDesktopMac(); // the Mac app: its own words, and no Discord RPC capture (Windows named pipes only)
  const desktop = typeof window !== 'undefined' && window.bonfireDesktop?.isDesktop;
  const canDetectGames = typeof window !== 'undefined' && typeof window.bonfireDesktop?.detectState === 'function';
  const [rpc, setRpc] = useState(null);
  const [detect, setDetect] = useState(null);
  const [err, setErr] = useState('');
  // app start-up / tray settings (desktop 1.7.0+; older apps don't have getAppSettings, so these rows stay hidden)
  const hasApp = typeof window !== 'undefined' && typeof window.bonfireDesktop?.getAppSettings === 'function';
  const [app, setApp] = useState(null);
  useEffect(() => {
    if (!hasApp) return () => {};
    let live = true;
    window.bonfireDesktop.getAppSettings().then(v => { if (live && v) setApp(v); }).catch(() => {});
    const off = window.bonfireDesktop.onAppSettings?.(v => { if (live && v) setApp(v); }); // the tray menu can change them too
    return () => { live = false; if (typeof off === 'function') off(); };
  }, [hasApp]);
  async function setAppSetting(key, value) {
    const prev = app;
    setApp(s => ({ ...s, [key]: value })); setErr('');
    try {
      const v = await window.bonfireDesktop.setAppSettings({ [key]: value });
      if (v) setApp(v); else { setApp(prev); setErr("That didn't save - try again."); }
    } catch { setApp(prev); setErr("That didn't save - try again."); }
  }

  useEffect(() => {
    if (!desktop) return;
    window.bonfireDesktop.rpcState?.().then(setRpc).catch(() => setErr('Could not load game status settings.'));
    window.bonfireDesktop.detectState?.().then(setDetect).catch(() => setErr('Could not load game detection settings.'));
  }, [desktop]);
  if (!desktop && !hasApp) return null;

  async function setRpcEnabled(enabled) {
    setRpc(s => ({ ...s, enabled })); setErr('');
    try { setRpc(await window.bonfireDesktop.setRpcEnabled(enabled)); }
    catch { setRpc(s => ({ ...s, enabled: !enabled })); setErr("That didn't save - try again."); }
  }
  async function setDetectEnabled(enabled) {
    setDetect(s => ({ ...s, enabled })); setErr('');
    try { setDetect(await window.bonfireDesktop.setDetectEnabled(enabled)); }
    catch { setDetect(s => ({ ...s, enabled: !enabled })); setErr("That didn't save - try again."); }
  }

  return <div className="card">
    <div className="card-header"><span className="card-title">{desktopAppTitle(mac)}</span></div>
    <div className="card-body cs-rows">
      {err && <div className="inline-msg error">{err}</div>}
      {desktop && !mac && <div className="cs-row">
        <div className="cs-text"><b><Gamepad2 size={15} /> Capture Discord game status</b><span>Let Ember receive game activity sent through Discord RPC when Discord is closed.</span></div>
        <button type="button" role="switch" aria-checked={!!rpc?.enabled} className={`cs-switch${rpc?.enabled ? ' on' : ''}`} disabled={!rpc} onClick={() => setRpcEnabled(!rpc.enabled)}><i /></button>
      </div>}
      {hasApp && app && (mac ? [
        ['openAtLogin', Power, 'Open at login', 'Open Ember when you log in to your Mac.'],
        ['startMinimized', Minimize2, 'Start hidden', 'When Ember opens, keep it in the menu bar instead of opening the window.'],
        ['closeToTray', PanelBottomClose, 'Keep running in the menu bar when closed', 'Closing the window keeps Ember running in the menu bar, so calls and messages still reach you. Quit from the menu bar icon or with Cmd+Q.'],
      ] : [
        ['openAtLogin', Power, 'Start with Windows', 'Open Ember when you sign in to Windows.'],
        ['startMinimized', Minimize2, 'Start minimized', 'When Ember starts with Windows, keep it in the tray instead of opening the window.'],
        ['closeToTray', PanelBottomClose, 'Minimize to tray when closed', 'Closing the window keeps Ember running in the tray, so calls and messages still reach you. Quit from the tray icon.'],
      ]).map(([key, Icon, label, hint]) => (
        <div className="cs-row" key={key}>
          <div className="cs-text"><b><Icon size={15} /> {label}</b><span>{hint}</span></div>
          <button type="button" role="switch" aria-label={label} aria-checked={!!app[key]} className={`cs-switch${app[key] ? ' on' : ''}`} onClick={() => setAppSetting(key, !app[key])}><i /></button>
        </div>
      ))}
      {canDetectGames && <div className="cs-row">
        <div className="cs-text"><b>Detect games I play</b><span>Detect supported games directly on this {mac ? 'Mac' : 'Windows computer'} for your Ember activity.</span></div>
        <button type="button" role="switch" aria-checked={!!detect?.enabled} className={`cs-switch${detect?.enabled ? ' on' : ''}`} disabled={!detect} onClick={() => setDetectEnabled(!detect.enabled)}><i /></button>
      </div>}
    </div>
  </div>;
}

// Internet Radio: the stream address + volume / pause for the player on /chat (chat/Radio.jsx)
const RADIO_DEFAULT = 'https://www.clubfmserver.be/pink.mp3';
function DesignSettings() {
  const [d, setD] = useState(getDesign());
  useEffect(() => subscribeDesign(setD), []);
  return (
    <div className="card vl-rise" style={{ '--i': 0 }}>
      <div className="card-header"><span className="card-title">Design</span></div>
      <div className="card-body cs-rows">
        <div className="cs-row">
          <div className="cs-text"><b>Look</b><span>Square: the original sharp-cornered look. Rounded: flat dark greys with softly rounded corners. Saved on this device.</span></div>
          <div className="cs-seg">
            {[['square', 'Square'], ['rounded', 'Rounded']].map(([v, l]) => <button type="button" key={v} className={d === v ? 'on' : ''} aria-pressed={d === v} onClick={() => setDesign(v)}>{l}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageSoundsSettings() {
  const [c, setC] = useState(getMessageSounds());
  useEffect(() => subscribeMessageSounds(setC), []);
  const on = c.pack !== 'none';
  return (
    <div className="card vl-rise" style={{ '--i': 0 }}>
      <div className="card-header"><span className="card-title"><Volume2 size={15} /> Message sounds</span></div>
      <div className="card-body cs-rows">
        <div className="cs-row">
          <div className="cs-text"><b>Sound pack</b><span>Plays a sound when you send a message, when you get one (also in channels you are not looking at) and when a bot posts. While a pack is on it replaces the notification sound. Muted channels and Do Not Disturb stay quiet, and the main Sounds switch under Notifications still applies. Saved on this device.</span></div>
          <div className="cs-seg">
            {[{ id: 'none', name: 'None' }, ...SOUND_PACKS].map(p => <button type="button" key={p.id} className={c.pack === p.id ? 'on' : ''} onClick={() => { setMessageSounds({ pack: p.id }); if (p.id !== 'none') playPackSound('receive', { pack: p.id, force: true }); }}>{p.name}</button>)}
          </div>
        </div>
        <div className="cs-row">
          <div className="cs-text"><b>Volume</b><span>{on ? 'How loud the pack plays.' : 'Pick a pack to use this.'}</span></div>
          <div className="cs-radio-ctl">
            <input type="range" min={0} max={100} value={Math.round(c.volume * 100)} disabled={!on} aria-label="Message sound volume" onChange={e => setMessageSounds({ volume: Number(e.target.value) / 100 })} onPointerUp={() => playPackSound('receive', { force: true })} />
            <span className="cs-radio-vol">{Math.round(c.volume * 100)}%</span>
          </div>
        </div>
        <div className="cs-row">
          <div className="cs-text"><b>Preview</b><span>Hear the pack you picked.</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['send', 'Send'], ['receive', 'Receive'], ['bot', 'Bot']].map(([k, l]) => <button type="button" key={k} className="btn btn-surface btn-sm" disabled={!on} onClick={() => playPackSound(k, { force: true })}><Volume2 size={14} /> {l}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}
function RadioSettings({ s, change, saving }) {
  const radio = useRadio();
  const [url, setUrl] = useState(s.radio_url || RADIO_DEFAULT);
  useEffect(() => { setUrl(s.radio_url || RADIO_DEFAULT); }, [s.radio_url]);
  const valid = /^https?:\/\/[^\s<>"]+$/i.test(url.trim()) && url.trim().length <= 500;
  const dirty = url.trim() !== (s.radio_url || RADIO_DEFAULT);
  const state = { off: 'Open Ember to listen.', loading: 'Tuning in...', waiting: 'Click anywhere in Ember to start it (browsers block sound until you do).', playing: radio.proxied ? 'Playing.' : "Playing (this station can't feed the visualizer, so the bars stay off).", paused: 'Paused.', error: "Can't play that stream." }[radio.status] || '';
  return (
    <div className="card vl-rise" style={{ '--i': 1 }}>
      <div className="card-header"><span className="card-title"><Radio size={15} /> Internet Radio</span></div>
      <div className="card-body cs-rows">
        <p className="cs-note">This is a bit of an easter egg feature. It has been in every ScratchCord version, so it's here too.</p>
        <div className="cs-row cs-radio-url">
          <div className="cs-text"><b>Stream address</b><span>Any http(s) radio stream (MP3, AAC or Ogg). It plays through Nookara so the visualizer can see it.</span></div>
          <div className="cs-radio-input">
            <input className="form-input" maxLength={500} value={url} spellCheck={false} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && valid && dirty) change('radio_url', url.trim()); }} />
            <button type="button" className="btn btn-surface btn-sm" disabled={saving || !valid || !dirty} onClick={() => change('radio_url', url.trim())}>Save</button>
            {(s.radio_url || RADIO_DEFAULT) !== RADIO_DEFAULT && <button type="button" className="btn btn-surface btn-sm" disabled={saving} onClick={() => change('radio_url', RADIO_DEFAULT)}>Reset</button>}
          </div>
        </div>
        <div className="cs-row">
          <div className="cs-text"><b>Volume</b><span>{s.radio_enabled ? state : 'Turn Internet Radio on to listen.'}</span></div>
          <div className="cs-radio-ctl">
            <button type="button" className="btn btn-surface btn-sm" disabled={!s.radio_enabled || radio.status === 'off'} aria-label={radio.paused ? 'Play' : 'Pause'} title={radio.paused ? 'Play' : 'Pause'} onClick={toggleRadioPause}>{radio.paused ? <Play size={14} /> : <Pause size={14} />}</button>
            <input type="range" min={0} max={100} value={Math.round(radio.volume * 100)} aria-label="Radio volume" onChange={e => setRadioVolume(Number(e.target.value) / 100)} />
            <span className="cs-radio-vol">{Math.round(radio.volume * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// search: does a row / page match what's typed in Settings' "Search settings..." box?
export const matches = (q, ...texts) => { const t = String(q || '').trim().toLowerCase(); return !t || texts.some(x => String(x || '').toLowerCase().includes(t)); };

// page / query / bare: used by Ember's settings dialog (chat/SettingsDialog.jsx), which draws its own
// sidebar + title; page picks the category, query hides the rows that don't match the search.
// read-only: the key your messages are signed with is the Velora account's (made and rotated on the account page)
function SigningKeyRow() {
  const sg = useChat(s => s.signing);
  const text = sg?.state === 'ready' ? <>Signing key <code>{sg.kid}</code> - managed on your Nookara account</>
    : sg?.state === 'no_scope' ? 'Not signing: this login lacks the "Sign Messages" permission. Sign in again to allow it.'
    : sg?.state === 'unsupported' ? "This browser can't make Ed25519 signatures, so messages are sent unsigned."
    : sg?.state === 'error' ? "Couldn't load your signing key." : 'Signing key - managed on your Nookara account';
  return (
    <div className="cs-row">
      <div className="cs-text"><b>Message signing</b><span>{text}</span></div>
      <a className="btn btn-surface btn-sm" href={siteHref("/me#settings/security")} target="_blank" rel="noopener noreferrer">Account page</a>
    </div>
  );
}
// onLogin (instead of onLogout) = signed out of Velora: only the Account page has anything to show; web = Ember in a browser (its own sign-in)
export default function ChatSettingsTab({ embedded = false, onLogout, onLogin, web = false, page, query = '', bare = false }) {
  const [s, setS] = useState(null);
  const [ownCategory, setCategory] = useState('Privacy');
  const category = page || ownCategory;
  const [saving, setSaving] = useState(false);
  const contentRef = useRef(null);
  const desktop = !!window.bonfireDesktop?.isDesktop || typeof window.bonfireDesktop?.getAppSettings === 'function';
  const mac = useDesktopMac();
  const categories = [...GROUPS.map(([title]) => title), 'About', 'Bots', ...(desktop ? ['Windows app'] : []), ...(onLogout || onLogin ? ['Account'] : [])];
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [category]);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (onLogin) return; apiFetch('/chat/settings').then(d => setS(d.settings)).catch(() => setErr('Could not load your chat settings.')); }, []);
  async function change(key, value) {
    if (saving) return;
    setSaving(true);
    const prev = s;
    setS({ ...s, [key]: value }); setErr('');
    try {
      const d = await apiFetch('/chat/settings', { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
      setS(d.settings); setSaved(key);
      window.dispatchEvent(new CustomEvent('vc-settings', { detail: d.settings })); // let the chat store pick up the new settings
      setTimeout(() => setSaved(k => (k === key ? '' : k)), 1400);
    } catch { setS(prev); setErr("That didn't save - try again."); }
    finally { setSaving(false); }
  }
  return (
    <div className={`cs-wrap bf-settings${embedded ? " embedded" : ""}`}>
      {!embedded && !bare && <div className="card cs-open">
        <div className="card-body">
          <MessagesSquare size={22} />
          <div><b>Ember</b><span>Servers, channels, DMs and group chats all live in Ember now.</span></div>
          <a className="btn btn-primary" href="/chat">Open Ember</a>
        </div>
      </div>}
      <div className={bare ? 'bf-settings-bare' : 'bf-settings-layout'}>
        {!bare && <nav className="bf-settings-nav" aria-label="Ember settings categories">
          <span className="bf-settings-nav-label">Settings</span>
          {categories.map(title => <button type="button" key={title} aria-current={category === title ? 'page' : undefined} className={category === title ? 'active' : ''} onClick={() => setCategory(title)}>{pageTitle(title, mac)}</button>)}
        </nav>}
        <section className={bare ? 'bf-settings-bare-content' : 'bf-settings-content'} aria-label={pageTitle(category, mac)} ref={bare ? undefined : contentRef}>
          {!bare && <h4 className="bf-settings-title">{pageTitle(category, mac)}</h4>}
          {err && category !== 'About' && <div className="inline-msg error" role="alert">{err}</div>}
      {!s && !err && !onLogin && category !== 'About' && <div className="card"><div className="card-body">Loading...</div></div>}
      {s && GROUPS.filter(([title]) => title === category).map(([title, rows], gi) => (
        <div className="card vl-rise" style={{ '--i': gi }} key={title}>
          {!bare && <div className="card-header"><span className="card-title">{title}</span></div>}
          <div className="card-body cs-rows">
            {(r => (r.length ? r : rows))(rows.filter(([key, label, hint, ch]) => !(key === 'notifications' && inAndroidApp()) && matches(query, title, label, hint, ...(ch || []).map(c => c[1])))).map(([key, label, hint, choices]) => (
              <div className="cs-row" key={key}>
                <div className="cs-text"><b>{label}{saved === key && <em> Saved</em>}</b><span>{hint}</span></div>
                {choices ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="cs-seg">
                      {choices.map(([v, l]) => <button type="button" key={v} className={s[key] === v ? 'on' : ''} disabled={saving} onClick={() => change(key, v)}>{l}</button>)}
                    </div>
                    {key === 'notify_sound' && <button type="button" className="btn btn-surface btn-sm" title="Preview" aria-label="Preview notification sound" onClick={() => previewNotifySound(s[key])}><Volume2 size={14} /></button>}
                  </div>
                ) : (
                  <button type="button" role="switch" aria-label={label} disabled={saving} aria-checked={!!s[key]} className={`cs-switch${s[key] ? ' on' : ''}`} onClick={() => change(key, !s[key])}><i /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {s && category === 'Notifications' && (desktop ? <DesktopNotifications /> : inAndroidApp() ? <AndroidNotifications /> : <><PushPrompt /><NotificationsTab /></>)}
      {category === 'Privacy' && <><h4 className="bf-settings-title">Encrypted DMs</h4><E2eeSettings /></>}
      {category === 'Messages' && <DesignSettings />}
      {s && category === 'Extras' && <MessageSoundsSettings />}
      {s && category === 'Extras' && <RadioSettings s={s} change={change} saving={saving} />}
      {s && category === 'Bots' && <BotsManager />}
      {category === 'Windows app' && <DesktopSettings />}
      {category === 'About' && <AboutBonfire />}
      {onLogin && category === 'Account' && <div className="card">
        <div className="card-header"><span className="card-title">{bare ? 'Your account' : 'Sign in'}</span></div>
        <div className="card-body cs-rows">
          <div className="cs-row">
            <div className="cs-text"><b>Sign in with Nookara</b><span>Direct messages, group chats, friends and servers hosted by Nookara need your Nookara account. Servers with their own accounts work without it. Ember asks you to approve it first and keeps its own sign-in - the website's session isn't used.</span></div>
            <button type="button" className="btn btn-primary btn-sm" onClick={onLogin}><ShieldCheck size={14} /> Sign in</button>
          </div>
        </div>
      </div>}
      {onLogout && category === 'Account' && <div className="card">
        <div className="card-header"><span className="card-title">{bare ? 'Your account' : 'Log out'}</span></div>
        <div className="card-body cs-rows">
          {bare && <div className="cs-row">
            <div className="cs-text"><b>Account management</b><span>Email, password, security, connected accounts, billing and your data live on your Nookara account page.</span></div>
            <a className="btn btn-surface btn-sm" href={siteHref("/me")} target="_blank" rel="noopener noreferrer">Open</a>
          </div>}
          {bare && <SigningKeyRow />}
          <div className="cs-row">
            <div className="cs-text"><b>Sign out of Ember</b><span>{web ? "Remove Ember's Nookara sign-in from this browser. The website's own session isn't touched. Servers with their own accounts stay logged in." : 'Remove this account from this Ember app or browser. You can sign in with a different account afterwards.'}</span></div>
            <button type="button" className="btn btn-danger btn-sm" onClick={onLogout}><LogOut size={14} /> Log out</button>
          </div>
        </div>
      </div>}
        </section>
      </div>
    </div>
  );
}
