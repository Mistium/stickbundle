// The composer is a contenteditable box so custom emojis, @mentions, @roles, @everyone and #channels
// show styled while you type. Its value is still plain message text: pills/emojis carry data-token.
import { getState, customEmoji } from './store.js';
import { emojiDataSync } from './EmojiPicker.jsx';

const EMOJI_TOKEN = /^<(a?):([A-Za-z0-9_]{1,32}):(e[0-9a-f]{10})>$/;
const ROLE_TOKEN = /^<@&(r[0-9a-f]{10})>$/;
const SPLIT_RE = /(<a?:[A-Za-z0-9_]{1,32}:e[0-9a-f]{10}>|<@&r[0-9a-f]{10}>)/;

// the element for one token (or null if it isn't one we style)
export function pillNode(token, sid) {
  let m;
  if ((m = EMOJI_TOKEN.exec(token))) {
    const img = document.createElement('img');
    img.className = 'vc-cemoji vc-in-emoji';
    img.src = customEmoji(m[3], m[1]);
    img.alt = img.title = `:${m[2]}:`;
    img.draggable = false;
    img.contentEditable = 'false';
    img.dataset.token = token;
    return img;
  }
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.token = token;
  if ((m = ROLE_TOKEN.exec(token))) {
    const r = (getState().detail[sid]?.roles || []).find(x => x.rid === m[1]);
    span.className = 'vc-mention role vc-tok';
    if (r?.color) span.style.setProperty('--rc', r.color);
    span.textContent = `@${r ? r.name : 'deleted-role'}`;
    return span;
  }
  if (/^@(everyone|here)$/.test(token)) { span.className = 'vc-mention all vc-tok'; span.textContent = token; return span; }
  if (token[0] === '@') {
    const me = getState().me?.username;
    span.className = `vc-mention vc-tok${me && me.toLowerCase() === token.slice(1).toLowerCase() ? ' me' : ''}`;
    span.textContent = token;
    return span;
  }
  if (token[0] === '#') { span.className = 'vc-mention ch vc-tok'; span.textContent = token; return span; }
  return null;
}

// a word typed by hand (followed by a space) -> the token it stands for, if it's a real thing
export function resolveWord(word, view) {
  const st = getState();
  const sid = view.kind === 'channel' ? view.sid : null;
  if (word[0] === ':') {
    const name = word.slice(1, -1).toLowerCase();
    for (const s of st.emojis || []) { const e = s.emojis.find(x => x.name.toLowerCase() === name); if (e) return `<${e.animated ? 'a' : ''}:${e.name}:${e.eid}>`; }
    const label = name.replace(/_/g, ' ');
    const data = emojiDataSync();
    return data?.find(e => Array.isArray(e[4]) && e[4].includes(name))?.[0] || data?.find(e => e[1] === label)?.[0] || data?.find(e => String(e[1]).replace(/[^a-z0-9]+/g, ' ').trim() === label.replace(/[^a-z0-9]+/g, ' ').trim())?.[0] || null;
  }
  if (word[0] === '#') return sid && st.detail[sid]?.channels.some(c => c.name === word.slice(1)) ? word : null;
  const n = word.slice(1).toLowerCase();
  if (sid && (n === 'everyone' || n === 'here')) return `@${n}`;
  if (sid) {
    const r = (st.detail[sid]?.roles || []).find(x => !x.is_default && x.name.toLowerCase() === n);
    if (r) return `<@&${r.rid}>`;
    const u = (st.members[sid] || []).find(x => x.username.toLowerCase() === n);
    return u ? `@${u.username}` : null;
  }
  if (view.kind === 'dm') return [view.username, st.me?.username].find(x => x && x.toLowerCase() === n) ? `@${[view.username, st.me?.username].find(x => x && x.toLowerCase() === n)}` : null;
  if (view.kind === 'group') { const g = st.groups.find(x => x.room === view.room); const u = g?.members.find(x => x.toLowerCase() === n); return u ? `@${u}` : null; }
  return null;
}

// box contents -> message text
export function serialize(root) {
  let out = '';
  const walk = node => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.dataset?.token) out += c.dataset.token;
      else if (c.nodeName === 'BR') out += '\n';
      else {
        const block = c.nodeName === 'DIV' || c.nodeName === 'P';
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(c);
      }
    }
  };
  walk(root);
  return out.replace(/​/g, '').replace(/ /g, ' ');
}

// message text (a saved draft) -> box contents
const WORD_RE = /(^|\s)(@[\w.-]{2,32}|#[a-z0-9_-]{1,40})(?=\s|$)/g;
export function fill(root, text, view) {
  const sid = view?.kind === 'channel' ? view.sid : null;
  root.textContent = '';
  const addText = t => t.split('\n').forEach((line, i) => {
    if (i) root.appendChild(document.createElement('br'));
    if (!line) return;
    // typed @someone / @everyone / #channel come back as pills when they're real
    let at = 0;
    for (const m of line.matchAll(WORD_RE)) {
      const token = view && resolveWord(m[2], view);
      const start = m.index + m[1].length;
      if (!token) continue;
      if (start > at) root.appendChild(document.createTextNode(line.slice(at, start)));
      root.appendChild(pillNode(token, sid) || document.createTextNode(token));
      at = start + m[2].length;
    }
    if (at < line.length) root.appendChild(document.createTextNode(line.slice(at)));
  });
  for (const part of String(text || '').split(SPLIT_RE)) {
    if (!part) continue;
    const pill = SPLIT_RE.test(part) && pillNode(part, sid);
    if (pill) root.appendChild(pill); else addText(part);
  }
}

export function caretToEnd(root) {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// Apply a Markdown pair around the current selection. Rebuilding through fill()
// deliberately keeps mention and custom-emoji pills intact after the shortcut.
export function markdownShortcut(root, view, marker) {
  const sel = getSelection();
  if (!root || !sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = serialize(before.cloneContents()).length;
  const selected = serialize(range.cloneContents());
  const value = serialize(root);
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(start + selected.length)}`;
  fill(root, next, view);
  const at = start + marker.length + selected.length;
  setSelectionOffset(root, at);
  return true;
}

function selectionOffset(root, range, atEnd = false) {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(atEnd ? range.endContainer : range.startContainer, atEnd ? range.endOffset : range.startOffset);
  return serialize(before.cloneContents()).length;
}
function setSelectionOffset(root, start, end = start) {
  const sel = getSelection();
  const point = at => {
    let left = at;
    const walk = parent => {
      for (const node of parent.childNodes) {
        if (node.nodeType === 3) {
          if (left <= node.nodeValue.length) return { node, offset: left };
          left -= node.nodeValue.length;
        } else if (node.dataset?.token || node.nodeName === 'BR') {
          const length = node.dataset?.token?.length || 1;
          if (left <= length) {
            const offset = Array.prototype.indexOf.call(parent.childNodes, node) + (left > 0 ? 1 : 0);
            return { node: parent, offset };
          }
          left -= length;
        } else {
          const found = walk(node);
          if (found) return found;
        }
      }
      return null;
    };
    const found = walk(root);
    if (found) return found;
    return { node: root, offset: root.childNodes.length };
  };
  const a = point(start), b = point(end);
  const range = document.createRange();
  range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
  sel.removeAllRanges(); sel.addRange(range);
}

// Make Markdown readable while it is still being written. The delimiters stay
// visible (so this remains an editor), while only their contents are styled.
export function styleMarkdown(root, view) {
  const sel = getSelection();
  const range = sel?.rangeCount && sel.getRangeAt(0);
  const inBox = range && root?.contains(range.startContainer) && root.contains(range.endContainer);
  const start = inBox ? selectionOffset(root, range) : null;
  const end = inBox ? selectionOffset(root, range, true) : null;
  const value = serialize(root);
  fill(root, value, view);
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  const linkify = text => {
    const out = document.createDocumentFragment();
    const re = /\[[^\]\n]{1,200}\]\(https?:\/\/[^\s<>()]+\)|https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.append(document.createTextNode(text.slice(last, m.index)));
      const link = document.createElement('span');
      link.className = 'vc-md-link';
      link.textContent = m[0];
      out.append(link);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.append(document.createTextNode(text.slice(last)));
    return out;
  };
  const inline = text => {
    const out = document.createDocumentFragment();
    const re = /(\[[^\]\n]{1,200}\]\(https?:\/\/[^\s<>()]+\)|https?:\/\/[^\s<>"')\]]+[^\s<>"'.,;:!?)\]]|\|\|[^|\n]+\|\||\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.append(document.createTextNode(text.slice(last, m.index)));
      const token = m[0];
      if (token.startsWith('http') || token.startsWith('[')) {
        out.append(linkify(token));
        last = m.index + token.length;
        continue;
      }
      const marker = token.startsWith('**') ? '**' : token.startsWith('__') ? '__' : token.startsWith('~~') ? '~~' : token.startsWith('||') ? '||' : token[0];
      const Tag = marker === '**' ? 'b' : marker === '__' ? 'u' : marker === '~~' ? 's' : marker === '`' ? 'code' : marker === '||' ? 'span' : 'i';
      out.append(document.createTextNode(marker));
      const styled = document.createElement(Tag);
      if (Tag === 'code') styled.className = 'vc-code';
      if (marker === '||') styled.className = 'vc-md-spoiler';
      const contents = token.slice(marker.length, -marker.length);
      if (Tag === 'code') styled.textContent = contents;
      else styled.append(linkify(contents));
      out.append(styled, document.createTextNode(marker));
      last = m.index + token.length;
    }
    if (last < text.length) out.append(document.createTextNode(text.slice(last)));
    return out;
  };
  for (const textNode of textNodes) {
    if (!textNode.parentElement || textNode.parentElement.closest('[data-token]')) continue;
    const text = textNode.nodeValue;
    if (!/[`*_~|]|^> |https?:\/\//.test(text)) continue;
    const fragment = document.createDocumentFragment();
    if (text.startsWith('> ')) {
      const quote = document.createElement('span');
      quote.className = 'vc-md-quote';
      quote.append(document.createTextNode('> '), inline(text.slice(2)));
      fragment.append(quote);
    } else fragment.append(inline(text));
    textNode.replaceWith(fragment);
  }
  if (start !== null) setSelectionOffset(root, start, end);
}

// The full text before the caret, including earlier lines and styled nodes.
export function caretText(root) {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return null;
  const n = sel.anchorNode;
  if (!n || !root.contains(n)) return null;
  return { node: n.nodeType === 3 ? n : null, off: sel.anchorOffset, before: serialize((() => {
    const before = sel.getRangeAt(0).cloneRange();
    before.selectNodeContents(root);
    before.setEnd(n, sel.anchorOffset);
    return before.cloneContents();
  })()) };
}

// replace the `len` characters before the caret with a pill and a space, caret after the space
export function replaceBeforeCaret(root, len, token, sid, eatSpace) {
  const c = caretText(root);
  if (!c || c.before.length < len) return false;
  const pill = pillNode(token, sid);
  const node = pill || document.createTextNode(token);
  setSelectionOffset(root, c.before.length - len, c.before.length - (eatSpace ? 1 : 0));
  const r = getSelection().getRangeAt(0);
  r.deleteContents();
  r.insertNode(node);
  let after = node.nextSibling;
  if (!(after && after.nodeType === 3 && after.nodeValue.startsWith(' '))) {
    after = document.createTextNode(' ');
    node.after(after);
  }
  const r2 = document.createRange();
  r2.setStart(after, 1);
  r2.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r2);
  return true;
}

// put text or a pill where `range` is (the caret, saved before a picker took focus)
export function insertAt(root, range, value, sid) {
  const sel = getSelection();
  let r = range && root.contains(range.startContainer) ? range : null;
  if (!r) { caretToEnd(root); r = sel.getRangeAt(0); }
  r.deleteContents();
  const pill = pillNode(value, sid);
  const node = pill || document.createTextNode(value);
  r.insertNode(node);
  let end = node;
  if (pill) { end = document.createTextNode(' '); node.after(end); }
  const r2 = document.createRange();
  if (end.nodeType === 3) r2.setStart(end, end.nodeValue.length); else r2.setStartAfter(end);
  r2.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r2);
}
