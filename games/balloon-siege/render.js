// All drawing. Everything is procedural — no image or audio files to 404 on a
// static host. World coordinates are 720x1180; main.js sets up the transform.

import { BLOONS, PATH_RADIUS, WORLD } from "./config.js";
import { TOWER_BY_ID, TOWER_RADIUS, resolveStats } from "./towers.js";

let mapLayer = null;
const balloonGradients = new Map();

/** One-off speckled ground so the map does not read as flat colour. */
function paintGround(g, map) {
  const grad = g.createLinearGradient(0, 0, WORLD.w * 0.6, WORLD.h);
  grad.addColorStop(0, map.grass);
  grad.addColorStop(1, map.grass2);
  g.fillStyle = grad;
  g.fillRect(0, 0, WORLD.w, WORLD.h);

  // Deterministic scatter: the same map always looks the same between sessions.
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * WORLD.w;
    const y = rnd() * WORLD.h;
    const r = 2 + rnd() * 9;
    g.globalAlpha = 0.05 + rnd() * 0.09;
    g.fillStyle = rnd() > 0.5 ? "#ffffff" : "#000000";
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function strokePath(ctx, path, width, color, cap = "round") {
  ctx.beginPath();
  ctx.moveTo(path.points[0][0], path.points[0][1]);
  for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i][0], path.points[i][1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = cap;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function paintMap(g, state) {
  paintGround(g, state.map);
  const path = state.path;
  strokePath(g, path, PATH_RADIUS * 2 + 10, "rgba(0,0,0,0.35)");
  strokePath(g, path, PATH_RADIUS * 2, state.map.track);
  g.save();
  g.globalAlpha = 0.5;
  g.setLineDash([16, 18]);
  strokePath(g, path, 3, "rgba(255,255,255,0.45)", "butt");
  g.restore();

  // Entry and exit markers so it is obvious which way the bloons run.
  const a = path.points[0];
  const b = path.points[path.points.length - 1];
  g.globalAlpha = 0.85;
  g.fillStyle = "#5ee6c8";
  g.beginPath();
  g.arc(a[0], a[1], 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ff5d8f";
  g.beginPath();
  g.arc(b[0], b[1], 18, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** The map never changes during a run, so it is painted once into its own
 * element behind the play canvas. Blitting it into the live canvas every frame
 * cost more than everything else in the frame put together; as a separate
 * layer the browser composites it for free. */
export function paintMapInto(canvas, state, cssW, cssH, dpr) {
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  const key = `${state.map.id}:${w}x${h}`;
  if (mapLayer === key) return;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const g = canvas.getContext("2d");
  g.setTransform(w / WORLD.w, 0, 0, h / WORLD.h, 0, 0);
  paintMap(g, state);
  mapLayer = key;
}

export function invalidateMapLayer() {
  mapLayer = null;
}

/** Balloon body gradients depend only on type, so they are built once rather
 * than once per bloon per frame. */
function balloonGradient(ctx, def, r, key) {
  let grad = balloonGradients.get(key);
  if (grad) return grad;
  if (def.rainbow) {
    grad = ctx.createLinearGradient(-r, -r, r, r);
    ["#ff4d4d", "#ffb020", "#3ddc84", "#4aa3e8", "#b06bff"].forEach((c, i, arr) =>
      grad.addColorStop(i / (arr.length - 1), c));
  } else {
    grad = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.35, def.color);
    grad.addColorStop(1, "rgba(0,0,0,0.35)");
  }
  balloonGradients.set(key, grad);
  return grad;
}

function blimpGradient(ctx, def, r, key) {
  let grad = balloonGradients.get(key);
  if (grad) return grad;
  grad = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
  grad.addColorStop(0, "rgba(255,255,255,0.5)");
  grad.addColorStop(0.4, def.color);
  grad.addColorStop(1, "rgba(0,0,0,0.45)");
  balloonGradients.set(key, grad);
  return grad;
}

function drawBalloon(ctx, b, def, time) {
  const r = b.r;
  ctx.save();
  ctx.translate(b.x, b.y);
  // A slight wobble keeps a screen full of circles from looking like a spreadsheet.
  ctx.rotate(Math.sin(time * 3 + b.id) * 0.12);

  ctx.beginPath();
  ctx.moveTo(0, r * 0.95);
  ctx.lineTo(-r * 0.16, r * 1.25);
  ctx.lineTo(r * 0.16, r * 1.25);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.88, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = balloonGradient(ctx, def, r, b.type);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.stroke();

  if (b.type === "ceramic") {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, i * r * 0.45);
      ctx.lineTo(r * 0.7, i * r * 0.45 + r * 0.16);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBlimp(ctx, b, def) {
  const r = b.r;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = blimpGradient(ctx, def, r, b.type);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-r * 0.22, r * 0.3, r * 0.44, r * 0.3);
  ctx.restore();

  const frac = Math.max(0, b.hp / b.maxHp);
  const w = r * 1.8;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(b.x - w / 2, b.y - r * 0.85, w, 6);
  ctx.fillStyle = frac > 0.5 ? "#3ddc84" : frac > 0.2 ? "#ffb020" : "#ff5d5d";
  ctx.fillRect(b.x - w / 2, b.y - r * 0.85, w * frac, 6);
}

export function drawBloons(ctx, state, time) {
  for (const b of state.bloons) {
    const def = BLOONS[b.type];
    if (def.moab) drawBlimp(ctx, b, def);
    else drawBalloon(ctx, b, def, time);

    if (b.camo) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = "#7dff9e";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (b.freezeT > 0 || b.slowT > 0) {
      ctx.save();
      ctx.globalAlpha = b.freezeT > 0 ? 0.55 : 0.25;
      ctx.fillStyle = "#9fe8ff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------- towers ---

export function drawRange(ctx, x, y, range, ok = true) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.fillStyle = ok ? "rgba(94,230,200,0.13)" : "rgba(255,93,143,0.16)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = ok ? "rgba(94,230,200,0.75)" : "rgba(255,93,143,0.85)";
  ctx.stroke();
  ctx.restore();
}

export function drawTower(ctx, tower, { selected = false, ghost = false } = {}) {
  const def = TOWER_BY_ID[tower.defId];
  const stats = resolveStats(def, tower.tiers);
  const tier = tower.tiers[0] + tower.tiers[1];
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.65;
  ctx.translate(tower.x, tower.y);

  ctx.beginPath();
  ctx.arc(0, 4, TOWER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fill();

  if (!stats.support) {
    ctx.save();
    ctx.rotate(tower.angle);
    ctx.fillStyle = "#2b303c";
    ctx.fillRect(0, -4.5, TOWER_RADIUS + 8, 9);
    ctx.fillStyle = stats.tint ?? "#7f8798";
    ctx.fillRect(TOWER_RADIUS - 2, -3, 9, 6);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(-6, -8, 3, 0, 0, TOWER_RADIUS);
  grad.addColorStop(0, "#3b4354");
  grad.addColorStop(1, "#1a1f29");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeStyle = selected ? "#5ee6c8" : tier > 0 ? "#ffb020" : "rgba(255,255,255,0.22)";
  ctx.stroke();

  ctx.font = "19px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.icon, 0, 1);

  // Upgrade pips: one dot per tier bought, so the board is readable at a glance.
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < tower.tiers[p]; i++) {
      ctx.beginPath();
      ctx.arc((p === 0 ? -1 : 1) * (7 + i * 6), TOWER_RADIUS + 6, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = p === 0 ? "#ffb020" : "#5ee6c8";
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawTowers(ctx, state, selected) {
  for (const t of state.towers) drawTower(ctx, t, { selected: t === selected });
}

// ----------------------------------------------------------- projectiles ---

export function drawProjectiles(ctx, state) {
  for (const p of state.projectiles) {
    const color = p.tint ?? (p.dmgType === "explosive" ? "#ffb020" : p.dmgType === "magic" ? "#b06bff" : "#f2f3f5");
    ctx.save();
    ctx.fillStyle = color;
    if (p.dmgType === "explosive") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.dmgType === "magic") {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const a = Math.atan2(p.vy, p.vx);
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.fillRect(-6, -1.6, 12, 3.2);
    }
    ctx.restore();
  }
}
