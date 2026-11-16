// Open-Meteo API client (https://open-meteo.com) - data licensed CC BY 4.0, no API key required.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 12000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
      'precipitation', 'weather_code', 'surface_pressure',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    ].join(','),
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'precipitation_probability_max', 'precipitation_sum',
      'sunrise', 'sunset', 'uv_index_max',
    ].join(','),
    timezone: 'auto',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  });
  return getJson(`${FORECAST_URL}?${params}`);
}

export async function searchLocations(query) {
  const params = new URLSearchParams({ name: query, count: '8', language: 'de', format: 'json' });
  const data = await getJson(`${GEOCODING_URL}?${params}`);
  return (data.results || []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    admin1: r.admin1 || '',
    country: r.country || '',
  }));
}
