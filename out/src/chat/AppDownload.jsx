// Getting the Ember apps from the website. AppDownload: the rail's download button opens it, with this device picked and the others
// a click away. AppDownloadTip: a one-time note beside that button on a computer (kept per device in localStorage); phones get
// MobileAppPromo instead, because their rail is usually out of view. Neither shows in the Android or desktop apps.
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Monitor, Laptop, Smartphone } from 'lucide-react';
import { openSite } from './hosts.js';
import { Dialog } from './Dialogs.jsx';
import { isDesktopApp } from './BonfireLogo.jsx';
import { isMobileDevice } from './store.js';
import { APP_TARGETS, detectAppTarget } from './appDownloadInfo.js';

const ICONS = { windows: Monitor, mac: Laptop, android: Smartphone };

export function AppDownload({ onClose }) {
  const [detected] = useState(() => detectAppTarget(navigator.userAgent, navigator.maxTouchPoints));
  const [picked, setPicked] = useState(detected);
  const target = APP_TARGETS[picked];
  return (
    <Dialog title="Get the Ember app" sub="Ember has apps for Windows, macOS and Android with extra features." onClose={onClose}>
      {close => (
        <>
          <div className="vc-appdl-list" role="radiogroup" aria-label="Your device">
            {Object.entries(APP_TARGETS).map(([id, t]) => {
              const Icon = ICONS[id];
              return (
                <button key={id} type="button" role="radio" aria-checked={picked === id} className={`vc-appdl-opt${picked === id ? ' on' : ''}`} onClick={() => setPicked(id)}>
                  <Icon size={20} />
                  <span className="vc-appdl-txt"><b>{t.name}{id === detected && <small>This device</small>}</b><span>{t.about}</span></span>
                </button>
              );
            })}
          </div>
          <div className="vc-dialog-btns">
            <button type="button" className="btn btn-primary" disabled={!target} onClick={() => { openSite(target.path); close(); }}><Download size={15} /> {target ? `Download for ${target.name}` : 'Choose your device'}</button>
            <button type="button" className="btn btn-surface" onClick={close}>Close</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

const TIP_KEY = 'bf_app_tip';
const TIP_DELAY_MS = 1500;
let tipSeen = false; // when localStorage can't be used the tip still only comes once per page load
const wasTipSeen = () => { try { return localStorage.getItem(TIP_KEY) === '1'; } catch { return tipSeen; } };
const markTipSeen = () => { tipSeen = true; try { localStorage.setItem(TIP_KEY, '1'); } catch { /* private mode */ } };
const button = () => document.querySelector('[data-app-download]');

export function AppDownloadTip({ onOpen }) {
  const [show, setShow] = useState(false);
  const [box, setBox] = useState(null);
  // waits for the rail to be drawn and for any dialog to close, so it never lands on top of one
  useEffect(() => {
    if (isDesktopApp() || window.bonfireMobile || isMobileDevice() || wasTipSeen()) return undefined;
    const t = setInterval(() => {
      if (!button() || document.querySelector('.vc-modal-back')) return;
      clearInterval(t);
      setShow(true);
    }, TIP_DELAY_MS);
    return () => clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    if (!show) return undefined;
    const place = () => { const r = button()?.getBoundingClientRect(); setBox(r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null); };
    button()?.scrollIntoView({ block: 'nearest' });
    place();
    const rail = button()?.closest('.vc-rail');
    const pressed = button()?.closest('button'); // pressing the button itself counts as having seen the tip
    const done = () => { markTipSeen(); setShow(false); };
    addEventListener('resize', place);
    rail?.addEventListener('scroll', place);
    pressed?.addEventListener('click', done);
    return () => { removeEventListener('resize', place); rail?.removeEventListener('scroll', place); pressed?.removeEventListener('click', done); };
  }, [show]);
  if (!show || !box) return null;
  const end = open => { markTipSeen(); setShow(false); if (open) onOpen(); };
  // sits to the right of the button, kept on screen when the button is near the bottom of the window
  const top = Math.max(12, Math.min(box.y + box.h / 2 - 70, innerHeight - 170));
  return createPortal(
    <>
      <i className="vc-appdl-ring" style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8 }} />
      <div className="vc-appdl-tip" role="dialog" aria-labelledby="vc-appdl-tip-t" style={{ left: box.x + box.w + 14, top }}>
        <b id="vc-appdl-tip-t">Ember has apps</b>
        <p>Download Ember for Android or desktop (macOS and Windows) to get extra features.</p>
        <div className="vc-dialog-btns">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => end(true)}><Download size={13} /> See downloads</button>
          <button type="button" className="btn btn-surface btn-sm" onClick={() => end(false)}>Not now</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
