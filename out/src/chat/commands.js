import { Bot } from 'lucide-react';
import { getState, sendInteraction, toast, errorText } from './store.js';
import { isInst } from './ids.js';

export const T = { SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };

const entry = (cmd, bot, path, options, description) => ({ key: `${cmd.id}/${path.join('/')}`, cmd, bot, path, label: [cmd.name, ...path].join(' '), description: description || cmd.description, options: options || [] });

export function slashEntries(data) {
  const bots = new Map((data?.bots || []).map(b => [b.id, b]));
  const out = [];
  for (const c of data?.commands || []) {
    const bot = bots.get(c.bot);
    if (c.type !== 1 || !bot) continue;
    if (!c.options.some(o => o.type === T.SUB || o.type === T.GROUP)) { out.push(entry(c, bot, [], c.options)); continue; }
    for (const o of c.options) {
      if (o.type === T.SUB) out.push(entry(c, bot, [o.name], o.options, o.description));
      else if (o.type === T.GROUP) for (const sub of o.options || []) out.push(entry(c, bot, [o.name, sub.name], sub.options, sub.description));
    }
  }
  return out;
}

const rankOf = (label, q) => {
  if (!q) return 3;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.split(' ').some(w => w.startsWith(q))) return 2;
  return label.includes(q) ? 4 : 9;
};
export function matchEntries(entries, query) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').replace(/^\s/, '');
  const scored = entries.map(e => ({ e, r: rankOf(e.label.toLowerCase(), q.trimEnd()) })).filter(x => x.r < 9);
  const bestOfBot = new Map();
  for (const x of scored) bestOfBot.set(x.e.bot.id, Math.min(bestOfBot.get(x.e.bot.id) ?? 9, x.r));
  return scored
    .sort((a, b) => bestOfBot.get(a.e.bot.id) - bestOfBot.get(b.e.bot.id) || a.e.bot.username.localeCompare(b.e.bot.username) || a.r - b.r || a.e.label.localeCompare(b.e.label))
    .slice(0, 30).map(x => x.e);
}
export const menuCommands = (data, type) => {
  const bots = new Map((data?.bots || []).map(b => [b.id, b]));
  return (data?.commands || []).filter(c => c.type === type && bots.has(c.bot)).map(c => ({ cmd: c, bot: bots.get(c.bot) }))
    .sort((a, b) => a.bot.username.localeCompare(b.bot.username) || a.cmd.name.localeCompare(b.cmd.name));
};
export const interactionError = e => {
  if (e?.message === 'bad_option') return `${e.option}: ${e.reason}.`;
  return null;
};

export function appsItems({ sid, cid, type, target }) {
  if (!sid || !cid || !isInst(sid)) return null;
  const list = menuCommands(getState().commands[sid], type);
  if (!list.length) return null;
  const sub = [];
  let last = null;
  for (const { cmd, bot } of list) {
    if (bot.id !== last) { sub.push({ type: 'head', label: bot.username }); last = bot.id; }
    sub.push({ label: cmd.name, onClick: () => sendInteraction(sid, { type: 2, channel: cid, command: cmd.id, target }).catch(e => toast(interactionError(e) || errorText(e.message))) });
  }
  return { label: 'Bots', icon: Bot, sub };
}
