// render.js — all drawing. Layered parallax sky, patterned ground, designed
// obstacle shapes, per-mode player art, particles and post effects.
//
// Nothing here reads input or mutates the simulation: draw(state) takes a
// snapshot and paints it. Additive ("lighter") passes are what give the neon
// look; they are kept to a few short passes per frame so a phone still holds
// 60fps.

import {
  GROUND_Y,
  CEIL_Y,
  TILE,
  VIEW_TOP,
  VIEW_BOTTOM,
  VIEW_W,
  solidRect,
  moveOffset,
} from "./levels.js";
import { HITBOX } from "./player.js";

const BAND_H = VIEW_BOTTOM - VIEW_TOP;

// -- colour helpers ---------------------------------------------------------

function rgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mix(a, b, t) {
  const ca = rgb(a);
  const cb = rgb(b);
  return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(
    ca[2] + (cb[2] - ca[2]) * t
  )})`;
}

function shade(hex, t) {
  return t < 0 ? mix(hex, "#000000", -t) : mix(hex, "#ffffff", t);
}

// -- deterministic decorative field ----------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DECO_SPAN = 1400;

function makeDecoField(seed, count, yMin, yMax) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: rnd() * DECO_SPAN,
      y: yMin + rnd() * (yMax - yMin),
      size: 24 + rnd() * 70,
      sides: 3 + Math.floor(rnd() * 4),
      rot: rnd() * Math.PI * 2,
      spin: (rnd() - 0.5) * 0.35,
      bob: rnd() * Math.PI * 2,
    });
  }
  return out;
}

const FAR_FIELD = makeDecoField(9901, 42, -470, 250);
const MID_FIELD = makeDecoField(4242, 31, -450, 255);
const NEAR_FIELD = makeDecoField(1717, 21, -400, 270);

// Fine drifting dust; cheap, and it stops the open sky reading as dead space.
// Backdrop architecture: dark pillars and arches standing on the horizon. They
// are never solid — they sit behind the terrain and give each frame something
// built to look at, the way a real level's background decoration does.
const STRUCTURES = (() => {
  const rnd = mulberry32(777);
  const out = [];
  let x = 0;
  while (x < DECO_SPAN) {
    const w = 34 + rnd() * 80;
    out.push({
      x,
      w,
      h: 40 + rnd() * 120,
      arch: rnd() < 0.4,
      notch: 0.2 + rnd() * 0.5,
      lights: 2 + Math.floor(rnd() * 4),
    });
    x += w + 60 + rnd() * 220;
  }
  return out;
})();

const STAR_FIELD = (() => {
  const rnd = mulberry32(2024);
  const out = [];
  for (let i = 0; i < 70; i++) {
    out.push({ x: rnd() * DECO_SPAN, y: -520 + rnd() * 800, r: 0.6 + rnd() * 1.9, tw: rnd() * 6.28, d: 0.06 + rnd() * 0.5 });
  }
  return out;
})();

function polyPath(ctx, x, y, r, sides, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let W = 0;
  let H = 0;
  let scale = 1;
  let bandTop = 0;
  let groundPattern = null;
  let patternTheme = null;

  function resize(w, h) {
    W = w;
    H = h;
    scale = Math.min(w / VIEW_W, h / BAND_H);
    const bandH = BAND_H * scale;
    bandTop = Math.max(0, (h - bandH) * 0.72);
    groundPattern = null;
  }

  const sy = (worldY) => bandTop + (worldY - VIEW_TOP) * scale;

  function buildGroundPattern(theme) {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = shade(theme.ground, -0.55);
    g.fillRect(0, 0, size, size);
    g.strokeStyle = rgba(theme.accent, 0.22);
    g.lineWidth = 2;
    for (let i = -size; i < size * 2; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + size, size);
      g.stroke();
    }
    g.strokeStyle = rgba(theme.glow, 0.09);
    g.lineWidth = 1;
    for (let i = 0; i <= size; i += 16) {
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(size, i);
      g.stroke();
    }
    groundPattern = ctx.createPattern(c, "repeat");
    patternTheme = theme;
  }

  // -- background ----------------------------------------------------------

  function drawSky(s) {
    const t = s.theme;
    const pulse = s.pulse;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, shade(t.sky0, 0.16));
    grad.addColorStop(0.5, shade(t.sky0, -0.05));
    grad.addColorStop(1, mix(t.sky1, t.accent, 0.12 + pulse * 0.1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // A distant disc sitting on the horizon gives the sky a focal point.
    const gy = sy(GROUND_Y);
    const sunR = Math.min(W, H) * 0.34;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const sun = ctx.createRadialGradient(W * 0.68, gy - sunR * 0.42, sunR * 0.1, W * 0.68, gy - sunR * 0.42, sunR);
    sun.addColorStop(0, rgba(t.accent2, 0.3));
    sun.addColorStop(0.42, rgba(t.accent, 0.14));
    sun.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(W * 0.68, gy - sunR * 0.42, sunR, 0, Math.PI * 2);
    ctx.fill();
    // Scan bands across the disc — a cheap retro-sun read.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = shade(t.sky0, -0.2);
    for (let i = 0; i < 7; i++) {
      const by = gy - sunR * 0.42 + sunR * (0.1 + i * 0.13);
      ctx.fillRect(W * 0.68 - sunR, by, sunR * 2, sunR * 0.035 * (1 + i * 0.5));
    }
    ctx.restore();

    // Horizon glow sitting just above the ground line, pumping on the beat.
    const r = Math.max(W, H) * (0.55 + pulse * 0.08);
    const glow = ctx.createRadialGradient(W * 0.5, gy, 0, W * 0.5, gy, r);
    glow.addColorStop(0, rgba(t.accent, 0.4 + pulse * 0.2));
    glow.addColorStop(0.45, rgba(t.accent2, 0.1));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  function drawDecoLayer(s, field, depth, opts) {
    const t = s.theme;
    const span = DECO_SPAN * scale;
    const shift = (s.camX * depth * scale) % span;
    ctx.save();
    ctx.globalCompositeOperation = opts.additive ? "lighter" : "source-over";
    ctx.lineWidth = opts.line;
    for (let rep = -1; rep <= Math.ceil(W / span) + 1; rep++) {
      for (const d of field) {
        const px = d.x * scale + rep * span - shift;
        if (px < -160 || px > W + 160) continue;
        const py = sy(d.y) + Math.sin(s.time * 0.5 + d.bob) * 10 * scale;
        const r = d.size * scale * opts.sizeMul;
        polyPath(ctx, px, py, r, d.sides, d.rot + s.time * d.spin);
        if (opts.fill) {
          ctx.fillStyle = rgba(opts.color, opts.alpha * (0.6 + s.pulse * 0.4));
          ctx.fill();
        } else {
          ctx.strokeStyle = rgba(opts.color, opts.alpha * (0.6 + s.pulse * 0.5));
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    void t;
  }

  function drawStars(s) {
    const span = DECO_SPAN * scale;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const st of STAR_FIELD) {
      const shift = (s.camX * st.d * scale) % span;
      for (let rep = 0; rep <= Math.ceil(W / span) + 1; rep++) {
        const px = st.x * scale + rep * span - shift;
        if (px < -6 || px > W + 6) continue;
        const py = sy(st.y);
        if (py < -6 || py > H + 6) continue;
        ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(s.time * 1.4 + st.tw));
        ctx.fillStyle = st.d > 0.3 ? s.theme.accent2 : "#ffffff";
        ctx.fillRect(px, py, st.r * scale, st.r * scale);
      }
    }
    ctx.restore();
  }

  function drawStructures(s) {
    const t = s.theme;
    const span = DECO_SPAN * scale;
    const depth = 0.42;
    const shift = (s.camX * depth * scale) % span;
    const gy = sy(GROUND_Y);
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let rep = 0; rep <= Math.ceil(W / span) + 1; rep++) {
      for (const st of STRUCTURES) {
        const px = st.x * scale + rep * span - shift;
        const pw = st.w * scale;
        if (px + pw < -20 || px > W + 20) continue;
        const ph = st.h * scale;
        const py = gy - ph;

        const g = ctx.createLinearGradient(0, py, 0, gy);
        g.addColorStop(0, mix(t.sky1, "#000000", 0.42));
        g.addColorStop(1, mix(t.sky1, t.accent, 0.3));
        ctx.fillStyle = g;
        if (st.arch) {
          ctx.beginPath();
          ctx.moveTo(px, gy);
          ctx.lineTo(px, py + pw * 0.5);
          ctx.arc(px + pw / 2, py + pw * 0.5, pw / 2, Math.PI, 0);
          ctx.lineTo(px + pw, gy);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(px, py, pw, ph);
          ctx.fillStyle = mix(t.sky1, "#000000", 0.55);
          ctx.fillRect(px + pw * st.notch, py, pw * 0.16, ph * 0.7);
        }

        // Rim + window lights so the silhouettes are not dead shapes.
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = rgba(t.accent, 0.22);
        ctx.lineWidth = Math.max(1, 1.2 * scale);
        ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph);
        for (let i = 0; i < st.lights; i++) {
          const ly = py + ph * (0.18 + i * 0.2);
          if (ly > gy - 4) break;
          ctx.fillStyle = rgba(t.glow, 0.14 + s.pulse * 0.26);
          ctx.fillRect(px + pw * 0.22, ly, pw * 0.56, 2 * scale);
        }
        ctx.restore();
      }
    }
    ctx.restore();

    // Atmospheric veil: pushes the whole layer behind the playfield so nothing
    // back here can be mistaken for something you are allowed to land on.
    const veil = ctx.createLinearGradient(0, gy - 300 * scale, 0, gy);
    veil.addColorStop(0, rgba(t.sky0, 0.3));
    veil.addColorStop(0.75, rgba(t.sky0, 0.78));
    veil.addColorStop(1, rgba(t.sky0, 0.92));
    ctx.fillStyle = veil;
    ctx.fillRect(0, gy - 300 * scale, W, 300 * scale);
  }

  function drawGrid(s) {
    const t = s.theme;
    const gy = sy(GROUND_Y);
    const spacing = TILE * 2 * scale;
    const shift = (s.camX * 0.35 * scale) % spacing;
    ctx.save();
    ctx.globalAlpha = 0.17 + s.pulse * 0.1;
    ctx.strokeStyle = t.accent2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -shift; x < W + spacing; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gy);
    }
    for (let y = gy; y > -spacing; y -= spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBackground(s) {
    drawSky(s);
    drawStars(s);
    drawDecoLayer(s, FAR_FIELD, 0.1, { color: s.theme.accent2, alpha: 0.4, line: 2.4 * scale, sizeMul: 1.5, additive: true });
    drawGrid(s);
    drawDecoLayer(s, MID_FIELD, 0.28, { color: s.theme.accent, alpha: 0.5, line: 3 * scale, sizeMul: 1, additive: true });
    drawStructures(s);
    drawDecoLayer(s, NEAR_FIELD, 0.55, { color: s.theme.sky1, alpha: 0.65, line: 0, sizeMul: 0.75, fill: true, additive: false });
    drawDecoLayer(s, NEAR_FIELD, 0.55, { color: s.theme.accent, alpha: 0.45, line: 2.4 * scale, sizeMul: 0.75, additive: true });
  }

  // -- terrain -------------------------------------------------------------

  // A terrain slab: `topY` is the world Y of the surface, `downward` says which
  // way the material extends. Dark body, patterned face, hot neon lip — the lip
  // is what the player actually reads, so it gets the glow budget.
  function drawSlab(s, x0, x1, topY, downward, depthWorld) {
    const t = s.theme;
    const y = sy(topY);
    const depth = depthWorld * scale;
    const yy = downward ? y : y - depth;
    const hh = downward ? Math.max(depth, H - y + 4) : depth;
    if (!groundPattern || patternTheme !== t) buildGroundPattern(t);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, yy, x1 - x0, hh);
    ctx.clip();

    const near = downward ? y : y;
    const far = downward ? y + hh : y - hh;
    const grad = ctx.createLinearGradient(0, near, 0, far);
    grad.addColorStop(0, mix(t.ground, "#000000", 0.45));
    grad.addColorStop(0.35, mix(t.sky0, "#000000", 0.35));
    grad.addColorStop(1, "#04050a");
    ctx.fillStyle = grad;
    ctx.fillRect(x0, yy, x1 - x0, hh);

    ctx.save();
    ctx.translate(-((s.camX * scale) % 64), 0);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = groundPattern;
    ctx.fillRect(x0 - 64, yy, x1 - x0 + 128, hh);
    ctx.restore();

    // Inner glow bleeding away from the lip.
    const eg = ctx.createLinearGradient(0, y, 0, y + (downward ? 1 : -1) * 54 * scale);
    eg.addColorStop(0, rgba(t.glow, 0.5));
    eg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = eg;
    ctx.fillRect(x0, downward ? y : y - 54 * scale, x1 - x0, 54 * scale);
    ctx.restore();

    // Outer bloom above the lip.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const bg = ctx.createLinearGradient(0, y - (downward ? 1 : -1) * 34 * scale, 0, y);
    bg.addColorStop(0, "rgba(0,0,0,0)");
    bg.addColorStop(1, rgba(t.glow, 0.28 + s.pulse * 0.22));
    ctx.fillStyle = bg;
    ctx.fillRect(x0, downward ? y - 34 * scale : y, x1 - x0, 34 * scale);
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, downward ? y - 1.5 * scale : y, x1 - x0, 1.8 * scale);
    ctx.fillStyle = rgba(t.glow, 0.95);
    ctx.fillRect(x0, downward ? y : y - 3.2 * scale, x1 - x0, 3.2 * scale);
    ctx.fillStyle = rgba(t.accent2, 0.5);
    ctx.fillRect(x0, downward ? y + 3.4 * scale : y - 5.6 * scale, x1 - x0, 1.6 * scale);
  }

  function drawTerrain(s) {
    const lv = s.level;
    for (const f of lv.floor) {
      const x0 = s.sx(f.x);
      const x1 = s.sx(f.x + f.w);
      if (x1 < -40 || x0 > W + 40) continue;
      drawSlab(s, Math.max(-40, x0), Math.min(W + 40, x1), f.y, true, 220);
    }
    if (lv.usesCeiling) {
      for (const c of lv.ceiling) {
        const x0 = s.sx(c.x);
        const x1 = s.sx(c.x + c.w);
        if (x1 < -40 || x0 > W + 40) continue;
        drawSlab(s, Math.max(-40, x0), Math.min(W + 40, x1), c.y + c.h, false, TILE * 2.4);
      }
    }
    // Pit void: a hard dark band with hot edges so a gap never reads as floor.
    for (const p of lv.pits) {
      const x0 = s.sx(p.x0);
      const x1 = s.sx(p.x1);
      if (x1 < -40 || x0 > W + 40) continue;
      const gy = sy(GROUND_Y);
      const g = ctx.createLinearGradient(0, gy, 0, H);
      g.addColorStop(0, "rgba(4,4,8,0.96)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = g;
      ctx.fillRect(x0, gy - 2, x1 - x0, H - gy + 2);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(s.theme.accent2, 0.8);
      ctx.fillRect(x0 - 2 * scale, gy, 3 * scale, 54 * scale);
      ctx.fillRect(x1 - scale, gy, 3 * scale, 54 * scale);
      ctx.restore();
    }
  }

  // -- obstacles -----------------------------------------------------------

  function drawBlock(s, r) {
    const t = s.theme;
    const x = s.sx(r.x);
    const y = sy(r.y);
    const w = r.w * scale;
    const h = r.h * scale;
    if (x + w < -40 || x > W + 40) return;

    const thin = r.style === "plat";
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, mix(t.sky1, "#ffffff", 0.14));
    grad.addColorStop(0.45, mix(t.sky1, "#000000", 0.55));
    grad.addColorStop(1, "#05060b");
    roundRect(ctx, x, y, w, h, thin ? h / 2 : Math.min(7 * scale, h / 3));
    ctx.fillStyle = grad;
    ctx.fill();

    // Inner tile hatching so big blocks are not flat fields of colour.
    if (!thin && w > 18 * scale && h > 18 * scale) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = rgba(t.accent, 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = x + TILE * scale; gx < x + w; gx += TILE * scale) {
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
      }
      for (let gy2 = y + TILE * scale; gy2 < y + h; gy2 += TILE * scale) {
        ctx.moveTo(x, gy2);
        ctx.lineTo(x + w, gy2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Bevel + emissive rim.
    ctx.strokeStyle = rgba(t.accent, 0.95);
    ctx.lineWidth = Math.max(1.6, 2.2 * scale);
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, thin ? h / 2 : Math.min(7 * scale, h / 3));
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = rgba(t.glow, 0.75);
    ctx.fillRect(x + 2 * scale, y, Math.max(0, w - 4 * scale), Math.max(1.5, 2.5 * scale));
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = t.accent2;
    ctx.fillRect(x + 2 * scale, y - 4 * scale, Math.max(0, w - 4 * scale), 4 * scale);
    ctx.restore();
  }

  function drawSpike(s, h) {
    const t = s.theme;
    const x = s.sx(h.x);
    const w = h.w * scale;
    if (x + w < -40 || x > W + 40) return;
    const up = h.dir === "up";
    const baseY = sy(h.y);
    const tipY = sy(up ? h.y - h.h : h.y + h.h);

    const grad = ctx.createLinearGradient(0, baseY, 0, tipY);
    grad.addColorStop(0, mix(t.accent, "#000000", 0.55));
    grad.addColorStop(0.5, t.accent);
    grad.addColorStop(1, shade(t.glow, 0.55));

    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + w, baseY);
    ctx.lineTo(x + w / 2, tipY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Rim light down the leading edge + a hot tip.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.4, 2 * scale);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, tipY);
    ctx.lineTo(x + w, baseY);
    ctx.stroke();
    ctx.strokeStyle = rgba(t.accent2, 0.45);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, tipY);
    ctx.lineTo(x, baseY);
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const tip = ctx.createRadialGradient(x + w / 2, tipY, 0, x + w / 2, tipY, w * 0.8);
    tip.addColorStop(0, rgba(t.glow, 0.55 + s.pulse * 0.25));
    tip.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tip;
    ctx.fillRect(x - w, tipY - w, w * 3, w * 2);
    ctx.restore();
  }

  function drawSaw(s, h) {
    const t = s.theme;
    const dy = moveOffset(h.move, s.level, s.camX);
    const x = s.sx(h.x);
    const y = sy(h.y + dy);
    const r = h.r * scale;
    if (x + r < -40 || x - r > W + 40) return;
    const rot = s.time * 7;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.74;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, shade(t.glow, 0.3));
    g.addColorStop(0.6, mix(t.accent, "#000000", 0.2));
    g.addColorStop(1, mix(t.sky0, "#000000", 0.2));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = rgba(t.glow, 0.85);
    ctx.lineWidth = Math.max(1.2, 1.6 * scale);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-rot * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = mix(t.sky0, "#000000", 0.4);
    ctx.fill();
    ctx.strokeStyle = rgba(t.accent2, 0.9);
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 1.9);
    gg.addColorStop(0, rgba(t.glow, 0.28));
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.restore();
  }

  function drawPad(s, pd) {
    const x = s.sx(pd.x);
    if (x < -60 || x > W + 60) return;
    const y = sy(pd.y);
    const col = pd.kind === "yellow" ? "#ffd23f" : "#ff6ad5";
    const w = 40 * scale;
    const h = 11 * scale;
    const d = pd.dir;
    const bob = Math.sin(s.time * 6) * 1.5 * scale;

    ctx.save();
    ctx.translate(x, y - d * bob);
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w * 0.34, -d * h);
    ctx.lineTo(-w * 0.34, -d * h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, -d * h);
    g.addColorStop(0, mix(col, "#000000", 0.5));
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = shade(col, 0.4);
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    const gg = ctx.createRadialGradient(0, -d * h, 0, 0, -d * h, w);
    gg.addColorStop(0, rgba(col, 0.45 + s.pulse * 0.2));
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(-w, -d * w, w * 2, w * 2);
    // Chevrons pointing the way it throws you.
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = Math.max(1, 2 * scale);
    for (let i = 0; i < 2; i++) {
      const off = -d * (h + 8 * scale + i * 7 * scale) - d * ((s.time * 26 * scale) % (14 * scale));
      ctx.beginPath();
      ctx.moveTo(-8 * scale, off + d * 5 * scale);
      ctx.lineTo(0, off);
      ctx.lineTo(8 * scale, off + d * 5 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOrb(s, ob) {
    const x = s.sx(ob.x);
    if (x < -60 || x > W + 60) return;
    const y = sy(ob.y);
    const col = ob.kind === "blue" ? "#4fc3ff" : ob.kind === "pink" ? "#ff6ad5" : "#ffd23f";
    const r = 17 * scale * (1 + Math.sin(s.time * 5) * 0.06);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
    g.addColorStop(0, rgba(col, 0.55));
    g.addColorStop(0.4, rgba(col, 0.18));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-r * 3, -r * 3, r * 6, r * 6);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = shade(col, 0.5);
    ctx.fill();

    ctx.rotate(s.time * 1.6);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.4, 2.4 * scale);
    ctx.setLineDash([r * 0.7, r * 0.5]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawCoin(s, c, taken) {
    if (taken) return;
    const x = s.sx(c.x);
    if (x < -60 || x > W + 60) return;
    const y = sy(c.y) + Math.sin(s.time * 3 + c.x * 0.01) * 4 * scale;
    const r = 11 * scale;
    const sq = Math.abs(Math.cos(s.time * 2.4 + c.x * 0.01));

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.35 + sq * 0.65, 1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, "#fff2b0");
    g.addColorStop(0.5, "#ffc93c");
    g.addColorStop(1, "#d98a0b");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#fff6cc";
    ctx.lineWidth = Math.max(1, 1.6 * scale);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    gg.addColorStop(0, "rgba(255,210,80,0.36)");
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.restore();
  }

  const PORTAL_COLORS = {
    cube: "#4fe3d0",
    ship: "#ff9c3d",
    ball: "#ff5ec4",
    wave: "#7c6bff",
    ufo: "#5cf07a",
  };

  function drawPortal(s, p) {
    const x = s.sx(p.x);
    if (x < -80 || x > W + 80) return;
    const y = sy(p.y);
    const col =
      p.kind === "mode" ? PORTAL_COLORS[p.value] || "#ffffff" : p.kind === "grav" ? (p.value < 0 ? "#3dd8ff" : "#ffd23f") : p.value > 1 ? "#ff5a48" : "#8cff6e";
    const rx = 17 * scale;
    const ry = 62 * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    g.addColorStop(0, rgba(col, 0.42));
    g.addColorStop(0.5, rgba(col, 0.14));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    const gg = ctx.createLinearGradient(-rx, 0, rx, 0);
    gg.addColorStop(0, rgba(col, 0.15));
    gg.addColorStop(0.5, rgba(col, 0.75));
    gg.addColorStop(1, rgba(col, 0.15));
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.strokeStyle = shade(col, 0.45);
    ctx.lineWidth = Math.max(1.6, 2.6 * scale);
    ctx.stroke();

    // Swirling interior rings.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba("#ffffff", 0.5);
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    for (let i = 0; i < 4; i++) {
      const t = (s.time * 1.2 + i / 4) % 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * (1 - t) * 1.2, ry * (1 - t), 0, 0, Math.PI * 2);
      ctx.globalAlpha = t * 0.8;
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  // -- player --------------------------------------------------------------

  function drawTrail(s) {
    const p = s.player;
    if (!p.trail || p.trail.length < 2) return;
    const col = s.theme.glow;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < p.trail.length; i++) {
        const q = p.trail[i];
        const px = s.sx(q.x);
        const py = sy(q.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(pass === 0 ? col : "#ffffff", pass === 0 ? 0.22 : 0.4);
      ctx.lineWidth = (pass === 0 ? 16 : 5) * scale;
      ctx.stroke();
    }
    ctx.restore();
  }

  function playerColors() {
    // Fixed player palette: the avatar must stay the brightest, most saturated
    // thing on screen no matter which theme the level uses.
    return { a: "#fff3a8", b: "#ff7a2f", rim: "#ffffff" };
  }

  function drawPlayer(s) {
    const p = s.player;
    const box = HITBOX[p.mode];
    const x = s.sx(p.x);
    const y = sy(p.y);
    const w = box.hw * 2 * scale;
    const h = box.hh * 2 * scale;
    const { a, b, rim } = playerColors(s);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, w * 1.6);
    g.addColorStop(0, rgba(a, 0.34));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 2, y - w * 2, w * 4, w * 4);
    ctx.restore();

    // Soft dark halo: separates the avatar from bright backgrounds without
    // stamping a visible grey disc behind it.
    ctx.save();
    const halo = ctx.createRadialGradient(x, y, w * 0.34, x, y, w * 0.95);
    halo.addColorStop(0, "rgba(4,5,10,0.6)");
    halo.addColorStop(1, "rgba(4,5,10,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - w, y - w, w * 2, w * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rotation);
    if (p.grav < 0 && (p.mode === "ship" || p.mode === "ufo" || p.mode === "wave")) ctx.scale(1, -1);

    const grad = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    grad.addColorStop(0, shade(a, 0.25));
    grad.addColorStop(0.5, a);
    grad.addColorStop(1, b);

    if (p.mode === "cube") {
      roundRect(ctx, -w / 2, -h / 2, w, h, 6 * scale);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, 2.4 * scale);
      ctx.stroke();
      roundRect(ctx, -w * 0.24, -h * 0.24, w * 0.48, h * 0.48, 3 * scale);
      ctx.fillStyle = mix(b, "#000000", 0.15);
      ctx.fill();
      ctx.strokeStyle = rgba("#ffffff", 0.5);
      ctx.lineWidth = Math.max(1, 1.4 * scale);
      ctx.stroke();
    } else if (p.mode === "ball") {
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, 2.4 * scale);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = mix(b, "#000000", 0.2);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, w / 2, i * Math.PI, i * Math.PI + Math.PI / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (p.mode === "ship") {
      ctx.beginPath();
      ctx.moveTo(w * 0.56, 0);
      ctx.lineTo(-w * 0.44, -h * 0.62);
      ctx.lineTo(-w * 0.26, 0);
      ctx.lineTo(-w * 0.44, h * 0.62);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.4, 2 * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w * 0.1, 0, w * 0.17, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#bfefff";
      ctx.fill();
      if (s.thrusting) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const fl = ctx.createLinearGradient(-w * 0.3, 0, -w * 1.3, 0);
        fl.addColorStop(0, rgba("#ffffff", 0.9));
        fl.addColorStop(0.4, rgba(b, 0.6));
        fl.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fl;
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, -h * 0.3);
        ctx.lineTo(-w * (1.0 + Math.random() * 0.4), 0);
        ctx.lineTo(-w * 0.3, h * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    } else if (p.mode === "ufo") {
      ctx.beginPath();
      ctx.ellipse(0, h * 0.12, w * 0.55, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.4, 2 * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.1, w * 0.26, h * 0.42, 0, Math.PI, 0);
      ctx.fillStyle = rgba("#bfefff", 0.9);
      ctx.fill();
      ctx.strokeStyle = rgba("#ffffff", 0.7);
      ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * w * 0.32, h * 0.28, 2.2 * scale, 0, Math.PI * 2);
        ctx.fillStyle = rgba("#ffffff", 0.7 + Math.sin(s.time * 8 + i) * 0.3);
        ctx.fill();
      }
      ctx.restore();
    } else if (p.mode === "wave") {
      ctx.beginPath();
      ctx.moveTo(w * 0.9, 0);
      ctx.lineTo(0, -h * 0.85);
      ctx.lineTo(-w * 0.55, 0);
      ctx.lineTo(0, h * 0.85);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.2, 1.8 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWaveRibbon(s) {
    const p = s.player;
    if (p.mode !== "wave" || !p.waveTrail || p.waveTrail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < p.waveTrail.length; i++) {
        const q = p.waveTrail[i];
        const px = s.sx(q.x);
        const py = sy(q.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(pass === 0 ? s.theme.accent2 : "#ffffff", pass === 0 ? 0.3 : 0.55);
      ctx.lineWidth = (pass === 0 ? 12 : 3) * scale;
      ctx.stroke();
    }
    ctx.restore();
  }

  // -- effects -------------------------------------------------------------

  function drawFx(s) {
    const fx = s.fx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of fx.parts) {
      const k = 1 - p.t / p.life;
      const px = s.sx(p.x);
      const py = sy(p.y);
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      const sz = p.size * scale * (0.4 + k * 0.6);
      if (p.square) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rot);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, sz / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const r of fx.rings) {
      const k = r.t / r.life;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * scale * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(s.sx(r.x), sy(r.y), (r.r0 + (r.r1 - r.r0) * k) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    for (const sh of fx.shards) {
      const k = 1 - sh.t / sh.life;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.save();
      ctx.translate(s.sx(sh.x), sy(sh.y));
      ctx.rotate(sh.rot);
      ctx.fillStyle = sh.color;
      const sz = sh.size * scale;
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.8);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCheckpoints(s) {
    if (!s.checkpoints) return;
    for (const c of s.checkpoints) {
      const x = s.sx(c.x);
      if (x < -40 || x > W + 40) continue;
      const y = sy(c.y);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(90,230,160,0.9)";
      ctx.lineWidth = Math.max(1.4, 2 * scale);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 46 * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 46 * scale);
      ctx.lineTo(x + 24 * scale, y - 38 * scale);
      ctx.lineTo(x, y - 30 * scale);
      ctx.closePath();
      ctx.fillStyle = "rgba(90,230,160,0.75)";
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPost(s) {
    // Vignette.
    const v = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    if (s.fx.flash > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.85, s.fx.flash);
      ctx.fillStyle = s.fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (s.fx.banner) {
      const bnr = s.fx.banner;
      const k = bnr.t / bnr.life;
      const alpha = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fs = Math.min(W * 0.11, 46);
      ctx.font = `800 ${fs}px "Chakra Petch", system-ui, sans-serif`;
      const cy = H * 0.3 - k * 16;
      ctx.lineWidth = fs * 0.16;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(bnr.text, W / 2, cy);
      const tg = ctx.createLinearGradient(0, cy - fs / 2, 0, cy + fs / 2);
      tg.addColorStop(0, "#ffffff");
      tg.addColorStop(1, bnr.color);
      ctx.fillStyle = tg;
      ctx.fillText(bnr.text, W / 2, cy);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------------

  function draw(s) {
    if (!W || !H) return;
    s.sx = (worldX) => W * 0.28 + (worldX - s.camX) * scale;
    s.sy = sy;
    s.scale = scale;

    const shakeX = s.fx.shake ? (Math.random() - 0.5) * s.fx.shake : 0;
    const shakeY = s.fx.shake ? (Math.random() - 0.5) * s.fx.shake : 0;

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    drawBackground(s);

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawTerrain(s);

    const lv = s.level;
    for (const so of lv.solids) drawBlock(s, solidRect(so, lv, s.camX));
    for (const h of lv.hazards) {
      if (h.type === "spike") drawSpike(s, h);
      else drawSaw(s, h);
    }
    for (const pd of lv.pads) drawPad(s, pd);
    for (const ob of lv.orbs) drawOrb(s, ob);
    for (let i = 0; i < lv.coins.length; i++) drawCoin(s, lv.coins[i], s.run.coins[i]);
    for (const p of lv.portals) drawPortal(s, p);

    drawCheckpoints(s);
    drawWaveRibbon(s);
    if (!s.player.dead) {
      drawTrail(s);
      drawPlayer(s);
    }
    drawFx(s);
    ctx.restore();

    drawPost(s);
  }

  return { resize, draw, get scale() { return scale; }, sy };
}

export { rgba, shade, mix, CEIL_Y };
