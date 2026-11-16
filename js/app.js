// Huberts Wetterapp - UI controller
import { fetchForecast, searchLocations } from './api.js';
import * as store from './storage.js';
import { describe, sceneFor } from './weathercodes.js';
import { setScene } from './background.js';
import { fetchWarnings, LEVELS, SOURCES } from './warnings.js';
import { openModal, setModalContent, closeModal, isModalOpen } from './modal.js';

const DEFAULT_LOCATION = { name: 'Wien', lat: 48.21, lon: 16.37, admin1: 'Wien', country: 'Österreich' };
const STALE_AFTER_MS = 15 * 60 * 1000;

const $ = (id) => document.getElementById(id);
let currentLocation = null;
let lastFetchedAt = 0;
let requestSeq = 0;
let searchTimer = null;
let lastData = null;
let lastWarnings = null;
let warnSeq = 0;

// ---------- helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const round = (v) => (v === null || v === undefined ? '–' : Math.round(v));
const hhmm = (iso) => iso.slice(11, 16);
const compass = (deg) => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

function dayName(dateStr, index) {
  if (index === 0) return 'Heute';
  if (index === 1) return 'Morgen';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'short' });
}

function showStatus(message, type = 'info') {
  const box = $('status');
  if (!message) { box.hidden = true; return; }
  box.textContent = message;
  box.className = `status status-${type}`;
  box.hidden = false;
}

function setBusy(busy) {
  $('btn-refresh').classList.toggle('spinning', busy);
}

// ---------- rendering ----------
function renderHero(data) {
  const c = data.current;
  const d = data.daily;
  const { label, icon } = describe(c.weather_code, c.is_day);
  $('hero-icon').textContent = icon;
  const { scene, intensity } = sceneFor(c.weather_code);
  setScene(scene, c.is_day, intensity);
  $('hero-temp').textContent = `${round(c.temperature_2m)}°`;
  $('hero-desc').textContent = label;
  $('hero-sub').textContent =
    `Gefühlt ${round(c.apparent_temperature)}° · H ${round(d.temperature_2m_max[0])}° · T ${round(d.temperature_2m_min[0])}°`;
}

function renderHourly(data) {
  const h = data.hourly;
  const nowHour = `${data.current.time.slice(0, 13)}:00`;
  let start = h.time.findIndex((t) => t >= nowHour);
  if (start < 0) start = 0;
  const container = $('hourly');
  container.replaceChildren();
  for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
    const item = el('div', i === start ? 'hour now' : 'hour');
    const { icon, label } = describe(h.weather_code[i], h.is_day[i]);
    item.append(
      el('span', 'hour-time', i === start ? 'Jetzt' : hhmm(h.time[i])),
      el('span', 'hour-icon', icon),
      el('span', 'hour-temp', `${round(h.temperature_2m[i])}°`),
      el('span', 'hour-pop', h.precipitation_probability[i] >= 10 ? `${h.precipitation_probability[i]} %` : ''),
    );
    item.title = label;
    container.append(item);
  }
}

function renderDaily(data) {
  const d = data.daily;
  const weekMin = Math.min(...d.temperature_2m_min);
  const weekMax = Math.max(...d.temperature_2m_max);
  const range = Math.max(weekMax - weekMin, 1);
  const list = $('daily');
  list.replaceChildren();
  d.time.forEach((date, i) => {
    const { icon, label } = describe(d.weather_code[i], 1);
    const row = el('li', 'day');
    row.title = label;

    const name = el('span', 'day-name', dayName(date, i));
    const pop = d.precipitation_probability_max[i];
    if (pop >= 20) name.append(el('span', 'day-pop', `${pop} %`));

    const bar = el('div', 'bar');
    const fill = el('div', 'bar-fill');
    fill.style.left = `${((d.temperature_2m_min[i] - weekMin) / range) * 100}%`;
    fill.style.width = `${Math.max(((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / range) * 100, 4)}%`;
    bar.append(fill);

    row.append(
      name,
      el('span', 'day-icon', icon),
      el('span', 'day-min', `${round(d.temperature_2m_min[i])}°`),
      bar,
      el('span', 'day-max', `${round(d.temperature_2m_max[i])}°`),
    );
    list.append(row);
  });
}

function renderDetails(data) {
  const c = data.current;
  const d = data.daily;
  const items = [
    ['Luftfeuchte', `${round(c.relative_humidity_2m)} %`, ''],
    ['Wind', `${round(c.wind_speed_10m)} km/h`, `${compass(c.wind_direction_10m)} · Böen ${round(c.wind_gusts_10m)} km/h`],
    ['Luftdruck', `${round(c.surface_pressure)} hPa`, ''],
    ['UV-Index', `${round(d.uv_index_max[0])}`, 'Tagesmaximum'],
    ['Sonnenaufgang', hhmm(d.sunrise[0]), ''],
    ['Sonnenuntergang', hhmm(d.sunset[0]), ''],
    ['Niederschlag', `${(d.precipitation_sum[0] ?? 0).toFixed(1).replace('.', ',')} mm`, 'heute gesamt'],
    ['Regenrisiko', `${d.precipitation_probability_max[0] ?? 0} %`, 'heute maximal'],
  ];
  const grid = $('details');
  grid.replaceChildren(...items.map(([label, value, extra]) => {
    const box = el('div', 'detail');
    box.append(el('div', 'detail-label', label), el('div', 'detail-value', value));
    if (extra) box.append(el('div', 'detail-extra', extra));
    return box;
  }));
}

function render(data, fetchedAt, fromCache) {
  lastData = data;
  renderHero(data);
  renderHourly(data);
  renderDaily(data);
  renderDetails(data);
  lastFetchedAt = fetchedAt;
  const when = new Date(fetchedAt).toLocaleString('de-AT', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  $('updated').textContent = `Aktualisiert: ${when}${fromCache ? ' (gespeicherter Stand)' : ''}`;
}

// ---------- location handling ----------
function updateFavButton() {
  const btn = $('btn-fav');
  const fav = currentLocation && !currentLocation.isGps && store.isFavorite(currentLocation);
  btn.textContent = fav ? '★' : '☆';
  btn.classList.toggle('is-active', Boolean(fav));
  btn.disabled = !currentLocation || Boolean(currentLocation.isGps);
  btn.setAttribute('aria-label', fav ? 'Favorit entfernen' : 'Als Favorit speichern');
}

async function loadLocation(loc) {
  currentLocation = loc;
  store.setLastLocation(loc);
  $('location-name').textContent = loc.name;
  updateFavButton();
  renderWarnings(null);

  const cached = store.getCachedForecast(loc);
  if (cached) render(cached.data, cached.fetchedAt, true);

  if (!navigator.onLine) {
    showStatus(cached ? 'Offline – gespeicherter Stand' : 'Offline – noch keine Daten für diesen Ort', cached ? 'warn' : 'error');
    return;
  }

  const seq = ++requestSeq;
  setBusy(true);
  try {
    const data = await fetchForecast(loc.lat, loc.lon);
    if (seq !== requestSeq) return; // a newer request superseded this one
    const fetchedAt = Date.now();
    store.setCachedForecast(loc, data, fetchedAt);
    render(data, fetchedAt, false);
    showStatus(null);
    loadWarnings(loc);
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error('forecast failed', err);
    showStatus(cached ? 'Keine Verbindung – gespeicherter Stand' : 'Wetterdaten konnten nicht geladen werden', cached ? 'warn' : 'error');
  } finally {
    if (seq === requestSeq) setBusy(false);
  }
}

function useGps(fallback) {
  if (!('geolocation' in navigator)) {
    showStatus('GPS wird von diesem Browser nicht unterstützt', 'error');
    if (fallback) loadLocation(fallback);
    return;
  }
  showStatus('Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Rounded to ~1 km for data minimisation (GDPR) before it is sent to Open-Meteo.
      loadLocation({
        name: 'Mein Standort',
        lat: Number(pos.coords.latitude.toFixed(2)),
        lon: Number(pos.coords.longitude.toFixed(2)),
        isGps: true,
      });
    },
    (err) => {
      const msg = err.code === err.PERMISSION_DENIED
        ? 'Standortzugriff verweigert – bitte Ort über den Namen oben suchen'
        : 'Standort nicht verfügbar – bitte Ort suchen';
      showStatus(msg, 'warn');
      if (fallback) loadLocation(fallback);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
  );
}

// ---------- warnings (GeoSphere Austria) ----------
async function loadWarnings(loc) {
  const seq = ++warnSeq;
  try {
    const result = await fetchWarnings(loc.lat, loc.lon);
    if (seq === warnSeq) renderWarnings(result);
  } catch (err) {
    console.warn('warnings failed', err);
    if (seq === warnSeq) {
      renderWarnings(null);
      $('warn-info').textContent = 'Unwetterwarnungen derzeit nicht abrufbar';
    }
  }
}

function renderWarnings(result) {
  lastWarnings = result;
  const banner = $('warnings');
  const info = $('warn-info');
  banner.hidden = true;
  info.replaceChildren();
  if (!result) return;
  if (!result.covered) {
    const link = el('a', '', 'Warnkarte Europa (MeteoAlarm) ›');
    link.href = 'https://meteoalarm.org/';
    link.target = '_blank';
    link.rel = 'noopener';
    info.append('Unwetterwarnungen in der App nur für Österreich und Deutschland · ', link);
    return;
  }
  const src = SOURCES[result.source];
  if (!result.warnings.length) {
    info.textContent = `Unwetterwarnungen: keine aktiv${result.area ? ` (${result.area})` : ''} · ${src.label}`;
    return;
  }
  const top = result.warnings[0];
  const level = LEVELS[top.level] || LEVELS[1];
  const textBox = el('span', 'warn-text');
  textBox.append(
    el('strong', '', `Warnstufe ${level.name}: ${top.typeName}`),
    el('span', '', top.text),
  );
  const more = result.warnings.length > 1 ? `+${result.warnings.length - 1} weitere · ` : '';
  textBox.append(el('span', 'warn-more', `${more}Details ›`));
  banner.className = `warn-banner warn-${level.key}`;
  banner.replaceChildren(el('span', 'warn-icon', top.icon), textBox);
  banner.hidden = false;
  info.textContent = `Unwetterwarnungen: ${src.label}`;
}

function openWarningDetails() {
  const result = lastWarnings;
  if (!result || !result.warnings.length) return;
  const src = SOURCES[result.source];
  const box = el('div', 'warn-details');
  if (result.area) box.append(el('p', 'muted', `Gebiet: ${result.area}`));
  for (const w of result.warnings) {
    const level = LEVELS[w.level] || LEVELS[1];
    const card = el('article', `warn-card warn-${level.key}`);
    card.append(
      el('h3', '', `${w.icon} ${w.typeName} – Warnstufe ${level.name}`),
      el('p', 'warn-time', `${w.begin} bis ${w.end}`),
      el('p', '', w.text),
    );
    if (w.details && w.details !== w.text) card.append(el('p', '', w.details));
    const section = (title, items) => {
      if (!items.length) return;
      card.append(el('h4', '', title));
      const ul = el('ul');
      items.forEach((l) => ul.append(el('li', '', l)));
      card.append(ul);
    };
    section('Mögliche Auswirkungen', w.impacts);
    section('Empfehlungen', w.advice);
    box.append(card);
  }
  const foot = el('p', 'source');
  const link = el('a', '', src.urlLabel);
  link.href = src.url;
  link.target = '_blank';
  link.rel = 'noopener';
  foot.append(`Quelle: ${src.label} (${src.license}) · `, link);
  box.append(foot);
  openModal('Unwetterwarnungen', box);
}

// ---------- radar & spread chart (loaded on demand) ----------
async function openRadar() {
  if (!currentLocation) return;
  if (!navigator.onLine) { showStatus('Das Regenradar braucht eine Internetverbindung', 'warn'); return; }
  const { createRadar } = await import('./radar.js');
  const radar = createRadar(currentLocation);
  openModal(`Regenradar · ${currentLocation.name}`, radar.node, { onClose: () => radar.destroy() });
}

async function openSpread() {
  if (!currentLocation) return;
  const loc = currentLocation;
  openModal(`Schwankungsbreite · ${loc.name}`, el('p', 'muted', 'Ensemble-Prognose wird geladen …'));
  try {
    const [{ fetchSpread }, { renderSpreadChart }] = await Promise.all([import('./ensemble.js'), import('./chart.js')]);
    const spread = await fetchSpread(loc.lat, loc.lon);
    if (!isModalOpen() || loc !== currentLocation) return;
    const nowHour = lastData ? `${lastData.current.time.slice(0, 13)}:00` : '';
    setModalContent(renderSpreadChart(spread.rows, { nowHour, members: spread.members }));
  } catch (err) {
    console.error('spread failed', err);
    if (isModalOpen()) setModalContent(el('p', 'status status-error', 'Die Ensemble-Daten konnten nicht geladen werden – Verbindung prüfen.'));
  }
}

// ---------- search sheet ----------
function locationSubtitle(loc) {
  return [loc.admin1, loc.country].filter(Boolean).join(', ');
}

function locationItem(loc, { removable = false } = {}) {
  const li = el('li');
  const pick = el('button', 'pick', loc.name);
  pick.type = 'button';
  const sub = locationSubtitle(loc);
  if (sub) pick.append(el('small', '', sub));
  pick.addEventListener('click', () => { closeSheet(); loadLocation(loc); });
  li.append(pick);
  if (removable) {
    const rm = el('button', 'remove', '✕');
    rm.type = 'button';
    rm.setAttribute('aria-label', `${loc.name} aus Favoriten entfernen`);
    rm.addEventListener('click', () => { store.removeFavorite(loc); renderFavorites(); updateFavButton(); });
    li.append(rm);
  }
  return li;
}

function renderFavorites() {
  const favs = store.getFavorites();
  const list = $('favorites');
  list.replaceChildren(...(favs.length
    ? favs.map((f) => locationItem(f, { removable: true }))
    : [el('li', 'empty', 'Noch keine Favoriten – Ort wählen und oben ☆ antippen.')]));
}

async function runSearch(query) {
  const list = $('search-results');
  if (query.length < 2) { list.replaceChildren(); return; }
  try {
    const results = await searchLocations(query);
    if ($('search-input').value.trim() !== query) return; // outdated response
    list.replaceChildren(...(results.length
      ? results.map((r) => locationItem(r))
      : [el('li', 'empty', 'Kein Ort gefunden')]));
  } catch (err) {
    console.error('search failed', err);
    list.replaceChildren(el('li', 'empty', 'Suche nicht möglich – Verbindung prüfen'));
  }
}

function openSheet() {
  $('sheet').hidden = false;
  $('search-input').value = '';
  $('search-results').replaceChildren();
  renderFavorites();
  setTimeout(() => $('search-input').focus(), 50);
}

function closeSheet() {
  $('sheet').hidden = true;
}

// ---------- init ----------
function bindEvents() {
  $('btn-location').addEventListener('click', openSheet);
  $('btn-refresh').addEventListener('click', () => currentLocation && loadLocation(currentLocation));
  $('btn-gps').addEventListener('click', () => useGps(null));
  $('btn-fav').addEventListener('click', () => {
    if (!currentLocation || currentLocation.isGps) return;
    store.toggleFavorite(currentLocation);
    updateFavButton();
  });
  document.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeSheet));
  document.querySelectorAll('[data-close-modal]').forEach((n) => n.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeModal(); } });
  $('warnings').addEventListener('click', openWarningDetails);
  $('btn-radar').addEventListener('click', openRadar);
  $('btn-spread').addEventListener('click', openSpread);

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch($('search-input').value.trim());
  });
  $('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 350);
  });

  window.addEventListener('online', () => currentLocation && loadLocation(currentLocation));
  window.addEventListener('offline', () => showStatus('Offline – gespeicherter Stand', 'warn'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentLocation && Date.now() - lastFetchedAt > STALE_AFTER_MS) {
      loadLocation(currentLocation);
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  }
}

function init() {
  bindEvents();
  registerServiceWorker();
  const last = store.getLastLocation();
  if (!last) {
    useGps(DEFAULT_LOCATION);
  } else {
    loadLocation(last); // show cached data immediately
    if (last.isGps) useGps(null); // then refresh the GPS position
  }
}

init();
