import { siteHref } from './hosts.js';
// The conversation: messages (grouped by person, with day dividers), the composer and who's typing.
import { SAVEABLE } from './uploadLinks.js';
import { saveMedia } from './mediaDownload.js';
import { canAttachInChannel } from './attachment-permissions.js';
import { apiFetch } from '../api.js';
import { instOpt, isInst, instOf } from './ids.js';
import { sigId } from './signing.js';
import { VideoPlayer, AudioPlayer, VoicePlayer } from './MediaPlayer.jsx';
import { useVoiceRecorder, VoiceBar } from './VoiceNote.jsx';
import { holdOutcome, isVoiceAtt, isVoiceLink } from './voice-note.js';
import { viewMedia } from './MediaViewer.jsx';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Eye, EyeOff, Reply, Pencil, Trash2, Copy, Plus, X, SmilePlus, Lock, SendHorizontal, AlertCircle, ImageIcon, CornerUpRight, Music, Film, ArrowRight, ArrowLeft, Webhook, Phone, Pin, ChevronUp, Star, Upload, CloudUpload } from 'lucide-react';
import { Embeds } from './ChannelTypes.jsx';
import { LinkEmbeds } from './LinkEmbeds.jsx';
import { E2eeMessageNote, OpenedAttachments, PreviewOnAsk, E2eeComposerNotes, E2eeLockedPanel } from './E2eeMessage.jsx';
import { GameInvites } from './GameInvite.jsx';
import { inviteSummary } from './gameInvite.js';
import { PlatformIcon, PLATFORM_NAMES } from './platforms.jsx';
import { GameEventLine } from './GameServer.jsx';
import { BotTag } from './Bots.jsx';
import { AliasMark, aliasOf, replyAliasOf, aliasKey, aliasFace, isUnmarked, aliasMemberOf } from './Alias.jsx';
import { CommandPicker, CommandBar, MessageComponents, InteractionLine, Thinking, EphemeralNote } from './Commands.jsx';
import { slashEntries, matchEntries } from './commands.js';
import { ViaBadge } from './ClientVia.jsx';
import { usePronouns } from './pronouns.js';
import { Reactions, QuickReactions, openReactionPicker } from './Reactions.jsx';
import MediaPicker, { GifBadge, StarButton } from './MediaPicker.jsx';
import GlintIntro from './GlintIntro.jsx';
import { GlintMark, NewTag, loadMyClips, liveClips } from './glint.jsx';
import EmojiPicker, { loadEmojiData } from './EmojiPicker.jsx';
import { TriangleAlert, Shield, Clock, HardDrive } from 'lucide-react';
import { expiryAt, expiryLabel } from './temp-expiry.js';
import { tempId, isCdnTemp } from './upload-dest.js';
import { TempAttPopover } from './TempAttPopover.jsx';
import { shortDays, daysText } from './temp-pick.js';
import { viaProxy } from './mediaProxy.js';
import { BookmarkPlus, Smile, File as FileIcon, FileArchive, FileCode, FileText, Download, Coins, MessageSquareQuote, Forward } from 'lucide-react';
import { messageCaps, reactionId, pinPath } from './msg-actions.js';

// a "GIF" picture-frame icon (drawn, not text) for the GIF picker button
function GifIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="1" y="1" width="20" height="16" />
      <path d="M8.2 6.6H6.4c-.9 0-1.4.6-1.4 1.4v2c0 .8.5 1.4 1.4 1.4h1.8V9.2H7" strokeLinecap="square" />
      <path d="M11 6.6v4.8" strokeLinecap="square" />
      <path d="M17 6.6h-3v4.8M14 9h2.4" strokeLinecap="square" />
    </svg>
  );
}
import { packActive } from './messageSounds.js';
import { playSound, loadEmojis, loadMembers, loadCommands, clearStatusReply, useTimedOut, untilText, dismissEphemeral } from './store.js';
import { takeJump, fileKind, uploadMedia, saveToMedia, isMineMsg, loadUploadLimits, getUploadLimits, chooseUploadDest, rememberedUploadDest, tempFileInfo, tempFileInfoNow, onTempInfo, TEMP_LINK } from './store.js';
import { useStarboardFor, starredByMe, STAR } from './Starboard.jsx';
import { CALL_LINE, callLineText } from './callText.js';
import { setReaction } from './Reactions.jsx';
import { getState, useChat, keyOf, loadMessages, sendMessage, setTyping, editMessage, deleteMessage, dropFailed, toast, errorText, dmErrorText, go, openLink, ask, askStripTracking } from './store.js';
import { cleanText, hasTracking } from './cleanLinks.js';
import { isSpoiler, spoilerName, shownName, nameInLink } from './spoiler.js';
import { renderBody, timeOf, stampOf, dayOf } from './text.jsx';
import { embedLabel } from './inviteLink.js';
import { fmtSize, RISKY, KIND_OF } from './fileKinds.js';
import { Avatar, BlockedMark } from './Profile.jsx';
import { messageMenu, userMenu, openMenu } from './Menu.jsx';
import { useScope, mentionsMe as isMention, useFace, wantVeloraFaces, useBlocked, blockedFace, isBlockedName, faceOf, BLOCKED_NAME } from './store.js';
import { useNameStyle, colorFrom, NameDecor, P, has } from './roles.jsx';
import { suggestQuery, useSuggestItems, MentionPicker, encodeRoleMentions, decodeRoleMentions } from './Mentions.jsx';
import { serialize, fill, caretToEnd, caretText, replaceBeforeCaret, insertAt, resolveWord, markdownShortcut, styleMarkdown } from './richInput.js';

const GROUP_MS = 7 * 60 * 1000;

const markdownMarker = e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key.toLowerCase() === 'b') return '**';
  if (e.key.toLowerCase() === 'i') return '*';
  if (e.key.toLowerCase() === 'u') return '__';
  if (e.shiftKey && e.key.toLowerCase() === 's') return '~~';
  if (e.shiftKey && e.key.toLowerCase() === 'c') return '`';
  return null;
};

const KLIPY = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i;
// a klipy.com/gifs/<name> page link: Velora asks Klipy's API for the GIF (their site blocks scrapers)
export const KLIPY_PAGE = /^https:\/\/(?:www\.)?klipy\.com\/(gifs|stickers|clips)\/([\w-]{1,160})\/?(?:\?\S*)?$/i;
const klipyPages = new Map(); // page url -> { url, width, height, title } | { url: null }
function KlipyPageGif({ url }) {
  const [g, setG] = useState(() => klipyPages.get(url));
  useEffect(() => {
    if (g !== undefined) return;
    const k = KLIPY_PAGE.exec(url);
    apiFetch(`/chat/klipy/${k[1].toLowerCase()}/${k[2]}`).then(d => { klipyPages.set(url, d); setG(d); }).catch(() => setG({ url: null }));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return <span className="vc-att gif vc-att-loading" />;
  if (!g.url) return <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="vc-file">{url}</a>;
  const item = { url: g.url, type: 'gif', name: g.title, width: g.width, height: g.height };
  return (
    <a href={g.url} target="_blank" rel="noopener noreferrer" data-media-url={g.url} data-media-name={g.title || ''} className="vc-att gif"
      onClick={e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button || e.target.closest('.vc-star')) return; e.preventDefault(); viewMedia({ items: [item], index: 0 }); }}>
      <img src={viaProxy(g.url)} alt={g.title || ''} loading="lazy" style={g.width ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
      <GifBadge />
      <StarButton gif={{ url: g.url, preview: g.url, title: g.title, width: g.width, height: g.height }} />
    </a>
  );
}
// a file (zip, pdf, exe...): what it is, its name + size, and a Download button. Programs / scripts ask first.
// a file in Velora's temporary storage: { left: 'N days' } while it's there, 'gone' once it expired, null = don't know (yet)
const leftText = s => (s < 3600 ? 'under an hour' : s < 86400 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`);
// re-renders when the answers for these temporary-storage links arrive or change; `enabled` = start asking (a message scrolled into view)
function useTempTick(urls, enabled) {
  const [, bump] = useState(0);
  const key = urls.join('\n');
  useEffect(() => {
    const ids = new Set(urls.map(tempId).filter(Boolean));
    if (!ids.size || !enabled) return undefined;
    const off = onTempInfo(id => { if (ids.has(id)) bump(n => n + 1); });
    urls.forEach(u => tempFileInfo(u));
    return off;
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function useTempFile(url, enabled = true) {
  const temp = TEMP_LINK.test(String(url || ''));
  useTempTick(temp ? [url] : [], enabled);
  const info = temp ? tempFileInfoNow(url) : null;
  if (!temp || !info) return null;
  if (info === 'gone') return 'gone';
  return { left: leftText(Math.max(0, info.expires_in - (Date.now() - info.at) / 1000)), ttl: info.ttl_days };
}
// "Expires Nov 29, 2026" for the temporary files of one message (null until all answers are in, and when none is left)
function useExpiryLabel(urls, enabled) {
  useTempTick(urls, enabled);
  if (!urls.length || !enabled) return null;
  const infos = urls.map(tempFileInfoNow);
  if (infos.some(i => i === undefined)) return null;
  return expiryLabel(infos.map(i => expiryAt(i)), { now: Date.now(), locale: navigator.language });
}
export function ExpiredFile({ name }) {
  return <div className="vc-filecard vc-att-expired"><FileIcon size={18} /><span><b>{shownName(name) || 'File'}</b><small>This file expired. Temporary files are deleted after a set time.</small></span></div>;
}
export function FileCard({ a, live = true }) {
  const name = shownName((() => { try { return decodeURIComponent(a.name || a.url.split('/').pop()); } catch { return a.name || 'file'; } })());
  const ext = (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] || /\.([a-z0-9]{1,10})$/i.exec(a.url)?.[1] || '').toLowerCase();
  const risky = RISKY.test(ext);
  const temp = useTempFile(a.url, live);
  // A temporary file in the CDN bucket ignores ?dl=1 (nothing runs in front of the bucket), and a plain-text one would open in the tab instead of
  // downloading: those are fetched and saved with their real name (mediaDownload.js, the same path the picture viewer uses; the Android app
  // hands the https link to Download Manager). A /t/ link keeps ?dl=1. If the fetch is refused, the link opens in a new tab instead.
  const cdn = isCdnTemp(a.url);
  const dl = /^https:\/\/files\.catbox\.moe\/[\w-]+\.[a-z0-9]{1,8}$/i.test(a.url) ? `/chat/dl?u=${encodeURIComponent(a.url)}&n=${encodeURIComponent(name)}`
    : TEMP_LINK.test(a.url) && !cdn ? `${a.url.split(/[?#]/)[0]}?dl=1` : a.url;
  const fetchDl = () => saveMedia(a.url, name).catch(() => { toast("Couldn't save it directly - opening it instead."); window.open(a.url, '_blank', 'noopener,noreferrer'); });
  const open = async e => {
    if (!risky && !cdn) return; // the link just downloads
    e.preventDefault();
    if (risky && !(await ask({ title: 'Download this program?', text: `${name} can run code on your computer. Only open files from people you trust.`, confirm: 'Download' }))) return;
    if (cdn) fetchDl(); else location.href = dl;
  };
  if (temp === 'gone') return <ExpiredFile name={name} />;
  const Ico = /^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext) ? FileArchive : /^(js|ts|jsx|tsx|py|json|html|css|c|cpp|cs|java|lua|sb3|pmp|sh|ps1)$/.test(ext) ? FileCode : /^(txt|md|pdf|doc|docx|rtf|odt|log)$/.test(ext) ? FileText : FileIcon;
  return (
    <div className="vc-filecard">
      <span className="vc-filecard-ico"><Ico size={26} />{ext && <b>{ext.slice(0, 4)}</b>}</span>
      <div className="vc-filecard-txt">
        <a className="vc-filecard-name" href={dl} download={name} onClick={open} title={name}>{name}</a>
        <small>{[KIND_OF(ext), fmtSize(a.size)].filter(Boolean).join(' - ')}{temp?.left && <span className="vc-filecard-exp" title={`Temporary file: deleted ${temp.left} from now`}> - expires in {temp.left}</span>}</small>
      </div>
      <a className="vc-filecard-dl" href={dl} download={name} onClick={open} title={`Download ${name}`}><Download size={16} /><span>Download</span></a>
    </div>
  );
}
function Attachments({ list: all, extra = [], m }) {
  // an Ember server deletes uploads after the time its settings keep them; the message keeps a note
  const gone = all.filter(a => a.expired), list = all.filter(a => !a.expired);
  // spoilered files stay covered until clicked (once per file)
  const [revealed, setRevealed] = useState(() => new Set());
  // temporary-storage pictures that didn't load: checked, and shown as expired when they are
  const [deadPics, setDeadPics] = useState(() => new Set());
  const picFailed = a => { if (TEMP_LINK.test(a.url)) tempFileInfo(a.url).then(v => { if (v === 'gone') setDeadPics(x => new Set(x).add(a.url)); }); };
  const hidden = a => isSpoiler(a) && !revealed.has(a.url);
  const reveal = a => setRevealed(x => new Set(x).add(a.url));
  // picture links in the text count too (a Klipy link = a GIF; a DM's catbox link carries its name, so its spoiler mark too)
  const pics = [...list.filter(a => a.type === 'image' || a.type === 'gif'), ...extra.map(u => ({ url: u, name: nameInLink(u) || undefined, type: KLIPY.test(u) || /\.gif(\?|$)/i.test(u) ? 'gif' : 'image' }))];
  const others = list.filter(a => a.type !== 'image' && a.type !== 'gif');
  // the message's temporary-storage files: asked about once it scrolls into view (their date is fixed, so once is enough)
  const tempUrls = [...new Set([...pics, ...others].map(a => a.url).filter(u => TEMP_LINK.test(u)))];
  const wrap = useRef(null);
  const [seen, setSeen] = useState(false);
  const hasTemp = tempUrls.length > 0;
  useEffect(() => {
    const el = wrap.current;
    if (!hasTemp || seen || !el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasTemp, seen]);
  const expiry = useExpiryLabel(tempUrls, seen);
  if (!pics.length && !others.length && !gone.length) return null;
  const cover = a => hidden(a) && (
    <button type="button" className="vc-att-spoiler-cover" onClick={e => { e.preventDefault(); e.stopPropagation(); reveal(a); }}>Spoiler</button>
  );
  return (
    <div className="vc-atts-wrap" ref={wrap}>
      {gone.map(a => <div key={a.url} className="vc-filecard vc-att-expired"><FileIcon size={18} /><span><b>{a.name || 'File'}</b><small>This file expired and was deleted.</small></span></div>)}
      {pics.length > 0 && (
        <div className={`vc-atts n${Math.min(pics.length, 4)}`}>
          {pics.map((a, i) => (KLIPY_PAGE.test(a.url) ? <KlipyPageGif key={a.url} url={a.url} /> : deadPics.has(a.url) ? <ExpiredFile key={a.url} name={a.name || nameInLink(a.url)} /> :
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" data-media-url={a.url} data-media-name={shownName(a.name)} className={`vc-att${a.type === 'gif' ? ' gif' : ''}${hidden(a) ? ' spoiler' : ''}`}
              onClick={e => { if (hidden(a)) { e.preventDefault(); reveal(a); return; } if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; if (e.target.closest('.vc-star')) return; e.preventDefault(); viewMedia({ items: pics.filter(p => !hidden(p) || p === a), index: pics.filter(p => !hidden(p) || p === a).indexOf(a), author: m?.author, at: m?.created_at }); }}>
              <img src={viaProxy(a.url)} alt={hidden(a) ? 'Spoiler' : shownName(a.name)} loading="lazy" onError={() => picFailed(a)} />
              {cover(a)}
              {a.type === 'gif' && !hidden(a) && <GifBadge />}
              {hidden(a) ? null : KLIPY.test(a.url) ? <StarButton gif={{ url: a.url, preview: a.url, title: a.name, width: a.width, height: a.height }} />
                : SAVEABLE.test(a.url) && <button type="button" className="vc-att-save" title="Save to Saved Media" onClick={e => { e.preventDefault(); e.stopPropagation(); saveToMedia(a.url, a.name); }}><BookmarkPlus size={15} /></button>}
            </a>
          ))}
        </div>
      )}
      {others.map(a => {
        const inner = a.type === 'file' ? <FileCard a={a} live={seen} /> : TEMP_LINK.test(a.url) ? <TempMedia a={a} live={seen} /> : isVoiceAtt(a)
          ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><VoicePlayer src={a.url} name={a.name} /></div>
          : a.type === 'video'
          ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><VideoPlayer className="vc-att-video" src={a.url} /></div>
          : a.type === 'audio'
            ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><AudioPlayer src={a.url} name={shownName(a.name)} /></div>
            : <a href={a.url} target="_blank" rel="noopener noreferrer" className="vc-file">{shownName(a.name) || a.url}</a>;
        return hidden(a) ? <div key={a.url} className="vc-att-spoiler-box">{inner}{cover(a)}</div> : <Fragment key={a.url}>{inner}</Fragment>;
      })}
      {expiry && <a className="vc-att-expiry" href="https://nookara.cc/temp-files" target="_blank" rel="noopener noreferrer" title="Temporary file - how long these last and how to keep them"><Clock size={12} aria-hidden="true" /><span>{expiry}</span></a>}
    </div>
  );
}
// a video / sound in temporary storage: the player, or the placeholder once it expired
function TempMedia({ a, live }) {
  const temp = useTempFile(a.url, live);
  if (temp === 'gone') return <ExpiredFile name={a.name} />;
  if (isVoiceAtt(a)) return <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><VoicePlayer src={a.url} name={a.name} /></div>;
  return a.type === 'video'
    ? <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><VideoPlayer className="vc-att-video" src={a.url} /></div>
    : <div className="vc-media-wrap" data-media-url={a.url} data-media-name={shownName(a.name)}><AudioPlayer src={a.url} name={shownName(a.name)} /></div>;
}
// a message whose files are still on their way up: how far along, and a way to stop it
function UploadBar({ m, view }) {
  const { sent, total } = m.uploading;
  const pct = Math.min(100, Math.floor((sent / total) * 100));
  const n = m.uploads.length;
  return (
    <div className="vc-upload-bar">
      <div className="vc-upload-bar-top">
        <span>{pct >= 100 ? 'Finishing upload...' : `Uploading ${n === 1 ? shownName(m.uploads[0].file.name) : `${n} files`}`}</span>
        <small>{fmtSize(Math.min(sent, total))} / {fmtSize(total)} - {pct}%</small>
        <button type="button" title="Cancel upload" onClick={() => dropFailed(view, m.nonce)}><X size={14} /></button>
      </div>
      <div className="vc-upload-track"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// the one-line quote in a reply preview: drawn by the same renderer as normal messages (custom + standard emojis, markdown,
// mentions), cut to one line by the CSS. A link that gets a card (a server invite, a payment) is named instead of shown raw.
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]/g;
function ReplyText({ body, ctx }) {
  const nodes = useMemo(() => {
    let t = inviteSummary(String(body || '')).replace(/<[^<>]*$/, ''); // (the server cuts long quotes: drop a half-cut <:emoji:id> / <@role>)
    t = t.replace(/```([\s\S]*?)```/g, (_, c) => `\`${c.trim().replace(/`/g, "'")}\``);
    t = t.replace(URL_IN_TEXT, u => { const l = isVoiceLink(u) ? 'Voice message' : embedLabel(u); return l ? `*${l}*` : u; });
    t = t.replace(/\s*\n\s*/g, ' ').trim().replace(/^(?:#{1,3}\s+|-#\s+|>>>?\s+|[-*]\s+|\d{1,3}[.)]\s+)/, '');
    return t ? renderBody(t, { ...ctx, bio: true, linkImages: false }).nodes : null;
  }, [body, ctx]);
  return (
    <span className="vc-reply-text" onClickCapture={e => { if (e.target.closest('a')) { e.preventDefault(); e.stopPropagation(); } }}>
      {nodes && nodes.length ? nodes : 'a picture'}
    </span>
  );
}

// phones / tablets: no keyboard shortcuts, so editing gets Cancel and Save buttons and Enter makes a new line
const touchEdit = () => !!window.bonfireMobile || !!window.matchMedia?.('(pointer: coarse)').matches;
function EditMessageInput({ m, view, onSave, onCancel }) {
  const touch = touchEdit();
  const input = useRef(null);
  const composing = useRef(false);
  const [mq, setMq] = useState(null);
  const [sel, setSel] = useState(0);
  const items = useSuggestItems(view, mq);
  const sid = view.kind === 'channel' ? view.sid : null;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    fill(el, decodeRoleMentions(m.body, sid), view);
    styleMarkdown(el, view);
    el.focus();
    caretToEnd(el);
    if (touch) { el.scrollIntoView?.({ block: 'nearest' }); setTimeout(() => { if (document.activeElement !== el) { el.focus(); caretToEnd(el); } el.scrollIntoView?.({ block: 'nearest' }); }, 120); }
  }, [m.id, m.body, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(e) {
    if (composing.current) return;
    const el = input.current;
    if (e?.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ':') {
      const caret = caretText(el);
      const match = caret && /(^|\s)(:[A-Za-z0-9_+-]{1,40}:)$/.exec(caret.before);
      const token = match && resolveWord(match[2], view);
      if (token) replaceBeforeCaret(el, match[2].length, token, sid, false);
    }
    if (e?.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ') {
      const caret = caretText(el);
      const match = caret && /(^|\s)(@[\w.-]{2,32}|#[a-z0-9_-]{1,40}|:[A-Za-z0-9_]{1,32}:)\s$/.exec(caret.before);
      const token = match && resolveWord(match[2], view);
      if (token) replaceBeforeCaret(el, match[2].length + 1, token, sid, true);
    }
    styleMarkdown(el, view);
    const caret = caretText(el);
    setMq(caret ? suggestQuery(caret.before, caret.before.length) : null);
    setSel(0);
  }
  function pick(it) {
    const el = input.current;
    if (!el || !mq) return;
    const token = it.token || (it.kind === 'role' ? `<@&${it.role.rid}>` : it.insert.trim());
    if (!replaceBeforeCaret(el, mq.q.length + 1, token, sid)) insertAt(el, null, token, sid);
    styleMarkdown(el, view);
    setMq(null);
    el.focus();
  }
  // (the Android app blurs any contenteditable="true" .vc-input it didn't focus itself, which kept the keyboard from ever
  // staying open here - "plaintext-only" isn't matched by that rule, and Chromium WebView supports it)
  return (
    <div className="vc-edit">
      {mq && <MentionPicker items={items} sel={sel} setSel={setSel} onPick={pick} sid={sid} />}
      <div ref={input} className="vc-input vc-edit-input" contentEditable={window.bonfireMobile ? 'plaintext-only' : true} suppressContentEditableWarning role="textbox" aria-label="Edit message" aria-multiline="true"
        spellCheck autoCorrect="on" autoCapitalize="sentences" onInput={update}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; update(); }}
        onBlur={() => setTimeout(() => setMq(null), 150)}
        onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
        onKeyDown={e => {
          if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
          const marker = markdownMarker(e);
          if (marker) { e.preventDefault(); markdownShortcut(input.current, view, marker); styleMarkdown(input.current, view); return; }
          if (mq && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(x => (x + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(x => (x - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[sel] || items[0]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setMq(null); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey || touch) { document.execCommand('insertLineBreak'); setMq(null); } else onSave(serialize(input.current)); }
          if (e.key === 'Escape') onCancel();
        }} />
      {touch
        ? <div className="vc-edit-btns on"><button type="button" className="cancel" onMouseDown={e => e.preventDefault()} onClick={onCancel}>Cancel</button><button type="button" className="save" onMouseDown={e => e.preventDefault()} onClick={() => onSave(serialize(input.current))}>Save</button></div>
        : <div className="vc-edit-foot"><small>Escape to cancel, Enter to save, Shift+Enter for a new line. Ctrl/Cmd+B, I, U; Ctrl/Cmd+Shift+S (strike), C (code).</small></div>}
    </div>
  );
}

// Identity for grouping consecutive messages: a CloudLink/webhook/bridge sender must never merge with an Ember user who happens to share the name.
function authorKey(a) {
  if (!a) return '';
  return [a.bridge || (a.webhook ? 'hook' : 'user'), a.bridge_from || '', a.username || ''].join('');
}

// Velora people on an instance server can sign what they send. A message from one that carries no signature can't be tied to
// their account, so it is shown without their picture or colours. (Local accounts, bots, webhooks, system lines and Velora's own
// servers - whose messages live on Velora itself - are exempt.)
const isUnsigned = m => !!m.inst && m.author?.kind === 'velora' && !m.signature && !m.author.bot && !m.author.webhook && !m.system && (!m.pending || m.unsigned) && !m.ephemeral;
// 'unsigned' | 'bad' | null: should this message's author picture / colour be withheld?
function useDistrust(m) {
  const v = useChat(s => (m.signature ? s.sigs[sigId(m)] : null));
  return v === 'bad' ? 'bad' : isUnsigned(m) ? 'unsigned' : null;
}
// a signed message is checked here against the author's Velora key (never taken from the instance's word). A good signature
// shows nothing (that's the normal case); a bad one and an unsigned Velora message are marked.
// (inside a stack only a bad signature is marked: a stack never mixes signed and unsigned messages, so its head has the shield)
function SigBadge({ m, inStack }) {
  const v = useChat(s => (m.signature ? s.sigs[sigId(m)] : null));
  if (v === 'bad') return <span className="vc-sig bad" title="Signature doesn't match"><TriangleAlert size={14} /></span>;
  if (!inStack && isUnsigned(m)) return <span className="vc-sig unsigned" title={`Sent unsigned - Nookara can't confirm this came from ${m.author.username}`}><Shield size={14} /></span>;
  return null;
}
// Message info (Manage messages only): the real author behind a message - most of all an alias, marked or not
function messageInfo(m) {
  const a = aliasOf(m), au = m.author || {};
  const kind = au.webhook ? (au.bridge ? `bridge (${au.bridge})` : 'webhook') : au.bot ? 'bot' : au.kind === 'local' ? 'local account' : au.kind === 'velora' ? 'Nookara account' : au.kind || 'account';
  const rows = [
    ['Sent by', `${au.username || 'Unknown'} (${kind})`],
    a && ['Shown as', `${a.name}${a.unmarked ? ' (unmarked alias: looks like a normal message)' : ' (alias, with the mask)'}`],
    a?.unmarked && ['Looks like', a.member ? `${a.member.username} (their name colour and profile card)` : 'nobody here (no member has that name)'],
    au.id && ['Author ID', au.id],
    ['Message ID', m.id],
    ['Sent', new Date(m.created_at).toLocaleString()],
    m.edited_at && ['Edited', new Date(m.edited_at).toLocaleString()],
  ].filter(Boolean);
  const text = (
    <span className="vc-msg-info">
      {a && <span className="vc-msg-info-lead">Sent by bot <b>{au.username}</b> via {a.unmarked ? 'an unmarked' : 'an'} alias. Only people who can manage messages see this.</span>}
      {rows.map(([k, v]) => <span key={k} className="vc-msg-info-row"><b>{k}</b><span>{v}</span></span>)}
    </span>
  );
  ask({ title: 'Message info', text, confirm: au.id ? 'Copy author ID' : 'OK', cancel: 'Close' })
    .then(ok => { if (ok && au.id) navigator.clipboard?.writeText(String(au.id)).then(() => toast('Author ID copied', true)).catch(() => {}); });
}
function Message({ m, head, ctx, canMod, onReply, onUser: openUser, editing, setEditing, view, fresh }) {
  const linkPreviews = useChat(s => s.settings.link_previews !== false);
  const hook = !!m.author?.webhook;
  // on an instance: Velora people get their Velora profile, local accounts / bots a plain card (never a Velora lookup by name)
  // an aliased bot message: the card is the real bot's, with a "Posting as alias" line. An unmarked alias (server setting) whose
  // name matched a member opens THAT member's card and takes their colour; one that matched nobody opens the bot's plain card.
  const alias = aliasOf(m);
  const unmarked = isUnmarked(alias);
  const aliasMember = useFace(useMemo(() => { const a = aliasMemberOf(alias); return a && m.inst ? { ...a, inst: m.inst } : a; }, [alias?.member, m.inst])); // eslint-disable-line react-hooks/exhaustive-deps
  const onUser = (name, el) => (aliasMember
    ? openUser(aliasMember.username, el, 'right', m.inst ? { ...alias.member, inst: m.inst } : undefined)
    : openUser(name, el, 'right', m.inst ? (alias && !unmarked ? { ...m.author, alias_name: alias.name } : m.author) : undefined));
  const author = useFace(m.author); // a Velora person on an instance: their live Velora picture / colour / rank
  const replyAlias = replyAliasOf(m.reply);
  const replyAuthor = useFace(useMemo(() => (m.reply?.author && m.inst ? { ...m.reply.author, inst: m.inst } : m.reply?.author), [m.reply?.author, m.inst]));
  useEffect(() => { if (m.inst && m.author?.kind === 'velora') wantVeloraFaces([m.author]); }, [m.inst, m.author?.velora_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = aliasMemberOf(alias); if (m.inst && a?.kind === 'velora') wantVeloraFaces([a]); }, [m.inst, alias?.member?.velora_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // somebody I blocked, in a server: "Blocked User" with the default picture, and the whole message under a cover until clicked
  // (only for me; everyone else sees them as usual). The real name stays behind the clicks, so their menu can still unblock.
  const blockedAuthor = useBlocked(view.kind === 'channel' && !hook && !m.system ? m.author : null, m.inst);
  const replyBlocked = useBlocked(view.kind === 'channel' ? m.reply?.author : null, m.inst);
  const [unmasked, setUnmasked] = useState(false);
  const masked = blockedAuthor && !unmasked;
  const mine = !hook && isMineMsg(m);
  // what this message can do here (menu + hover toolbar): msg-actions.js
  const caps = messageCaps(view, m, { mine, canMod, canPost: ctx.canPost });
  const canReplyHere = caps.reply, canReact = caps.react;
  const reactId = reactionId(m);
  const starHere = useStarboardFor(view.sid, view.cid) && canReact && view.kind === 'channel';
  const starred = starHere && starredByMe(m, ctx.me);
  const forward = () => dispatchEvent(new CustomEvent('vc-dialog', { detail: { kind: 'forward', message: m, from: view } }));
  const togglePin = () => apiFetch(pinPath(view, m), { method: m.pinned ? 'DELETE' : 'PUT', inst: instOpt(m.channel) }).then(() => toast(m.pinned ? 'Unpinned.' : 'Pinned.', true)).catch(e => toast(errorText(e.message)));
  const { nodes, images, media, jumbo, links, invites } = useMemo(() => renderBody(m.body, ctx), [m.body, ctx]);
  const mentionsMe = isMention(m);
  const nameKey = useNameStyle(view.sid, aliasMember || author); // (an unmarked alias that matched a member: their colour + role icon)
  const distrust = useDistrust(m);
  // pronouns come from the viewer's own profile lookup (friends-only profiles hide them), not the broadcast author object
  const pronouns = usePronouns(m.author?.username, !!head && !hook && !m.system && !m.author?.bot && !!m.author?.username && m.author.username !== 'System' && m.author?.kind !== 'local' && !blockedAuthor);
  async function saveEdit(value) {
    const t = view.sid ? encodeRoleMentions(value.trim(), view.sid) : value.trim();
    setEditing(null);
    if (t === m.body.trim()) return;
    try { await editMessage(m.id, t, m); } catch (e) { toast(errorText(e.message)); }
  }
  async function remove(e) {
    if (!e.shiftKey && !(await ask({ title: 'Delete this message?', text: 'Tip: hold Shift while clicking delete to skip this.', confirm: 'Delete', danger: true }))) return;
    try { await deleteMessage(view, m); } catch (er) { toast(errorText(er.message)); }
  }
  // DM calls leave a line: "[Voice call] started a call" / "call ended - 3 minutes" / "missed call",
  // sent by the caller and shared by both people - worded from the viewer's side (callText.js)
  const callLine = !m.system && CALL_LINE.test(m.body || '') && callLineText(m.body, { caller: m.author?.username, me: ctx.me, other: view.kind === 'dm' ? view.username : null });
  if (callLine) {
    return (
      <div className={`vc-msg vc-sys k-call${callLine.missed ? ' missed' : ''} vl-in`}>
        <span className="vc-sys-ico"><Phone size={14} /></span>
        <div className="vc-sys-body">{callLine.before}{callLine.name && <b>{callLine.name}</b>}{callLine.after}<span className="vc-time">{stampOf(m.created_at)}</span></div>
      </div>
    );
  }
  // Ember Link: joins / leaves / deaths / advancements from Minecraft are compact rows
  if (m.author?.bridge === 'minecraft' && /^mc_/.test(m.sys_kind || '')) return <GameEventLine m={m} />;
  if (m.ephemeral && !m.interaction_id) {
    return (
      <div className="vc-msg vc-sys vc-eph vl-in">
        <span className="vc-sys-ico"><Coins size={15} /></span>
        <div className="vc-sys-body">{m.body}<span className="vc-eph-tag">Only you can see this - <a href={siteHref("/me#chat")} target="_blank" rel="noopener noreferrer">turn these off</a></span></div>
      </div>
    );
  }
  if (m.system) {
    return (
      <div className={`vc-msg vc-sys vl-in${m.sys_kind ? ` k-${m.sys_kind}` : ''}`}>
        <span className="vc-sys-ico">{m.sys_kind === 'join' ? <ArrowRight size={15} /> : m.sys_kind === 'leave' ? <ArrowLeft size={15} /> : m.sys_kind === 'pin' ? <Pin size={14} /> : <CornerUpRight size={14} />}</span>
        <div className="vc-sys-body">{nodes}{m.sys_kind === 'pin' && <> <button type="button" className="vc-sys-link" onClick={() => dispatchEvent(new Event('vc-open-pins'))}>See all pinned messages</button></>}<span className="vc-time">{stampOf(m.created_at)}</span></div>
      </div>
    );
  }
  const name = m.author?.username || 'Unknown';
  return (
    <div className={`vc-msg${head ? ' head' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${mentionsMe ? ' mention' : ''}${editing ? ' editing' : ''} ${fresh === 'live' ? (isMineMsg(m) ? 'vc-in-mine' : 'vc-in-live') : fresh === 'done' ? '' : 'vl-in'}`} data-id={m.id}
      onContextMenu={e => {
        if (e.target.closest('textarea, input, [contenteditable]') || m.pending) return;
        if (!hook && e.target.closest('.vc-msg-av, .vc-msg-name')) { const el = e.target.closest('.vc-msg-av, .vc-msg-name'); userMenu(e, aliasMember?.username || name, { sid: view.sid, onProfile: () => onUser(name, el) }); return; }
        if (m.ephemeral) { openMenu(e, [{ label: 'Dismiss message', icon: X, onClick: () => dismissEphemeral(view, m) }]); return; }
        const reactionAnchor = e.currentTarget.getBoundingClientRect();
        messageMenu(e, m, view, {
          me: ctx.me, canReply: canReplyHere, onReply: () => onReply(m), canEdit: caps.edit, onEdit: () => setEditing(m.id), onForward: caps.forward ? forward : null, canCopyLink: caps.copyLink,
          canPin: caps.pin && !hook, onPin: togglePin,
          canDelete: caps.del, onDelete: () => remove({ shiftKey: false }),
          onReact: canReact ? () => openReactionPicker(reactId, reactionAnchor, instOpt(m.channel)) : null,
          onInfo: view.kind === 'channel' && canMod && !m.system ? () => messageInfo(m) : null, // staff only: who really sent it
        });
      }}>
      {m.statusReply && (
        <div className="vc-reply-to vc-status-reply">
          <span className="vc-reply-line" />
          <MessageSquareQuote size={13} />
          <b>{m.author?.username === ctx.me ? 'You replied to their status' : 'Replied to your status'}</b>
          <span className="vc-sr-quote">{m.statusReply}</span>
        </div>
      )}
      {m.reply && (
        <div className="vc-reply-to" onClick={() => document.querySelector(`.vc-msg[data-id="${m.reply.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <span className="vc-reply-line" />
          {replyAuthor ? <Avatar user={replyBlocked ? blockedFace(replyAuthor) : aliasFace(replyAlias, replyAuthor)} size={16} /> : null}
          {replyBlocked
            ? <><b className="vc-blocked-name">{BLOCKED_NAME}<BlockedMark size={11} /></b><span className="vc-reply-text vc-blocked-quote">Message from someone you blocked</span></>
            : <><b style={replyAuthor?.color ? { color: replyAuthor.color } : undefined}>{replyAlias ? replyAlias.name : replyAuthor?.username || 'Nookara'}</b>
              {replyAlias && <AliasMark alias={replyAlias} by={replyAuthor} size={12} />}
              <ReplyText body={m.reply.body} ctx={ctx} /></>}
        </div>
      )}
      <InteractionLine m={m} sid={view.sid} onUser={onUser} />
      {head ? (
        hook ? <span className="vc-msg-av hook">{m.author.pfp ? <img src={m.author.pfp} alt="" /> : m.author.bridge ? <span className="vc-av-l">{(m.author.username || '?')[0].toUpperCase()}</span> : <Webhook size={20} />}</span>
          : <button type="button" className="vc-msg-av" onClick={e => onUser(name, e.currentTarget)}><Avatar user={blockedAuthor ? blockedFace(author) : distrust ? { ...author, pfp: null } : aliasFace(alias, author, aliasMember)} size={40} /></button>
      ) : (
        <span className="vc-msg-gut">{timeOf(m.created_at)}</span>
      )}
      <div className="vc-msg-main">
        {head && (
          <div className="vc-msg-head">
            {hook ? <><span className="vc-msg-name hook">{name}</span>{m.author.staff ? <><span className="vc-app-tag staff">STAFF</span>{m.staffBy && <small className="vc-staff-by">sent by {m.staffBy} (only staff see this)</small>}</> : m.author.bridge === 'cloudlink' ? <><span className="vc-app-tag cl" title="This message came in over the channel's CloudLink bridge.">CLOUDLINK</span>{m.author.bridge_from && <span className="vc-game-tag" title="The chat it came from before CloudLink">{m.author.bridge_from}</span>}</> : m.author.bridge ? <><span className="vc-plat-tag" title={m.author.bridge === 'minecraft' ? 'Sent from the linked Minecraft server.' : `This message was sent from the linked ${PLATFORM_NAMES[m.author.bridge] || m.author.bridge} community.`}><PlatformIcon p={m.author.bridge} size={16} /></span>{m.author.bridge_from && <span className="vc-game-tag" title="The server it was sent from">{m.author.bridge_from}</span>}</> : <span className="vc-app-tag">APP</span>}</> : <>
            {blockedAuthor
              ? <><button type="button" className="vc-msg-name vc-blocked-name" onClick={e => onUser(name, e.currentTarget)}>{BLOCKED_NAME}</button><BlockedMark /></>
              : <><button type="button" className="vc-msg-name" style={colorFrom(nameKey) && !distrust ? { color: colorFrom(nameKey) } : undefined} onClick={e => onUser(name, e.currentTarget)}>{alias ? alias.name : name}</button>
                {alias && !unmarked ? <AliasMark alias={alias} by={author} /> : <NameDecor sid={view.sid} user={aliasMember || author} />}</>}{m.author?.bot && !unmarked && <BotTag verified={!!m.author.verified} />}<SigBadge m={m} />{m.via && <ViaBadge via={m.via} />}</>}
            {pronouns && <span className="vc-pronouns" title="Pronouns">{pronouns}</span>}
            <span className="vc-time" title={new Date(m.created_at).toLocaleString()}>{stampOf(m.created_at)}</span>
            {m.pinned && <span className="vc-pinned-mark" title="Pinned"><Pin size={12} /></span>}
          </div>
        )}
        {masked ? <button type="button" className="vc-blocked-cover" onClick={() => setUnmasked(true)}>Message from someone you blocked - click to show</button> : <>
        {m.interaction?.thinking ? <Thinking m={m} /> : editing ? <EditMessageInput m={m} view={view} onSave={saveEdit} onCancel={() => setEditing(null)} /> : (
          (nodes.length > 0) && <div className={`vc-text${jumbo ? ' jumbo' : ''}`}>{nodes}{!head && <SigBadge m={m} inStack />}{m.edited_at && <span className="vc-edited" title={stampOf(m.edited_at)}>(edited)</span>}</div>
        )}
        <GameInvites invites={invites} />
        <Embeds list={m.embeds} ctx={ctx} />
        {!m.embeds?.length && !m.pending && (linkPreviews ? <LinkEmbeds urls={links} inst={view.kind === 'dm' ? undefined : instOpt(m.channel)} priv={view.kind === 'dm' || view.kind === 'group'} /> : <PreviewOnAsk urls={links} inst={view.kind === 'dm' ? undefined : instOpt(m.channel)} priv={view.kind === 'dm' || view.kind === 'group'} />)}
        <E2eeMessageNote m={m} view={view} />
        <OpenedAttachments list={[...(m.attachments || []), ...media]} extra={images} m={m} Attachments={Attachments} />
        {m.uploading && <UploadBar m={m} view={view} />}
        <Reactions m={m} me={ctx.me} canReact={canReact} />
        <MessageComponents m={m} view={view} />
        </>}
        {m.ephemeral && <EphemeralNote m={m} view={view} />}
        {m.failed && (
          <div className="vc-fail"><AlertCircle size={13} /> {view.kind === 'dm' ? dmErrorText(m.failed) : errorText(m.failed)}
            <button type="button" onClick={() => { dropFailed(view, m.nonce); sendMessage(view, m.body, m.uploads ? { replyTo: m.replyTo, attachments: m.ready, uploads: m.uploads } : { replyTo: m.reply, attachments: m.attachments }); }}>Try again</button>
            <button type="button" onClick={() => dropFailed(view, m.nonce)}>Remove</button>
          </div>
        )}
      </div>
      {!m.pending && !m.failed && !editing && !m.ephemeral && (
        <div className="vc-tools">
          {canReact && <><QuickReactions id={reactId} inst={instOpt(m.channel)} selected={(m.reactions || []).filter(r => r.users?.includes(ctx.me)).map(r => r.emoji)} onDone={() => {}} limit={3} className="vc-tools-react" sid={view.kind === 'channel' ? view.sid : null} /><button type="button" title="Add reaction" onClick={e => openReactionPicker(reactId, e.currentTarget, instOpt(m.channel))}><SmilePlus size={16} /></button><span className="vc-tools-sep" aria-hidden="true" /></>}
          {starHere && <button type="button" title={starred ? 'Take your star back' : 'Star it (for the starboard)'} className={`vc-star-tool${starred ? ' on' : ''}`} onClick={() => setReaction(m.id, STAR, !starred, instOpt(m.channel))}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button>}
          {canReplyHere && <button type="button" title="Reply" onClick={() => onReply(m)}><Reply size={16} /></button>}
          {caps.forward && <button type="button" title="Forward" onClick={forward}><Forward size={16} /></button>}
          {caps.edit && <button type="button" title="Edit" onClick={() => setEditing(m.id)}><Pencil size={15} /></button>}
          {caps.del && <button type="button" className="danger" title="Delete (shift-click: no question)" onClick={remove}><Trash2 size={15} /></button>}
        </div>
      )}
    </div>
  );
}

const motionOK = el => { try { return !el.closest('.vc.still') && !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function MessageList({ view, onUser, onReply, canPost, canMod, channels, title }) {
  const key = keyOf(view);
  const box = useChat(s => s.msgs[key]);
  const me = useChat(s => (view.sid && isInst(view.sid) ? s.instances.find(i => i.origin === instOf(view.sid))?.user?.username : s.me?.username)); // who I am in this conversation (an instance has its own account for me)
  const scroller = useRef(null);
  const stick = useRef(true);
  const prevH = useRef(0);
  const [editing, setEditing] = useState(null);
  // a message that is still sending stays out of sight until the server has it (then it appears and animates in once); failed ones and uploads with progress show
  const list = useMemo(() => (box?.list || []).filter(m => !m.pending || m.failed || m.uploading || m.uploads || m.waiting), [box?.list]);
  const linkImages = useChat(s => s.settings.link_images);
  const roles = useChat(s => (view.sid ? s.detail[view.sid]?.roles : null));
  const blocks = useChat(s => s.blocks);
  const members = useChat(s => (view.sid ? s.members[view.sid] : null));
  const ctx = useMemo(() => ({
    me, canPost, channels, linkImages, roles,
    onUser: (u, el) => onUser(u, el),
    onChannel: c => go({ kind: 'channel', sid: view.sid, cid: c.cid }),
    onLink: openLink,
    isBlocked: view.kind === 'channel' && blocks?.length ? n => isBlockedName(view.sid, n) : null, // @mentions of somebody I blocked
  }), [me, canPost, channels, view.sid, linkImages, roles, blocks, members]); // eslint-disable-line react-hooks/exhaustive-deps

  // opening a conversation always starts at the bottom; unread messages get a "New" line and a banner at the top
  // to jump up to them (it goes away by itself after 5 s if you leave it)
  const jump = useRef(null);
  const lastKey = useRef(null);
  const [newFrom, setNewFrom] = useState(null);
  const [unreadBar, setUnreadBar] = useState(null); // { id, count, at }
  useLayoutEffect(() => { jump.current = takeJump(key); setNewFrom(null); setUnreadBar(null); }, [key]);
  // (the countdown is the thin line along its bottom - a CSS animation that pauses while you hover it)
  useEffect(() => {
    if (!unreadBar?.out) return undefined;
    const t = setTimeout(() => setUnreadBar(null), 220);
    return () => clearTimeout(t);
  }, [unreadBar?.out]);
  function jumpToUnread() {
    const el = scroller.current;
    const row = el?.querySelector(`.vc-msg[data-id="${unreadBar?.id}"]`);
    setUnreadBar(null);
    if (!row) return;
    stick.current = false;
    el.scrollTo({ top: Math.max(0, row.offsetTop - 56), behavior: 'smooth' });
  }
  // keep the view at the bottom while you're at the bottom; keep your place when older ones load
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const last = list[list.length - 1];
    const lk = last ? (last.nonce || last.id) : null;
    // you just sent something: always go to the bottom
    if (last && lk !== lastKey.current && last.author?.username === me && (last.pending || Date.now() - last.created_at < 15000)) stick.current = true;
    lastKey.current = lk;
    if (jump.current && box?.loaded && list.length) {
      const j = jump.current;
      jump.current = null;
      const first = j.count ? list.filter(m => m.author?.username !== me).slice(-j.count)[0] : list.find(m => !m.pending && /^\d+$/.test(String(m.id)) && BigInt(m.id) > BigInt(j.after || 0) && m.author?.username !== me);
      if (first) {
        setNewFrom(first.id);
        const at = list.indexOf(first);
        const count = list.slice(at).filter(m => m.author?.username !== me).length;
        // only worth a banner when the first new one isn't already on screen at the bottom
        requestAnimationFrame(() => {
          const row = el.querySelector(`.vc-msg[data-id="${first.id}"]`);
          if (row && row.offsetTop < el.scrollHeight - el.clientHeight - 40) setUnreadBar({ id: first.id, count, at: Date.now() });
        });
      }
    }
    // The pinned view jumps straight to the new bottom; the column then starts that far below and glides back up (FLIP): the
    // rows already on screen rise by the new message's height and the new row comes up from under the list, i.e. out of the
    // composer. The column sits inside an overflow:clip box so its transform can't inflate scrollHeight (that made the
    // resize / scroll handlers fight the glide). A second message mid-glide carries on from where the first had got to.
    const col = column.current, colNow = col?.offsetHeight || 0, grew = colNow - colH.current;
    colH.current = colNow;
    const glide = liveNew.current && stick.current && grew > 0 && colNow - grew > 0 && col.animate && motionOK(el);
    liveNew.current = false;
    if (prevH.current && el.scrollTop < 80 && !stick.current) el.scrollTop += el.scrollHeight - prevH.current;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    if (glide) {
      let from = Math.min(grew, el.clientHeight);
      if (slide.current) { try { from += new DOMMatrix(getComputedStyle(col).transform).m42; } catch { /* none */ } slide.current.cancel(); }
      const an = col.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      slide.current = an;
      an.onfinish = an.oncancel = () => { if (slide.current === an) slide.current = null; };
    }
    prevH.current = el.scrollHeight;
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stick.current = true; prevH.current = 0; lastKey.current = null; setEditing(null); }, [key]);
  // pictures, embeds and link previews finish loading after the message lands: stay at the bottom if you were there
  const content = useRef(null);
  useEffect(() => {
    const el = scroller.current, inner = content.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; prevH.current = el.scrollHeight; colH.current = column.current?.offsetHeight || 0; });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [key]);
  useEffect(() => {
    const go2 = e => { if (e.detail && e.detail !== key) return; stick.current = true; const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };
    addEventListener('vc-sent', go2);
    return () => removeEventListener('vc-sent', go2);
  }, [key]);
  useEffect(() => {
    // Up arrow in an empty composer edits your last message
    const onEditLast = () => {
      const last = [...list].reverse().find(m => m.author?.username === me && !m.pending && !m.system);
      if (last && (view.kind === 'channel' || (view.kind === 'dm' && last.imId))) setEditing(last.id);
    };
    addEventListener('vc-edit-last', onEditLast);
    return () => removeEventListener('vc-edit-last', onEditLast);
  }, [list, me, view.kind]);
  function onScroll() {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    prevH.current = el.scrollHeight;
    if (el.scrollTop < 120 && box?.hasMore && !box.loading) loadMessages(view, { older: true });
  }
  // images loading in push the bottom down: stay stuck
  function onLoadCapture() { if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }

  // messages that arrive while the conversation is open slide in (mine from the composer); everything loaded with it, or
  // older history scrolled in, just appears. A row is "fresh" for a moment so a re-render doesn't cut its animation short.
  const known = useRef({ key: null, at: new Map() });
  const liveNew = useRef(false); // a live message was just added: slide the rows above it up with it
  const column = useRef(null), slide = useRef(null), colH = useRef(0);
  if (known.current.key !== key || !box?.loaded) known.current = { key, at: new Map() };
  const seen = known.current.at;
  const firstPass = seen.size === 0;
  let newest = 0;
  for (const e of seen.values()) if (e.t > newest) newest = e.t;
  const nowMs = Date.now();
  const isFresh = m => {
    const id = m.nonce || m.id;
    let e = seen.get(id);
    // not seen before: appended after what I already had = live; the first load, or older pages scrolled in = not
    if (!e) { if (!firstPass && (m.created_at || 0) >= newest - 5000) liveNew.current = true; e = { live: !firstPass && (m.created_at || 0) >= newest - 5000, born: nowMs, t: m.created_at || 0 }; seen.set(id, e); }
    return !e.live ? 'init' : nowMs - e.born < 700 ? 'live' : 'done';
  };
  const rows = [];
  let prev = null;
  for (const m of list) {
    const day = new Date(m.created_at).toDateString();
    if (!prev || new Date(prev.created_at).toDateString() !== day) rows.push(<div className="vc-day" key={`d${day}`}><span>{dayOf(m.created_at)}</span></div>);
    const head = !prev || m.system || prev.system || /^mc_/.test(prev.sys_kind || '') || m.reply || m.interaction || m.statusReply || authorKey(prev.author) !== authorKey(m.author) || aliasKey(prev) !== aliasKey(m) || isUnsigned(prev) !== isUnsigned(m) || m.created_at - prev.created_at > GROUP_MS || new Date(prev.created_at).toDateString() !== day;
    if (newFrom && m.id === newFrom) rows.push(<div className="vc-new-line" key="new-line"><span>New</span></div>);
    rows.push(<Message key={m.nonce || m.id} fresh={isFresh(m)} m={m} head={head} ctx={ctx} canMod={canMod} onReply={onReply} onUser={onUser} editing={editing === m.id} setEditing={setEditing} view={view} />);
    prev = m;
  }
  return (
    <div className="vc-scroll" ref={scroller} onScroll={onScroll} onLoadCapture={onLoadCapture}>
      {unreadBar && (
        <div className={`vc-unread-bar${unreadBar.out ? ' out' : ''}`}>
          <button type="button" className="vc-unread-go" onClick={jumpToUnread}>
            <span>{unreadBar.count >= 50 ? '50+' : unreadBar.count} new message{unreadBar.count === 1 ? '' : 's'}</span>
            <b>Jump to unread <ChevronUp size={14} /></b>
          </button>
          <button type="button" className="vc-unread-x" title="Dismiss" onClick={() => setUnreadBar(null)}><X size={14} /></button>
          <i className="vc-unread-time" onAnimationEnd={() => setUnreadBar(b => (b ? { ...b, out: true } : b))} />
        </div>
      )}
      <div className="vc-msgs" ref={content}><div className="vc-msgs-col" ref={column}>
        {box?.loaded && !box.hasMore && (
          <div className="vc-start vl-in">
            <div className="vc-start-ico">{title.icon}</div>
            <h2>{title.big}</h2>
            <p>{title.sub}</p>
          </div>
        )}
        {box?.loading && <div className="vc-loading"><i /><i /><i /></div>}
        {box?.error && <div className="vc-empty-note">Couldn't load these messages ({errorText(box.error)}).</div>}
        {rows}
      </div></div>
    </div>
  );
}

export function Typing({ view }) {
  const show = useChat(s => s.settings.show_typing);
  const t = useChat(s => (show ? s.typing[keyOf(view)] : null));
  const people = useChat(s => s.people);
  const members = useChat(s => (view.kind === 'channel' ? s.members[view.sid] : null));
  const faces = useChat(s => s.veloraFaces);
  const now = Date.now();
  // the picture comes from the server's member list first (bots are members there, not in `people`), then anyone I've seen
  const pfpOf = n => {
    const m = members?.find(x => x.username === n);
    return (m ? faceOf(m, { veloraFaces: faces })?.pfp : null) || people[n]?.pfp || null;
  };
  const names = Object.entries(t || {}).filter(([, until]) => until > now).map(([n]) => n);
  // in a server, somebody I blocked types as "Blocked User" with the default picture
  const blockedNames = useChat(s => (view.kind === 'channel' ? names.filter(n => isBlockedName(view.sid, n, s)).join('\n') : ''));
  const isB = n => !!blockedNames && blockedNames.split('\n').includes(n);
  const who = n => (isB(n) ? <b className="vc-blocked-name">{BLOCKED_NAME}<BlockedMark size={11} /></b> : <b>{n}</b>);
  return (
    <div className={`vc-typing${names.length ? ' on' : ''}`} aria-live="polite">
      {names.length > 0 && <span className="vc-ch-typing-avs">{names.slice(0, 3).map(u => <Avatar key={u} user={isB(u) ? { username: BLOCKED_NAME, pfp: null } : { username: u, pfp: pfpOf(u) }} size={18} />)}</span>}
      {names.length > 0 && <span className="vc-dots"><i /><i /><i /></span>}
      {names.length === 1 && <span>{who(names[0])} is typing...</span>}
      {names.length === 2 && <span>{who(names[0])} and {who(names[1])} are typing...</span>}
      {names.length > 2 && <span>Several people are typing...</span>}
    </div>
  );
}

// unsent drafts, per conversation: kept across channel switches and page reloads (this browser, this account)
const draftKey = () => `velora_chat_drafts_${getState().me?.username || ''}`;
let draftMem = null;
function draftsAll() {
  if (!draftMem) { try { draftMem = JSON.parse(localStorage.getItem(draftKey()) || '{}') || {}; } catch { draftMem = {}; } }
  return draftMem;
}
let draftTimer = null;
function setDraft(key, v) {
  const all = draftsAll();
  if (v.trim()) all[key] = v.slice(0, 4000); else delete all[key];
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify(all)); } catch { /* full / blocked */ } }, 300);
}
addEventListener('beforeunload', () => { if (draftMem) try { localStorage.setItem(draftKey(), JSON.stringify(draftMem)); } catch { /* fine */ } });

// a DM needs this device unlocked. Every DM and group chat says what kind of privacy it has.
export function Composer(props) {
  const status = useChat(s => s.e2eeStatus);
  const { view } = props;
  const dm = view.kind === 'dm' && view.username !== 'System';
  if (dm && status !== 'ready') return <E2eeLockedPanel />;
  return <><E2eeComposerNotes view={view} /><ComposerBox {...props} /></>;
}
function ComposerBox({ view, placeholder, locked: lockedBy, lockedText, replyTo, setReplyTo }) {
  const timedOut = useTimedOut(view.kind === 'channel' ? view.sid : null); // (on an instance: a timeout hides the box until it ends)
  const locked = lockedBy || !!timedOut;
  const [text, setText] = useState('');
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(0);
  const ta = useRef(null); // the contenteditable box
  const composing = useRef(false);
  const mobileTextInput = () => !!window.bonfireMobile || window.matchMedia('(pointer: coarse)').matches;
  const saved = useRef(null); // the caret, kept while a picker has focus
  const file = useRef(null);
  const key = keyOf(view);
  const uploadContext = useRef({ key, pending: 0 });
  if (uploadContext.current.key !== key) uploadContext.current = { key, pending: 0 };
  const srDraft = useChat(s => s.statusReplyDraft);
  const barRoles = useChat(s => (view.sid ? s.detail[view.sid]?.roles : null));
  const barCtx = useMemo(() => ({ roles: barRoles, linkImages: false }), [barRoles]); // (the quote in the "Replying to" bar)
  const srActive = !!srDraft && view.kind === 'dm' && String(view.username).toLowerCase() === srDraft.username.toLowerCase() ? srDraft : null;
  useEffect(() => { if (!srActive) clearStatusReply(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (srActive) ta.current?.focus(); }, [srActive]);
  useEffect(() => { const f = () => ta.current?.focus(); addEventListener('vc-focus-composer', f); return () => removeEventListener('vc-focus-composer', f); }, []);
  const sid = view.kind === 'channel' ? view.sid : null;
  const canAttach = useChat(s => (view.kind === 'channel' ? canAttachInChannel(s.detail[view.sid], view.cid, s.members[view.sid], isInst(view.sid) ? s.instances.find(i => i.origin === instOf(view.sid))?.user?.username : s.me?.username) : true));
  const [mq, setMq] = useState(null); // the @word being typed
  const [cmd, setCmd] = useState(null); // the slash command being filled in
  const [csel, setCsel] = useState(0);
  const cmdSubmit = useRef(null);
  const cdata = useChat(s => (sid && isInst(sid) ? s.commands[sid] : null));
  useEffect(() => { if (sid && isInst(sid)) loadCommands(sid, view.cid); }, [sid, view.cid]); // eslint-disable-line react-hooks/exhaustive-deps
  const centries = useMemo(() => slashEntries(cdata), [cdata]);
  const slashQ = !cmd && text.startsWith('/') && !/\n|^\/\s/.test(text) ? text.slice(1) : null;
  // the bot rail on the left of the slash popup: null = every bot
  const [cbot, setCbot] = useState(null);
  const cbots = useMemo(() => [...new Map(centries.map(en => [en.bot.id, en.bot])).values()].sort((a, b) => a.username.localeCompare(b.username)), [centries]);
  const cbotOn = cbot && cbots.some(b => b.id === cbot) ? cbot : null;
  useEffect(() => { if (slashQ == null && cbot) setCbot(null); }, [slashQ == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const citems = useMemo(() => (slashQ == null ? [] : matchEntries(cbotOn ? centries.filter(en => en.bot.id === cbotOn) : centries, slashQ)), [slashQ, centries, cbotOn]);
  const cpicker = slashQ != null && (citems.length > 0 || (cbotOn && cbots.length > 1));
  const pickBot = id => { setCbot(id); setCsel(0); };
  const stepBot = d => { const ids = [null, ...cbots.map(b => b.id)]; pickBot(ids[(ids.indexOf(cbotOn) + d + ids.length) % ids.length]); };
  function startCommand(entry) {
    if (ta.current) ta.current.textContent = '';
    setText(''); setDraft(key, ''); setCmd(entry); setCsel(0); setMq(null);
  }
  const voice = useVoiceRecorder();
  const voiceHold = useRef(null); // { id, x, dx } while a finger holds the record button
  const voiceTouch = useRef(false);
  const [voiceHolding, setVoiceHolding] = useState(false);
  const [voiceDrag, setVoiceDrag] = useState(0);
  const canUploadMedia = useScope('MEDIA_UPLOAD');
  // a recording belongs to the conversation it started in, and stops counting if posting here stops being allowed
  useEffect(() => () => { voiceHold.current = null; setVoiceDrag(0); voice.discard(); voice.clearError(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locked && voice.active) voice.discard(); }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!voice.active) return undefined;
    setPicker(false); setEmoji(false);
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); voiceHold.current = null; setVoiceDrag(0); voiceDelete(); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [voice.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dropping, setDropping] = useState(false); // a file is being dragged over the window
  const saveFile = useRef(null);
  const destOnce = useRef(null); // the + menu's "Upload to ... storage": where the next picked files go
  const [picker, setPicker] = useState(false); // false | 'saved' | 'clips' (the tab it opens on)
  const [glintIntro, setGlintIntro] = useState(false);
  const [emoji, setEmoji] = useState(false);
  useEffect(() => {
    const keep = () => {
      const sel = getSelection();
      if (sel.rangeCount && ta.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', keep);
    return () => document.removeEventListener('selectionchange', keep);
  }, []);
  function sync() {
    const el = ta.current;
    if (!el) return '';
    let v = serialize(el);
    if (!v.trim() && !el.querySelector('[data-token]')) { if (el.childNodes.length) el.textContent = ''; v = ''; }
    setText(v);
    setDraft(key, v);
    return v;
  }
  // put an emoji where the cursor was
  function insertText(t) {
    const el = ta.current;
    if (!el) return;
    el.focus();
    insertAt(el, saved.current, t, sid);
    styleMarkdown(el, view);
    sync();
  }
  const [msel, setMsel] = useState(0);
  const mitems = useSuggestItems(view, mq);
  function pickMention(it) {
    const el = ta.current;
    if (!el || !mq) return;
    const token = it.token || (it.kind === 'role' ? `<@&${it.role.rid}>` : it.insert.trim());
    if (!replaceBeforeCaret(el, mq.q.length + 1, token, sid)) insertAt(el, saved.current, token, sid);
    styleMarkdown(el, view);
    setMq(null);
    sync();
    el.focus();
  }
  useEffect(() => { // each conversation keeps its own draft
    const el = ta.current;
    const saved = draftsAll()[key] || '';
    if (el) { fill(el, saved, view); styleMarkdown(el, view); }
    setText(saved);
    setCmd(null);
    setAtts(x => { x.forEach(a => a.preview && URL.revokeObjectURL(a.preview)); return []; }); setBusy(0);
    setTimeout(() => { if (ta.current && !mobileTextInput()) { ta.current.focus(); caretToEnd(ta.current); } }, 30);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  // what typed :names:, @people and #channels turn into needs to be loaded even if no picker was opened
  useEffect(() => { loadEmojiData()?.catch?.(() => {}); if (!getState().emojis) loadEmojis(); }, []);
  useEffect(() => { if (sid && !getState().members[sid]) loadMembers(sid); }, [sid]);
  function onInput(e) {
    const el = ta.current;
    if (composing.current || e.nativeEvent.isComposing) {
      const value = serialize(el);
      setText(value); setDraft(key, value); setMq(null);
      if (value.trim()) setTyping(view, true);
      return;
    }
    // a finished emoji (":name:") turns into the emoji as soon as the closing colon goes in
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ':') {
      const c = caretText(el);
      const m = c && /(^|\s)(:[A-Za-z0-9_+-]{1,40}:)$/.exec(c.before);
      const token = m && resolveWord(m[2], view);
      if (token) replaceBeforeCaret(el, m[2].length, token, sid, false);
    }
    // a finished word ("@someone ", "#channel ", ":name: ") turns into its pill
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ') {
      const c = caretText(el);
      const m = c && /(^|\s)(@[\w.-]{2,32}|#[a-z0-9_-]{1,40}|:[A-Za-z0-9_]{1,32}:)\s$/.exec(c.before);
      const token = m && resolveWord(m[2], view);
      if (token) replaceBeforeCaret(el, m[2].length + 1, token, sid, true);
    }
    if (!mobileTextInput()) styleMarkdown(el, view);
    const v = sync();
    if (e.nativeEvent.inputType === 'insertText' && e.nativeEvent.data === ' ' && /^\/\S+( \S+){0,2} $/.test(v)) {
      const hit = centries.find(en => en.label.toLowerCase() === v.slice(1).trim().toLowerCase());
      if (hit) { startCommand(hit); return; }
    }
    const c = caretText(el);
    setMq(c ? suggestQuery(c.before, c.before.length) : null); setMsel(0);
    if (v.trim()) setTyping(view, true);
  }
  function submit(askedAlready) {
    let t = (ta.current ? serialize(ta.current) : text).trim();
    if ((!t && !atts.length) || busy) return;
    // tracking junk in a link: ask once (first time), then clean silently when the setting is on
    const strip = getState().settings.strip_tracking;
    if (strip == null && !askedAlready && hasTracking(t)) { askStripTracking().then(() => submit(true)); return; }
    if (strip === true) t = cleanText(t);
    // an Ember server can lower the longest message (Server settings > Message rules)
    const maxLen = (view.kind === 'channel' && isInst(view.sid) && getState().detail[view.sid]?.server.max_message_length) || 4000;
    if (t.length > maxLen) { toast(maxLen < 4000 ? `Messages here can be up to ${maxLen.toLocaleString()} characters (this one is ${t.length.toLocaleString()}).` : errorText('message_too_long')); return; }
    // files picked here upload now, after the message is sent: the composer is free again straight away
    const queued = atts.filter(a => a.local);
    sendMessage(view, sid ? encodeRoleMentions(t, sid) : t, { replyTo, attachments: atts.filter(a => !a.local), uploads: queued.map(a => ({ file: a.file, spoiler: a.spoiler, dest: a.dest, expires: a.dest === 'temp' && a.expires !== 'default' ? a.expires : undefined })) });
    queued.forEach(a => a.preview && URL.revokeObjectURL(a.preview));
    setMq(null);
    if (ta.current) ta.current.textContent = '';
    setText(''); setDraft(key, ''); setAtts([]); setReplyTo?.(null);
    ta.current?.focus({ preventScroll: true });
  }
  // DMs, group chats and Velora-hosted channels send files to Velora (account or temporary storage); instance communities keep their own
  const onVelora = !(view.kind === 'channel' && isInst(view.sid));
  // the biggest file this conversation takes (MB): an instance community says so itself; on Velora it depends on where it goes
  function uploadCap(dest) {
    if (!onVelora) return getState().detail[view.sid]?.server.my_upload_max_mb || getState().detail[view.sid]?.server.upload_max_mb || 25; // (my_: with my roles)
    return dest === 'account' ? getUploadLimits().saved_mb : getUploadLimits().server_mb;
  }
  // dropped / pasted / picked files wait in the tray (checked against the size limit now) and only upload when the message is
  // sent - see sendMessage's uploads. On Velora each file goes where you picked: the remembered choice (chat setting
  // dm_upload_dest), the "Where should this go?" picker the first time, or destOnce from the + menu (just these files).
  async function addFiles(fileList, destOnce) {
    const context = uploadContext.current;
    if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
    const files = [...fileList]; // (copied now: a file input is emptied straight after this is called)
    if (!files.length) return;
    let dest = null;
    if (onVelora) {
      dest = destOnce || await chooseUploadDest(files);
      if (!dest || uploadContext.current !== context) return; // picker closed, or the conversation changed meanwhile
    }
    const cap = uploadCap(dest);
    const fits = [];
    for (const f of files) {
      if (f.size > cap * 1024 * 1024) toast(`${f.name} is too big (${fmtSize(f.size)}) - ${dest === 'account' ? 'files kept on your account' : dest === 'temp' ? 'temporary files' : 'files here'} go up to ${cap} MB.`);
      else if (!f.size) toast(`${f.name} is empty.`);
      else fits.push(f);
    }
    if (fits.length > Math.max(0, 4 - atts.length - context.pending)) toast('A message can carry up to 4 files.');
    if (!fits.length) return;
    // (counted again inside the update: two drops in a row can come before a re-render)
    setAtts(x => [...x, ...fits.slice(0, Math.max(0, 4 - x.length - context.pending)).map((f, i) => ({ local: true, id: `q${Date.now()}_${i}_${f.name}`, file: f, name: f.name, size: f.size, kind: fileKind(f), spoiler: false, dest, expires: 'default', preview: /^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null }))]);
    // a drop never focuses the box by itself: put the caret there so typing + Enter just work
    const el = ta.current;
    if (el && document.activeElement !== el && !mobileTextInput()) { el.focus({ preventScroll: true }); caretToEnd(el); }
  }
  function toggleSpoiler(a) {
    setAtts(x => x.map(y => (y !== a ? y : y.local ? { ...y, spoiler: !y.spoiler } : { ...y, name: spoilerName(y.name, !isSpoiler(y)) })));
  }
  function removeAtt(a) {
    if (a.preview) URL.revokeObjectURL(a.preview);
    setAtts(x => x.filter(y => y !== a));
    if (attPop?.id === a.id) setAttPop(null);
  }
  // the storage badge on a waiting file (TempAttPopover): a Velora Pro member's picked expiry, or the other storage
  const [attPop, setAttPop] = useState(null); // { id, rect } of the file whose popover is open
  const patchAtt = (id, p) => setAtts(x => x.map(y => (y.id === id ? { ...y, ...p } : y)));
  const popAtt = attPop && atts.find(a => a.id === attPop.id);
  // Android keyboard images and native Paste use the same attachment path as
  // file selection. The listener is refreshed with current permissions/draft.
  useEffect(() => {
    const el = ta.current, context = uploadContext.current;
    if (!el) return;
    const receive = async e => {
      e.preventDefault();
      if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
      try {
        const url = new URL(e.detail.url);
        if (url.origin !== location.origin || !url.pathname.startsWith('/__bonfire_clipboard/')) return;
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw Error('Could not paste that media. Try copying it again.');
        const blob = await response.blob();
        if (el !== ta.current || !el.isConnected || uploadContext.current !== context) return;
        await addFiles([new File([blob], e.detail.name || 'clipboard-media', { type: blob.type })]);
      } catch (error) { if (uploadContext.current === context) toast(error.message); }
    };
    el.addEventListener('bonfire-media-paste', receive);
    return () => el.removeEventListener('bonfire-media-paste', receive);
  });
  // "Upload to my Velora account": the file goes to Saved Media (your Velora storage) AND is attached to this message, the same
  // attachment a Saved Media pick gives
  async function addSavedFiles(files) {
    const context = uploadContext.current;
    if (locked || (view.kind === 'channel' && !canAttach) || view.username === 'System') return;
    const list = [...files].slice(0, Math.max(0, 4 - atts.length - context.pending));
    if (!list.length) return;
    const cap = getUploadLimits().saved_mb;
    const big = list.find(f => f.size > cap * 1024 * 1024);
    if (big) { toast(`${big.name} is too big - files kept on your account go up to ${cap} MB.`); return; }
    context.pending += list.length;
    setBusy(n => n + list.length);
    for (const f of list) {
      if (uploadContext.current !== context) return;
      try { const a = await uploadMedia(f); if (uploadContext.current === context) setAtts(x => [...x, a]); }
      catch (e) { if (uploadContext.current === context) toast(errorText(e.message)); }
      context.pending--;
      if (uploadContext.current === context) setBusy(n => n - 1);
    }
  }
  // The whole window takes dropped files. Counted dragenter/dragleave + a "no dragover for a moment" timer so the overlay can never
  // get stuck, preventDefault on window so a miss never opens the file in the tab. The Saved Media picker (and the emoji upload
  // list) mark themselves [data-drop-own]: a drop on them goes there instead and this overlay stays out of the way.
  const dz = useRef(null);
  dz.current = { ok: !locked && (view.kind !== 'channel' || canAttach) && view.username !== 'System', add: addFiles };
  useEffect(() => {
    loadUploadLimits();
    let depth = 0, idle = null;
    const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const own = e => !!e.target.closest?.('[data-drop-own]');
    const blocked = () => !dz.current.ok || !!document.querySelector('.vc-modal-back, .vc-mv-back');
    const stop = () => { depth = 0; clearTimeout(idle); setDropping(false); };
    const show = e => { if (own(e) || blocked()) { setDropping(false); return; } setDropping(true); clearTimeout(idle); idle = setTimeout(stop, 700); };
    const enter = e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(e); };
    const over = e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; show(e); };
    const leave = e => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth || (e.relatedTarget == null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight))) stop();
    };
    const drop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const mine = !own(e) && !blocked();
      stop();
      if (mine) dz.current.add(e.dataTransfer.files);
    };
    const opts = true;
    addEventListener('dragenter', enter, opts); addEventListener('dragover', over, opts); addEventListener('dragleave', leave, opts);
    addEventListener('drop', drop, opts); addEventListener('dragend', stop, opts); addEventListener('blur', stop);
    return () => {
      clearTimeout(idle);
      removeEventListener('dragenter', enter, opts); removeEventListener('dragover', over, opts); removeEventListener('dragleave', leave, opts);
      removeEventListener('drop', drop, opts); removeEventListener('dragend', stop, opts); removeEventListener('blur', stop);
    };
  }, []);
  // the + button: a file for this conversation, or one kept on my Velora account (Saved Media)
  function uploadMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const lim = getUploadLimits();
    loadMyClips(); // (cached for the session) so the Glint choice below knows straight away
    const pickOnce = dest => { destOnce.current = dest; file.current?.click(); };
    const mine = rememberedUploadDest();
    openMenu({ clientX: r.left, clientY: Math.max(6, r.top - 150), preventDefault() {}, stopPropagation() {} }, [
      ...(onVelora ? [ // DMs / group chats: pick where these files go (just this once - the remembered choice stays)
        { label: 'Upload to temporary storage', hint: `Free, deleted after a set time - up to ${lim.server_mb} MB${mine === 'temp' ? ' (your default)' : ''}`, icon: Clock, onClick: () => pickOnce('temp') },
        { label: 'Upload to account storage', hint: `Kept on your Nookara account - up to ${lim.saved_mb} MB${mine === 'account' ? ' (your default)' : ''}`, icon: CloudUpload, onClick: () => pickOnce('account') },
      ] : [
        { label: 'Upload to server', hint: `Sent here - up to ${uploadCap()} MB`, icon: Upload, onClick: () => file.current?.click() },
        { label: 'Upload to my Nookara account', hint: `Kept in Saved Media and attached - up to ${lim.saved_mb} MB`, icon: CloudUpload, onClick: () => saveFile.current?.click() },
      ]),
      { label: <span className="vc-ctx-newlabel">Attach a Glint clip <NewTag /></span>, hint: 'One of your game clips', icon: GlintMark,
        onClick: async () => { const list = liveClips(await loadMyClips()); setEmoji(false); if (list.length) setPicker('clips'); else setGlintIntro(true); } },
    ]);
  }
  // Voice messages. An empty box turns the send button into the record button. The input decides how it works, not the screen size:
  // a finger holds (let go sends, slide left deletes), a mouse or keyboard clicks once to start and again to send.
  const canVoice = !cmd && !text.trim() && !atts.length && !busy && !locked && view.kind !== 'modmail' && view.username !== 'System' && (view.kind !== 'channel' || canAttach) && (!onVelora || canUploadMedia);
  async function sendVoice() {
    const v = view, reply = replyTo, recorded = await voice.finish();
    if (!recorded) return;
    const dest = onVelora ? rememberedUploadDest() || 'temp' : undefined; // no picker for a voice message: the usual place, else temporary storage
    const cap = uploadCap(dest);
    if (recorded.size > cap * 1024 * 1024) { toast(`That voice message is too big (${fmtSize(recorded.size)}) - files here go up to ${cap} MB.`); return; }
    if (!packActive()) playSound('voice_send', 0.5); // (a message sound pack plays its own send sound)
    sendMessage(v, '', { replyTo: reply, uploads: [{ file: recorded, spoiler: false, dest }] });
    setReplyTo?.(null);
  }
  function voiceDelete() { playSound('voice_delete', 0.5); voice.discard(); }
  function voicePress(e) {
    voiceTouch.current = false;
    if (e.pointerType === 'mouse' || !canVoice || voice.active) return;
    voiceTouch.current = true;
    voiceHold.current = { id: e.pointerId, x: e.clientX, dx: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the release still lands on the button */ }
    setVoiceHolding(true); setVoiceDrag(0); setPicker(false); setEmoji(false);
    voice.start();
  }
  function voiceMove(e) {
    const h = voiceHold.current;
    if (!h || h.id !== e.pointerId) return;
    h.dx = e.clientX - h.x;
    setVoiceDrag(Math.min(0, h.dx));
  }
  function voiceRelease(e) {
    const h = voiceHold.current;
    if (!h || h.id !== e.pointerId) return;
    voiceHold.current = null;
    setVoiceDrag(0);
    setTimeout(() => { voiceTouch.current = false; }, 500); // (a browser may not add its click after a long press)
    const what = voice.phase === 'recording' || voice.phase === 'full' ? holdOutcome({ recordedMs: voice.elapsed(), dx: h.dx }) : 'too_short';
    if (what === 'send') { sendVoice(); return; }
    if (what === 'discard') voiceDelete(); else voice.discard();
    if (what === 'too_short') toast('Hold the button while you talk.');
  }
  // the system took the press away (a call, a permission prompt, the screen going off): never counts as "send"
  function voiceCancel(e) {
    const h = voiceHold.current;
    if (!h || h.id !== e.pointerId) return;
    voiceHold.current = null;
    setVoiceDrag(0);
    voice.discard();
  }
  if (timedOut) return <div className="vc-composer locked timed-out" role="status"><Clock size={15} /> <span><b>You're timed out</b> until {untilText(timedOut)}. You can read messages, but can't send any, react or join voice until then.</span></div>;
  if (locked) {
    return <div className="vc-composer locked"><Lock size={15} /> {lockedText || "This channel is locked - only the server's admins can post here."}</div>;
  }
  return (
    <div className="vc-composer-wrap">
      {dropping && createPortal(
        <div className="vc-dropzone" aria-hidden="true">
          <div className="vc-dropzone-card">
            <Upload size={44} />
            <b>Drop to upload</b>
            <span>Up to {uploadCap()} MB per file{view.kind === 'channel' && isInst(view.sid) ? '' : ', 4 files at a time'}</span>
          </div>
        </div>
        , document.body)}
      {replyTo && (
        <div className="vc-replybar">
          <span className="vc-replybar-main">Replying to <b>{aliasOf(replyTo)?.name || replyTo.author?.username || 'Nookara'}</b>{replyTo.body ? <ReplyText body={replyTo.body} ctx={barCtx} /> : null}</span>
          <button type="button" onClick={() => setReplyTo(null)} title="Cancel reply"><X size={14} /></button>
        </div>
      )}
      {srActive && (
        <div className="vc-replybar vc-sr-bar">
          <span>Replying to <b>{srActive.username}</b>'s status: <i>{srActive.text}</i></span>
          <button type="button" onClick={clearStatusReply} title="Cancel status reply"><X size={14} /></button>
        </div>
      )}
      {(atts.length > 0 || busy > 0) && (
        <div className="vc-pending-atts">
          {atts.map(a => {
            const type = a.local ? a.kind : a.type, src = a.local ? a.preview : a.url;
            const spoiler = a.local ? a.spoiler : isSpoiler(a);
            const name = shownName(a.name) || 'File';
            // pictures and videos show as a big thumbnail; sounds and other files as a card with their name and size
            const thumb = (type === 'image' || type === 'gif' || type === 'video') && src;
            const ext = (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || '').toUpperCase();
            const picked = a.local && a.dest === 'temp' && a.expires && a.expires !== 'default' && a.expiresDays ? shortDays(a.expiresDays) : null;
            return (
              <span key={a.local ? a.id : a.url} className={`vc-patt${thumb ? ' thumb' : ' card'}${spoiler ? ' spoiler' : ''}`} title={`${name}${a.size ? ` (${fmtSize(a.size)})` : ''}`}>
                {thumb ? (
                  <>
                    {type === 'video' ? <video src={src} muted preload="metadata" playsInline /> : <img src={src} alt="" />}
                    {type === 'video' && <span className="vc-patt-kind"><Film size={11} />Video</span>}
                  </>
                ) : (
                  <>
                    <span className="vc-patt-ico">{type === 'audio' ? <Music size={22} /> : type === 'video' ? <Film size={22} /> : <FileIcon size={22} />}{ext && <b>{ext.slice(0, 4)}</b>}</span>
                    <span className="vc-patt-meta"><span className="vc-patt-name">{name}</span><small>{[type === 'audio' ? 'Sound' : type === 'video' ? 'Video' : KIND_OF(ext.toLowerCase()), fmtSize(a.size)].filter(Boolean).join(' - ')}</small></span>
                  </>
                )}
                {spoiler && <span className="vc-patt-spoiler-tag">Spoiler</span>}
                {a.local && a.dest && (
                  <button type="button" className={`vc-patt-dest${picked ? ' picked' : ''}${attPop?.id === a.id ? ' open' : ''}`} aria-haspopup="dialog" aria-expanded={attPop?.id === a.id}
                    title={a.dest === 'account' ? 'Goes to your Nookara account storage - click for options' : `Goes to Nookara's temporary storage${picked ? ` (deleted after ${daysText(a.expiresDays)}, fixed)` : ''} - click for options`}
                    onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAttPop(p => (p?.id === a.id ? null : { id: a.id, rect: r })); }}>
                    {a.dest === 'account' ? <HardDrive size={12} /> : <Clock size={12} />}{picked && <span>{picked}</span>}
                  </button>
                )}
                <button type="button" className="vc-patt-spoiler" title={spoiler ? 'Remove spoiler' : 'Mark as spoiler'} aria-pressed={spoiler} onClick={() => toggleSpoiler(a)}>{spoiler ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                <button type="button" className="vc-patt-x" title="Remove" onClick={() => removeAtt(a)}><X size={12} /></button>
              </span>
            );
          })}
          {Array.from({ length: busy }, (_, i) => <span key={`b${i}`} className="vc-patt thumb busy"><ImageIcon size={22} /></span>)}
        </div>
      )}
      {popAtt && (
        <TempAttPopover att={popAtt} rect={attPop.rect} onClose={() => setAttPop(null)}
          onExpires={(v, days) => patchAtt(popAtt.id, { expires: v, expiresDays: days })}
          onDest={d => patchAtt(popAtt.id, { dest: d, expires: 'default', expiresDays: null })} />
      )}
      {voice.error && (
        <div className="vc-replybar vc-voice-error" role="alert">
          <span><AlertCircle size={13} aria-hidden="true" /> {voice.error}</span>
          <button type="button" onClick={voice.clearError} title="Dismiss"><X size={14} /></button>
        </div>
      )}
      <div className={`vc-composer${replyTo || srActive ? ' replying' : ''}${voice.active ? ' recording' : ''}`}>
        {(view.kind !== 'channel' || canAttach) && view.username !== 'System' && !voice.active && (
          <button type="button" className="vc-ico-btn" title="Upload a file" onClick={uploadMenu}><Plus size={18} /></button>
        )}
        {mq && <MentionPicker items={mitems} sel={msel} setSel={setMsel} onPick={pickMention} sid={view.sid} />}
        {slashQ === '' && cdata && !centries.length && <div className="vc-mentions vc-cmd-picker vc-cmd-empty">No bot commands in this server yet. Bots can add slash commands, and they will show up here.</div>}
        {cpicker && <CommandPicker items={citems} sel={csel} setSel={setCsel} onPick={startCommand} bots={cbots} bot={cbotOn} onBot={pickBot} />}
        {cmd && <CommandBar key={cmd.key} view={view} entry={cmd} submitRef={cmdSubmit} onCancel={() => { setCmd(null); ta.current?.focus(); }} onSent={() => { setCmd(null); setReplyTo?.(null); ta.current?.focus(); }} />}
        <input ref={file} type="file" multiple hidden onChange={e => { const once = destOnce.current; destOnce.current = null; addFiles(e.target.files, once); e.target.value = ''; }} />
        <input ref={saveFile} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/*" onChange={e => { addSavedFiles(e.target.files); e.target.value = ''; }} />
        <div
          ref={ta} className="vc-input" style={cmd || voice.active ? { display: 'none' } : undefined} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
          data-placeholder={placeholder} spellCheck autoCorrect="on" autoCapitalize="sentences" inputMode="text"
          onInput={onInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={e => { composing.current = false; onInput(e); }}
          onBlur={() => setTimeout(() => setMq(null), 150)}
          onPaste={e => {
            e.preventDefault();
            const files = [...(e.clipboardData.files || [])];
            if (!files.length) for (const item of e.clipboardData.items || []) {
              if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
            }
            if (files.length) { addFiles(files); return; }
            const t = e.clipboardData.getData('text/plain');
            if (!t) return;
            const strip = getState().settings.strip_tracking;
            if (strip === true) { document.execCommand('insertText', false, cleanText(t)); return; }
            if (strip == null && hasTracking(t)) { askStripTracking().then(yes => insertText(yes ? cleanText(t) : t)); return; } // first time: ask, then paste it
            document.execCommand('insertText', false, t);
          }}
          onDrop={e => { if (e.dataTransfer.files.length) return; e.preventDefault(); }}
          onKeyDown={e => {
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            const marker = markdownMarker(e);
            if (marker) { e.preventDefault(); markdownShortcut(ta.current, view, marker); styleMarkdown(ta.current, view); sync(); return; }
            if (cpicker && cbots.length > 1 && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); stepBot(e.key === 'ArrowDown' ? 1 : -1); return; }
            if (citems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCsel(x => (x + 1) % citems.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCsel(x => (x - 1 + citems.length) % citems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); startCommand(citems[csel] || citems[0]); return; }
            }
            if (mq && mitems.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMsel(x => (x + 1) % mitems.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMsel(x => (x - 1 + mitems.length) % mitems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mitems[msel] || mitems[0]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMq(null); return; }
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (e.shiftKey) { document.execCommand('insertLineBreak'); sync(); } else submit();
            }
            if (e.key === 'ArrowUp' && !text) { e.preventDefault(); dispatchEvent(new Event('vc-edit-last')); }
            if (e.key === 'Escape' && replyTo) setReplyTo(null);
          }}
        />
        {voice.active && <VoiceBar voice={voice} mode={voiceHolding ? 'hold' : 'click'} dragX={voiceDrag} onDiscard={voiceDelete} />}
        {!voice.active && <button type="button" className={`vc-ico-btn vc-gif-btn${picker ? ' on' : ''}`} title="Media (GIFs, Saved Media, Game Clips)" onClick={() => { setPicker(p => (p ? false : 'saved')); setEmoji(false); }}><GifIcon /></button>}
        {!voice.active && <button type="button" className={`vc-ico-btn vc-emoji-btn${emoji ? ' on' : ''}`} title="Emoji" onClick={() => { setEmoji(x => !x); setPicker(false); }}><Smile size={19} /></button>}
        {emoji && !voice.active && <EmojiPicker onClose={() => setEmoji(false)} onPick={t => { insertText(t); setEmoji(false); }} />}
        <button type="button" className={`vc-ico-btn send${canVoice || voice.active ? ' voice' : ''}`} title={voice.active ? 'Send voice message' : canVoice ? 'Record a voice message' : 'Send'} aria-label={voice.active ? 'Send voice message' : canVoice ? 'Record a voice message' : 'Send'} disabled={!voice.active && !canVoice && !cmd && !text.trim() && !atts.length}
          onPointerDown={e => { e.preventDefault(); voicePress(e); }} onPointerMove={voiceMove} onPointerUp={voiceRelease} onPointerCancel={voiceCancel} onContextMenu={e => { if (canVoice || voice.active) e.preventDefault(); }} onMouseDown={e => e.preventDefault()}
          onClick={() => {
            if (voiceTouch.current) { voiceTouch.current = false; return; } // (the click a browser adds after a touch: the press already did it)
            if (voice.active) sendVoice(); else if (canVoice) { setVoiceHolding(false); voice.start(); } else if (cmd) cmdSubmit.current?.(); else submit();
          }}>{voice.active && !voiceHolding ? <SendHorizontal size={18} /> : canVoice || voice.active ? <AudioLines size={18} /> : <SendHorizontal size={18} />}</button>
        {picker && <MediaPicker key={picker} tab={picker === 'clips' ? 'clips' : undefined} onClose={() => setPicker(false)} onPick={a => { setPicker(false); sendMessage(view, '', { replyTo, attachments: [a] }); setReplyTo?.(null); }}
          onSendLink={url => { setPicker(false); sendMessage(view, url, { replyTo }); setReplyTo?.(null); }} />}
        {glintIntro && <GlintIntro onClose={() => setGlintIntro(false)} />}
      </div>
      <Typing view={view} />
    </div>
  );
}
