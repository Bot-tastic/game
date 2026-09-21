// fx.js — dirt, smoke, sparks, coin pops, screen shake and floating text.
// Purely cosmetic: the simulation never reads back from here, so respecting
// prefers-reduced-motion is only a matter of damping what we emit.

const reduceMotion = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

export function createFx() {
  return { parts: [], pops: [], shake: 0, flash: 0, flashColor: "#ffffff", reduceMotion };
}

function push(fx, p) {
  if (fx.parts.length > 360) fx.parts.shift();
  fx.parts.push(p);
}

/** Dirt/snow/dust thrown by a spinning wheel. */
export function dirt(fx, x, y, dirX, amount, color) {
  const n = Math.min(4, Math.ceil(amount * (reduceMotion ? 1 : 3)));
  for (let i = 0; i < n; i++) {
    push(fx, {
      kind: "dirt",
      x,
      y,
      vx: -dirX * (3 + Math.random() * 7) * amount,
      vy: 2 + Math.random() * 5,
      life: 0.45 + Math.random() * 0.35,
      t: 0,
      size: 0.05 + Math.random() * 0.07,
      color,
      gravity: 12,
    });
  }
}

/** Exhaust puff — slow, rising, fading. */
export function smoke(fx, x, y, vx = 0) {
  push(fx, {
    kind: "smoke",
    x,
    y,
    vx: vx * 0.2 + (Math.random() - 0.5) * 0.6,
    vy: 0.7 + Math.random() * 0.8,
    life: 0.7 + Math.random() * 0.5,
    t: 0,
    size: 0.09 + Math.random() * 0.09,
    color: "rgba(215,220,232,0.38)",
    gravity: -0.6,
  });
}

export function sparks(fx, x, y, n = 10, color = "#ffd166") {
  const count = reduceMotion ? Math.ceil(n / 2) : n;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 9;
    push(fx, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.abs(Math.sin(a)) * sp,
      life: 0.3 + Math.random() * 0.4,
      t: 0,
      size: 0.05 + Math.random() * 0.06,
      color,
      gravity: 16,
    });
  }
}

/** Floating text anchored in world space (coins, bonuses, warnings). */
export function pop(fx, x, y, text, color = "#ffd166", big = false) {
  fx.pops.push({ x, y, text, color, big, t: 0, life: 1.05 });
}

export function shake(fx, amount) {
  fx.shake = Math.min(1.4, fx.shake + (reduceMotion ? amount * 0.3 : amount));
}

export function flash(fx, color, amount = 0.5) {
  if (reduceMotion) amount *= 0.4;
  fx.flashColor = color;
  fx.flash = Math.max(fx.flash, amount);
}

export function updateFx(fx, dt) {
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.t += dt;
    if (p.t >= p.life) {
      fx.parts.splice(i, 1);
      continue;
    }
    p.vy -= p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 1.4 * dt;
  }
  for (let i = fx.pops.length - 1; i >= 0; i--) {
    const p = fx.pops[i];
    p.t += dt;
    p.y += dt * 1.5;
    if (p.t >= p.life) fx.pops.splice(i, 1);
  }
  fx.shake = Math.max(0, fx.shake - dt * 2.4);
  fx.flash = Math.max(0, fx.flash - dt * 2.2);
}

export function clearFx(fx) {
  fx.parts.length = 0;
  fx.pops.length = 0;
  fx.shake = 0;
  fx.flash = 0;
}
