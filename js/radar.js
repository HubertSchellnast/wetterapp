// Rain radar: RainViewer (past 2 h, free for personal use, max zoom 7) on
// OpenStreetMap tiles, darkened via CSS filter (© OpenStreetMap contributors, ODbL).
// Small custom tile viewer - no map library needed.
// Gestures: one finger pans, two fingers pinch-zoom, double tap zooms in;
// on desktop: drag, mouse wheel, double click. Buttons +/- as fallback.
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
  const zoomOut = button('−', 'Herauszoomen', () => zoomAtCenter(-1));
  const zoomIn = button('+', 'Hineinzoomen', () => zoomAtCenter(1));
  const controls = el('div', 'radar-controls');
  controls.append(playBtn, slider, timeLabel, zoomOut, zoomIn);

  const note = el('p', 'radar-note',
    'Niederschlag der letzten 2 Stunden (10-Minuten-Schritte). Kräftigere Farbe = stärkerer Niederschlag. Keine Vorhersage. Zoomen mit zwei Fingern oder Doppeltippen.');
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
  const pointers = new Map();
  let gesture = null;
  let lastWheel = 0;

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

  const mapSize = () => ({ w: map.clientWidth || 340, h: map.clientHeight || 360 });

  function clampCenter() {
    const size = TILE * 2 ** z;
    const { h } = mapSize();
    center.y = Math.min(Math.max(center.y, h / 2), size - h / 2);
  }

  /**
   * Zooms by dz levels keeping the world point under the focal point (fx, fy)
   * on screen; (shiftX, shiftY) = how far that point was moved by the gesture.
   */
  function zoomAt(dz, fx, fy, shiftX = 0, shiftY = 0) {
    const { w, h } = mapSize();
    const nz = Math.min(MAX_Z, Math.max(MIN_Z, z + dz));
    const f = 2 ** (nz - z);
    const wx = center.x - w / 2 + fx;
    const wy = center.y - h / 2 + fy;
    center = { x: wx * f - (fx + shiftX) + w / 2, y: wy * f - (fy + shiftY) + h / 2 };
    z = nz;
    clampCenter();
    render();
  }

  function zoomAtCenter(dz) {
    const { w, h } = mapSize();
    zoomAt(dz, w / 2, h / 2);
  }

  // ---- gestures: pointer events cover touch, pen and mouse ----
  function startGesture() {
    const pts = [...pointers.values()];
    const rect = map.getBoundingClientRect();
    if (pts.length === 1) {
      gesture = { type: 'pan', sx: pts[0].x, sy: pts[0].y, dx: 0, dy: 0 };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = {
        type: 'pinch',
        fx: (a.x + b.x) / 2 - rect.left,
        fy: (a.y + b.y) / 2 - rect.top,
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: 1, dx: 0, dy: 0,
      };
      pan.style.transformOrigin = `${gesture.fx}px ${gesture.fy}px`;
    }
  }

  function endGesture() {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    pan.style.transform = '';
    pan.style.transformOrigin = '';
    if (g.type === 'pan') {
      if (!g.dx && !g.dy) return;
      center = { x: center.x - g.dx, y: center.y - g.dy };
      clampCenter();
      render();
    } else {
      zoomAt(Math.round(Math.log2(g.scale)), g.fx, g.fy, g.dx, g.dy);
    }
  }

  map.addEventListener('pointerdown', (e) => {
    try { map.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    endGesture(); // commit whatever was going on before the new finger
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  });

  map.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === 'pan') {
      gesture.dx = e.clientX - gesture.sx;
      gesture.dy = e.clientY - gesture.sy;
      pan.style.transform = `translate(${gesture.dx}px, ${gesture.dy}px)`;
    } else {
      const [a, b] = [...pointers.values()];
      const rect = map.getBoundingClientRect();
      const minScale = 2 ** (MIN_Z - z) * 0.8; // slight rubber band at the limits
      const maxScale = 2 ** (MAX_Z - z) * 1.25;
      gesture.scale = Math.min(Math.max(Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0, minScale), maxScale);
      gesture.dx = (a.x + b.x) / 2 - rect.left - gesture.fx;
      gesture.dy = (a.y + b.y) / 2 - rect.top - gesture.fy;
      pan.style.transform = `translate(${gesture.dx}px, ${gesture.dy}px) scale(${gesture.scale})`;
    }
  });

  const onPointerEnd = (e) => {
    if (!pointers.has(e.pointerId)) return;
    endGesture();
    pointers.delete(e.pointerId);
    if (pointers.size) startGesture(); // e.g. continue panning with the remaining finger
  };
  map.addEventListener('pointerup', onPointerEnd);
  map.addEventListener('pointercancel', onPointerEnd);

  map.addEventListener('dblclick', (e) => {
    const rect = map.getBoundingClientRect();
    zoomAt(1, e.clientX - rect.left, e.clientY - rect.top);
  });

  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheel < 250) return; // one level per wheel "notch burst"
    lastWheel = now;
    const rect = map.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

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
