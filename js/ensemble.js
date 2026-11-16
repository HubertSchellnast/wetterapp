// Forecast uncertainty from the Open-Meteo Ensemble API (data CC BY 4.0).
// Model: DWD ICON seamless ensemble (40 runs, hourly, 7 days).
const ENS_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const MODEL = 'icon_seamless';
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export async function fetchSpread(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    hourly: 'temperature_2m',
    models: MODEL,
    forecast_days: '7',
    timezone: 'auto',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let json;
  try {
    const res = await fetch(`${ENS_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ensemble`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const h = json.hourly;
  const memberKeys = Object.keys(h).filter((k) => k.startsWith('temperature_2m'));
  const rows = h.time.map((time, i) => {
    const v = memberKeys.map((k) => h[k][i]).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
    if (v.length < 3) return null;
    return { time, min: v[0], p10: quantile(v, 0.1), p50: quantile(v, 0.5), p90: quantile(v, 0.9), max: v[v.length - 1] };
  }).filter(Boolean);

  const data = { rows, members: memberKeys.length };
  cache.set(key, { at: Date.now(), data });
  return data;
}
