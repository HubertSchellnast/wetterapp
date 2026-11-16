// Weather-dependent animated background: gradient per scene + subtle canvas particles,
// drifting clouds and lightning. Throttled to 30 fps, paused when the app is hidden,
// static when the user prefers reduced motion.
const FPS = 30;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const SCENES = {
  clear:   { day: ['#123a63', '#0b0f17'], night: ['#0b1230', '#05070d'], fx: { day: null, night: 'stars' }, clouds: 0, glow: true },
  partly:  { day: ['#16324f', '#0b0f17'], night: ['#0d1529', '#06080e'], fx: { day: null, night: 'stars' }, clouds: 0.22, glow: true },
  cloudy:  { day: ['#1f2835', '#0b0f17'], night: ['#131922', '#07090d'], fx: { day: null, night: null }, clouds: 0.38 },
  fog:     { day: ['#272e37', '#0e1116'], night: ['#181c22', '#08090c'], fx: { day: null, night: null }, clouds: 0.5, fog: true },
  drizzle: { day: ['#18232f', '#090c11'], night: ['#10161f', '#06080b'], fx: { day: 'drizzle', night: 'drizzle' }, clouds: 0.32 },
  rain:    { day: ['#15202c', '#080b10'], night: ['#0e141c', '#05070a'], fx: { day: 'rain', night: 'rain' }, clouds: 0.4 },
  snow:    { day: ['#22303f', '#0b0f17'], night: ['#151c27', '#07090d'], fx: { day: 'snow', night: 'snow' }, clouds: 0.3 },
  storm:   { day: ['#1c1833', '#07060d'], night: ['#120f22', '#050409'], fx: { day: 'rain', night: 'rain' }, clouds: 0.5, lightning: true },
};

const COUNTS = {
  rain: { light: 50, normal: 90, heavy: 140 },
  drizzle: { light: 25, normal: 35, heavy: 50 },
  snow: { light: 50, normal: 85, heavy: 130 },
  stars: { light: 80, normal: 80, heavy: 80 },
};

let sky = null;
let canvas = null;
let ctx = null;
let flash = null;
let particles = [];
let fx = null;
let intensity = 'normal';
let lightning = false;
let sceneKey = '';
let rafId = 0;
let lastFrame = 0;
let flashTimer = 0;
let dpr = 1;

function ensureDom() {
  if (sky) return;
  sky = document.createElement('div');
  sky.className = 'sky';
  sky.setAttribute('aria-hidden', 'true');
  canvas = document.createElement('canvas');
  ctx = canvas.getContext('2d');
  flash = document.createElement('div');
  flash.className = 'flash';
  sky.append(canvas);
  for (const c of ['c1', 'c2', 'c3']) {
    const cloud = document.createElement('div');
    cloud.className = `cloud ${c}`;
    sky.append(cloud);
  }
  sky.append(flash);
  document.body.prepend(sky);
  window.addEventListener('resize', () => { resize(); spawn(); drawFrame(false); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

const rand = (min, max) => min + Math.random() * (max - min);

function spawn() {
  const w = canvas.width;
  const h = canvas.height;
  const n = fx ? COUNTS[fx][intensity] : 0;
  particles = Array.from({ length: n }, () => {
    switch (fx) {
      case 'rain':
      case 'drizzle': {
        const short = fx === 'drizzle';
        return { x: rand(0, w * 1.1), y: rand(-h, h), len: (short ? rand(5, 9) : rand(12, 24)) * dpr, v: (short ? rand(5, 7) : rand(10, 15)) * dpr };
      }
      case 'snow':
        return { x: rand(0, w), y: rand(0, h), r: rand(1.2, 3.4) * dpr, v: rand(0.5, 1.6) * dpr, phase: rand(0, Math.PI * 2), amp: rand(0.3, 1.1) * dpr };
      case 'stars':
        return { x: rand(0, w), y: rand(0, h * 0.6), r: rand(0.4, 1.4) * dpr, phase: rand(0, Math.PI * 2), speed: rand(0.02, 0.06) };
      default:
        return null;
    }
  });
}

function drawFrame(advance) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!fx) return;

  if (fx === 'rain' || fx === 'drizzle') {
    ctx.strokeStyle = fx === 'rain' ? 'rgba(170, 200, 240, 0.32)' : 'rgba(170, 200, 240, 0.25)';
    ctx.lineWidth = dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of particles) {
      if (advance) {
        p.y += p.v;
        p.x -= p.v * 0.15;
        if (p.y > h) { p.y = -p.len; p.x = rand(0, w * 1.1); }
      }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.len * 0.15, p.y + p.len);
    }
    ctx.stroke();
  } else if (fx === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    for (const p of particles) {
      if (advance) {
        p.y += p.v;
        p.phase += 0.03;
        p.x += Math.sin(p.phase) * p.amp;
        if (p.y > h + p.r) { p.y = -p.r; p.x = rand(0, w); }
      }
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (fx === 'stars') {
    for (const p of particles) {
      if (advance) p.phase += p.speed;
      ctx.fillStyle = `rgba(230, 237, 247, ${0.3 + 0.5 * (0.5 + 0.5 * Math.sin(p.phase))})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function loop(ts) {
  rafId = requestAnimationFrame(loop);
  if (ts - lastFrame < 1000 / FPS) return;
  lastFrame = ts;
  drawFrame(true);
}

function scheduleLightning() {
  clearTimeout(flashTimer);
  if (!lightning || reducedMotion.matches || document.hidden) return;
  flashTimer = setTimeout(() => {
    flash.classList.remove('on');
    void flash.offsetWidth; // restart CSS animation
    flash.classList.add('on');
    scheduleLightning();
  }, rand(4000, 12000));
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearTimeout(flashTimer);
}

function start() {
  stop();
  drawFrame(false);
  if (fx && !reducedMotion.matches && !document.hidden) rafId = requestAnimationFrame(loop);
  scheduleLightning();
}

export function setScene(scene, isDay, level = 'normal') {
  ensureDom();
  const def = SCENES[scene] || SCENES.cloudy;
  const time = isDay ? 'day' : 'night';
  const key = `${scene}|${time}|${level}`;
  if (key === sceneKey) return;
  sceneKey = key;

  const [top, bottom] = def[time];
  sky.style.setProperty('--sky-top', top);
  sky.style.setProperty('--sky-bottom', bottom);
  sky.style.setProperty('--cloud-alpha', String(def.clouds));
  sky.dataset.scene = scene;
  sky.dataset.time = time;
  sky.dataset.glow = def.glow ? (isDay ? 'sun' : 'moon') : 'none';
  sky.dataset.fog = def.fog ? '1' : '0';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', top);

  fx = def.fx[time];
  intensity = level;
  lightning = Boolean(def.lightning);
  spawn();
  start();
}
