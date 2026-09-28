const KEY = 'daily-tasks-v1';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

let data = load();           // { "YYYY-MM-DD": [{id, text, done}] }
let current = iso(new Date());

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { alert('Could not save (storage blocked or full).'); }
}
function iso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function shift(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function nice(s) { return parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Tasks view ---------- */
function render() {
  const tasks = data[current] || [];
  $('date').value = current;
  $('day-title').textContent = parse(current).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (current === iso(new Date()) ? ' (today)' : '');
  const done = tasks.filter(t => t.done).length;
  $('day-stats').textContent = tasks.length ? `${done}/${tasks.length} done` : 'No tasks yet.';
  const ul = $('list');
  ul.replaceChildren();
  for (const t of tasks) {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = t.done;
    cb.onchange = () => { t.done = cb.checked; save(); render(); };
    const sp = document.createElement('span');
    sp.textContent = t.text;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Delete task');
    del.onclick = () => {
      data[current] = tasks.filter(x => x !== t);
      if (!data[current].length) delete data[current];
      save(); render();
    };
    li.append(cb, sp, del);
    ul.append(li);
  }
}
function go(d) { current = d; render(); if (!$('map-view').hidden) drawMap(); }

$('add').onsubmit = e => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  (data[current] ||= []).push({ id: uid(), text, done: false });
  $('text').value = '';
  save(); render();
};
$('prev').onclick = () => go(shift(current, -1));
$('next').onclick = () => go(shift(current, 1));
$('today').onclick = () => go(iso(new Date()));
$('date').onchange = e => { if (e.target.value) go(e.target.value); };

$('carry').onclick = () => {
  const prev = Object.keys(data).filter(d => d < current).sort().pop();
  if (!prev) return alert('No earlier day with tasks.');
  const open = data[prev].filter(t => !t.done);
  if (!open.length) return alert(`Nothing unfinished on ${nice(prev)}.`);
  const have = new Set((data[current] || []).map(t => t.text));
  const add = open.filter(t => !have.has(t.text));
  (data[current] ||= []).push(...add.map(t => ({ id: uid(), text: t.text, done: false })));
  if (!data[current].length) delete data[current];
  save(); render();
};
$('export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'tasks-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('import').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (typeof obj !== 'object' || Array.isArray(obj)) throw 0;
    for (const [d, list] of Object.entries(obj)) {
      if (!/^\d{4}-\d\d-\d\d$/.test(d) || !Array.isArray(list)) throw 0;
      const cur = (data[d] ||= []);
      const ids = new Set(cur.map(t => t.id));
      for (const t of list) if (t && typeof t.text === 'string' && !ids.has(t.id)) cur.push({ id: t.id || uid(), text: t.text, done: !!t.done });
    }
    save(); render();
  } catch { alert('Invalid backup file.'); }
  e.target.value = '';
};

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  const map = b.dataset.view === 'map';
  $('map-view').hidden = !map;
  $('tasks-view').hidden = map;
  if (map) drawMap(true);
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
        tt.textContent = clip(t.text, 24);
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
$('fit').onclick = fitView;

render();
