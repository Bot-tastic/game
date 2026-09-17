// fx.js — particles, screen shake, hit-stop and floating text. Everything is
// purely cosmetic: the simulation never reads from here, so honouring
// prefers-reduced-motion is just a matter of damping the outputs.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFx() {
  return {
    parts: [],
    rings: [],
    shards: [],
    shake: 0,
    flash: 0,
    flashColor: "#ffffff",
    hitStop: 0,
    banner: null,
    reduceMotion,
  };
}

function push(fx, p) {
  if (fx.parts.length > 420) fx.parts.shift();
  fx.parts.push(p);
}

export function burst(fx, x, y, opts = {}) {
  const n = reduceMotion ? Math.ceil((opts.count || 10) / 2) : opts.count || 10;
  const spread = opts.spread != null ? opts.spread : Math.PI * 2;
  const dir = opts.dir != null ? opts.dir : 0;
  for (let i = 0; i < n; i++) {
    const a = dir + (Math.random() - 0.5) * spread;
    const sp = (opts.speed || 140) * (0.4 + Math.random() * 0.9);
    push(fx, {
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: opts.life || 0.5,
      t: 0,
      size: (opts.size || 5) * (0.5 + Math.random()),
      color: opts.color || "#ffffff",
      gravity: opts.gravity != null ? opts.gravity : 900,
      square: opts.square !== false,
      spin: (Math.random() - 0.5) * 12,
      rot: Math.random() * 6.28,
    });
  }
}

export function ring(fx, x, y, opts = {}) {
  fx.rings.push({
    x,
    y,
    t: 0,
    life: opts.life || 0.45,
    r0: opts.r0 || 8,
    r1: opts.r1 || 70,
    color: opts.color || "#ffffff",
    width: opts.width || 4,
  });
}

export function shatter(fx, x, y, color, color2) {
  const n = reduceMotion ? 12 : 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 160 + Math.random() * 320;
    fx.shards.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 120,
      rot: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * 16,
      size: 5 + Math.random() * 13,
      t: 0,
      life: 0.9,
      color: Math.random() < 0.5 ? color : color2,
    });
  }
  ring(fx, x, y, { color, r1: 160, life: 0.5, width: 6 });
  ring(fx, x, y, { color: color2, r1: 110, life: 0.36, width: 3 });
}

export function shake(fx, amount) {
  if (reduceMotion) return;
  fx.shake = Math.min(26, fx.shake + amount);
}

export function flash(fx, color, amount = 0.6) {
  fx.flashColor = color;
  fx.flash = Math.max(fx.flash, reduceMotion ? amount * 0.3 : amount);
}

export function hitStop(fx, seconds) {
  if (reduceMotion) return;
  fx.hitStop = Math.max(fx.hitStop, seconds);
}

export function banner(fx, text, color) {
  fx.banner = { text, color, t: 0, life: 1.5 };
}

export function updateFx(fx, dt) {
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.t += dt;
    if (p.t >= p.life) {
      fx.parts.splice(i, 1);
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }

  for (let i = fx.rings.length - 1; i >= 0; i--) {
    const r = fx.rings[i];
    r.t += dt;
    if (r.t >= r.life) fx.rings.splice(i, 1);
  }

  for (let i = fx.shards.length - 1; i >= 0; i--) {
    const s = fx.shards[i];
    s.t += dt;
    if (s.t >= s.life) {
      fx.shards.splice(i, 1);
      continue;
    }
    s.vy += 1100 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.rot += s.spin * dt;
  }

  fx.shake = Math.max(0, fx.shake - dt * 60);
  fx.flash = Math.max(0, fx.flash - dt * 3.2);
  if (fx.banner) {
    fx.banner.t += dt;
    if (fx.banner.t >= fx.banner.life) fx.banner = null;
  }
}

export function clearFx(fx) {
  fx.parts.length = 0;
  fx.rings.length = 0;
  fx.shards.length = 0;
  fx.shake = 0;
  fx.flash = 0;
  fx.hitStop = 0;
  fx.banner = null;
}
