// A one-time "Ember has an app" popup for phones using the website. Download opens the app picker (AppDownload.jsx), Dismiss closes it for
// good (kept per device in localStorage). After Dismiss a short notice says the rail's download button gets the app too, then it goes
// away by itself. Never shown in the Android app, the desktop app, or on a computer.
import { useEffect, useState } from 'react';
import { Smartphone, Download, X } from 'lucide-react';
import { isDesktopApp } from './BonfireLogo.jsx';
import { isMobileDevice } from './store.js';
import { dialog } from './Parts.jsx';

const KEY = 'bf_app_promo';
const NOTICE_MS = 7000;
let seenThisSession = false; // when localStorage can't be used the popup still only comes once per page load
const wasDismissed = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return seenThisSession; } };
const markDismissed = () => { seenThisSession = true; try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };
const inApp = () => !!window.bonfireMobile || isDesktopApp() || /\bBonfireAndroid\//.test(navigator.userAgent);

export function MobileAppPromo() {
  const [step, setStep] = useState(() => (isMobileDevice() && !inApp() && !wasDismissed() ? 'ask' : 'none'));
  useEffect(() => {
    if (step !== 'notice') return undefined;
    const t = setTimeout(() => setStep('none'), NOTICE_MS);
    return () => clearTimeout(t);
  }, [step]);

  if (step === 'ask') {
    const dismiss = () => { markDismissed(); setStep('notice'); };
    return (
      <div className="vc-modal-back" role="presentation">
        <div className="vc-dialog vc-app-promo" role="dialog" aria-modal="true" aria-labelledby="vc-app-promo-t">
          <img className="vc-app-promo-logo" src="/assets/bonfire/logo-photo-96.jpg?v=2" alt="" width={72} height={72} draggable={false} />
          <h3 id="vc-app-promo-t">Ember has an app</h3>
          <p className="vc-dialog-sub">Get Ember for Android for notifications, swipe gestures and a smoother phone experience. There are desktop apps for macOS and Windows too.</p>
          <div className="vc-dialog-btns">
            <button type="button" className="btn btn-primary" onClick={() => { markDismissed(); setStep('none'); dialog('app-download'); }}><Download size={15} /> Download</button>
            <button type="button" className="btn btn-surface" onClick={dismiss}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }
  if (step === 'notice') {
    return (
      <div className="vc-upd vc-app-promo-note" role="status">
        <span className="vc-upd-ico"><Smartphone size={22} /></span>
        <div className="vc-upd-txt"><b>Changed your mind?</b><span>The download button in the server rail also gets the Ember app.</span></div>
        <div className="vc-upd-btns"><button type="button" className="vc-ico-btn" title="Close" onClick={() => setStep('none')}><X size={15} /></button></div>
      </div>
    );
  }
  return null;
}
