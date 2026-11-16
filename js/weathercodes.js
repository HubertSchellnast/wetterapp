// WMO weather interpretation codes as used by Open-Meteo.
const CODES = {
  0: ['Klar', '☀️', '🌙'],
  1: ['Überwiegend klar', '🌤️', '🌙'],
  2: ['Teilweise bewölkt', '⛅', '☁️'],
  3: ['Bedeckt', '☁️', '☁️'],
  45: ['Nebel', '🌫️', '🌫️'],
  48: ['Raureifnebel', '🌫️', '🌫️'],
  51: ['Leichter Nieselregen', '🌦️', '🌧️'],
  53: ['Nieselregen', '🌦️', '🌧️'],
  55: ['Starker Nieselregen', '🌧️', '🌧️'],
  56: ['Gefrierender Nieselregen', '🌧️', '🌧️'],
  57: ['Starker gefrierender Nieselregen', '🌧️', '🌧️'],
  61: ['Leichter Regen', '🌦️', '🌧️'],
  63: ['Regen', '🌧️', '🌧️'],
  65: ['Starker Regen', '🌧️', '🌧️'],
  66: ['Gefrierender Regen', '🌧️', '🌧️'],
  67: ['Starker gefrierender Regen', '🌧️', '🌧️'],
  71: ['Leichter Schneefall', '🌨️', '🌨️'],
  73: ['Schneefall', '🌨️', '🌨️'],
  75: ['Starker Schneefall', '❄️', '❄️'],
  77: ['Schneegriesel', '🌨️', '🌨️'],
  80: ['Leichte Regenschauer', '🌦️', '🌧️'],
  81: ['Regenschauer', '🌧️', '🌧️'],
  82: ['Heftige Regenschauer', '⛈️', '⛈️'],
  85: ['Leichte Schneeschauer', '🌨️', '🌨️'],
  86: ['Schneeschauer', '❄️', '❄️'],
  95: ['Gewitter', '⛈️', '⛈️'],
  96: ['Gewitter mit Hagel', '⛈️', '⛈️'],
  99: ['Schweres Gewitter mit Hagel', '⛈️', '⛈️'],
};

export function describe(code, isDay = 1) {
  const entry = CODES[code];
  if (!entry) return { label: 'Unbekannt', icon: '❔' };
  return { label: entry[0], icon: isDay ? entry[1] : entry[2] };
}

// Maps a WMO code to a background scene + intensity (used by background.js).
const SCENE_MAP = {
  0: ['clear', 'normal'], 1: ['clear', 'normal'], 2: ['partly', 'normal'], 3: ['cloudy', 'normal'],
  45: ['fog', 'normal'], 48: ['fog', 'normal'],
  51: ['drizzle', 'light'], 53: ['drizzle', 'normal'], 55: ['drizzle', 'heavy'],
  56: ['drizzle', 'normal'], 57: ['drizzle', 'heavy'],
  61: ['rain', 'light'], 63: ['rain', 'normal'], 65: ['rain', 'heavy'],
  66: ['rain', 'light'], 67: ['rain', 'heavy'],
  80: ['rain', 'light'], 81: ['rain', 'normal'], 82: ['rain', 'heavy'],
  71: ['snow', 'light'], 73: ['snow', 'normal'], 75: ['snow', 'heavy'], 77: ['snow', 'light'],
  85: ['snow', 'normal'], 86: ['snow', 'heavy'],
  95: ['storm', 'normal'], 96: ['storm', 'heavy'], 99: ['storm', 'heavy'],
};

export function sceneFor(code) {
  const [scene, intensity] = SCENE_MAP[code] || ['cloudy', 'normal'];
  return { scene, intensity };
}
