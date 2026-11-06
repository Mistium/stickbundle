// "Attach a Glint clip" when you have no clips yet: what Glint is + where to get it
import { Download, History, Scissors, Link2, Keyboard } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { GlintMark, GLINT_DOWNLOAD, GLINT_BROWSE, openOutside } from './glint.jsx';

const POINTS = [
  [History, 'Always-on replay', 'Glint keeps the last few minutes of your game in the background.'],
  [Keyboard, 'Alt+C to clip', 'Something great happened? One key saves it.'],
  [Scissors, 'Trim it', 'Cut it down to the good part before you share.'],
  [Link2, 'Share a link', 'Clip links play right here in Ember, with their own card.'],
];
export default function GlintIntro({ onClose }) {
  const go = (url, close) => e => { e.preventDefault(); openOutside(url); close(); };
  return (
    <Dialog title={<span className="vc-glint-intro-title"><span className="vc-glint-intro-mark"><GlintMark size={20} /></span>Glint</span>} sub="Medal-style game clipping for Windows, made for Nookara." onClose={onClose} className="vc-glint-intro">
      {close => (
        <>
          <ul className="vc-glint-intro-list">
            {POINTS.map(([Icon, t, d], i) => <li key={t} className="vl-rise" style={{ '--i': i }}><Icon size={17} /><span><b>{t}</b><small>{d}</small></span></li>)}
          </ul>
          <div className="vc-dialog-btns vc-glint-intro-actions">
            <a href={GLINT_BROWSE} className="vc-glint-intro-browse" target="_blank" rel="noopener noreferrer" onClick={go(GLINT_BROWSE, close)}>Browse clips</a>
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>Not now</button>
            <a href={GLINT_DOWNLOAD} className="btn btn-primary" target="_blank" rel="noopener noreferrer" onClick={go(GLINT_DOWNLOAD, close)}><Download size={15} /> Download Glint</a>
          </div>
        </>
      )}
    </Dialog>
  );
}
