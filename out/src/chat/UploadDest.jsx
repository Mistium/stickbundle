// "Where should this go?": the first time files are added in a DM / group chat (chat setting dm_upload_dest = ask), pick
// Velora account storage or Velora's temporary storage, and maybe remember it. store.chooseUploadDest opens this.
import { useEffect, useState } from 'react';
import { HardDrive, Clock } from 'lucide-react';
import { Dialog } from './Dialogs.jsx';
import { useChat, answerUploadAsk, loadUploadDestinations } from './store.js';

const MB = 1024 * 1024;
const fmt = b => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(b >= 10 * 1024 * MB ? 0 : 1)} GB` : `${Math.max(0, Math.round(b / MB))} MB`);

export function UploadDestHost() {
  const a = useChat(s => s.uploadAsk);
  const [info, setInfo] = useState(null);
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    if (!a) return undefined;
    setRemember(false);
    let live = true;
    Promise.resolve(loadUploadDestinations(true)).then(d => { if (live) setInfo(d); });
    return () => { live = false; };
  }, [a]);
  if (!a) return null;
  const acc = info?.account, tmp = info?.temp, days = tmp?.days || { image: 30, media: 14, file: 7, large: 3 };
  const accWhy = !acc ? null
    : !acc.available ? "This login can't use your account storage (it's missing the Media Upload permission)."
      : a.biggest > acc.max_mb * MB ? `Files kept on your account go up to ${acc.max_mb} MB.`
        : a.total > acc.remaining ? `Not enough space left (${fmt(acc.remaining)} free).` : null;
  const tmpWhy = tmp && a.biggest > tmp.max_mb * MB ? `Temporary files go up to ${tmp.max_mb} MB.` : null;
  const pick = dest => answerUploadAsk(dest, remember);
  return (
    <Dialog title="Where should this go?" sub={a.count === 1 ? 'Pick where the file you\'re sending is kept.' : `Pick where the ${a.count} files you're sending are kept.`} onClose={() => answerUploadAsk(null)} className="vc-updest">
      <div className="vc-updest-cards">
        <button type="button" className="vc-updest-card" disabled={!!accWhy} onClick={() => pick('account')}>
          <HardDrive size={22} />
          <span>
            <b>Nookara account storage</b>
            <small>Stays until you delete it, and counts toward your storage.{acc ? ` ${fmt(acc.remaining)} of ${fmt(acc.limit)} free.` : ''}{acc && !acc.pro && acc.pro_limit ? ` Nookara Pro has ${fmt(acc.pro_limit)}.` : ''}</small>
            {accWhy && <small className="why">{accWhy}</small>}
          </span>
        </button>
        <button type="button" className="vc-updest-card" disabled={!!tmpWhy} onClick={() => pick('temp')}>
          <Clock size={22} />
          <span>
            <b>Temporary storage</b>
            <small>Free. Deleted a set time after you send it: pictures after about {days.image} days, videos and sounds {days.media}, other files {days.file}, files over 25 MB {days.large}. Opening a file never changes that.</small>
            {tmpWhy && <small className="why">{tmpWhy}</small>}
          </span>
        </button>
      </div>
      <label className="vc-check sm vc-updest-remember">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        <span>Remember my choice. Change it in My Account &gt; Chat, or pick once from the + button.</span>
      </label>
    </Dialog>
  );
}
