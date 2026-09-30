const KEY = 'daily-tasks-v1';
let toastTimer;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const RKEY = 'daily-tasks-rules-v1';
let data = load();
let rules = loadRules();     // [{id, text, freq:'daily'|'weekly'|'monthly', days:[0-6], start, last}]           // { "YYYY-MM-DD": [{id, text, done}] }
let current = iso(new Date());

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function loadRules() {
  try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch { return []; }
}
function saveRules() {
  try { localStorage.setItem(RKEY, JSON.stringify(rules)); } catch { toast('Could not save (storage blocked or full).'); }
}
function matches(r, ds) {
  const d = parse(ds);
  if (r.freq === 'daily') return true;
  if (r.freq === 'weekly') return r.days.includes(d.getDay());
  const sd = parse(r.start).getDate();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(sd, lastDay);   // day 31 falls on the month's last day
}
// Create recurring tasks for every day up to `upTo` once; deleting one later won't bring it back.
function materialize(upTo) {
  let changed = false;
  for (const r of rules) {
    let d = shift(r.last, 1), n = 0;
    while (d <= upTo && n++ < 1500) {
      if (matches(r, d)) {
        const list = (data[d] ||= []);
        if (!list.some(t => t.rid === r.id)) list.push({ id: uid(), text: r.text, done: false, rid: r.id });
        changed = true;
      }
      r.last = d;
      d = shift(d, 1);
    }
  }
  if (changed) { save(); saveRules(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { toast('Could not save (storage blocked or full).'); }
}
function iso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function shift(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function nice(s) {
  const d = parse(s), f = o => d.toLocaleDateString(undefined, o);
  return `${f({ weekday: 'short' })} ${f({ month: 'short' })} ${d.getDate()}`;   // e.g. Wed Sep 30
}
function relLabel(s) {
  const n = Math.round((parse(s) - parse(iso(new Date()))) / 864e5);
  if (n === 0) { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  return n < 0 ? `${-n} days ago` : `In ${n} days`;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Tasks view ---------- */
function render(animate) {
  materialize(current > iso(new Date()) ? current : iso(new Date()));
  const tasks = data[current] || [];
  const today = iso(new Date());
  $('eyebrow').textContent = relLabel(current);
  $('day-title').textContent = nice(current);
  $('today').hidden = current === today;
  $('carry-day').textContent = nice(current);
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('day-stats').textContent = tasks.length ? `${done} of ${tasks.length} done` : 'No tasks yet';
  $('ring').style.setProperty('--p', pct);
  $('ring-text').textContent = pct + '%';
  $('empty').hidden = tasks.length > 0;
  renderStrip();
  const ul = $('list');
  ul.replaceChildren();
  ul.classList.toggle('enter', !!animate);
  tasks.forEach((t, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', i);
    if (t.done) li.className = 'done';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = t.done;
    cb.onchange = () => { t.done = cb.checked; save(); render(); };
    const sp = document.createElement('span');
    sp.textContent = (t.rid ? '↻ ' : '') + t.text;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete task');
    del.onclick = () => {
      data[current] = tasks.filter(x => x !== t);
      if (!data[current].length) delete data[current];
      save(); render();
    };
    li.append(cb, sp, del);
    ul.append(li);
  });
  renderRules();
}

function renderStrip() {
  const strip = $('strip'), today = iso(new Date());
  strip.replaceChildren();
  let sel;
  for (let n = -10; n <= 10; n++) {
    const d = shift(current, n), list = data[d] || [];
    const b = document.createElement('button');
    b.className = 'chip' + (d === current ? ' sel' : '') + (d === today ? ' today' : '') + (list.length ? (list.every(t => t.done) ? ' all' : ' has') : '');
    const dt = parse(d);
    b.innerHTML = '<small></small><b></b><i></i>';
    b.children[0].textContent = dt.toLocaleDateString(undefined, { weekday: 'short' });
    b.children[1].textContent = dt.getDate();
    b.setAttribute('aria-label', nice(d));
    b.onclick = () => go(d);
    strip.append(b);
    if (d === current) sel = b;
  }
  strip.scrollLeft = sel.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2;
}
function renderRules() {
  const ul = $('rules');
  ul.replaceChildren();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const r of rules) {
    const li = document.createElement('li');
    const sp = document.createElement('span');
    const when = r.freq === 'weekly' ? 'every ' + r.days.map(d => names[d]).join(', ')
      : r.freq === 'monthly' ? `monthly on day ${parse(r.start).getDate()}` : 'every day';
    sp.textContent = `↻ ${r.text} — ${when}`;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete recurring task');
    del.title = 'Stop repeating (past tasks are kept)';
    del.onclick = () => { rules = rules.filter(x => x !== r); saveRules(); render(); };
    li.append(sp, del);
    ul.append(li);
  }
}
$('r-freq').onchange = () => { $('r-days').hidden = $('r-freq').value !== 'weekly'; };
$('r-form').onsubmit = e => {
  e.preventDefault();
  const text = $('r-text').value.trim();
  const freq = $('r-freq').value;
  const days = [...document.querySelectorAll('#r-days input:checked')].map(i => +i.value);
  if (!text) return;
  if (freq === 'weekly' && !days.length) return toast('Pick at least one weekday.');
  // starts on the day you're viewing (the earliest a repeat can appear)
  rules.push({ id: uid(), text, freq, days, start: current, last: shift(current, -1) });
  $('r-text').value = '';
  saveRules(); render();
};

function go(d) { current = d; render(true); if (!$('map-view').hidden) drawMap(); }

$('add').onsubmit = e => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  (data[current] ||= []).push({ id: uid(), text, done: false });
  $('text').value = '';
  save(); render();
};
$('today').onclick = () => go(iso(new Date()));

$('carry').onclick = () => {
  const prev = Object.keys(data).filter(d => d < current).sort().pop();
  if (!prev) return toast('No earlier day with tasks.');
  const open = data[prev].filter(t => !t.done && !t.rid);
  if (!open.length) return toast(`Nothing unfinished on ${nice(prev)}.`);
  const have = new Set((data[current] || []).map(t => t.text));
  const add = open.filter(t => !have.has(t.text));
  (data[current] ||= []).push(...add.map(t => ({ id: uid(), text: t.text, done: false })));
  if (!data[current].length) delete data[current];
  save(); render();
};
$('export').onclick = () => {
  const box = $('backup');
  box.hidden = false; $('paste-import').hidden = false;
  box.value = JSON.stringify({ version: 2, days: data, rules }, null, 2);
  box.select();
  try { navigator.clipboard.writeText(box.value).then(() => toast('Backup copied. Paste it into a notes app.'), () => toast('Select the text below and copy it.')); }
  catch { toast('Select the text below and copy it.'); }
};
function importText(text) {
  try {
    const raw = JSON.parse(text);
    if (typeof raw !== 'object' || !raw || Array.isArray(raw)) throw 0;
    const obj = raw.version === 2 ? raw.days : raw;   // v1 backups are just the days
    if (!obj || typeof obj !== 'object') throw 0;
    const dateRe = /^\d{4}-\d\d-\d\d$/;
    if (raw.version === 2 && Array.isArray(raw.rules)) {
      const have = new Set(rules.map(r => r.id));
      for (const r of raw.rules) {
        if (r && typeof r.text === 'string' && ['daily', 'weekly', 'monthly'].includes(r.freq) && dateRe.test(r.start) && dateRe.test(r.last) && !have.has(r.id))
          rules.push({ id: r.id || uid(), text: r.text, freq: r.freq, days: Array.isArray(r.days) ? r.days.filter(n => n >= 0 && n <= 6) : [], start: r.start, last: r.last });
      }
      saveRules();
    }
    for (const [d, list] of Object.entries(obj)) {
      if (!dateRe.test(d) || !Array.isArray(list)) throw 0;
      const cur = (data[d] ||= []);
      const ids = new Set(cur.map(t => t.id));
      for (const t of list) if (t && typeof t.text === 'string' && !ids.has(t.id)) cur.push({ id: t.id || uid(), text: t.text, done: !!t.done, ...(t.rid ? { rid: t.rid } : {}) });
    }
    save(); render(); toast('Backup imported.');
  } catch { toast('That is not a valid backup.'); }
}
$('import').onchange = async e => {
  const f = e.target.files[0];
  if (f) importText(await f.text());
  e.target.value = '';
};
$('paste-import').onclick = () => importText($('backup').value);

/* ---------- Skins ---------- */
const SKIN_KEY = 'daily-tasks-skin';
function applySkin(name) {
  const root = document.documentElement;
  if (name && name !== 'system') root.dataset.skin = name; else delete root.dataset.skin;
  document.querySelectorAll('.skin').forEach(b => b.classList.toggle('sel', b.dataset.skin === (name || 'system')));
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = getComputedStyle(root).getPropertyValue('--card').trim() || '#0b0f14';
  Object.assign(COL, readMapColors());
  if (typeof Wb !== 'undefined') { if (!cv.hidden && !$('map-view').hidden) wake(0); if (!Wb.raf && !cv.hidden) paint(); }
}
document.querySelectorAll('.skin').forEach(b => b.onclick = () => {
  try { localStorage.setItem(SKIN_KEY, b.dataset.skin); } catch {}
  applySkin(b.dataset.skin);
});

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  const view = b.dataset.view;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  $('tasks-view').hidden = view !== 'tasks';
  $('map-view').hidden = view !== 'map';
  $('settings-view').hidden = view !== 'settings';
  scrollTo(0, 0);
  if (view === 'map') drawMap(true); else stopWeb();
});

/* ---------- Mind map ---------- */
const svg = $('map');
let view = { x: 0, y: 0, w: 1000, h: 600 };
let bounds = { w: 1000, h: 600 };

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

function drawMap(fit) {
  const web = $('mode').value === 'web';
  svg.hidden = web; $('web').hidden = !web;
  if (web) { drawWeb(); return; }
  stopWeb();
  svg.replaceChildren();
  const range = +$('range').value;
  let days = Object.keys(data).filter(d => data[d].length).sort().reverse();
  if (range) { const cut = shift(iso(new Date()), -(range - 1)); days = days.filter(d => d >= cut); }
  const g = el('g', {}, svg);

  const ROW = 30, DAYW = 110, TASKW = 190, X_ROOT = 20, X_DAY = 190, X_TASK = 370;
  if (!days.length) {
    const t = el('text', { x: 20, y: 30, class: 'empty' }, g);
    t.textContent = 'No tasks in this range yet. Add some in the Tasks tab.';
    bounds = { w: 500, h: 60 };
  } else {
    let y = 0;
    const layout = days.map(d => {
      const n = data[d].length;
      const top = y;
      y += n * ROW + 14;
      return { d, top, mid: top + (n * ROW) / 2 };
    });
    const total = y - 14;
    const rootY = total / 2;
    const links = el('g', {}, g), nodes = el('g', {}, g);
    const curve = (x1, y1, x2, y2) => {
      const mx = (x1 + x2) / 2;
      el('path', { class: 'link', d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, links);
    };
    const rootG = el('g', { class: 'root' }, nodes);
    el('rect', { x: X_ROOT, y: rootY - 20, width: 120, height: 40, rx: 20 }, rootG);
    const rt = el('text', { x: X_ROOT + 60, y: rootY, 'text-anchor': 'middle' }, rootG);
    rt.textContent = 'My days';

    for (const L of layout) {
      curve(X_ROOT + 120, rootY, X_DAY, L.mid);
      const dg = el('g', { class: 'day' + (L.d === current ? ' sel' : '') }, nodes);
      el('rect', { x: X_DAY, y: L.mid - 16, width: DAYW, height: 32, rx: 16 }, dg);
      const dt = el('text', { x: X_DAY + DAYW / 2, y: L.mid, 'text-anchor': 'middle' }, dg);
      dt.textContent = nice(L.d);
      dg.addEventListener('click', () => {
        if (moved) return;
        go(L.d);
        document.querySelector('[data-view=tasks]').click();
      });
      data[L.d].forEach((t, i) => {
        const ty = L.top + i * ROW + ROW / 2;
        curve(X_DAY + DAYW, L.mid, X_TASK, ty);
        const tg = el('g', { class: 'task' + (t.done ? ' done' : '') }, nodes);
        el('rect', { x: X_TASK, y: ty - 12, width: TASKW, height: 24, rx: 8 }, tg);
        el('circle', { cx: X_TASK + 12, cy: ty, r: 4 }, tg);
        const tt = el('text', { x: X_TASK + 24, y: ty }, tg);
        tt.textContent = clip((t.rid ? '↻ ' : '') + t.text, 24);
        el('title', {}, tg).textContent = t.text;
      });
    }
    bounds = { w: X_TASK + TASKW + 40, h: total + 40 };
    g.setAttribute('transform', 'translate(0,20)');
  }
  if (fit) fitView(); else applyView();
}
function fitView() {
  // fit to width and start at the top; long lists are panned/zoomed
  const r = svg.getBoundingClientRect();
  const w = bounds.w, h = w * r.height / (r.width || 1);
  view = { x: 0, y: 0, w, h };
  applyView();
}
function applyView() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }

let drag = null, moved = false;
svg.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false;
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!moved && Math.hypot(dx, dy) > 4) { moved = true; svg.classList.add('drag'); svg.setPointerCapture(e.pointerId); }
  if (!moved) return;
  const r = svg.getBoundingClientRect();
  view.x = drag.vx - dx * view.w / r.width;
  view.y = drag.vy - dy * view.h / r.height;
  applyView();
});
const end = () => { drag = null; svg.classList.remove('drag'); setTimeout(() => moved = false, 0); };
svg.addEventListener('pointerup', end);
svg.addEventListener('pointercancel', end);
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const f = e.deltaY > 0 ? 1.1 : 1 / 1.1;
  const px = view.x + (e.clientX - r.left) / r.width * view.w;
  const py = view.y + (e.clientY - r.top) / r.height * view.h;
  view.w *= f; view.h *= f;
  view.x = px - (e.clientX - r.left) / r.width * view.w;
  view.y = py - (e.clientY - r.top) / r.height * view.h;
  applyView();
}, { passive: false });
$('range').onchange = () => drawMap(true);
$('mode').onchange = () => drawMap(true);
$('fit').onclick = () => $('mode').value === 'web' ? fitWeb() : fitView();

/* ---------- Web (force-directed) map ---------- */
const cv = $('web'), cx = cv.getContext('2d');
const COL = {};
function readMapColors() {
  const st = getComputedStyle(document.documentElement), g = n => st.getPropertyValue(n).trim();
  return { open: g('--c-open'), done: g('--c-done'), rec: g('--c-rec'), day: g('--c-day'), root: g('--c-root'), bg: g('--map-bg') };
}
Object.assign(COL, readMapColors());
const Wb = { nodes: [], links: [], alpha: 1, k: 1, tx: 0, ty: 0, raf: 0, hover: null, drag: null, pan: null, touched: false, ticks: 0, w: 0, h: 0, dpr: 1 };

function sizeWeb() {
  const r = cv.getBoundingClientRect();
  Wb.dpr = window.devicePixelRatio || 1;
  Wb.w = r.width; Wb.h = r.height;
  cv.width = Math.max(1, r.width * Wb.dpr); cv.height = Math.max(1, r.height * Wb.dpr);
  wake(0);
}
new ResizeObserver(() => { if (!$('map-view').hidden && !cv.hidden) sizeWeb(); }).observe($('stage'));

function drawWeb() {
  sizeWeb();
  const range = +$('range').value;
  let days = Object.keys(data).filter(d => data[d].length).sort();
  if (range) { const cut = shift(iso(new Date()), -(range - 1)); days = days.filter(d => d >= cut); }
  const nodes = [], links = [];
  const root = { id: 'root', type: 'root', r: 15, label: 'My days', color: 'root', x: 0, y: 0, vx: 0, vy: 0 };
  nodes.push(root);
  const rand = () => (Math.random() - .5);
  let prev = null;
  const byRule = {};
  days.forEach((d, i) => {
    const ang = i / Math.max(days.length, 1) * Math.PI * 2;
    const dn = { id: 'd' + d, type: 'day', date: d, r: 9, label: nice(d), color: 'day', x: Math.cos(ang) * 120, y: Math.sin(ang) * 120, vx: 0, vy: 0 };
    nodes.push(dn);
    links.push({ a: root, b: dn, len: 70, str: .5, kind: 'day' });
    if (prev) links.push({ a: prev, b: dn, len: 90, str: .12, kind: 'next' });
    prev = dn;
    for (const t of data[d]) {
      const tn = { id: t.id, type: 'task', r: 5, label: (t.rid ? '↻ ' : '') + t.text, done: t.done, date: d,
        color: t.done ? 'done' : t.rid ? 'rec' : 'open', x: dn.x + rand() * 60, y: dn.y + rand() * 60, vx: 0, vy: 0 };
      nodes.push(tn);
      links.push({ a: dn, b: tn, len: 34, str: .7, kind: 'task' });
      if (t.rid) { const p = byRule[t.rid]; if (p) links.push({ a: p, b: tn, len: 110, str: .04, kind: 'repeat' }); byRule[t.rid] = tn; }
    }
  });
  Object.assign(Wb, { nodes, links, alpha: 1, ticks: 0, hover: null, touched: false, empty: !days.length });
  fitWeb();
  wake(1);
}
function fitWeb() {
  const ns = Wb.nodes;
  if (!ns.length || !Wb.w) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of ns) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  const pad = 50, w = Math.max(x1 - x0, 80), h = Math.max(y1 - y0, 80);
  Wb.k = Math.min((Wb.w - pad * 2) / w, (Wb.h - pad * 2) / h, 2.2);
  Wb.tx = Wb.w / 2 - (x0 + x1) / 2 * Wb.k;
  Wb.ty = Wb.h / 2 - (y0 + y1) / 2 * Wb.k;
  Wb.touched = false;
  wake(0);
}
function wake(a) { Wb.alpha = Math.max(Wb.alpha, a); if (!Wb.raf && !$('map-view').hidden && !cv.hidden) Wb.raf = requestAnimationFrame(loop); }
function stopWeb() { cancelAnimationFrame(Wb.raf); Wb.raf = 0; }

function step() {
  const ns = Wb.nodes, al = Wb.alpha;
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i];
    for (let j = i + 1; j < ns.length; j++) {
      const b = ns[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > 90000) continue;
      if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
      const f = 420 * al / d2, d = Math.sqrt(d2);
      dx = dx / d * f; dy = dy / d * f;
      a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
  }
  for (const l of Wb.links) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - l.len) / d * l.str * al * .5;
    l.a.vx += dx * f; l.a.vy += dy * f; l.b.vx -= dx * f; l.b.vy -= dy * f;
  }
  for (const n of ns) {
    n.vx -= n.x * .012 * al; n.vy -= n.y * .012 * al;
    if (n === Wb.drag) { n.vx = n.vy = 0; continue; }
    n.vx *= .82; n.vy *= .82;
    n.x += n.vx; n.y += n.vy;
  }
  Wb.alpha *= .985;
  if (Wb.alpha < .004) Wb.alpha = 0;
}
function loop() {
  Wb.raf = 0;
  if ($('map-view').hidden || cv.hidden) return;
  if (Wb.alpha > 0 || Wb.drag) {
    step(); Wb.ticks++;
    if (!Wb.touched && Wb.ticks % 8 === 0 && Wb.ticks < 240) fitWeb();
  }
  paint();
  if (Wb.alpha > 0 || Wb.drag) Wb.raf = requestAnimationFrame(loop);
}
function neighbors(n) {
  const s = new Set([n]);
  for (const l of Wb.links) { if (l.a === n) s.add(l.b); if (l.b === n) s.add(l.a); }
  return s;
}
function paint() {
  const { k, tx, ty, dpr } = Wb;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, Wb.w, Wb.h);
  if (Wb.empty) {
    cx.fillStyle = '#8b94a3'; cx.font = '14px system-ui,sans-serif'; cx.textAlign = 'center';
    cx.fillText('No tasks in this range yet. Add some in the Tasks tab.', Wb.w / 2, Wb.h / 2);
    return;
  }
  cx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
  const hov = Wb.hover, near = hov ? neighbors(hov) : null;
  cx.lineCap = 'round';
  for (const l of Wb.links) {
    const lit = hov && (l.a === hov || l.b === hov);
    cx.globalAlpha = hov ? (lit ? .95 : .12) : (l.kind === 'day' ? .5 : l.kind === 'task' ? .4 : .28);
    cx.strokeStyle = l.kind === 'repeat' ? COL.rec : l.kind === 'next' ? COL.day : COL.root;
    cx.lineWidth = (lit ? 1.6 : 1) / k;
    cx.setLineDash(l.kind === 'repeat' ? [4 / k, 4 / k] : []);
    cx.beginPath(); cx.moveTo(l.a.x, l.a.y); cx.lineTo(l.b.x, l.b.y); cx.stroke();
  }
  cx.setLineDash([]);
  for (const n of Wb.nodes) {
    cx.globalAlpha = hov && !near.has(n) ? .25 : 1;
    const nc = COL[n.color];
    cx.shadowColor = nc; cx.shadowBlur = (n === hov ? 22 : 12) * k;
    cx.fillStyle = COL.bg; cx.strokeStyle = nc; cx.lineWidth = (n.type === 'task' ? 1.6 : 2) / k;
    cx.beginPath(); cx.arc(n.x, n.y, n.r, 0, 7); cx.fill(); cx.stroke();
    if (n.type === 'task' && n.done) { cx.shadowBlur = 0; cx.fillStyle = nc; cx.beginPath(); cx.arc(n.x, n.y, n.r * .45, 0, 7); cx.fill(); }
  }
  cx.shadowBlur = 0; cx.globalAlpha = 1;
  // labels: days always, tasks when zoomed in or highlighted
  cx.textAlign = 'center'; cx.textBaseline = 'top';
  for (const n of Wb.nodes) {
    const few = Wb.nodes.length;
    const show = (near && near.has(n)) || (n.type === 'task' ? (k > 3 || few < 25) : (k > 1.5 || few < 40));
    if (!show || (hov && !near.has(n))) continue;
    const size = 11 / k;
    cx.font = `${size}px system-ui,sans-serif`;
    cx.fillStyle = n.type === 'task' ? '#c8d0dc' : '#e9edf5';
    cx.fillText(n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label, n.x, n.y + n.r + 3 / k);
  }
}
function worldPt(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left - Wb.tx) / Wb.k, y: (e.clientY - r.top - Wb.ty) / Wb.k };
}
function pick(p) {
  let best = null, bd = 1e9;
  for (const n of Wb.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y), lim = n.r + 5 / Wb.k;
    if (d < lim && d < bd) { best = n; bd = d; }
  }
  return best;
}
let webDown = null;
cv.addEventListener('pointerdown', e => {
  const p = worldPt(e), n = pick(p);
  webDown = { x: e.clientX, y: e.clientY, n, moved: false, tx: Wb.tx, ty: Wb.ty };
  cv.setPointerCapture(e.pointerId);
  if (n) { Wb.drag = n; wake(.3); }
});
cv.addEventListener('pointermove', e => {
  if (webDown) {
    const dx = e.clientX - webDown.x, dy = e.clientY - webDown.y;
    if (Math.hypot(dx, dy) > 4) webDown.moved = true;
    if (webDown.moved) {
      Wb.touched = true;
      if (webDown.n) { const p = worldPt(e); webDown.n.x = p.x; webDown.n.y = p.y; wake(.3); }
      else { Wb.tx = webDown.tx + dx; Wb.ty = webDown.ty + dy; cv.style.cursor = 'grabbing'; wake(0); }
      if (!Wb.raf) paint();
    }
    return;
  }
  const n = pick(worldPt(e));
  if (n !== Wb.hover) { Wb.hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; showTip(n, e); if (!Wb.raf) paint(); }
  else if (n) showTip(n, e);
});
function endWeb(e) {
  if (!webDown) return;
  const d = webDown; webDown = null; Wb.drag = null; cv.style.cursor = Wb.hover ? 'pointer' : 'grab';
  if (!d.moved && d.n && d.n.type === 'day') { go(d.n.date); document.querySelector('[data-view=tasks]').click(); }
  else if (!d.moved && d.n && d.n.type === 'task') { go(d.n.date); document.querySelector('[data-view=tasks]').click(); }
}
cv.addEventListener('pointerup', endWeb);
cv.addEventListener('pointercancel', endWeb);
cv.addEventListener('pointerleave', () => { if (!webDown) { Wb.hover = null; showTip(null); if (!Wb.raf) paint(); } });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const f = e.deltaY > 0 ? 1 / 1.12 : 1.12, nk = Math.min(6, Math.max(.15, Wb.k * f));
  Wb.tx = mx - (mx - Wb.tx) * nk / Wb.k; Wb.ty = my - (my - Wb.ty) * nk / Wb.k; Wb.k = nk;
  Wb.touched = true; wake(0); if (!Wb.raf) paint();
}, { passive: false });

function showTip(n, e) {
  let t = document.getElementById('tip');
  if (!t) { t = document.createElement('div'); t.id = 'tip'; $('stage').append(t); }
  if (!n) { t.hidden = true; return; }
  t.hidden = false;
  t.textContent = n.type === 'task' ? `${n.label}${n.done ? ' ✓' : ''} · ${nice(n.date)}` : n.label;
  const r = cv.getBoundingClientRect();
  t.style.left = Math.min(e.clientX - r.left + 14, r.width - 220) + 'px';
  t.style.top = (e.clientY - r.top + 14) + 'px';
}

let savedSkin = 'system';
try { savedSkin = localStorage.getItem(SKIN_KEY) || 'system'; } catch {}
applySkin(savedSkin);
function sizeHeader() { document.documentElement.style.setProperty('--hdr', document.querySelector('header').offsetHeight + 'px'); }
sizeHeader(); addEventListener('resize', sizeHeader);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
render(true);
