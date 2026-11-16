// Rain radar: RainViewer (past 2 h, free for personal use, max zoom 7) on
// OpenStreetMap tiles, darkened via CSS filter (© OpenStreetMap contributors, ODbL).
// Small custom tile viewer - no map library needed. Drag to pan, buttons to zoom.
// Note: CARTO basemaps were dropped in v1.3.0 - they now require an API key.
const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE = 256;
const MIN_Z = 4;
const MAX_Z = 7; // RainViewer free tier limit
const COLOR = 2; // "Universal Blue" - the only colour scheme on the free tier
const FRAME_MS = 650;
const LAST_FRAME_HOLD_MS = 1800;

const baseUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

function project(lat, lon, z) {
  const size = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function button(label, aria, onClick) {
  const b = el('button', 'icon-btn', label);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

/** Builds the radar UI. Returns { node, destroy }. */
export function createRadar({ lat, lon, name }) {
  const node = el('div', 'radar');
  const map = el('div', 'radar-map');
  const pan = el('div', 'radar-pan');
  const baseLayer = el('div', 'radar-layer radar-base');
  const frameLayer = el('div', 'radar-layer');
  const marker = el('div', 'radar-marker');
  marker.title = name || 'Ort';
  pan.append(baseLayer, frameLayer, marker);
  map.append(pan);

  const status = el('div', 'radar-status', 'Radar wird geladen …');
  map.append(status);

  const playBtn = button('⏸', 'Animation anhalten', () => (timer ? stop() : play()));
  const slider = el('input', 'radar-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.value = '0';
  slider.setAttribute('aria-label', 'Zeitpunkt des Radarbilds');
  const timeLabel = el('span', 'radar-time', '–');
  const zoomOut = button('−', 'Herauszoomen', () => setZoom(z - 1));
  const zoomIn = button('+', 'Hineinzoomen', () => setZoom(z + 1));
  const controls = el('div', 'radar-controls');
  controls.append(playBtn, slider, timeLabel, zoomOut, zoomIn);

  const note = el('p', 'radar-note',
    'Niederschlag der letzten 2 Stunden (10-Minuten-Schritte). Kräftigere Farbe = stärkerer Niederschlag. Keine Vorhersage.');
  const source = el('p', 'source');
  const rvLink = el('a', '', 'RainViewer');
  rvLink.href = 'https://www.rainviewer.com/';
  rvLink.target = '_blank';
  rvLink.rel = 'noopener';
  const osmLink = el('a', '', '© OpenStreetMap-Mitwirkende');
  osmLink.href = 'https://www.openstreetmap.org/copyright';
  osmLink.target = '_blank';
  osmLink.rel = 'noopener';
  source.append('Radar: ', rvLink, ' · Karte: ', osmLink);
  node.append(map, controls, note, source);

  let z = 6;
  let center = project(lat, lon, z);
  let frames = [];
  let host = '';
  let current = 0;
  let timer = null;
  let frameDivs = [];
  let drag = null;

  function tilesFor(fn, layerClass = '') {
    const w = map.clientWidth || 340;
    const h = map.clientHeight || 360;
    const x0 = center.x - w / 2;
    const y0 = center.y - h / 2;
    const n = 2 ** z;
    const frag = document.createDocumentFragment();
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h - 1) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w - 1) / TILE); tx++) {
        const wx = ((tx % n) + n) % n;
        const img = new Image(TILE, TILE);
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.className = layerClass;
        img.onerror = () => { img.style.visibility = 'hidden'; }; // hide failed tiles instead of a broken-image icon
        img.style.left = `${Math.round(tx * TILE - x0)}px`;
        img.style.top = `${Math.round(ty * TILE - y0)}px`;
        img.src = fn(z, wx, ty);
        frag.append(img);
      }
    }
    return frag;
  }

  function render() {
    baseLayer.replaceChildren(tilesFor(baseUrl));
    frameDivs = frames.map((f, i) => {
      const d = el('div', i === current ? 'radar-frame active' : 'radar-frame');
      d.append(tilesFor((zz, x, y) => `${host}${f.path}/${TILE}/${zz}/${x}/${y}/${COLOR}/1_1.png`));
      return d;
    });
    frameLayer.replaceChildren(...frameDivs);
    const p = project(lat, lon, z);
    const w = map.clientWidth || 340;
    const h = map.clientHeight || 360;
    marker.style.left = `${p.x - (center.x - w / 2)}px`;
    marker.style.top = `${p.y - (center.y - h / 2)}px`;
    zoomIn.disabled = z >= MAX_Z;
    zoomOut.disabled = z <= MIN_Z;
  }

  function showFrame(i) {
    if (!frames.length) return;
    frameDivs[current]?.classList.remove('active');
    current = (i + frames.length) % frames.length;
    frameDivs[current]?.classList.add('active');
    slider.value = String(current);
    const t = new Date(frames[current].time * 1000);
    const hhmm = t.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    timeLabel.textContent = current === frames.length - 1 ? `${hhmm} (neuestes)` : hhmm;
  }

  function play() {
    stop();
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', 'Animation anhalten');
    const tick = () => {
      showFrame(current + 1);
      timer = setTimeout(tick, current === frames.length - 1 ? LAST_FRAME_HOLD_MS : FRAME_MS);
    };
    timer = setTimeout(tick, FRAME_MS);
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Animation abspielen');
  }

  function setZoom(nz) {
    if (nz < MIN_Z || nz > MAX_Z) return;
    const f = 2 ** (nz - z);
    center = { x: center.x * f, y: center.y * f };
    z = nz;
    render();
  }

  // drag to pan: move the layer with CSS while dragging, re-render tiles on release
  map.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    pan.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    const size = TILE * 2 ** z;
    const h = map.clientHeight || 360;
    center = {
      x: center.x - drag.dx,
      y: Math.min(Math.max(center.y - drag.dy, h / 2), size - h / 2),
    };
    drag = null;
    pan.style.transform = '';
    render();
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);

  slider.addEventListener('input', () => { stop(); showFrame(Number(slider.value)); });

  const onResize = () => render();
  window.addEventListener('resize', onResize);

  (async () => {
    try {
      const res = await fetch(MAPS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json();
      host = meta.host;
      frames = meta.radar?.past || [];
      if (!frames.length) throw new Error('no frames');
      slider.max = String(frames.length - 1);
      current = frames.length - 1;
      render();
      showFrame(current);
      status.remove();
      play();
    } catch (err) {
      console.error('radar failed', err);
      status.textContent = 'Radar derzeit nicht verfügbar – Verbindung prüfen.';
      render(); // still show the base map
    }
  })();

  // first layout pass once the node is in the DOM
  requestAnimationFrame(() => render());

  return {
    node,
    destroy() {
      stop();
      window.removeEventListener('resize', onResize);
    },
  };
}
