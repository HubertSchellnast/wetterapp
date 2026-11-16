// Local-only persistence (localStorage). Nothing leaves the device.
const KEY_LAST = 'wx.lastLocation';
const KEY_FAVS = 'wx.favorites';
const KEY_FORECAST_PREFIX = 'wx.forecast.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('storage write failed', key, err);
  }
}

export const locationKey = (loc) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

export const getLastLocation = () => read(KEY_LAST, null);
export const setLastLocation = (loc) => write(KEY_LAST, loc);

export const getFavorites = () => read(KEY_FAVS, []);
export const isFavorite = (loc) => getFavorites().some((f) => locationKey(f) === locationKey(loc));

export function toggleFavorite(loc) {
  const favs = getFavorites();
  const key = locationKey(loc);
  const exists = favs.some((f) => locationKey(f) === key);
  const next = exists ? favs.filter((f) => locationKey(f) !== key) : [...favs, loc];
  write(KEY_FAVS, next);
  return !exists;
}

export function removeFavorite(loc) {
  write(KEY_FAVS, getFavorites().filter((f) => locationKey(f) !== locationKey(loc)));
}

export const getCachedForecast = (loc) => read(KEY_FORECAST_PREFIX + locationKey(loc), null);
export const setCachedForecast = (loc, data, fetchedAt) =>
  write(KEY_FORECAST_PREFIX + locationKey(loc), { data, fetchedAt });
