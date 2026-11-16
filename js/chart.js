// Spread ("Schwankungsbreite") chart: median line + 80 % band + full min-max band.
// Plain SVG, single hue, crosshair tooltip on touch/hover, table view for accessibility.
const SVG_NS = 'http://www.w3.org/2000/svg';
const H = 240;
const M = { top: 12, right: 10, bottom: 30, left: 34 };

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const fmt = (v) => `${Math.round(v)}°`;
const fmt1 = (v) => `${(Math.round(v * 2) / 2).toString().replace('.', ',')}°`;
const weekday = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'short' });

/** Groups hourly rows by calendar day. */
function byDay(rows) {
  const days = new Map();
  for (const r of rows) {
    const d = r.time.slice(0, 10);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(r);
  }
  return [...days.entries()].map(([date, list]) => ({
    date,
    low: Math.min(...list.map((r) => r.p50)),
    high: Math.max(...list.map((r) => r.p50)),
    spread: list.reduce((s, r) => s + (r.p90 - r.p10) / 2, 0) / list.length,
    hours: list.length,
  }));
}

export function renderSpreadChart(rowsAll, { nowHour, members } = {}) {
  const startIdx = Math.max(0, rowsAll.findIndex((r) => r.time >= (nowHour || '')));
  const rows = rowsAll.slice(startIdx);
  const wrap = el('div', 'spread');

  if (rows.length < 2) {
    wrap.append(el('p', 'muted', 'Für diesen Ort sind gerade keine Ensemble-Daten verfügbar.'));
    return wrap;
  }

  const days = byDay(rows);
  const first = days[0];
  const last = days[days.length - 1];
  wrap.append(el('p', 'spread-intro',
    `Je breiter das Band, desto unsicherer die Prognose. ` +
    `Heute liegen die Modelle bei etwa ±${fmt1(first.spread).replace('°', '')} °C auseinander, ` +
    `am ${weekday(last.date)} bei etwa ±${fmt1(last.spread).replace('°', '')} °C.`));

  // ---- chart ----
  const box = el('div', 'spread-chart');
  wrap.append(box);
  const W = 340; // viewBox width; scales to container via CSS
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const lo = Math.floor(Math.min(...rows.map((r) => r.min))) - 1;
  const hi = Math.ceil(Math.max(...rows.map((r) => r.max))) + 1;
  const x = (i) => M.left + (i / (rows.length - 1)) * iw;
  const y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * ih;

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Temperatur-Prognose mit Schwankungsbreite für die nächsten Tage' });

  // grid + y labels
  const step = hi - lo <= 12 ? 2 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    chart.append(svg('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), class: v === 0 ? 'grid zero' : 'grid' }));
    const t = svg('text', { x: M.left - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = `${v}°`;
    chart.append(t);
  }
  // day separators + labels
  let dayStart = 0;
  rows.forEach((r, i) => {
    const isMidnight = r.time.endsWith('T00:00');
    const isEnd = i === rows.length - 1;
    if ((isMidnight && i > 0) || isEnd) {
      const mid = (dayStart + (isEnd ? i : i - 1)) / 2;
      if ((isEnd ? i : i - 1) - dayStart >= 5) { // only label days with enough room
        const t = svg('text', { x: x(mid), y: H - 10, class: 'axis', 'text-anchor': 'middle' });
        t.textContent = dayStart === 0 ? 'Heute' : weekday(rows[dayStart].time.slice(0, 10));
        chart.append(t);
      }
      if (isMidnight) {
        chart.append(svg('line', { x1: x(i), x2: x(i), y1: M.top, y2: M.top + ih, class: 'grid day' }));
        dayStart = i;
      }
    }
  });

  // bands + median
  const area = (upper, lower) => {
    const top = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[upper]).toFixed(1)}`).join('');
    const bottom = rows.map((r, i) => i).reverse().map((i) => `L${x(i).toFixed(1)},${y(rows[i][lower]).toFixed(1)}`).join('');
    return `${top}${bottom}Z`;
  };
  chart.append(svg('path', { d: area('max', 'min'), class: 'band-outer' }));
  chart.append(svg('path', { d: area('p90', 'p10'), class: 'band-inner' }));
  chart.append(svg('path', {
    d: rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.p50).toFixed(1)}`).join(''),
    class: 'median',
  }));

  // crosshair layer
  const cross = svg('line', { y1: M.top, y2: M.top + ih, class: 'crosshair', visibility: 'hidden' });
  const dot = svg('circle', { r: 4, class: 'cross-dot', visibility: 'hidden' });
  const hit = svg('rect', { x: M.left, y: M.top, width: iw, height: ih, class: 'hit' });
  chart.append(cross, dot, hit);
  box.append(chart);

  const tip = el('div', 'spread-tip');
  tip.hidden = true;
  box.append(tip);

  const show = (evt) => {
    const rect = chart.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - M.left) / iw) * (rows.length - 1));
    if (i < 0 || i >= rows.length) return;
    const r = rows[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(r.p50)); dot.setAttribute('visibility', 'visible');
    const when = `${weekday(r.time.slice(0, 10))} ${r.time.slice(11, 16)}`;
    tip.replaceChildren(
      el('strong', '', `${when} · ${fmt(r.p50)}`),
      el('span', '', `80 %: ${fmt(r.p10)} bis ${fmt(r.p90)}`),
      el('span', '', `alle: ${fmt(r.min)} bis ${fmt(r.max)}`),
    );
    tip.hidden = false;
    const leftPct = (x(i) / W) * 100;
    tip.style.left = `${Math.min(Math.max(leftPct, 22), 78)}%`;
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); }
  });

  // legend (identity never by colour alone)
  const legend = el('div', 'spread-legend');
  const item = (cls, label) => { const s = el('span', 'legend-item'); s.append(el('i', cls), document.createTextNode(label)); return s; };
  legend.append(
    item('sw-median', 'wahrscheinlichster Wert (Median)'),
    item('sw-inner', '80 % der Modellläufe'),
    item('sw-outer', 'gesamte Bandbreite'),
  );
  wrap.append(legend);

  // table view
  const details = el('details', 'spread-table');
  details.append(el('summary', '', 'Als Tabelle anzeigen'));
  const table = el('table');
  const head = el('tr');
  ['Tag', 'Tief', 'Hoch', 'Unsicherheit'].forEach((h) => head.append(el('th', '', h)));
  table.append(head);
  days.forEach((d, i) => {
    const tr = el('tr');
    tr.append(
      el('td', '', i === 0 ? 'Heute' : weekday(d.date)),
      el('td', '', fmt(d.low)),
      el('td', '', fmt(d.high)),
      el('td', '', `±${fmt1(d.spread)}`),
    );
    table.append(tr);
  });
  details.append(table);
  wrap.append(details);

  wrap.append(el('p', 'source',
    `Grundlage: ${members || 40} Läufe des Ensemble-Modells DWD ICON. Daten: Open-Meteo.com (CC BY 4.0).`));
  return wrap;
}
