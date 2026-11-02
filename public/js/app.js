import { validateTariff, calculateMonth, usageForBudget, typeLabel } from './tariff.js';

const DATA_DIR = 'data/';
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

const state = {
  entries: [], // { key, source: 'data' | 'custom', file, tariff }
  messages: [], // { kind: 'error' | 'warn', title, items[] }
  mode: 'usage',
  values: { usage: 500, budget: 1000 },
  customCount: 0,
};

// ---------- small DOM helpers (everything user-supplied goes through textContent) ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

const clear = (node) => node.replaceChildren();

// ---------- formatting ----------

const moneyFormats = new Map();
function money(value, currency, digits = 2) {
  const key = `${currency}:${digits}`;
  if (!moneyFormats.has(key)) {
    let fmt;
    try {
      fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      fmt = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyFormats.set(key, fmt);
  }
  return moneyFormats.get(key).format(value).replace(/ /g, ' ');
}

const num = (value, max = 2) => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: max }).format(value).replace(/ /g, ' ');

function bandRange(band, unit) {
  return band.to === null ? `${num(band.from)}+ ${unit}` : `${num(band.from)} – ${num(band.to)} ${unit}`;
}

function bandColor(i, n) {
  const hue = n <= 1 ? 210 : 210 - (i / (n - 1)) * 200;
  return `hsl(${hue.toFixed(0)} 70% 52%)`;
}

// ---------- loading tariff files from /data ----------

async function listDataFiles() {
  try {
    const res = await fetch(`${DATA_DIR}index.json`, { cache: 'no-cache' });
    if (res.ok) {
      const manifest = await res.json();
      const files = Array.isArray(manifest) ? manifest : manifest.files;
      if (Array.isArray(files)) return files.filter((f) => typeof f === 'string' && f !== 'index.json');
    }
  } catch { /* fall through to directory listing */ }

  // Fallback for servers that expose a directory listing (python -m http.server, nginx autoindex).
  try {
    const res = await fetch(DATA_DIR, { cache: 'no-cache' });
    if (res.ok) {
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      return [...doc.querySelectorAll('a[href]')]
        .map((a) => decodeURIComponent(a.getAttribute('href').split('/').pop()))
        .filter((f) => f.toLowerCase().endsWith('.json') && f !== 'index.json');
    }
  } catch { /* nothing more to try */ }
  return [];
}

async function loadDataFiles() {
  const files = await listDataFiles();
  const skipped = [];

  await Promise.all(files.map(async (file, i) => {
    try {
      const res = await fetch(`${DATA_DIR}${encodeURIComponent(file)}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = validateTariff(await res.json());
      if (!result.ok) throw new Error(result.errors.join(' '));
      state.entries[i] = { key: `data:${file}`, source: 'data', file, tariff: result.tariff };
    } catch (err) {
      skipped.push(`${file}: ${err.message}`);
    }
  }));
  state.entries = state.entries.filter(Boolean);

  if (skipped.length) state.messages.push({ kind: 'error', title: 'Some data files were skipped:', items: skipped });
  if (!files.length) {
    state.messages.push({ kind: 'warn', title: `No tariff files found in "${DATA_DIR}". Upload your own JSON to get started.`, items: [] });
  }
}

// ---------- uploads ----------

async function handleUpload(fileList) {
  let last = null;
  for (const file of fileList) {
    try {
      const result = validateTariff(JSON.parse(await file.text()));
      if (!result.ok) {
        state.messages.push({ kind: 'error', upload: true, title: `${file.name} was not loaded:`, items: result.errors });
        continue;
      }
      if (result.warnings.length) state.messages.push({ kind: 'warn', upload: true, title: `${file.name}:`, items: result.warnings });
      last = { key: `custom:${state.customCount++}:${file.name}`, source: 'custom', file: file.name, tariff: result.tariff };
      state.entries.push(last);
    } catch (err) {
      state.messages.push({ kind: 'error', upload: true, title: `${file.name} is not valid JSON:`, items: [err.message] });
    }
  }
  refreshSelects(last ? last.key : undefined);
}

// ---------- selects ----------

function typesInUse() {
  const order = ['power', 'water'];
  const types = [...new Set(state.entries.map((e) => e.tariff.type))];
  return types.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function selectedEntry() {
  const key = $('tariff-select').value;
  return state.entries.find((e) => e.key === key) || null;
}

function refreshSelects(preferKey) {
  const typeSel = $('type-select');
  const tariffSel = $('tariff-select');
  const preferred = state.entries.find((e) => e.key === preferKey);
  const prevType = typeSel.value;

  const types = typesInUse();
  clear(typeSel);
  types.forEach((t) => typeSel.append(el('option', { value: t }, typeLabel(t))));
  typeSel.disabled = tariffSel.disabled = types.length === 0;

  if (!types.length) {
    clear(tariffSel);
    tariffSel.append(el('option', {}, 'No tariffs available'));
    typeSel.append(el('option', {}, 'No tariffs available'));
  } else {
    typeSel.value = preferred ? preferred.tariff.type : types.includes(prevType) ? prevType : types[0];
    fillTariffSelect(preferred ? preferred.key : undefined);
  }

  $('clear-custom').hidden = !state.entries.some((e) => e.source === 'custom');
  renderMessages();
  renderTariffInfo();
  recalc();
}

function fillTariffSelect(selectKey) {
  const tariffSel = $('tariff-select');
  const type = $('type-select').value;
  const matching = state.entries
    .filter((e) => e.tariff.type === type)
    .sort((a, b) => a.tariff.displayName.localeCompare(b.tariff.displayName));

  clear(tariffSel);
  matching.forEach((e) => {
    tariffSel.append(el('option', { value: e.key }, e.tariff.displayName + (e.source === 'custom' ? ' (uploaded)' : '')));
  });
  if (selectKey && matching.some((e) => e.key === selectKey)) tariffSel.value = selectKey;
}

// ---------- messages & tariff info ----------

function renderMessages() {
  const box = $('messages');
  clear(box);
  for (const m of state.messages) {
    box.append(el('div', { class: `note ${m.kind === 'error' ? 'error' : ''}` },
      m.title,
      m.items.length ? el('ul', {}, m.items.map((i) => el('li', {}, i))) : null));
  }
}

function renderTariffInfo() {
  const box = $('tariff-info');
  const entry = selectedEntry();
  clear(box);
  box.hidden = !entry;
  if (!entry) return;

  const t = entry.tariff;
  const meta = [];
  if (t.area) meta.push(['Area', t.area]);
  if (t.effectiveFrom) meta.push(['Effective from', t.effectiveFrom]);
  if (t.fixedMonthlyCharge > 0) meta.push(['Fixed monthly charge', money(t.fixedMonthlyCharge, t.currency)]);
  if (t.vatPercent > 0) meta.push(['VAT', `${num(t.vatPercent)}% (${t.ratesIncludeVat ? 'included in rates' : 'added on top'})`]);

  const metaP = el('p', { class: 'meta' });
  meta.forEach(([k, v], i) => metaP.append(i ? ' · ' : '', `${k}: `, el('strong', {}, v)));

  const head = el('thead', {}, el('tr', {},
    el('th', {}, 'Band'), el('th', {}, 'Range'), el('th', {}, `Rate per ${t.unit}`)));
  const body = el('tbody', {}, t.bands.map((b, i) => el('tr', {},
    el('td', {}, el('span', { class: 'swatch', style: `background:${bandColor(i, t.bands.length)}` }), `Band ${i + 1}`),
    el('td', {}, bandRange(b, t.unit)),
    el('td', {}, money(b.rate, t.currency, 4)))));

  box.append(
    meta.length ? metaP : null,
    el('div', { class: 'table-wrap' }, el('table', {}, head, body)),
    t.notes ? el('p', { class: 'meta', style: 'margin-top:10px' }, t.notes) : null,
    t.source ? el('p', { class: 'meta' }, `Source: ${t.source}`) : null,
  );
}

// ---------- calculation & results ----------

function daysInMonth(monthValue) {
  const [y, m] = monthValue.split('-').map(Number);
  return y && m ? new Date(y, m, 0).getDate() : null;
}

function dayLabel(monthValue, day) {
  const [y, m] = monthValue.split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, day).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function updateAmountField() {
  const entry = selectedEntry();
  const t = entry && entry.tariff;
  $('amount-label').textContent = state.mode === 'usage' ? 'Monthly usage' : 'Monthly budget';
  $('amount-suffix').textContent = state.mode === 'usage' ? (t ? t.unit : '') : (t ? t.currency : '');
}

function recalc() {
  updateAmountField();
  const entry = selectedEntry();
  const results = $('results');
  const amount = parseFloat($('amount').value);
  const days = parseInt($('days').value, 10);

  if (!entry || !(amount >= 0) || !(days >= 1)) {
    results.hidden = true;
    return;
  }

  const t = entry.tariff;
  const usage = state.mode === 'usage' ? amount : usageForBudget(t, amount);
  const r = calculateMonth(t, usage, days);
  results.hidden = false;

  renderSummary(t, r, amount);
  renderBandTable(t, r);
  renderDaily(t, r);
}

function stat(label, value, sub, primary) {
  return el('div', { class: `stat ${primary ? 'primary' : ''}` },
    el('div', { class: 'k' }, label), el('div', { class: 'v' }, value), sub ? el('div', { class: 's' }, sub) : null);
}

function renderSummary(t, r, amount) {
  const breakdown = r.vat > 0 ? `Includes ${money(r.vat, t.currency)} VAT` : null;

  const cards = state.mode === 'usage'
    ? [
        stat('Estimated monthly cost', money(r.total, t.currency), breakdown, true),
        stat('Total usage', `${num(r.usage)} ${t.unit}`, `${num(r.perDayUsage)} ${t.unit} per day`),
        stat('Average cost per day', money(r.avgDailyCost, t.currency), `over ${r.days} days`),
        stat(`Average cost per ${t.unit}`, money(r.avgUnitCost, t.currency, 4), 'all bands, fixed charge and VAT'),
      ]
    : [
        stat('Your budget buys', `${num(r.usage)} ${t.unit}`, `for ${money(amount, t.currency)} a month`, true),
        stat('Average per day', `${num(r.perDayUsage)} ${t.unit}`, `over ${r.days} days`),
        stat('Cost per day', money(r.avgDailyCost, t.currency), breakdown),
        stat(`Average cost per ${t.unit}`, money(r.avgUnitCost, t.currency, 4), 'all bands, fixed charge and VAT'),
      ];

  const box = $('summary');
  clear(box);
  box.append(...cards);
  if (state.mode === 'budget' && amount > 0 && r.usage === 0) {
    box.append(el('div', { class: 'note', style: 'grid-column:1/-1;margin:0' }, 'This budget does not cover the fixed monthly charge, so it buys no usage.'));
  }
}

function renderBandTable(t, r) {
  const table = $('band-table');
  clear(table);
  const cols = (n) => ({ colspan: String(n) });

  const body = el('tbody', {}, r.bandRows.map((row, i) => el('tr', { class: row.used === 0 ? 'dim' : '' },
    el('td', {}, el('span', { class: 'swatch', style: `background:${bandColor(i, t.bands.length)}` }), `Band ${i + 1}`),
    el('td', {}, bandRange(row.band, t.unit)),
    el('td', {}, money(row.band.rate, t.currency, 4)),
    el('td', {}, `${num(row.used)} ${t.unit}`),
    el('td', {}, money(row.cost, t.currency)))));

  const foot = el('tfoot', {},
    el('tr', {}, el('td', cols(3), 'Usage charges'), el('td', {}, `${num(r.usage)} ${t.unit}`), el('td', {}, money(r.energy, t.currency))));
  if (r.fixed > 0) foot.append(el('tr', {}, el('td', cols(4), 'Fixed monthly charge'), el('td', {}, money(r.fixed, t.currency))));
  if (r.vat > 0) {
    const label = t.ratesIncludeVat ? `of which VAT (${num(t.vatPercent)}%, already in rates)` : `VAT (${num(t.vatPercent)}%)`;
    foot.append(el('tr', { class: t.ratesIncludeVat ? 'dim' : '' }, el('td', cols(4), label), el('td', {}, money(r.vat, t.currency))));
  }
  foot.append(el('tr', {}, el('td', cols(4), 'Total for the month'), el('td', {}, money(r.total, t.currency))));

  table.append(
    el('thead', {}, el('tr', {}, ['Band', 'Range', `Rate per ${t.unit}`, 'Usage', 'Cost'].map((h) => el('th', {}, h)))),
    body, foot);
}

function renderDaily(t, r) {
  const month = $('month').value;
  const n = t.bands.length;

  $('daily-hint').textContent =
    `Usage is spread evenly over ${r.days} days (${num(r.perDayUsage)} ${t.unit}/day). Bands apply to the month's running total, ` +
    `so each day's cost is the extra cost of that day's units and rises as you move into higher bands. ` +
    `The average is ${money(r.avgDailyCost, t.currency)} per day.`;

  renderChart(t, r);

  const legend = $('legend');
  clear(legend);
  t.bands.forEach((b, i) => legend.append(el('span', {},
    el('span', { class: 'swatch', style: `background:${bandColor(i, n)}` }), `Band ${i + 1}: ${bandRange(b, t.unit)}`)));

  const bandCell = (d) => (d.bandStart === d.bandEnd ? `${d.bandEnd + 1}` : `${d.bandStart + 1} → ${d.bandEnd + 1}`);
  const table = $('daily-table');
  clear(table);
  table.append(
    el('thead', {}, el('tr', {}, ['Day', 'Date', `Usage (${t.unit})`, `Cumulative (${t.unit})`, 'Band', 'Cost', 'Cumulative cost'].map((h) => el('th', {}, h)))),
    el('tbody', {}, r.daily.map((d) => el('tr', {},
      el('td', {}, d.day),
      el('td', { class: 'dim', style: 'text-align:left' }, dayLabel(month, d.day)),
      el('td', {}, num(d.usage)),
      el('td', {}, num(d.cumUsage)),
      el('td', {}, el('span', { class: 'swatch', style: `background:${bandColor(d.bandEnd, n)}` }), bandCell(d)),
      el('td', {}, money(d.cost, t.currency)),
      el('td', { class: 'dim' }, money(d.cumCost, t.currency))))));
}

function renderChart(t, r) {
  const W = 900, H = 240, L = 62, R = 8, T = 10, B = 28;
  const plotW = W - L - R, plotH = H - T - B;
  const n = r.daily.length;
  const maxCost = Math.max(...r.daily.map((d) => d.cost), 0.01);
  const slot = plotW / n;
  const barW = Math.max(1, slot * 0.78);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
  for (let i = 0; i <= 4; i++) {
    const y = T + plotH - (plotH * i) / 4;
    root.append(
      svg('line', { class: 'axis', x1: L, x2: W - R, y1: y, y2: y }),
      Object.assign(svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }), { textContent: money((maxCost * i) / 4, t.currency, maxCost >= 10 ? 0 : 2) }));
  }

  const step = Math.ceil(n / 16);
  r.daily.forEach((d, i) => {
    const h = (d.cost / maxCost) * plotH;
    const x = L + i * slot + (slot - barW) / 2;
    const bar = svg('rect', { x, y: T + plotH - h, width: barW, height: h, rx: 1.5, fill: bandColor(d.bandEnd, t.bands.length) });
    bar.append(Object.assign(svg('title'), { textContent: `Day ${d.day}: ${num(d.usage)} ${t.unit}, ${money(d.cost, t.currency)}` }));
    root.append(bar);
    if (i % step === 0 || d.day === n) {
      root.append(Object.assign(svg('text', { x: x + barW / 2, y: H - 8, 'text-anchor': 'middle' }), { textContent: d.day }));
    }
  });

  const chart = $('chart');
  chart.setAttribute('aria-label', `Bar chart of the cost for each of ${n} days`);
  clear(chart);
  chart.append(root);
}

// ---------- wiring ----------

function setMode(mode) {
  state.values[state.mode] = $('amount').value;
  state.mode = mode;
  $('amount').value = state.values[mode];
  recalc();
}

function init() {
  const now = new Date();
  $('month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('days').value = daysInMonth($('month').value);

  $('type-select').addEventListener('change', () => { fillTariffSelect(); renderTariffInfo(); recalc(); });
  $('tariff-select').addEventListener('change', () => { renderTariffInfo(); recalc(); });
  $('amount').addEventListener('input', recalc);
  $('days').addEventListener('input', recalc);
  $('month').addEventListener('change', () => {
    const d = daysInMonth($('month').value);
    if (d) $('days').value = d;
    recalc();
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => setMode(e.target.value)));

  $('custom-file').addEventListener('change', async (e) => {
    state.messages = state.messages.filter((m) => !m.upload);
    await handleUpload([...e.target.files]);
    e.target.value = '';
  });
  $('clear-custom').addEventListener('click', () => {
    const current = selectedEntry();
    state.entries = state.entries.filter((e) => e.source !== 'custom');
    refreshSelects(current && current.source === 'data' ? current.key : undefined);
  });

  loadDataFiles().then(() => refreshSelects());
}

init();
