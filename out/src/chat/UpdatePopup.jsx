// "There's an update" popups (bottom-right corner):
//  - the website: a newer commit of ember-client is out AND the site actually serves it -> Reload. The client watches GitHub for a
//    new commit on main, then waits until the site's version.json shows that commit (the host has to deploy it first); only then
//    does it ask for a reload. When GitHub can't be reached it falls back to just comparing with what the site serves.
//  - the desktop app: a new version is downloading (progress) -> once it's in, Restart to update
import { useEffect, useState } from 'react';
import { RotateCw, X, Download } from 'lucide-react';
import { BonfireLogo, isDesktopApp } from './BonfireLogo.jsx';
import { COMMIT, isRelease, sameCommit, latestCommit, servedCommit } from '../version.js';

const mb = n => (n ? `${(n / 1048576).toFixed(n > 104857600 ? 0 : 1)} MB` : '');

export function UpdatePopup() {
  const [web, setWeb] = useState(false); // a newer website build is live
  const [app, setApp] = useState(null);  // { state: 'downloading' | 'ready', version, progress, got, total }
  const [hide, setHide] = useState({});  // what you closed: 'web', 'dl:<version>', 'ready:<version>'
  useEffect(() => {
    if (!isRelease) return undefined; // dev builds have no commit to compare
    let live = true, busy = false, latest = null, lastGithub = 0, timer = null;
    const GITHUB_EVERY = 5 * 60 * 1000, WAITING_EVERY = 60 * 1000, IDLE_EVERY = 5 * 60 * 1000;
    // one round: ask GitHub (not more than every few minutes; its API is rate limited), then see what the site serves
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!latest || Date.now() - lastGithub > GITHUB_EVERY) { latest = (await latestCommit()) || latest; lastGithub = Date.now(); }
        const served = await servedCommit();
        if (!live || !served) return;
        // the site serves a build that isn't this one, and it is the newest one on GitHub (or GitHub couldn't tell us)
        if (!sameCommit(served, COMMIT) && (!latest || sameCommit(served, latest))) setWeb(true);
      } finally { busy = false; schedule(); }
    };
    // GitHub has a newer commit than ours but the site doesn't serve it yet: look again soon, until it does
    const schedule = () => { clearTimeout(timer); if (live) timer = setTimeout(check, latest && !sameCommit(latest, COMMIT) ? WAITING_EVERY : IDLE_EVERY); };
    const onFocus = () => { if (Date.now() - lastGithub > 30 * 1000) check(); };
    addEventListener('focus', onFocus);
    const onPush = () => { lastGithub = 0; check(); }; // Velora says its files changed: ask GitHub and the site again
    addEventListener('vc-web-build', onPush);
    timer = setTimeout(check, 20000);
    return () => { live = false; clearTimeout(timer); removeEventListener('focus', onFocus); removeEventListener('vc-web-build', onPush); };
  }, []);
  useEffect(() => {
    if (!isDesktopApp() || !window.bonfireDesktop.onUpdate) return undefined;
    return window.bonfireDesktop.onUpdate(u => { if (u?.state === 'downloading' || u?.state === 'ready') setApp(u); else if (u?.state === 'error') setApp(a => (a?.state === 'downloading' ? null : a)); });
  }, []);
  const close = k => setHide(h => ({ ...h, [k]: true }));

  // the desktop app first (restarting it also loads the newest website)
  if (app?.state === 'ready' && !hide[`ready:${app.version}`]) {
    return (
      <div className="vc-upd" role="status">
        <span className="vc-upd-ico"><BonfireLogo size={34} /></span>
        <div className="vc-upd-txt"><b>Ember {app.version} is ready</b><span>Restart Ember to update. If you don't, it updates by itself next time you quit.</span></div>
        <div className="vc-upd-btns">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.bonfireDesktop.installUpdate()}><RotateCw size={14} /> Restart to update</button>
          <button type="button" className="vc-ico-btn" title="Later" onClick={() => close(`ready:${app.version}`)}><X size={15} /></button>
        </div>
      </div>
    );
  }
  if (app?.state === 'downloading' && !hide[`dl:${app.version}`]) {
    const pct = Math.max(0, Math.min(100, app.progress || 0));
    return (
      <div className="vc-upd" role="status">
        <span className="vc-upd-ico"><BonfireLogo size={34} /></span>
        <div className="vc-upd-txt">
          <b>Downloading Ember {app.version}</b>
          <span>{pct}%{app.total ? ` - ${mb(app.got)} of ${mb(app.total)}` : ''}. Keep chatting, it's in the background.</span>
          <i className="vc-upd-bar"><i style={{ width: `${pct}%` }} /></i>
        </div>
        <div className="vc-upd-btns">
          <span className="vc-upd-dl"><Download size={16} /></span>
          <button type="button" className="vc-ico-btn" title="Hide (it keeps downloading)" onClick={() => close(`dl:${app.version}`)}><X size={15} /></button>
        </div>
      </div>
    );
  }
  if (web && !hide.web) {
    return (
      <div className="vc-upd" role="status">
        <span className="vc-upd-ico"><BonfireLogo size={34} /></span>
        <div className="vc-upd-txt"><b>Ember has been updated</b><span>Reload to get the newest version - anything you're typing is kept.</span></div>
        <div className="vc-upd-btns">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => location.reload()}><RotateCw size={14} /> Reload</button>
          <button type="button" className="vc-ico-btn" title="Later" onClick={() => close('web')}><X size={15} /></button>
        </div>
      </div>
    );
  }
  return null;
}
