// Discover > Bots: the bot gallery (approved, Verified bots), with search, tags, a detail view and Add to server.
import { useEffect, useState } from 'react';
import { Search, Bot, ArrowLeft, ExternalLink, Link2, ShieldCheck, Tag, Flag } from 'lucide-react';
import { useChat } from './store.js';
import { BotTag, AddBotButton, TrustedIn } from './Bots.jsx';
import { GALLERY_PERMS } from './BotGalleryDev.jsx';
import { getToken } from '../api.js';

const httpsOnly = u => (/^https:\/\//i.test(u || '') ? u : null); // listing text is the developer's: only https links
const permName = k => (GALLERY_PERMS.find(p => p[0] === k) || [k, k.replace(/_/g, ' ')])[1];

function BotAvatar({ b, size = 52 }) {
  return <span className="bg-av" style={{ width: size, height: size }}>{httpsOnly(b.avatar_url) ? <img src={b.avatar_url} alt="" /> : <Bot size={size / 2} />}</span>;
}

export function BotGallery() {
  const signedIn = !!getToken();
  const [q, setQ] = useState('');
  const [deb, setDeb] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState([]);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(null); // a bot's id
  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { fetch('/bonfire/bots/gallery/tags').then(r => (r.ok ? r.json() : Promise.reject())).then(x => setTags(x.tags || [])).catch(() => {}); }, []);
  const load = (page = 1) => fetch(`/bonfire/bots/gallery?q=${encodeURIComponent(deb)}&tag=${encodeURIComponent(tag)}&page=${page}`).then(r => (r.ok ? r.json() : Promise.reject()))
    .then(x => { setErr(false); setD(cur => ({ ...x, results: page > 1 && cur ? [...cur.results, ...x.results] : x.results })); }).catch(() => setErr(true));
  useEffect(() => { setD(null); load(1); }, [deb, tag]); // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return <BotDetail id={open} signedIn={signedIn} onBack={() => setOpen(null)} />;
  return (
    <>
      <label className="vc-search"><Search size={15} /><input placeholder="Search bots by name, description or tag" value={q} onChange={e => setQ(e.target.value)} /></label>
      {tags.length > 0 && (
        <div className="bg-tagbar">
          <button type="button" className={`vc-chip${tag ? '' : ' ok'}`} onClick={() => setTag('')}>All</button>
          {tags.slice(0, 16).map(t => <button type="button" key={t.tag} className={`vc-chip${tag === t.tag ? ' ok' : ''}`} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{t.tag} <small>{t.count}</small></button>)}
        </div>
      )}
      <div className="vc-disc-grid bg-grid">
        {!d && !err && <div className="vc-loading"><i /><i /><i /></div>}
        {err && <div className="vc-empty-note">Couldn't load the bot gallery - try again in a bit.</div>}
        {d && !d.results.length && <div className="vc-empty-note">{deb || tag ? 'No bots match that.' : 'No bots are listed yet.'}</div>}
        {d?.results.map(b => (
          <div key={b.id} className="vc-disc-card bg-card vl-rise">
            <button type="button" className="bg-card-main" onClick={() => setOpen(b.id)}>
              <BotAvatar b={b} />
              <span className="bg-card-txt">
                <b>{b.username}<BotTag small verified={b.verified} /></b>
                <small>by @{b.owner}</small>
                <span className="bg-desc">{b.description || 'No description.'}</span>
              </span>
            </button>
            {b.tags?.length > 0 && <div className="vc-disc-tags">{b.tags.slice(0, 5).map(t => <span key={t} className="vc-chip">{t}</span>)}</div>}
            <div className="vc-disc-foot">
              <span><ShieldCheck size={13} /> Trusted in {b.trusted_in} server{b.trusted_in === 1 ? '' : 's'}</span>
              <button type="button" className="btn btn-surface btn-sm" onClick={() => setOpen(b.id)}>Details</button>
            </div>
          </div>
        ))}
      </div>
      {d?.has_more && <div className="vc-dialog-btns"><span className="grow" /><button type="button" className="btn btn-surface" onClick={() => load((d.page || 1) + 1)}>Load more</button><span className="grow" /></div>}
    </>
  );
}

function BotDetail({ id, signedIn, onBack }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  useChat(s => s.servers); // (redraw when my servers change)
  useEffect(() => {
    // with a login, the owner and staff can open their unlisted bots too
    const t = getToken();
    fetch(`/bonfire/bots/gallery/${encodeURIComponent(id)}`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(x => setB(x.bot || x)).catch(() => setErr("Couldn't load that bot."));
  }, [id]);
  return (
    <div className="bg-detail">
      <button type="button" className="btn btn-surface btn-sm" onClick={onBack}><ArrowLeft size={13} /> All bots</button>
      {err && <div className="vc-empty-note">{err}</div>}
      {!b && !err && <div className="vc-loading"><i /><i /><i /></div>}
      {b && (
        <>
          <div className="bg-detail-head">
            <BotAvatar b={b} size={72} />
            <div className="grow">
              <h4>{b.username}<BotTag verified={b.verified} /></h4>
              <small>Made by @{b.owner}</small>
              <TrustedIn n={b.trusted_in} verified />
            </div>
            <div className="bg-detail-add">
              {signedIn
                ? <AddBotButton username={b.username} info={{ bot: { id: b.id, username: b.username, public: !!b.verified, mine: !!b.mine, state: b.state }, can_add_to: null }} />
                : <small className="vc-hint">Sign in to add it to a server.</small>}
            </div>
          </div>
          {b.tags?.length > 0 && <div className="vc-disc-tags">{b.tags.map(t => <span key={t} className="vc-chip"><Tag size={11} /> {t}</span>)}</div>}
          <p className="bg-long">{b.long_description || b.description || 'No description.'}</p>
          {b.permissions?.length > 0 && (
            <div className="bg-block"><b>Asks for these permissions</b>
              <div className="vc-disc-tags">{b.permissions.map(p => <span key={p} className="vc-chip">{permName(p)}</span>)}</div></div>
          )}
          {(httpsOnly(b.support_url) || b.links?.some(l => httpsOnly(l.url))) && (
            <div className="bg-block"><b>Links</b>
              <div className="vc-disc-tags">
                {httpsOnly(b.support_url) && <a className="vc-chip vc-conn" href={b.support_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Support</a>}
                {b.links?.filter(l => httpsOnly(l.url)).map(l => <a key={l.url} className="vc-chip vc-conn" href={l.url} target="_blank" rel="noopener noreferrer"><Link2 size={13} /> {l.label}</a>)}
              </div></div>
          )}
          <p className="vc-hint">After adding it, connect the bot to that server's address with its token. Its developer's page or the support link explains how.</p>
          {/* spam, scams or rule-breaking: Velora staff see it in Admin > Apps */}
          <p className="vc-hint"><a href={`https://nookara.cc/report?bot=${encodeURIComponent(b.id)}`} target="_blank" rel="noopener noreferrer"><Flag size={12} style={{ verticalAlign: '-2px' }} /> Report this bot to Nookara</a></p>
        </>
      )}
    </div>
  );
}
