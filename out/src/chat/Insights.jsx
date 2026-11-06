// Server settings > Insights: activity over 24 hours / 7 / 30 / 90 days from an instance's /servers/:sid/insights.
// Headline tiles (vs the previous range), joins & leaves, member count, messages, unique chatters, reactions, top channels,
// top chatters and the busiest hours. Charts are small inline SVGs (no chart library): they measure their box, so they fill
// the width on any screen, and show the exact value + time under the pointer.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Users, UserPlus, MessageSquare, MessagesSquare, SmilePlus, Hash, Trophy, CalendarClock, TrendingUp, TrendingDown, Minus, Mic, Bot, ChartLine } from 'lucide-react';
import { apiFetch } from '../api.js';
import { toast, errorText } from './store.js';
import { Avatar } from './Profile.jsx';
import { Card } from './SettingsShell.jsx';
import { niceMax, pctChange, labelEvery, bucketAt, short, mondayFirst } from './insightsMath.js';
import './Insights.css';

const RANGES = [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];
// series colours: distinct from each other and from the (user-picked) accent
const C = { join: '#6fbf8a', leave: '#e06c6c', net: '#e3b25a', members: '#7d95e0', messages: '#9d8ad1', chatters: '#56bfcb', reactions: '#d07ab8' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = n => Number(n || 0).toLocaleString();

// the time a bucket covers, in the viewer's own clock
function bucketLabel(d, i, long) {
  const t = new Date(d.start + i * d.step_ms);
  if (d.step_ms < 86400000) {
    const hh = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!long) return hh;
    const e = new Date(t.getTime() + d.step_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${hh} - ${e}`;
  }
  return t.toLocaleDateString([], long ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// one chart: bars (side by side, a negative `sign` draws below zero) and lines / areas over the same buckets
// series: [{ key, label, color, values, type: 'bar' | 'line' | 'area', sign?: -1 }]
function Chart({ d, series, height = 170, ariaLabel, fit = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const n = d.count;
  const L = 38, R = 8, T = 8, B = 22;
  const pw = Math.max(1, width - L - R), ph = height - T - B;
  const vals = series.flatMap(s => s.values.map(v => v * (s.sign || 1)));
  // fit: zoom the y axis onto the data (a member count of 1,280 +- 20 would be a flat line from zero)
  const mn = Math.min(...vals), mx = Math.max(...vals), pad = Math.max(1, Math.ceil((mx - mn) * 0.2));
  const top = fit ? mx + pad : niceMax(Math.max(0, mx));
  const low = fit ? Math.max(0, mn - pad) : mn < 0 ? -niceMax(-mn) : 0;
  const y = v => T + ph - ((v - low) / (top - low)) * ph;
  const bw = pw / n;
  const bars = series.filter(s => s.type === 'bar');
  const pos = series.filter(s => s.type === 'bar' && s.sign !== -1);
  const group = Math.max(1, Math.min(bw - Math.min(4, bw * 0.2), 34 * Math.max(1, pos.length))); // bars stay slim on wide screens
  const inner = group / Math.max(1, pos.length);
  const ticks = fit ? [low, Math.round((low + top) / 2), top] : low < 0 ? [low, 0, top] : [0, top / 2, top];
  const xl = labelEvery(n, Math.floor(pw / 64));
  const empty = series.every(s => s.values.every(v => !v));
  const move = e => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(bucketAt(e.clientX - r.left, L, pw, n));
  };
  const tipLeft = hover == null ? 0 : Math.min(Math.max(L + (hover + 0.5) * bw, 90), Math.max(90, width - 90));
  return (
    <div className="bf-in-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
          {ticks.map((t, ti) => (
            <g key={ti}>
              <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} className={t === 0 && !fit ? 'bf-in-zero' : 'bf-in-grid'} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="bf-in-axis">{short(Math.round(t))}</text>
            </g>
          ))}
          {xl.map(i => <text key={i} x={L + (i + 0.5) * bw} y={height - 6} textAnchor="middle" className="bf-in-axis">{bucketLabel(d, i)}</text>)}
          {hover != null && <rect x={L + hover * bw} y={T} width={bw} height={ph} className="bf-in-hover" />}
          {bars.map(s => {
            const slot = s.sign === -1 ? Math.max(0, pos.findIndex(p => p.key === s.pair)) : pos.indexOf(s);
            return s.values.map((v, i) => {
              if (!v) return null;
              const val = v * (s.sign || 1), y0 = y(0), y1 = y(val);
              return <rect key={`${s.key}${i}`} x={L + i * bw + (bw - group) / 2 + slot * inner} y={Math.min(y0, y1)} width={Math.max(1, inner - (pos.length > 1 ? 1 : 0))} height={Math.max(1, Math.abs(y1 - y0))} fill={s.color} />;
            });
          })}
          {series.filter(s => s.type !== 'bar').map(s => {
            const pts = s.values.map((v, i) => [L + (i + 0.5) * bw, y(v * (s.sign || 1))]);
            const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
            return (
              <g key={s.key}>
                {s.type === 'area' && <path d={`${line}L${pts.at(-1)[0].toFixed(1)},${y(Math.max(0, low))}L${pts[0][0].toFixed(1)},${y(Math.max(0, low))}Z`} fill={s.color} opacity=".16" />}
                <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                {n <= 31 && pts.map((p, i) => <rect key={i} x={p[0] - 2} y={p[1] - 2} width="4" height="4" fill={s.color} />)}
                {hover != null && <rect x={pts[hover][0] - 3.5} y={pts[hover][1] - 3.5} width="7" height="7" fill={s.color} stroke="var(--bg, #0b0b0c)" strokeWidth="1.5" />}
              </g>
            );
          })}
        </svg>
      )}
      {empty && width > 0 && <div className="bf-in-empty">Nothing in this range yet.</div>}
      {hover != null && (
        <div className="bf-in-tip" style={{ left: tipLeft }}>
          <b>{bucketLabel(d, hover, true)}</b>
          {series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}<em>{fmt(s.values[hover])}</em></span>)}
        </div>
      )}
    </div>
  );
}

function Legend({ items }) {
  return <div className="bf-in-legend">{items.map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>;
}

// a tiny line for the top channels table
function Spark({ values, color }) {
  const w = 96, h = 24, max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => `${n === 1 ? w / 2 : ((i / (n - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return <svg className="bf-in-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function Delta({ now, prev, range }) {
  const p = pctChange(now, prev);
  if (p === null) return <small className="bf-in-delta up"><TrendingUp size={12} /> new vs prior {range}</small>;
  const I = p > 0 ? TrendingUp : p < 0 ? TrendingDown : Minus;
  return <small className={`bf-in-delta ${p > 0 ? 'up' : p < 0 ? 'down' : ''}`}><I size={12} /> {p > 0 ? '+' : ''}{p}% vs prior {range}</small>;
}

function Heatmap({ heat }) {
  const [tip, setTip] = useState(null);
  const rows = mondayFirst(heat);
  const max = Math.max(1, ...rows.flatMap(r => r.hours));
  const hourName = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  return (
    <div className="bf-in-heat-wrap" onPointerLeave={() => setTip(null)}>
      <div className="bf-in-heat" role="img" aria-label="Messages by weekday and hour">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="bf-in-heat-h">{h % 6 === 0 ? hourName(h) : ''}</span>)}
        {rows.map(r => [
          <span key={`d${r.day}`} className="bf-in-heat-d">{DAYS[r.day]}</span>,
          ...r.hours.map((v, h) => (
            <i key={`${r.day}-${h}`} style={{ '--a': v ? 0.12 + 0.88 * (v / max) : 0 }} className={v ? '' : 'zero'}
              onPointerEnter={() => setTip({ day: r.day, h, v })} onPointerDown={() => setTip({ day: r.day, h, v })} />
          )),
        ])}
      </div>
      <div className="bf-in-heat-foot">
        <small className="vc-hint">{tip ? <><b>{DAYS[tip.day]} {hourName(tip.h)} - {hourName((tip.h + 1) % 24)}</b>: {fmt(tip.v)} message{tip.v === 1 ? '' : 's'}</> : 'Your local time. Point at a square for its count.'}</small>
        <span className="bf-in-heat-scale"><small>Less</small>{[0.12, 0.4, 0.7, 1].map(a => <i key={a} style={{ '--a': a }} />)}<small>More</small></span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bf-in-skel" aria-busy="true" aria-label="Loading insights">
      <div className="bf-in-tiles">{[0, 1, 2, 3].map(i => <div key={i} className="bf-in-skel-tile" />)}</div>
      {[0, 1, 2].map(i => <div key={i} className="bf-in-skel-card"><i /><b /></div>)}
    </div>
  );
}

export function InsightsPage({ sid }) {
  const [range, setRange] = useState(() => { try { return localStorage.getItem('bf_insights_range') || '7d'; } catch { return '7d'; } });
  const [bots, setBots] = useState(false);
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    setD(null); setFailed(false);
    try { localStorage.setItem('bf_insights_range', range); } catch { /* private window */ }
    apiFetch(`/chat/servers/${sid}/insights?range=${range}&bots=${bots ? 1 : 0}&tz=${new Date().getTimezoneOffset()}`)
      .then(v => { if (!off) setD(v); })
      .catch(e => { if (!off) { setFailed(true); if (!/not_found|404/.test(String(e.message))) toast(errorText(e.message)); } });
    return () => { off = true; };
  }, [sid, range, bots]);
  const rangeWord = RANGES.find(r => r[0] === range)?.[1] || range;
  const prevWord = range; // "vs previous 7d"

  const controls = (
    <div className="bf-in-bar">
      <div className="bf-in-seg" role="tablist" aria-label="Range">
        {RANGES.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{label}</button>)}
      </div>
      <label className="bf-in-bots">
        <Bot size={14} /> Include bots
        <button type="button" role="switch" aria-checked={bots} aria-label="Include bots in message counts" className={`cs-switch${bots ? ' on' : ''}`} onClick={() => setBots(b => !b)}><i /></button>
      </label>
    </div>
  );
  if (failed) return <div className="bf-ss-page">{controls}<Card title="Insights" icon={ChartLine}><p className="vc-hint">Insights need a newer version of this server.</p></Card></div>;
  if (!d) return <div className="bf-ss-page">{controls}<Skeleton /></div>;

  const m = d.members;
  const tiles = [
    [Users, 'Members now', m.now, m.at_start, C.members],
    [UserPlus, `Joins`, m.joins_total, m.prev_joins, C.join],
    [MessageSquare, 'Messages', d.messages.total, d.messages.prev, C.messages],
    [MessagesSquare, 'Unique chatters', d.chatters.total, d.chatters.prev, C.chatters],
  ];
  const since = m.leaves_since ? new Date(m.leaves_since).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const chMax = Math.max(1, ...d.top_channels.map(x => x.messages));
  const uMax = Math.max(1, ...d.top_chatters.map(x => x.messages));
  return (
    <div className="bf-ss-page bf-in">
      {controls}
      <div className="bf-in-tiles">
        {tiles.map(([I, label, now, prev, color]) => (
          <div key={label} className="bf-in-tile" style={{ '--c': color }}>
            <span><I size={14} /> {label}</span>
            <b>{fmt(now)}</b>
            <Delta now={now} prev={prev} range={prevWord} />
          </div>
        ))}
      </div>
      <div className="bf-in-active">
        <span><small>Active today</small><b>{fmt(d.chatters.dau)}</b></span>
        <span><small>Active this week</small><b>{fmt(d.chatters.wau)}</b></span>
        <span><small>Active this month</small><b>{fmt(d.chatters.mau)}</b></span>
        <span><small>Reactions</small><b>{fmt(d.reactions.total)}</b></span>
      </div>

      <Card title="Joins and leaves" icon={UserPlus}>
        <Legend items={[['Joins', C.join], ['Leaves', C.leave], ['Net growth', C.net]]} />
        <Chart d={d} ariaLabel="Joins and leaves" series={[
          { key: 'j', label: 'Joins', color: C.join, values: m.joins, type: 'bar' },
          { key: 'l', label: 'Leaves', color: C.leave, values: m.leaves, type: 'bar', sign: -1, pair: 'j' },
          { key: 'n', label: 'Net growth', color: C.net, values: m.net, type: 'line' },
        ]} />
        {since && <small className="vc-hint">Leave history starts {since}, when this server started recording it. Joins before that come from members who are still here.</small>}
      </Card>

      <Card title="Members" icon={Users}>
        <Chart d={d} ariaLabel="Member count" height={150} fit series={[{ key: 'm', label: 'Members', color: C.members, values: m.series, type: 'area' }]} />
        <small className="vc-hint">People only, at the end of each {d.step_ms < 86400000 ? 'hour' : 'day'}. Worked back from today's count, so it's only as complete as the join and leave history.</small>
      </Card>

      <Card title="Messages" icon={MessageSquare}>
        <Chart d={d} ariaLabel="Messages" series={[{ key: 'msg', label: bots ? 'Messages (incl. bots)' : 'Messages', color: C.messages, values: d.messages.series, type: 'bar' }]} />
        <small className="vc-hint">{bots ? 'Bots and webhooks included.' : 'People only: bots and webhooks are left out.'} System notices never count.</small>
      </Card>

      <Card title="Unique chatters" icon={MessagesSquare}>
        <Chart d={d} ariaLabel="Unique chatters" series={[{ key: 'u', label: 'Chatters', color: C.chatters, values: d.chatters.series, type: 'area' }]} />
        <small className="vc-hint">Different people who sent at least one message. Bots never count here.</small>
      </Card>

      <Card title="Reactions" icon={SmilePlus}>
        <Chart d={d} ariaLabel="Reactions" height={130} series={[{ key: 'r', label: 'Reactions', color: C.reactions, values: d.reactions.series, type: 'bar' }]} />
      </Card>

      <Card title="Busiest hours" icon={CalendarClock}>
        <Heatmap heat={d.heatmap} />
      </Card>

      <Card title="Top channels" icon={Hash}>
        {!d.top_channels.length ? <p className="vc-hint">No messages in the last {rangeWord}.</p> : (
          <table className="bf-in-table">
            <thead><tr><th>Channel</th><th className="num">Messages</th><th className="num">Share</th><th className="spark">Trend</th></tr></thead>
            <tbody>
              {d.top_channels.map(x => (
                <tr key={x.cid || x.name}>
                  <td><span className="bf-in-name"><Hash size={13} />{x.name}</span><span className="bf-sr-bar bf-in-mini"><i style={{ width: `${Math.max(2, (x.messages / chMax) * 100)}%`, background: C.messages }} /></span></td>
                  <td className="num">{fmt(x.messages)}</td>
                  <td className="num">{d.messages.total ? Math.round((x.messages / d.messages.total) * 100) : 0}%</td>
                  <td className="spark"><Spark values={x.spark} color={C.messages} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Top chatters" icon={Trophy}>
        {!d.top_chatters.length ? <p className="vc-hint">Nobody has chatted in the last {rangeWord}.</p> : (
          <ol className="bf-in-people">
            {d.top_chatters.map((u, i) => (
              <li key={u.id}>
                <span className="bf-in-rank">{i + 1}</span>
                <Avatar user={{ username: u.username, display_name: u.display_name, pfp: u.pfp }} size={26} />
                <span className="bf-in-who"><b>{u.display_name}</b>{u.bot && <em className="bf-in-tag">bot</em>}<small>@{u.username}</small></span>
                <span className="bf-sr-bar bf-in-mini"><i style={{ width: `${Math.max(2, (u.messages / uMax) * 100)}%`, background: C.chatters }} /></span>
                <b className="bf-in-count">{fmt(u.messages)}</b>
              </li>
            ))}
          </ol>
        )}
        <small className="vc-hint">Only people who manage this server can see this list.</small>
      </Card>

      <Card title="Voice" icon={Mic}>
        <p className="vc-hint">Voice activity isn't recorded by this server yet, so there's nothing to chart here.</p>
      </Card>
    </div>
  );
}
