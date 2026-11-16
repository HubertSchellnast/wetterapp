// Official weather warnings from GeoSphere Austria (Warn API, data CC BY 4.0).
// Coverage: Austrian municipalities only; high-alpine areas are not covered.
const WARN_URL = 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords';
const TIMEOUT_MS = 10000;

// API enums: warntypid 1..7, warnstufeid 1..3
export const WARN_TYPES = {
  1: ['Sturm', '🌬️'],
  2: ['Regen', '🌧️'],
  3: ['Schnee', '❄️'],
  4: ['Glatteis', '🧊'],
  5: ['Gewitter', '⛈️'],
  6: ['Hitze', '🌡️'],
  7: ['Kälte', '🥶'],
};
export const WARN_LEVELS = {
  1: ['Gelb', 'yellow'],
  2: ['Orange', 'orange'],
  3: ['Rot', 'red'],
};

export async function fetchWarnings(lat, lon) {
  const params = new URLSearchParams({ lon: lon.toFixed(4), lat: lat.toFixed(4), lang: 'de' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WARN_URL}?${params}`, { signal: controller.signal });
    if (res.status === 404) return { covered: false, municipality: '', warnings: [] }; // outside Austria
    if (!res.ok) throw new Error(`HTTP ${res.status} for warnings`);
    const json = await res.json();
    const props = json.properties || {};
    const now = Date.now() / 1000;
    const warnings = (props.warnings || [])
      .map((w) => w.properties || {})
      .filter((p) => !p.rawinfo || Number(p.rawinfo.end) > now) // drop expired ones
      .map((p) => ({
        type: p.warntypid,
        level: p.warnstufeid,
        begin: p.begin,
        end: p.end,
        start: Number(p.rawinfo?.start) || 0,
        text: p.text || '',
        impacts: p.auswirkungen || '',
        advice: p.empfehlungen || '',
        meteo: p.meteotext || '',
      }))
      .sort((a, b) => b.level - a.level || a.start - b.start);
    return { covered: true, municipality: props.location?.properties?.name || '', warnings };
  } finally {
    clearTimeout(timer);
  }
}

/** Splits the API's "* item\n* item" text into list items. */
export function bulletLines(text) {
  return text.split('\n').map((l) => l.replace(/^\s*\*\s*/, '').trim()).filter(Boolean);
}
