// Official weather warnings, normalised to one format:
//   Austria  -> GeoSphere Austria Warn API (data CC BY 4.0), per municipality
//   Germany  -> Deutscher Wetterdienst, WFS "Warnungen_Gemeinden" (DWD open data)
//   elsewhere -> not covered (UI links to meteoalarm.org)
// MeteoAlarm (all of Europe) would need an API key / server-side proxy - see docs/ENTSCHEIDUNGEN.md (E8)
const GEOSPHERE_URL = 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords';
const DWD_WFS = 'https://maps.dwd.de/geoserver/dwd/ows';
const TIMEOUT_MS = 12000;

export const LEVELS = {
  1: { name: 'Gelb', key: 'yellow' },
  2: { name: 'Orange', key: 'orange' },
  3: { name: 'Rot', key: 'red' },
  4: { name: 'Violett', key: 'purple' }, // DWD "extreme" only
};

const GEOSPHERE_TYPES = {
  1: ['Sturm', '🌬️'], 2: ['Regen', '🌧️'], 3: ['Schnee', '❄️'], 4: ['Glatteis', '🧊'],
  5: ['Gewitter', '⛈️'], 6: ['Hitze', '🌡️'], 7: ['Kälte', '🥶'],
};

const DWD_GROUPS = {
  THUNDERSTORM: ['Gewitter', '⛈️'], WIND: ['Wind', '🌬️'], TORNADO: ['Tornado', '🌪️'],
  RAIN: ['Regen', '🌧️'], HAIL: ['Hagel', '🧊'], SNOWFALL: ['Schneefall', '❄️'],
  SNOWDRIFT: ['Schneeverwehung', '❄️'], FOG: ['Nebel', '🌫️'], FROST: ['Frost', '🥶'],
  GLAZE: ['Glätte', '🧊'], THAW: ['Tauwetter', '💧'], POWERLINEVIBRATION: ['Leitungsschwingungen', '⚡'],
  UV: ['UV-Strahlung', '☀️'], HEAT: ['Hitze', '🌡️'],
};
const DWD_SEVERITY = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };

export const SOURCES = {
  geosphere: { label: 'GeoSphere Austria', license: 'CC BY 4.0', url: 'https://warnungen.zamg.at/', urlLabel: 'warnungen.zamg.at' },
  dwd: { label: 'Deutscher Wetterdienst', license: 'Datenbasis: DWD', url: 'https://www.dwd.de/warnungen', urlLabel: 'dwd.de/warnungen' },
};

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status, json: res.ok ? await res.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

const lines = (text) => (text || '').split('\n').map((l) => l.replace(/^\s*\*\s*/, '').trim()).filter(Boolean);
const fmtDate = (iso) => new Date(iso).toLocaleString('de-AT', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

// ---------- Austria ----------
async function fetchGeoSphere(lat, lon) {
  const params = new URLSearchParams({ lon: lon.toFixed(4), lat: lat.toFixed(4), lang: 'de' });
  const { status, json } = await getJson(`${GEOSPHERE_URL}?${params}`);
  if (status === 404) return null; // not an Austrian municipality
  if (!json) throw new Error(`GeoSphere HTTP ${status}`);
  const props = json.properties || {};
  const now = Date.now() / 1000;
  const warnings = (props.warnings || [])
    .map((w) => w.properties || {})
    .filter((p) => !p.rawinfo || Number(p.rawinfo.end) > now)
    .map((p) => {
      const [typeName, icon] = GEOSPHERE_TYPES[p.warntypid] || ['Warnung', '⚠️'];
      return {
        typeName, icon, level: p.warnstufeid || 1,
        begin: p.begin, end: p.end, start: Number(p.rawinfo?.start) || 0,
        text: p.text || '', impacts: lines(p.auswirkungen), advice: lines(p.empfehlungen), details: p.meteotext || '',
      };
    });
  return { covered: true, source: 'geosphere', area: props.location?.properties?.name || '', warnings };
}

// ---------- Germany ----------
function wfsUrl(typeName, geomField, lat, lon, properties) {
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName,
    outputFormat: 'application/json', propertyName: properties,
    CQL_FILTER: `INTERSECTS(${geomField},POINT(${lat.toFixed(4)} ${lon.toFixed(4)}))`,
  });
  return `${DWD_WFS}?${params}`;
}

async function fetchDwd(lat, lon) {
  const fields = 'NAME,EVENT,SEVERITY,EC_GROUP,HEADLINE,DESCRIPTION,INSTRUCTION,ONSET,EXPIRES,STATUS,MSGTYPE';
  const [warnRes, areaRes] = await Promise.all([
    getJson(wfsUrl('dwd:Warnungen_Gemeinden', 'THE_GEOM', lat, lon, fields)),
    getJson(wfsUrl('dwd:Warngebiete_Gemeinden', 'SHAPE', lat, lon, 'NAME')), // coverage check
  ]);
  const area = areaRes.json?.features?.[0]?.properties?.NAME;
  const raw = (warnRes.json?.features || []).map((f) => f.properties || {});
  if (!area && !raw.length) return null; // not a German municipality
  const now = Date.now();
  const warnings = raw
    .filter((p) => p.STATUS === 'Actual' && p.MSGTYPE !== 'Cancel' && (!p.EXPIRES || Date.parse(p.EXPIRES) > now))
    .map((p) => {
      const group = (p.EC_GROUP || '').split(';')[0];
      const [typeName, icon] = DWD_GROUPS[group] || [p.EVENT ? p.EVENT.charAt(0) + p.EVENT.slice(1).toLowerCase() : 'Warnung', '⚠️'];
      return {
        typeName, icon, level: DWD_SEVERITY[p.SEVERITY] || 1,
        begin: p.ONSET ? fmtDate(p.ONSET) : '', end: p.EXPIRES ? fmtDate(p.EXPIRES) : 'auf Weiteres',
        start: p.ONSET ? Date.parse(p.ONSET) / 1000 : 0,
        text: p.HEADLINE || p.EVENT || '', impacts: [],
        advice: lines(p.INSTRUCTION).filter((l) => !/:\s*$/.test(l)), // drop bare headers like "Handlungsempfehlungen:"
        details: p.DESCRIPTION || '',
      };
    });
  return { covered: true, source: 'dwd', area: raw[0]?.NAME || area || '', warnings };
}

/** Returns { covered, source, area, warnings[] } for the given point. */
export async function fetchWarnings(lat, lon) {
  const result = (await fetchGeoSphere(lat, lon)) || (await fetchDwd(lat, lon))
    || { covered: false, source: null, area: '', warnings: [] };
  result.warnings.sort((a, b) => b.level - a.level || a.start - b.start);
  return result;
}
