// One-time account notices ("what's new" popups, account-notices.js on Velora). GET /account/notices says which ids this
// account hasn't dismissed yet; we show the first one we have words for. Either button marks it seen for the account
// (POST /account/notices/:id/seen), so it never comes back here, in the other Ember apps or on the Velora dashboard.
import { useEffect, useState } from 'react';
import { ShieldCheck, MessageCircle, Ban, Settings } from 'lucide-react';
import { apiFetch } from '../api.js';

const NOTICES = {
  'privacy-settings-2026-10': {
    title: 'New privacy settings',
    lines: [
      [MessageCircle, 'Choose who can DM you: everyone, friends only, or people in servers you\'re in.'],
      [Ban, 'Block people so they can\'t see your profile, message you, call you or pay you. Their messages in servers are hidden behind a click.'],
      [Settings, 'Who can DM you is in Settings > Privacy. Block someone from their profile or user menu, and see everyone you blocked in your Nookara account under Privacy.'],
    ],
    action: 'Open privacy settings',
    page: 'Privacy', // SettingsDialog page with "Who can send me direct messages"
  },
};

// onOpenSettings(page): open Ember's settings on that page
export function AccountNotices({ onOpenSettings }) {
  const [id, setId] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch('/account/notices')
      .then(d => { if (live) setId((d?.notices || []).find(n => NOTICES[n]) || null); })
      .catch(() => {}); // offline / old server: ask again next time Ember opens
    return () => { live = false; };
  }, []);
  if (!id) return null;
  const n = NOTICES[id];
  const done = open => {
    apiFetch(`/account/notices/${encodeURIComponent(id)}/seen`, { method: 'POST' }).catch(() => {});
    setId(null);
    if (open) onOpenSettings?.(n.page);
  };
  return (
    <div className="vc-modal-back" role="presentation">
      <div className="vc-dialog vc-notice" role="dialog" aria-modal="true" aria-labelledby="vc-notice-t">
        <h3 id="vc-notice-t"><ShieldCheck size={19} /> {n.title}</h3>
        <ul className="vc-notice-list">
          {n.lines.map(([Icon, text]) => <li key={text}><Icon size={15} /><span>{text}</span></li>)}
        </ul>
        <div className="vc-dialog-btns">
          <button type="button" className="btn btn-primary" autoFocus onClick={() => done(true)}><Settings size={15} /> {n.action}</button>
          <button type="button" className="btn btn-surface" onClick={() => done(false)}>Got it</button>
        </div>
      </div>
    </div>
  );
}
