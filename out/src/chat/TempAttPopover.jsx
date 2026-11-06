// The little settings popover on a file waiting in the composer (the clock / drive badge on it, see Composer in
// Messages.jsx). For temporary storage it shows how long the file will last; Velora Pro members can pick a fixed expiry
// (sent as expires_in_days, see store.uploadTemp), everyone else gets a short note about Pro. Either way the file can be
// moved to account storage instead (or back), the same two places the "Where should this go?" picker offers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, HardDrive, Sparkles, Check, ArrowRight, HelpCircle } from 'lucide-react';
import { loadUploadDestinations } from './store.js';
import { normalDays, daysText, expiryChoices, pickedDays } from './temp-pick.js';

const MB = 1024 * 1024;
const VELORA = 'https://nookara.cc';
const fmt = b => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.max(0, Math.round(b / MB))} MB`);
const dateIn = days => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) }).format(Date.now() + days * 864e5);

// att: the composer's queued file ({ kind, size, dest, expires }); rect: the badge's getBoundingClientRect()
// onExpires(value, days): value 'default' | days | 'max' (what goes to the server), days = what it stands for (null = default)
// onDest('account' | 'temp')
export function TempAttPopover({ att, rect, onExpires, onDest, onClose }) {
  const [info, setInfo] = useState(undefined);
  const box = useRef(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.top, hidden: true });
  useEffect(() => {
    let live = true;
    Promise.resolve(loadUploadDestinations()).then(d => { if (live) setInfo(d || null); });
    return () => { live = false; };
  }, []);
  // open above the badge, kept inside the window
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8));
    const top = rect.top - h - 8 >= 8 ? rect.top - h - 8 : Math.min(rect.bottom + 8, innerHeight - h - 8);
    setPos({ left, top, hidden: false });
  }, [info, rect, att.dest]);
  useEffect(() => {
    const down = e => { if (box.current && !box.current.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    addEventListener('resize', onClose);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); removeEventListener('resize', onClose); };
  }, [onClose]);

  const tmp = info?.temp, acc = info?.account;
  const pro = !!(tmp?.can_pick_expiry ?? tmp?.pro);
  const normal = normalDays(tmp?.days, att.kind, att.size);
  const proNormal = normalDays(tmp?.pro_days, att.kind, att.size);
  const maxDays = tmp?.max_expiry_days;
  const picked = att.expires ?? 'default';
  const accWhy = !acc ? null : !acc.available ? "This login can't use your account storage."
    : att.size > acc.max_mb * MB ? `Files kept on your account go up to ${acc.max_mb} MB.`
      : att.size > acc.remaining ? `Not enough space left (${fmt(acc.remaining)} free).` : null;
  const tmpWhy = tmp && att.size > tmp.max_mb * MB ? `Temporary files go up to ${tmp.max_mb} MB.` : null;

  let body;
  if (info === undefined) body = <div className="vc-tpop-loading">Loading...</div>;
  else if (att.dest === 'account') {
    body = (
      <>
        <div className="vc-tpop-head"><HardDrive size={16} /><b>Kept on your account</b></div>
        <p className="vc-tpop-text">Stays until you delete it, and counts toward your Nookara storage{acc ? ` (${fmt(acc.remaining)} of ${fmt(acc.limit)} free)` : ''}.</p>
        <button type="button" className="vc-tpop-move" disabled={!!tmpWhy} onClick={() => { onDest('temp'); onClose(); }}>
          <Clock size={15} /><span><b>Send as a temporary file instead</b><small>{tmpWhy || `Free, deleted ${normal ? `after ${daysText(normal)}` : 'after a set time'}`}</small></span>
        </button>
      </>
    );
  } else {
    const choices = pro ? expiryChoices(tmp.expiry_presets, maxDays) : [];
    body = (
      <>
        <div className="vc-tpop-head"><Clock size={16} /><b>Temporary file</b>{pro && <span className="vc-tpop-chip">Pro</span>}</div>
        {pro ? (
          <>
            <p className="vc-tpop-text">When should it be deleted?</p>
            <div className="vc-tpop-choices" role="radiogroup" aria-label="Expiry">
              {choices.map(c => {
                const on = String(picked) === String(c.value);
                return (
                  <button key={c.value} type="button" role="radio" aria-checked={on} className={`vc-tpop-choice${on ? ' on' : ''}`} onClick={() => onExpires(c.value, c.days)}>
                    <span className="vc-tpop-radio">{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className="vc-tpop-label">{c.value === 'default' ? 'Default' : daysText(c.days)}{c.value === 'max' && <em> (longest)</em>}</span>
                    <small>{c.value === 'default' ? (normal ? `${daysText(normal)} after it's sent` : 'The normal time') : dateIn(c.days)}</small>
                  </button>
                );
              })}
            </div>
            <p className="vc-tpop-note">{pickedDays(picked, maxDays) ? 'Deleted on that date, however often the file is opened.' : 'Deleted a set time after it is sent, however often the file is opened.'}</p>
          </>
        ) : (
          <>
            <p className="vc-tpop-text">{normal ? `Deleted ${daysText(normal)} after you send it.` : 'Deleted a set time after you send it.'} Opening it doesn't change that.</p>
            <div className="vc-tpop-pro">
              <Sparkles size={15} />
              <span>
                <b>Nookara Pro</b> keeps it {proNormal ? `${daysText(proNormal)}` : 'twice as long'} and lets you pick when it expires, up to {daysText(tmp?.pro_days?.max || 120)}.
                <a href={`${VELORA}/upgrade`} target="_blank" rel="noopener noreferrer">Get Pro <ArrowRight size={12} /></a>
              </span>
            </div>
          </>
        )}
        <button type="button" className="vc-tpop-move" disabled={!!accWhy} onClick={() => { onDest('account'); onClose(); }}>
          <HardDrive size={15} /><span><b>Keep on my account instead</b><small>{accWhy || 'Stays until you delete it'}</small></span>
        </button>
      </>
    );
  }
  return createPortal(
    <div ref={box} className="vc-tpop" role="dialog" aria-label="File storage" style={{ left: pos.left, top: pos.top, visibility: pos.hidden ? 'hidden' : 'visible' }}>
      {body}
      <a className="vc-tpop-help" href={`${VELORA}/temp-files`} target="_blank" rel="noopener noreferrer"><HelpCircle size={13} />How temporary files work</a>
    </div>,
    document.body,
  );
}
