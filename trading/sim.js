'use strict';
// Day-trading simulator. Account is in SAR, US stocks trade in USD, converted at the 3.75 peg.
// Replay mode: real historical intraday bars (Alpha Vantage), replayed tick by tick.
// Live mode: real-time trades (Finnhub websocket), aggregated into 1-minute candles.
// All chart times are New York time stored as fake-UTC seconds, so the chart reads in market time.

const RATE = 3.75, START_SAR = 10000, LS = 'daytrade-sim-v1', CACHE = 'daytrade-av:';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ---------- persisted state ----------
function fresh() {
  return { cash: START_SAR, log: [], settings: { lev: 1, comm: 0, slip: 0.01 }, keys: { av: '', fh: '' }, session: null };
}
let S = (() => {
  try { const s = JSON.parse(localStorage.getItem(LS)); if (s && typeof s.cash === 'number') return Object.assign(fresh(), s); } catch (e) {}
  return fresh();
})();
function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} }

// ---------- trading session (one symbol at a time) ----------
let ses = S.session || null; // {mode, sym, pos:{qty,avg}, orders:[], lastPrice, dayStartEquity, markers:[], replay:{month,interval,day,i}}
let price = ses ? ses.lastPrice : 0;
let barTime = 0;
let orderSeq = 1;

const usd = (n, d) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
const sar = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' SAR';
const signed = n => (n > 0 ? '+' : '') + sar(n);
const cls = n => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const round = p => (p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000);
const nyTime = t => new Date(t * 1000).toISOString().slice(11, 16);
const nyDate = t => new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function equity() { return S.cash + (ses ? ses.pos.qty * price * RATE : 0); }
function posValueSAR(qty, px) { return Math.abs(qty) * px * RATE; }

function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

// ---------- chart ----------
const chart = LightweightCharts.createChart($('#chart'), {
  autoSize: true,
  layout: { background: { color: 'transparent' }, textColor: '#8b98a8' },
  grid: { vertLines: { color: '#1a2230' }, horzLines: { color: '#1a2230' } },
  rightPriceScale: { borderColor: '#243040' },
  timeScale: { borderColor: '#243040', timeVisible: true, secondsVisible: false, rightOffset: 6 },
  crosshair: { mode: 0 },
});
const candles = chart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', borderVisible: false });
const vols = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
vols.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
const volBar = b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)' });
let priceLines = [];

function chartMsg(html) { $('#chart-msg').innerHTML = html ? `<div>${html}</div>` : ''; }

function drawLines() {
  priceLines.forEach(l => candles.removePriceLine(l));
  priceLines = [];
  if (!ses) return;
  if (ses.pos.qty) priceLines.push(candles.createPriceLine({ price: ses.pos.avg, color: '#3b82f6', lineWidth: 1, lineStyle: 2, title: `avg ${ses.pos.qty > 0 ? 'L' : 'S'} ${Math.abs(ses.pos.qty)}` }));
  for (const o of ses.orders) {
    priceLines.push(candles.createPriceLine({ price: o.price, color: o.tag === 'SL' ? '#ef4444' : o.tag === 'TP' ? '#22c55e' : '#f59e0b', lineWidth: 1, lineStyle: 1, title: `${o.tag || o.type} ${o.side} ${o.qty}` }));
  }
}

// ---------- order engine ----------
function maxQty(side, px) {
  if (!ses || !px) return 0;
  const cap = Math.floor(Math.max(0, equity()) * S.settings.lev / (px * RATE));
  return Math.max(0, side === 'buy' ? cap - ses.pos.qty : cap + ses.pos.qty);
}

function fill(side, qty, px, why) {
  const p = ses.pos, dq = side === 'buy' ? qty : -qty;
  const comm = S.settings.comm * RATE;
  let realized = 0;
  if (p.qty && Math.sign(dq) !== Math.sign(p.qty)) {
    const closing = Math.min(Math.abs(dq), Math.abs(p.qty));
    realized = closing * (px - p.avg) * Math.sign(p.qty) * RATE;
  }
  const nq = p.qty + dq;
  if (nq === 0) p.avg = 0;
  else if (!p.qty || Math.sign(nq) !== Math.sign(p.qty)) p.avg = px;           // opened or flipped
  else if (Math.sign(dq) === Math.sign(p.qty)) p.avg = (p.qty * p.avg + dq * px) / nq; // added
  p.qty = nq;
  S.cash -= dq * px * RATE + comm;
  S.log.unshift({ t: barTime, sym: ses.sym, side, qty, px, realized: realized - comm, closing: realized !== 0, why });
  if (S.log.length > 500) S.log.length = 500;
  ses.markers.push({ time: barTime, position: side === 'buy' ? 'belowBar' : 'aboveBar', color: side === 'buy' ? '#22c55e' : '#ef4444', shape: side === 'buy' ? 'arrowUp' : 'arrowDown', text: `${side === 'buy' ? 'B' : 'S'} ${qty}` });
  candles.setMarkers(ses.markers);
  if (p.qty === 0) ses.orders = ses.orders.filter(o => !o.exit); // brackets die with the position
  toast(`${why ? why + ': ' : ''}${side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${ses.sym} @ ${usd(px)}${realized ? ` · ${signed(realized - comm)}` : ''}`);
  persist(); render(); drawLines();
}

function marketPx(side) {
  const slip = S.settings.slip;
  return round(side === 'buy' ? price + slip : Math.max(0.0001, price - slip));
}

function submit(o) {
  if (!ses || !price) return toast('Load a chart first');
  o.qty = Math.floor(o.qty);
  if (!(o.qty > 0)) return toast('Enter a share quantity');
  if (o.type === 'market') {
    if (!running()) return toast(ses.mode === 'live' ? 'Not connected' : 'Replay is not running — press ▶ or load a day');
    const px = marketPx(o.side);
    if (o.qty > maxQty(o.side, px)) return toast(`Not enough buying power (max ${maxQty(o.side, px)} shares)`);
    fill(o.side, o.qty, px);
    addBracket(o);
  } else {
    if (!(o.price > 0)) return toast('Enter an order price');
    ses.orders.push({ id: orderSeq++, side: o.side, type: o.type, qty: o.qty, price: round(o.price), sl: o.sl, tp: o.tp });
    toast(`${o.type} ${o.side} ${o.qty} @ ${usd(o.price)} placed`);
    persist(); render(); drawLines();
  }
}

function addBracket(o) {
  const exitSide = o.side === 'buy' ? 'sell' : 'buy', oco = orderSeq++;
  if (o.sl > 0) ses.orders.push({ id: orderSeq++, side: exitSide, type: 'stop', qty: o.qty, price: round(o.sl), exit: true, oco, tag: 'SL' });
  if (o.tp > 0) ses.orders.push({ id: orderSeq++, side: exitSide, type: 'limit', qty: o.qty, price: round(o.tp), exit: true, oco, tag: 'TP' });
  if (o.sl > 0 || o.tp > 0) { persist(); render(); drawLines(); }
}

function checkOrders() {
  if (!ses) return;
  for (const o of ses.orders.slice()) {
    if (!ses.orders.includes(o)) continue;
    const hit = o.type === 'limit' ? (o.side === 'buy' ? price <= o.price : price >= o.price)
                                   : (o.side === 'buy' ? price >= o.price : price <= o.price);
    if (!hit) continue;
    ses.orders = ses.orders.filter(x => x !== o && !(o.oco && x.oco === o.oco));
    // Limits fill at the limit or better; stops become market orders and can slip past the stop on a gap.
    const px = o.type === 'limit' ? round(o.side === 'buy' ? Math.min(o.price, price) : Math.max(o.price, price)) : marketPx(o.side);
    let qty = o.qty;
    if (o.exit) {
      const p = ses.pos.qty;
      if (!p || (o.side === 'sell') !== (p > 0)) { persist(); render(); drawLines(); continue; }
      qty = Math.min(qty, Math.abs(p));
    } else if (qty > maxQty(o.side, px)) {
      toast(`Order #${o.id} rejected: not enough buying power`); persist(); render(); drawLines(); continue;
    }
    fill(o.side, qty, px, o.tag === 'SL' ? 'Stop-loss' : o.tag === 'TP' ? 'Take-profit' : `${o.type} #${o.id}`);
    addBracket(o);
  }
}

function cancelOrder(id) { ses.orders = ses.orders.filter(o => o.id !== id); persist(); render(); drawLines(); }

function flatten(why) {
  if (!ses || !ses.pos.qty || !price) return;
  const side = ses.pos.qty > 0 ? 'sell' : 'buy';
  fill(side, Math.abs(ses.pos.qty), marketPx(side), why);
}

function onTick(p) {
  price = p;
  if (ses) ses.lastPrice = p;
  checkOrders();
  render();
}

// ---------- session lifecycle ----------
function newSession(mode, sym, replay) {
  ses = { mode, sym, pos: { qty: 0, avg: 0 }, orders: [], lastPrice: 0, dayStartEquity: S.cash, markers: [], replay: replay || null };
  price = 0; barTime = 0;
  candles.setData([]); vols.setData([]); candles.setMarkers([]);
  persist(); drawLines(); render();
}

// Leaving a symbol/day/mode with an open position: close it at the last price, as a broker would at your request.
function confirmLeave() {
  if (!ses || (!ses.pos.qty && !ses.orders.length)) return true;
  if (!confirm('You have an open position or orders. Close everything at the current price and continue?')) return false;
  ses.orders = [];
  flatten('Closed');
  return true;
}

let lastPersist = 0;
function persist(force) {
  S.session = ses;
  const now = Date.now();
  if (force !== false || now - lastPersist > 2000) { lastPersist = now; save(); }
}

// ---------- replay (Alpha Vantage) ----------
const R = { bars: [], days: [], dayIdx: -1, i: 0, step: 0, path: [], playing: false, timer: 0, barSec: 60, ctxLen: 0 };
const STEPS = 12;

function monthOptions() {
  const sel = $('#month'), d = new Date();
  for (let k = 0; k < 24; k++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    const v = m.toISOString().slice(0, 7);
    sel.add(new Option(m.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }), v));
  }
}

function cacheGet(key, month) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE + key));
    const current = month === new Date().toISOString().slice(0, 7);
    if (c && (!current || Date.now() - c.ts < 3 * 3600e3)) return c.bars;
  } catch (e) {}
  return null;
}
function cachePut(key, bars) {
  const val = JSON.stringify({ ts: Date.now(), bars });
  for (let tries = 0; tries < 2; tries++) {
    try { localStorage.setItem(CACHE + key, val); return; } catch (e) {
      Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); // full: drop old cached months
    }
  }
}

async function fetchBars(sym, month, interval, demo) {
  const key = `${sym}:${month}:${interval}`;
  const hit = cacheGet(key, month);
  if (hit) return hit;
  const url = demo
    ? 'https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&month=2009-01&outputsize=full&apikey=demo'
    : `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(sym)}&interval=${interval}&month=${month}&outputsize=full&extended_hours=false&apikey=${encodeURIComponent(S.keys.av)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Data request failed (${r.status})`);
  const j = await r.json();
  const series = j[`Time Series (${interval})`];
  if (!series) throw new Error(j['Error Message'] ? `Alpha Vantage: unknown symbol or month (${sym} ${month})` : (j.Note || j.Information || 'No data returned'));
  const bars = Object.entries(series).map(([ts, v]) => [
    Date.parse(ts.replace(' ', 'T') + 'Z') / 1000, +v['1. open'], +v['2. high'], +v['3. low'], +v['4. close'], +v['5. volume'],
  ]).filter(b => { const m = (b[0] % 86400) / 60; return m >= 570 && m < 960; }) // regular session 9:30–16:00
    .sort((a, b) => a[0] - b[0]);
  if (!bars.length) throw new Error('No regular-session bars in that month');
  cachePut(key, bars);
  return bars;
}

async function loadReplay(demo, resume) {
  const sym = demo ? 'IBM' : $('#sym').value.trim().toUpperCase();
  const month = demo ? '2009-01' : $('#month').value;
  const interval = demo ? '5min' : $('#interval').value;
  if (!sym) return toast('Enter a symbol');
  if (!demo && !S.keys.av && !resume) { openSettings(); return toast('Add a free Alpha Vantage key first (or try the IBM demo)', 4000); }
  if (!resume && !confirmLeave()) return;
  pause();
  chartMsg(`Loading ${sym} ${month}…`);
  try {
    R.bars = await fetchBars(sym, month, interval, demo);
  } catch (e) {
    chartMsg(''); toast(e.message, 6000);
    if (resume) { ses.replay = null; flatten('Closed (data unavailable)'); }
    return;
  }
  chartMsg('');
  R.barSec = interval === '5min' ? 300 : 60;
  R.days = [...new Set(R.bars.map(b => Math.floor(b[0] / 86400)))];
  const daySel = $('#day'); daySel.innerHTML = '';
  R.days.slice().reverse().forEach(d => daySel.add(new Option(nyDate(d * 86400), d)));
  daySel.disabled = false; $('#btn-random').disabled = false;
  $('#sym').value = sym;
  if (![...$('#month').options].some(o => o.value === month)) $('#month').add(new Option(month, month));
  $('#month').value = month; $('#interval').value = interval;
  if (resume) {
    daySel.value = ses.replay.day;
    startDay(+ses.replay.day, ses.replay.i);
  } else {
    newSession('replay', sym, { month, interval, demo: !!demo, day: 0, i: 0 });
    startDay(R.days[R.days.length - 1]);
  }
}

function startDay(day, resumeAt) {
  pause();
  const di = R.days.indexOf(day);
  R.dayIdx = di;
  const prev = di > 0 ? R.days[di - 1] : null;
  const ctx = prev == null ? [] : R.bars.filter(b => Math.floor(b[0] / 86400) === prev);
  R.day = R.bars.filter(b => Math.floor(b[0] / 86400) === day);
  R.ctxLen = ctx.length;
  R.prevClose = ctx.length ? ctx[ctx.length - 1][4] : R.day[0][1];
  const toBar = b => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });
  R.shown = ctx.map(toBar);
  R.i = 0; R.step = 0;
  if (resumeAt) { for (; R.i < resumeAt && R.i < R.day.length; R.i++) R.shown.push(toBar(R.day[R.i])); }
  else {
    ses.markers = [];
    ses.dayStartEquity = equity();
  }
  ses.replay.day = day; ses.replay.i = R.i;
  candles.setData(R.shown); vols.setData(R.shown.map(volBar));
  candles.setMarkers(ses.markers.filter(m => m.time >= (R.shown[0] ? R.shown[0].time : 0)));
  const last = R.shown[R.shown.length - 1];
  if (last) { price = last.close; barTime = last.time; }
  else { price = R.day[0][1]; barTime = R.day[0][0]; }
  ses.lastPrice = price;
  chart.timeScale().scrollToRealTime();
  $('#btn-play').disabled = false; $('#btn-step').disabled = false;
  $('#day').value = day;
  persist(); drawLines(); render();
  if (!resumeAt) chartMsg(`<b>${ses.sym} · ${nyDate(day * 86400)}</b><br>${ctx.length ? 'Previous session shown for context. ' : ''}Press ▶ to ring the opening bell.`);
}

// Intrabar path: open → nearer extreme → other extreme → close, so stops and limits trigger in a plausible order.
function barPath(b) {
  const [, o, h, l, c] = b;
  const pts = Math.abs(o - h) < Math.abs(o - l) ? [o, h, l, c] : [o, l, h, c];
  const out = [];
  for (let s = 1; s <= STEPS; s++) {
    const x = s / STEPS * 3, seg = Math.min(2, Math.floor(x)), f = x - seg;
    out.push(round(pts[seg] + (pts[seg + 1] - pts[seg]) * f));
  }
  return out;
}

function replayTick() {
  if (R.i >= R.day.length) return endOfDay();
  const b = R.day[R.i];
  if (R.step === 0) { R.path = barPath(b); R.forming = { time: b[0], open: b[1], high: b[1], low: b[1], close: b[1], volume: 0 }; barTime = b[0]; }
  const p = R.path[R.step], f = R.forming;
  f.high = Math.max(f.high, p); f.low = Math.min(f.low, p); f.close = p; f.volume = Math.round(b[5] * (R.step + 1) / STEPS);
  R.step++;
  if (R.step === STEPS) { // snap to the real bar so the finished candle is exact
    Object.assign(f, { open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });
    R.shown.push(f); R.i++; R.step = 0;
    ses.replay.i = R.i;
    persist(false);
  }
  candles.update(f); vols.update(volBar(f));
  onTick(f.close);
}

function schedule() {
  clearTimeout(R.timer);
  if (!R.playing) return;
  const ms = Math.max(16, R.barSec * 1000 / +$('#speed').value / STEPS);
  R.timer = setTimeout(() => { replayTick(); schedule(); }, ms);
}
function play() {
  if (R.i >= (R.day || []).length) return;
  chartMsg(''); R.playing = true; $('#btn-play').textContent = '⏸'; schedule();
}
function pause() { R.playing = false; clearTimeout(R.timer); $('#btn-play').textContent = '▶'; }
function stepBar() { chartMsg(''); const i = R.i; while (R.i === i && R.i < R.day.length) replayTick(); if (R.i >= R.day.length) endOfDay(); }

function endOfDay() {
  pause();
  ses.orders = [];
  flatten('Market close');
  const pnl = equity() - ses.dayStartEquity;
  chartMsg(`<b>Closing bell</b><br>Day result: <span class="${cls(pnl)}">${signed(pnl)}</span><br>Positions are closed at 16:00. Pick another day to keep practicing.`);
  $('#btn-play').disabled = true; $('#btn-step').disabled = true;
  persist(); render(); drawLines();
}

function running() {
  if (!ses) return false;
  if (ses.mode === 'replay') return R.day && R.i < R.day.length && (R.i > 0 || R.step > 0);
  return L.ws && L.ws.readyState === 1 || L.polling;
}

// ---------- live (Finnhub) ----------
const L = { ws: null, poll: 0, polling: false, bar: null, lastTrade: 0, prevClose: 0 };
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function nySec(ms) {
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
}
function marketOpen() {
  const t = nySec(Date.now()), dow = new Date(t * 1000).getUTCDay(), m = (t % 86400) / 60;
  return dow > 0 && dow < 6 && m >= 570 && m < 960;
}

function liveDisconnect() {
  if (L.ws) { L.ws.onclose = null; L.ws.close(); }
  L.ws = null; clearInterval(L.poll); L.polling = false;
  $('#btn-connect').textContent = 'Connect';
}

async function liveConnect() {
  if (L.ws || L.polling) { liveDisconnect(); $('#live-status').textContent = 'Disconnected'; return; }
  const key = S.keys.fh;
  if (!key) { openSettings(); return toast('Add a free Finnhub key first', 4000); }
  const sym = $('#sym').value.trim().toUpperCase();
  if (!sym) return toast('Enter a symbol');
  const resume = ses && ses.mode === 'live' && ses.sym === sym;
  if (!resume && !confirmLeave()) return;
  let q;
  try {
    q = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`)).json();
  } catch (e) { return toast('Could not reach Finnhub — check your key/connection', 5000); }
  if (!q || !q.c) return toast(q && q.error ? `Finnhub: ${q.error}` : `No quote for ${sym}`, 5000);
  if (!resume) newSession('live', sym);
  const today = Math.floor(nySec(Date.now()) / 86400);
  if (ses.liveDay !== today) { ses.liveDay = today; ses.dayStartEquity = S.cash + ses.pos.qty * q.c * RATE; }
  ses.markers = []; // the chart restarts empty, so old markers have no bars to sit on
  L.prevClose = q.pc; L.bar = null;
  candles.setData([]); vols.setData([]); candles.setMarkers([]);
  liveTrade(q.c, 0, q.t ? q.t * 1000 : Date.now());
  L.polling = true; // quote polling keeps the price honest even if the socket goes quiet
  L.poll = setInterval(pollQuote, 15000);
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
  L.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.type === 'trade') for (const tr of m.data) if (tr.s === sym) liveTrade(tr.p, tr.v, tr.t);
  };
  ws.onclose = () => { L.ws = null; $('#live-status').textContent = 'Socket closed — using 15s quotes'; };
  $('#btn-connect').textContent = 'Disconnect';
  $('#live-status').textContent = marketOpen() ? 'Streaming real-time trades' : 'US market is closed — price will barely move. Use Replay to practice now.';
  if (!marketOpen()) chartMsg('US market is closed right now (open 9:30–16:00 New York, i.e. 16:30–23:00 Riyadh in summer, 17:30–00:00 in winter).<br>Use <b>Replay</b> to trade a real past day.');
  persist(); render();
}

async function pollQuote() {
  if (!ses || ses.mode !== 'live') return;
  if (Date.now() - L.lastTrade < 15000) return;
  try {
    const q = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ses.sym)}&token=${encodeURIComponent(S.keys.fh)}`)).json();
    if (q && q.c && q.c !== price) liveTrade(q.c, 0, Date.now(), true);
  } catch (e) {}
}

let liveRaf = 0;
function liveTrade(p, v, ms, fromPoll) {
  if (!fromPoll) L.lastTrade = Date.now();
  const t = nySec(ms), minute = t - t % 60;
  if (!L.bar || minute > L.bar.time) L.bar = { time: minute, open: p, high: p, low: p, close: p, volume: 0 };
  else if (minute < L.bar.time) return; // late print
  const b = L.bar;
  b.high = Math.max(b.high, p); b.low = Math.min(b.low, p); b.close = p; b.volume += v || 0;
  barTime = minute; price = p; ses.lastPrice = p;
  checkOrders();
  if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; candles.update({ ...L.bar }); vols.update(volBar(L.bar)); render(); persist(false); });
}

// ---------- rendering ----------
function render() {
  const eq = equity();
  $('#st-equity').textContent = sar(eq);
  $('#st-cash').textContent = sar(S.cash);
  const day = ses ? eq - ses.dayStartEquity : 0;
  $('#st-day').textContent = signed(day); $('#st-day').className = cls(day);
  const tot = eq - START_SAR;
  $('#st-total').textContent = signed(tot); $('#st-total').className = cls(tot);

  $('#q-sym').textContent = ses ? ses.sym : '—';
  $('#q-price').textContent = price ? usd(price) : '—';
  const ref = ses && (ses.mode === 'replay' ? R.prevClose : L.prevClose);
  if (price && ref) {
    const ch = price - ref;
    $('#q-chg').textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)} (${(ch / ref * 100).toFixed(2)}%)`;
    $('#q-chg').className = cls(ch);
  } else $('#q-chg').textContent = '';
  $('#q-time').textContent = barTime ? `${nyDate(barTime)} · ${nyTime(barTime)} NY` : '';

  // position
  const pos = $('#pos');
  if (ses && ses.pos.qty) {
    const p = ses.pos, upnl = p.qty * (price - p.avg) * RATE;
    pos.className = '';
    pos.innerHTML = `<span>${p.qty > 0 ? 'Long' : 'Short'}</span><span>${Math.abs(p.qty)} ${ses.sym}</span>
      <span>Avg price</span><span>${usd(p.avg)}</span>
      <span>Value</span><span>${sar(posValueSAR(p.qty, price))}</span>
      <span>Unrealized</span><span class="${cls(upnl)}">${signed(upnl)}</span>`;
    $('#btn-flat').hidden = false;
  } else { pos.className = 'muted'; pos.textContent = 'Flat'; $('#btn-flat').hidden = true; }

  // orders (rebuild only when the set changes)
  const sig = ses ? ses.orders.map(o => o.id).join(',') : '';
  if (render.sig !== sig) {
    render.sig = sig;
    const ul = $('#orders');
    ul.innerHTML = ses && ses.orders.length ? '' : '<li class="muted">None</li>';
    if (ses) for (const o of ses.orders) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="${o.side === 'buy' ? 'up' : 'down'}">${o.tag || o.type} ${o.side} ${o.qty} @ ${usd(o.price)}</span>`;
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Cancel'; x.onclick = () => cancelOrder(o.id);
      li.append(x); ul.append(li);
    }
  }

  updateEstimate();
  if (render.logLen !== S.log.length || render.logHead !== S.log[0]) renderLog();
}

function renderLog() {
  render.logLen = S.log.length; render.logHead = S.log[0];
  $('#log').innerHTML = S.log.slice(0, 200).map(f => `<tr>
    <td>${f.t ? new Date(f.t * 1000).toISOString().slice(5, 16).replace('T', ' ') : ''}</td><td>${f.sym}</td>
    <td class="${f.side === 'buy' ? 'up' : 'down'}">${f.side}${f.why ? ` <span class="muted">(${f.why})</span>` : ''}</td>
    <td>${f.qty}</td><td>${usd(f.px)}</td>
    <td class="${f.closing ? cls(f.realized) : 'muted'}">${f.closing ? signed(f.realized) : '—'}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">No trades yet.</td></tr>';
  const closes = S.log.filter(f => f.closing);
  if (closes.length) {
    const wins = closes.filter(f => f.realized > 0), losses = closes.filter(f => f.realized <= 0);
    const sum = a => a.reduce((s, f) => s + f.realized, 0);
    const avgW = wins.length ? sum(wins) / wins.length : 0, avgL = losses.length ? sum(losses) / losses.length : 0;
    $('#perf').innerHTML = `${closes.length} closing trades · win rate ${(wins.length / closes.length * 100).toFixed(0)}% · avg win <span class="up">${sar(avgW)}</span> · avg loss <span class="down">${sar(avgL)}</span> · realized <span class="${cls(sum(closes))}">${signed(sum(closes))}</span>`;
  } else $('#perf').textContent = '';
}

// ---------- ticket ----------
let side = 'buy';
function setSide(s) {
  side = s;
  $$('#side button').forEach(b => b.classList.toggle('on', b.dataset.side === s));
  const btn = $('#btn-submit'); btn.className = `submit ${s}`;
  btn.textContent = s === 'buy' ? (ses && ses.pos.qty < 0 ? 'Buy / Cover' : 'Buy') : (ses && ses.pos.qty > 0 ? 'Sell' : 'Sell / Short');
  updateEstimate();
}
function ticketOrder(sideOverride) {
  return {
    side: sideOverride || side, type: sideOverride ? 'market' : $('#otype').value, qty: +$('#oqty').value,
    price: +$('#opx').value, sl: +$('#osl').value || 0, tp: +$('#otp').value || 0,
  };
}
function updateEstimate() {
  const o = ticketOrder(), px = o.type === 'market' ? price : (o.price || price);
  if (!px || !(o.qty > 0)) { $('#est').textContent = ses ? `Max ${maxQty(side, price)} shares` : '—'; return; }
  $('#est').textContent = `≈ ${usd(o.qty * px)} = ${sar(o.qty * px * RATE)} · max ${maxQty(side, px)} shares`;
}

// ---------- settings ----------
function openSettings() {
  $('#k-av').value = S.keys.av; $('#k-fh').value = S.keys.fh;
  $('#s-lev').value = S.settings.lev; $('#s-comm').value = S.settings.comm; $('#s-slip').value = S.settings.slip;
  $('#settings').returnValue = '';
  $('#settings').showModal();
}
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'ok') return;
  S.keys.av = $('#k-av').value.trim(); S.keys.fh = $('#k-fh').value.trim();
  S.settings.lev = +$('#s-lev').value || 1;
  S.settings.comm = Math.max(0, +$('#s-comm').value || 0);
  S.settings.slip = Math.max(0, +$('#s-slip').value || 0);
  save(); render();
});
$('#btn-reset').onclick = () => {
  if (!confirm('Reset to 10,000 SAR and erase your trade log?')) return;
  const keys = S.keys, settings = S.settings;
  pause(); liveDisconnect();
  S = fresh(); S.keys = keys; S.settings = settings;
  ses = null; price = 0; barTime = 0;
  candles.setData([]); vols.setData([]); candles.setMarkers([]);
  $('#btn-play').disabled = true; $('#btn-step').disabled = true;
  save(); drawLines(); render(); renderLog();
  $('#settings').close();
  chartMsg('Account reset to 10,000 SAR. Load a day to start.');
};

// ---------- wiring ----------
function setMode(m) {
  if (ses && ses.mode !== m && !confirmLeave()) return false;
  $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#replay-ctl').hidden = m !== 'replay'; $('#live-ctl').hidden = m !== 'live';
  if (m === 'live') pause(); else liveDisconnect();
  chartMsg('');
  return true;
}
$$('#mode button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$$('#side button').forEach(b => b.onclick = () => setSide(b.dataset.side));
$('#otype').onchange = () => { $('#px-row').hidden = $('#otype').value === 'market'; if (!$('#opx').value && price) $('#opx').value = price; updateEstimate(); };
['#oqty', '#opx'].forEach(s => $(s).addEventListener('input', updateEstimate));
$$('.chips button').forEach(b => b.onclick = () => {
  const o = ticketOrder(), px = o.type === 'market' ? price : (o.price || price);
  $('#oqty').value = Math.max(0, Math.floor(maxQty(side, px) * +b.dataset.pct / 100)); updateEstimate();
});
$('#btn-submit').onclick = () => submit(ticketOrder());
$('#btn-flat').onclick = () => flatten('Closed');
$('#btn-settings').onclick = openSettings;
$('#btn-load').onclick = () => loadReplay(false);
$('#btn-demo').onclick = () => loadReplay(true);
$('#day').onchange = () => { if (confirmLeave()) startDay(+$('#day').value); else $('#day').value = ses.replay.day; };
$('#btn-random').onclick = () => { if (confirmLeave()) startDay(R.days[Math.floor(Math.random() * R.days.length)]); };
$('#btn-play').onclick = () => (R.playing ? pause() : play());
$('#btn-step').onclick = () => { pause(); stepBar(); };
$('#speed').onchange = schedule;
$('#btn-connect').onclick = liveConnect;
$('#sym').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#live-ctl').hidden ? loadReplay(false) : liveConnect()); });

document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'b') submit(ticketOrder('buy'));
  else if (k === 's') submit(ticketOrder('sell'));
  else if (k === 'f') flatten('Closed');
  else if (k === ' ' && !$('#btn-play').disabled) { e.preventDefault(); R.playing ? pause() : play(); }
});
setInterval(() => setSide(side), 1000); // keep Buy/Cover label in sync with the position

// ---------- boot ----------
monthOptions();
renderLog();
if (ses && ses.mode === 'replay' && ses.replay) {
  $('#month').value = ses.replay.month; $('#interval').value = ses.replay.interval; $('#sym').value = ses.sym;
  loadReplay(ses.replay.demo, true);
} else if (ses && ses.mode === 'live') {
  setMode('live'); $('#sym').value = ses.sym;
  chartMsg('Press <b>Connect</b> to resume live trading.');
} else {
  chartMsg(`<b>Practice day trading with real US market data.</b><br><br>
    You start with <b>10,000 SAR</b> (1 USD = 3.75 SAR).<br><br>
    <b>Replay</b>: trade a real past session, bar by bar, at any hour.<br>
    <b>Live</b>: trade real-time prices while the US market is open.<br><br>
    Add your free API keys in ⚙ Settings, or hit <b>Try IBM demo</b> now.`);
}
setSide('buy');
render();
