// Starboard channels: the server's best messages, laid out like a gallery.
// A message gets on the board once it has enough ⭐ (the star button on messages, the ⭐ reaction, or votes here -
// they're all the same reaction) and then stays, even if it loses stars later. Top starred + a random throwback up top.
import { useEffect, useMemo, useRef, useState } from 'react';
import { viaProxy } from './mediaProxy.js';
import { Star, CornerDownRight, Shuffle, Trophy, History, Check } from 'lucide-react';
import { apiFetch } from '../api.js';
import { useChat, toast, errorText, go, openLink, jumpToMessage } from './store.js';
import { setReaction } from './Reactions.jsx';
import { renderBody, stampOf } from './text.jsx';
import { GameInvites } from './GameInvite.jsx';
import { viewMedia } from './MediaViewer.jsx';
import { Avatar } from './Profile.jsx';
import { VideoPlayer, AudioPlayer } from './MediaPlayer.jsx';
import { FileCard } from './Messages.jsx';
import { K, bare, instOf, instOpt, isInst } from './ids.js';
import { isSpoiler } from './spoiler.js';
import { aliasOf, aliasFace, shownName } from './aliases.js';

// the star, drawn (never the emoji)
const StarIco = () => <Star size={13} className="vc-stb-inline" fill="currentColor" />;

export const STAR = '⭐';

// the star button in a message's quick actions: only where a starboard is watching that channel
export function useStarboardFor(sid, cid) {
  const chans = useChat(s => s.detail[sid]?.channels);
  return useMemo(() => (chans || []).some(b => b.type === 'starboard' && b.cid !== cid && (b.config?.watch?.length ? b.config.watch.includes(wid(cid)) : true)), [chans, cid]);
}
// a starboard's `watch` holds the channel ids its server uses (bare ones on an instance)
const wid = cid => (isInst(cid) ? bare(cid) : cid);
export function starredByMe(m, me) {
  return !!(m.reactions || []).find(r => r.emoji === STAR)?.users?.includes(me);
}

// settings in the channel editor: which channels it watches + how many stars it takes
export function StarboardSettings({ config, setConfig, sid, channel }) {
  const chans = useChat(s => s.detail[sid]?.channels) || [];
  const pickable = chans.filter(c => c.cid !== channel?.cid && !['starboard', 'voice', 'link', 'roles'].includes(c.type));
  const watch = config.watch || [];
  const min = config.min ?? 3;
  const toggle = cid => { cid = wid(cid); setConfig({ ...config, watch: watch.includes(cid) ? watch.filter(x => x !== cid) : [...watch, cid] }); };
  return (
    <>
      <label className="vc-field"><span>Stars needed</span>
        <input className="form-input" type="number" min={1} max={100} value={min} onChange={e => setConfig({ ...config, min: Math.max(1, Math.min(100, Math.trunc(Number(e.target.value) || 1))) })} />
        <small className="vc-field-hint">A message lands here once it has this many stars. It stays even if it loses stars later, or you raise this.</small>
      </label>
      <div className="vc-field"><span>Channels it watches</span>
        <small className="vc-field-hint">{watch.length ? `${watch.length} picked.` : 'None picked = every chat channel in the server.'}</small>
        <div className="vc-stb-watch">
          {pickable.map(c => (
            <button type="button" key={c.cid} className={`vc-chip-btn${watch.includes(wid(c.cid)) ? ' on' : ''}`} onClick={() => toggle(c.cid)}>
              {watch.includes(wid(c.cid)) ? <Check size={12} /> : <span className="vc-stb-hash">#</span>}{c.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function useCtx(sid) {
  const me = useChat(s => (isInst(sid) ? s.instances.find(i => i.origin === instOf(sid))?.user?.username : s.me?.username));
  const chans = useChat(s => s.detail[sid]?.channels);
  const roles = useChat(s => s.detail[sid]?.roles);
  return useMemo(() => ({
    me, channels: chans, roles, canPost: false, linkImages: true,
    onUser: () => {}, onChannel: c => go({ kind: 'channel', sid, cid: c.cid }), onLink: openLink,
  }), [me, chans, roles, sid]);
}

// one starred post
function Post({ m, sid, ctx, onVote, big, label, rank }) {
  // a forwarded message shows what was forwarded, without the "Forwarded from" line
  const body = String(m.body || '').replace(/^-# Forwarded from [^\n]*\n?/, '');
  const { nodes, images, media, invites } = useMemo(() => renderBody(body, ctx), [body, ctx]);
  const atts = [...(m.attachments || []), ...(media || [])];
  const pics = [...atts.filter(a => a.type === 'image' || a.type === 'gif'), ...images.map(u => ({ url: u, type: /\.gif(\?|#|$)/i.test(u) ? 'gif' : 'image' }))];
  const other = atts.filter(a => a.type !== 'image' && a.type !== 'gif');
  const name = shownName(m);
  return (
    <article className={`vc-stb-post vl-rise${big ? ' big' : ''}${pics.length ? ' has-pic' : ''}`} style={{ '--i': Math.min(rank ?? 0, 10) }}>
      {label && <div className="vc-stb-label">{label}</div>}
      {pics.length > 0 && (
        <button type="button" className={`vc-stb-pic${isSpoiler(pics[0]) ? ' spoiler' : ''}`} onClick={() => viewMedia({ items: pics, index: 0, author: m.author, at: m.created_at })}>
          <img src={viaProxy(pics[0].url)} alt="" loading="lazy" />
          {pics.length > 1 && <span className="vc-stb-more">+{pics.length - 1}</span>}
        </button>
      )}
      <div className="vc-stb-body">
        <header>
          <Avatar user={m.author ? aliasFace(aliasOf(m), m.author) : { username: name }} size={28} />
          <span className="vc-stb-who"><b style={m.author?.color ? { color: m.author.color } : undefined}>{name}</b><small>#{m.channel_name} - {stampOf(m.created_at)}</small></span>
          {rank != null && <span className="vc-stb-rank">#{rank + 1}</span>}
        </header>
        {nodes.length > 0 && <div className="vc-text vc-stb-text">{nodes}</div>}
        <GameInvites invites={invites} />
        {other.length > 0 && (
          <div className="vc-stb-media">
            {other.map(a => (a.type === 'video' ? <div key={a.url} className="vc-media-wrap" data-media-url={a.url} data-media-name={a.name || ''}><VideoPlayer className="vc-att-video" src={a.url} /></div>
              : a.type === 'audio' ? <div key={a.url} className="vc-media-wrap" data-media-url={a.url} data-media-name={a.name || ''}><AudioPlayer src={a.url} name={a.name} /></div>
                : <FileCard key={a.url} a={a} />))}
          </div>
        )}
        <footer>
          <button type="button" className={`vc-stb-star${m.starred ? ' on' : ''}`} title={m.starred ? 'Take your star back' : 'Star it'} onClick={() => onVote(m)}>
            <Star size={15} fill={m.starred ? 'currentColor' : 'none'} /><b>{m.stars}</b>
          </button>
          <button type="button" className="vc-stb-jump" onClick={() => jumpToMessage({ kind: 'channel', sid, cid: K(instOf(sid), m.channel) }, m.id)}><CornerDownRight size={14} /> Jump</button>
        </footer>
      </div>
    </article>
  );
}

export function Starboard({ channel, sid }) {
  const [d, setD] = useState(null);
  const [more, setMore] = useState(false);
  const ctx = useCtx(sid);
  const timer = useRef(null);
  const load = () => apiFetch(`/chat/channels/${channel.cid}/starboard`).then(x => { setD(x); setMore(x.more); }).catch(e => toast(errorText(e.message)));
  useEffect(() => { setD(null); load(); }, [channel.cid, channel.config]); // eslint-disable-line react-hooks/exhaustive-deps
  // live: new posts arrive, star counts change
  useEffect(() => {
    const on = e => {
      const m = e.detail;
      if (m.channel !== channel.cid) return;
      if (m.added) { clearTimeout(timer.current); timer.current = setTimeout(load, 400); return; }
      const fix = list => list?.map(p => (p.id === m.id ? { ...p, stars: m.stars } : p));
      setD(cur => cur && { ...cur, recent: fix(cur.recent), top: fix(cur.top), throwback: cur.throwback && fix([cur.throwback])[0] });
    };
    addEventListener('vc-starboard', on);
    return () => { removeEventListener('vc-starboard', on); clearTimeout(timer.current); };
  }, [channel.cid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function vote(m) {
    const on = !m.starred;
    const fix = list => list?.map(p => (p.id === m.id ? { ...p, starred: on, stars: Math.max(0, p.stars + (on ? 1 : -1)) } : p));
    setD(cur => cur && { ...cur, recent: fix(cur.recent), top: fix(cur.top), throwback: cur.throwback && fix([cur.throwback])[0] });
    await setReaction(m.id, STAR, on, instOpt(channel.cid));
  }
  async function older() {
    const last = d?.recent[d.recent.length - 1];
    if (!last) return;
    try { const x = await apiFetch(`/chat/channels/${channel.cid}/starboard?before=${last.starred_at}`); setD(cur => ({ ...cur, recent: [...cur.recent, ...x.recent.filter(p => !cur.recent.some(q => q.id === p.id))] })); setMore(x.more); }
    catch (e) { toast(errorText(e.message)); }
  }
  async function reshuffle() {
    try { const x = await apiFetch(`/chat/channels/${channel.cid}/starboard`); setD(cur => ({ ...cur, throwback: x.throwback })); }
    catch (e) { toast(errorText(e.message)); }
  }

  const where = d?.watching?.length ? d.watching.map(n => `#${n}`).join(', ') : 'every channel';
  return (
    <div className="vc-shop vc-stb">
      <div className="vc-shop-head">
        <Star size={28} />
        <div><h2>#{channel.name}</h2><p>{channel.topic || (d ? <>Messages from {where} with {d.min}+ <StarIco />. Star anything with the star button on a message.</> : 'The best messages in the server.')}</p></div>
        <span className="grow" />
        {d && <span className="vc-balance"><Star size={15} /> {d.total.toLocaleString()} starred</span>}
      </div>
      {!d && <div className="vc-loading"><i /><i /><i /></div>}
      {d && !d.total && (
        <div className="vc-stb-empty">
          <Star size={34} />
          <b>Nothing here yet</b>
          <span>Messages from {where} land here once they get {d.min} <StarIco />. Hover a message and press the star to vote for it.</span>
        </div>
      )}
      {d && d.total > 0 && (
        <>
          <div className="vc-stb-top">
            {d.top.length > 0 && (
              <section className="vc-stb-sec">
                <h3><Trophy size={15} /> Top starred</h3>
                <div className="vc-stb-row">{d.top.map((m, i) => <Post key={m.id} m={m} sid={sid} ctx={ctx} onVote={vote} rank={i} />)}</div>
              </section>
            )}
            {d.throwback && (
              <section className="vc-stb-sec vc-stb-tb">
                <h3><History size={15} /> Throwback <button type="button" className="vc-ico-btn" title="Another one" onClick={reshuffle}><Shuffle size={14} /></button></h3>
                <Post key={d.throwback.id} m={d.throwback} sid={sid} ctx={ctx} onVote={vote} big label={`Starred ${stampOf(d.throwback.starred_at)}`} />
              </section>
            )}
          </div>
          <section className="vc-stb-sec">
            <h3><Star size={15} /> Recent</h3>
            <div className="vc-stb-grid">{d.recent.map(m => <Post key={m.id} m={m} sid={sid} ctx={ctx} onVote={vote} />)}</div>
            {more && <button type="button" className="btn btn-surface vc-stb-older" onClick={older}>Load older</button>}
          </section>
        </>
      )}
    </div>
  );
}
