// All drawing. Everything is procedural — no image or audio files to 404 on a
// static host. World coordinates are WORLD.w x WORLD.h; main.js sets up the
// transform that maps them onto the canvas.
//
// Anything that looks the same every frame (the map, a balloon of a given
// type, a tower's platform and icon) is painted once into an offscreen sprite
// and blitted from then on. Canvas 2D is fill-rate bound on phones, and a late
// round has hundreds of bloons on screen: a gradient-filled bezier per bloon per
// frame was the single biggest cost in the old renderer.

import { BLOONS, PATH_RADIUS, WORLD } from "./config.js";
import { distanceToPath, pointAt } from "./path.js";
import { TOWER_BY_ID, TOWER_RADIUS, resolveStats } from "./towers.js";

export const DISPLAY_FONT = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";

/** Towers placed by the simulation carry a memoised stat block; the placement
 * ghost is a bare literal and has to be resolved on the spot. */
function statsFor(tower) {
  const key = `${tower.tiers[0]},${tower.tiers[1]}:${tower.level ?? 1}`;
  if (tower.statsKey === key) return tower.statsCache;
  return resolveStats(TOWER_BY_ID[tower.defId], tower.tiers, tower.level ?? 1);
}

let mapLayer = null;
const sprites = new Map();

// ---------------------------------------------------------------- colour ---

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a colour towards white (amt > 0) or black (amt < 0). */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const m = (c) => Math.round(c + (t - c) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** An offscreen canvas `w` x `h` world units big, drawn at `scale` px per unit
 * with the origin in the middle. */
function makeSprite(w, h, scale, draw) {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * scale);
  cv.height = Math.ceil(h * scale);
  const g = cv.getContext("2d");
  g.setTransform(scale, 0, 0, scale, cv.width / 2, cv.height / 2);
  draw(g);
  return { cv, w, h };
}

function blit(ctx, sprite, x, y) {
  ctx.drawImage(sprite.cv, x - sprite.w / 2, y - sprite.h / 2, sprite.w, sprite.h);
}

// ------------------------------------------------------------------- map ---

function tracePath(g, path) {
  g.beginPath();
  g.moveTo(path.points[0][0], path.points[0][1]);
  for (let i = 1; i < path.points.length; i++) g.lineTo(path.points[i][0], path.points[i][1]);
}

function strokePath(g, path, width, color) {
  tracePath(g, path);
  g.lineWidth = width;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke();
}

function paintGround(g, map, rnd) {
  const th = map.theme;
  const grad = g.createLinearGradient(0, 0, WORLD.w * 0.4, WORLD.h * 1.1);
  grad.addColorStop(0, th.ground[0]);
  grad.addColorStop(1, th.ground[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, WORLD.w, WORLD.h);

  // Big soft patches first, so the ground has light and shade at map scale.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * WORLD.w;
    const y = rnd() * WORLD.h;
    const r = 60 + rnd() * 140;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rnd() > 0.5 ? th.tuft[0] : th.tuft[1];
    rg.addColorStop(0, rgba(c, 0.28));
    rg.addColorStop(1, rgba(c, 0));
    g.fillStyle = rg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Then fine texture: grass blades, sand ripples or cinders.
  const scene = th.scene;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * WORLD.w;
    const y = rnd() * WORLD.h;
    const c = rnd() > 0.5 ? th.tuft[0] : th.tuft[1];
    g.globalAlpha = 0.35 + rnd() * 0.4;
    g.strokeStyle = c;
    g.fillStyle = c;
    if (scene === "forest" || scene === "lake") {
      g.lineWidth = 1.6;
      g.lineCap = "round";
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        g.moveTo(x + k * 2.5, y);
        g.lineTo(x + k * 4 + (rnd() - 0.5) * 2, y - 4 - rnd() * 4);
      }
      g.stroke();
    } else if (scene === "desert") {
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y + 10, 12 + rnd() * 8, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(x, y, 1 + rnd() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

function paintTrack(g, path, map, rnd) {
  const [light, mid, dark] = map.theme.path;
  // Drop shadow, rim, bed, and a lighter worn strip down the middle.
  g.save();
  g.translate(0, 5);
  strokePath(g, path, PATH_RADIUS * 2 + 14, "rgba(0,0,0,0.22)");
  g.restore();
  strokePath(g, path, PATH_RADIUS * 2 + 10, dark);
  strokePath(g, path, PATH_RADIUS * 2, mid);
  strokePath(g, path, PATH_RADIUS * 2 - 16, light);
  g.save();
  g.globalAlpha = 0.5;
  strokePath(g, path, PATH_RADIUS * 0.7, shade(light, 0.25));
  g.restore();

  // Pebbles and ruts scattered along the bed.
  for (let d = 0; d < path.length; d += 7) {
    const p = pointAt(path, d);
    const off = (rnd() - 0.5) * (PATH_RADIUS * 2 - 8);
    const x = p.x - p.dy * off;
    const y = p.y + p.dx * off;
    const r = 1 + rnd() * 2.6;
    g.globalAlpha = 0.25 + rnd() * 0.35;
    g.fillStyle = rnd() > 0.35 ? dark : "#ffffff";
    g.beginPath();
    g.ellipse(x, y, r * 1.3, r, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  if (map.theme.scene === "volcano") {
    // Glowing cracks: the Brutal map should look like it wants you dead.
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "rgba(255,110,40,0.55)";
    g.lineWidth = 1.6;
    g.lineCap = "round";
    for (let d = 20; d < path.length; d += 38 + rnd() * 30) {
      const p = pointAt(path, d);
      const off = (rnd() - 0.5) * PATH_RADIUS * 1.2;
      let x = p.x - p.dy * off;
      let y = p.y + p.dx * off;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += p.dx * (6 + rnd() * 6) + (rnd() - 0.5) * 8;
        y += p.dy * (6 + rnd() * 6) + (rnd() - 0.5) * 8;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }
}

/** Where the track crosses the edge of the board, walking in from `from`. */
function edgeCrossing(path, fromStart) {
  const inside = (p) => p.x >= 0 && p.x <= WORLD.w && p.y >= 0 && p.y <= WORLD.h;
  if (fromStart) {
    for (let d = 0; d < path.length; d += 2) if (inside(pointAt(path, d))) return d;
    return 0;
  }
  for (let d = path.length; d > 0; d -= 2) if (inside(pointAt(path, d))) return d;
  return path.length;
}

function paintGates(g, path) {
  // Entry: a row of chevrons pointing the way in.
  const d0 = edgeCrossing(path, true);
  for (let i = 0; i < 3; i++) {
    const p = pointAt(path, d0 + 26 + i * 22);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(p.dy, p.dx));
    g.globalAlpha = 0.85 - i * 0.2;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(-6, -13);
    g.lineTo(6, 0);
    g.lineTo(-6, 13);
    g.lineTo(-12, 13);
    g.lineTo(0, 0);
    g.lineTo(-12, -13);
    g.closePath();
    g.fill();
    g.restore();
  }

  // Exit: a little fort gate the bloons are trying to break through.
  const d1 = edgeCrossing(path, false);
  const p = pointAt(path, Math.max(0, d1 - 34));
  g.save();
  g.translate(p.x, p.y);
  g.rotate(Math.atan2(p.dy, p.dx));
  const half = PATH_RADIUS + 12;
  for (const side of [-1, 1]) {
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(-9, side * half - 11 + 4, 22, 22);
    g.fillStyle = "#8a8f9c";
    g.fillRect(-11, side * half - 11, 22, 22);
    g.fillStyle = "#b9bfcc";
    g.fillRect(-11, side * half - 11, 22, 6);
    g.fillStyle = "#5f6472";
    g.fillRect(-11, side * half + 7, 22, 4);
  }
  g.fillStyle = "rgba(255,93,143,0.9)";
  g.fillRect(-2, -half, 4, half * 2);
  g.fillStyle = "#ff5d8f";
  g.beginPath();
  g.moveTo(0, -half - 8);
  g.lineTo(0, -half - 30);
  g.lineTo(18, -half - 24);
  g.lineTo(0, -half - 18);
  g.fill();
  g.strokeStyle = "#3b2a1a";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -half - 6);
  g.lineTo(0, -half - 30);
  g.stroke();
  g.restore();
}

// Scenery ------------------------------------------------------------------

function drawTree(g, x, y, s, rnd, leaf, leafDark) {
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  g.ellipse(x + s * 0.25, y + s * 0.35, s * 1.05, s * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#6b4a2b";
  g.fillRect(x - s * 0.12, y - s * 0.1, s * 0.24, s * 0.55);
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd();
    const bx = x + Math.cos(a) * s * 0.42;
    const by = y - s * 0.45 + Math.sin(a) * s * 0.32;
    g.fillStyle = leafDark;
    g.beginPath();
    g.arc(bx, by + 3, s * 0.52, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd();
    const bx = x + Math.cos(a) * s * 0.36;
    const by = y - s * 0.5 + Math.sin(a) * s * 0.28;
    g.fillStyle = leaf;
    g.beginPath();
    g.arc(bx, by, s * 0.46, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.arc(x - s * 0.25, y - s * 0.8, s * 0.24, 0, Math.PI * 2);
  g.fill();
}

function drawBush(g, x, y, s, color) {
  g.fillStyle = "rgba(0,0,0,0.2)";
  g.beginPath();
  g.ellipse(x + 2, y + s * 0.4, s * 1.1, s * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  for (const [dx, dy, k] of [[-0.55, 0, 0.62], [0.55, 0, 0.6], [0, -0.3, 0.72]]) {
    g.fillStyle = shade(color, -0.18);
    g.beginPath();
    g.arc(x + dx * s, y + dy * s + 2, s * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + dx * s, y + dy * s, s * k * 0.9, 0, Math.PI * 2);
    g.fill();
  }
}

function drawRock(g, x, y, s, color, rnd) {
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  g.ellipse(x + 3, y + s * 0.45, s * 1.05, s * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = s * (0.75 + rnd() * 0.3);
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.72);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.ellipse(x - s * 0.25, y - s * 0.25, s * 0.4, s * 0.22, -0.4, 0, Math.PI * 2);
  g.fill();
}

function drawFlowers(g, x, y, rnd, colors) {
  for (let i = 0; i < 5; i++) {
    const fx = x + (rnd() - 0.5) * 22;
    const fy = y + (rnd() - 0.5) * 14;
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(fx + Math.cos(a) * 2.4, fy + Math.sin(a) * 2.4, 1.9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#ffe066";
    g.beginPath();
    g.arc(fx, fy, 1.5, 0, Math.PI * 2);
    g.fill();
  }
}

function drawCactus(g, x, y, s) {
  g.fillStyle = "rgba(0,0,0,0.2)";
  g.beginPath();
  g.ellipse(x + s * 0.4, y + 2, s * 0.9, s * 0.25, 0, 0, Math.PI * 2);
  g.fill();
  const body = "#4f9a52";
  const light = "#76c26f";
  const limb = (lx, ly, w, h) => {
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(lx - w / 2, ly - h, w, h, w / 2);
    g.fill();
    g.fillStyle = light;
    g.fillRect(lx - w * 0.15, ly - h + w * 0.4, w * 0.18, h - w * 0.6);
  };
  limb(x, y, s * 0.42, s * 1.6);
  limb(x - s * 0.45, y - s * 0.55, s * 0.28, s * 0.7);
  g.fillStyle = body;
  g.fillRect(x - s * 0.45, y - s * 0.7, s * 0.3, s * 0.2);
  limb(x + s * 0.45, y - s * 0.8, s * 0.28, s * 0.6);
  g.fillRect(x + s * 0.15, y - s * 0.95, s * 0.3, s * 0.2);
  g.fillStyle = "#ff7fa8";
  g.beginPath();
  g.arc(x, y - s * 1.6, s * 0.14, 0, Math.PI * 2);
  g.fill();
}

function drawMesa(g, x, y, s) {
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath();
  g.ellipse(x + 6, y + 4, s * 1.2, s * 0.35, 0, 0, Math.PI * 2);
  g.fill();
  const layers = ["#b85a32", "#cf7443", "#e39458"];
  for (let i = 0; i < 3; i++) {
    const w = s * (1.1 - i * 0.22);
    g.fillStyle = layers[i];
    g.beginPath();
    g.roundRect(x - w, y - s * 0.3 * (i + 1), w * 2, s * 0.34, 4);
    g.fill();
  }
}

function drawPond(g, x, y, rx, ry, rnd) {
  g.fillStyle = "#c9b98a";
  g.beginPath();
  g.ellipse(x, y, rx + 7, ry + 6, 0, 0, Math.PI * 2);
  g.fill();
  const wg = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 4, x, y, rx);
  wg.addColorStop(0, "#7fd8f5");
  wg.addColorStop(1, "#2f8fc4");
  g.fillStyle = wg;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const wx = x + (rnd() - 0.5) * rx;
    const wy = y + (rnd() - 0.5) * ry;
    g.beginPath();
    g.moveTo(wx - 8, wy);
    g.quadraticCurveTo(wx, wy - 3, wx + 8, wy);
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const lx = x + Math.cos(a) * rx * 0.6;
    const ly = y + Math.sin(a) * ry * 0.6;
    g.fillStyle = "#4fae4c";
    g.beginPath();
    g.arc(lx, ly, 7, 0.3, Math.PI * 2 - 0.3);
    g.lineTo(lx, ly);
    g.fill();
    if (rnd() > 0.5) {
      g.fillStyle = "#ff9ecb";
      g.beginPath();
      g.arc(lx + 2, ly - 1, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawLava(g, x, y, rx, ry) {
  g.fillStyle = "#1c141c";
  g.beginPath();
  g.ellipse(x, y, rx + 8, ry + 7, 0, 0, Math.PI * 2);
  g.fill();
  const lg = g.createRadialGradient(x, y, 2, x, y, rx);
  lg.addColorStop(0, "#fff0a0");
  lg.addColorStop(0.35, "#ffae3a");
  lg.addColorStop(1, "#d8401c");
  g.fillStyle = lg;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.globalCompositeOperation = "lighter";
  const glow = g.createRadialGradient(x, y, rx * 0.5, x, y, rx * 2.2);
  glow.addColorStop(0, "rgba(255,120,40,0.35)");
  glow.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = glow;
  g.fillRect(x - rx * 2.2, y - rx * 2.2, rx * 4.4, rx * 4.4);
  g.restore();
}

function drawCrystal(g, x, y, s, rnd) {
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.beginPath();
  g.ellipse(x + 3, y + 3, s * 0.9, s * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 3; i++) {
    const cx = x + (i - 1) * s * 0.4;
    const h = s * (1 + rnd() * 0.9) * (i === 1 ? 1.3 : 0.9);
    const w = s * 0.28;
    g.fillStyle = i === 1 ? "#b77bff" : "#8a55e0";
    g.beginPath();
    g.moveTo(cx - w, y);
    g.lineTo(cx - w, y - h * 0.7);
    g.lineTo(cx, y - h);
    g.lineTo(cx + w, y - h * 0.7);
    g.lineTo(cx + w, y);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.moveTo(cx - w, y - h * 0.7);
    g.lineTo(cx, y - h);
    g.lineTo(cx, y);
    g.lineTo(cx - w, y);
    g.closePath();
    g.fill();
  }
}

function drawDeadTree(g, x, y, s) {
  g.strokeStyle = "#1a1219";
  g.lineCap = "round";
  const branch = (bx, by, a, len, w, depth) => {
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(ex, ey);
    g.stroke();
    if (depth > 0) {
      branch(ex, ey, a - 0.5, len * 0.65, w * 0.6, depth - 1);
      branch(ex, ey, a + 0.45, len * 0.6, w * 0.6, depth - 1);
    }
  };
  branch(x, y, -Math.PI / 2, s, s * 0.22, 3);
}

/** Scenery never goes on the track, and the big pieces stay near the edges of
 * the board or far from the track, where nobody wants to build anyway — a tree
 * under every good tower spot would read as "you can't build here". */
function paintScenery(g, path, map, rnd) {
  const scene = map.theme.scene;
  const clear = (x, y, r) => distanceToPath(path, x, y) > PATH_RADIUS + 10 + r;
  const nearEdge = (x, y) => x < 70 || x > WORLD.w - 70 || y < 60 || y > WORLD.h - 50;
  const spot = (r, bigOnly) => {
    for (let tries = 0; tries < 40; tries++) {
      const x = rnd() * WORLD.w;
      const y = rnd() * WORLD.h;
      if (!clear(x, y, r)) continue;
      if (bigOnly && !nearEdge(x, y) && distanceToPath(path, x, y) < 260) continue;
      return { x, y };
    }
    return null;
  };

  const place = (count, r, big, draw) => {
    const items = [];
    for (let i = 0; i < count; i++) {
      const p = spot(r, big);
      if (p) items.push(p);
    }
    // Paint top to bottom so nearer things overlap farther ones.
    items.sort((a, b) => a.y - b.y);
    for (const p of items) draw(p.x, p.y);
  };

  if (scene === "forest") {
    place(26, 8, false, (x, y) => drawFlowers(g, x, y, rnd, ["#ffffff", "#ff9ecb", "#ffd166"]));
    place(10, 12, false, (x, y) => drawRock(g, x, y, 6 + rnd() * 6, "#9aa3a8", rnd));
    place(12, 22, true, (x, y) => drawBush(g, x, y, 11 + rnd() * 6, "#4f9e3c"));
    place(22, 30, true, (x, y) => drawTree(g, x, y, 22 + rnd() * 10, rnd, "#4bab45", "#2f7d34"));
  } else if (scene === "desert") {
    place(14, 12, false, (x, y) => drawRock(g, x, y, 5 + rnd() * 7, "#c98a55", rnd));
    place(4, 60, true, (x, y) => drawMesa(g, x, y, 34 + rnd() * 14));
    place(18, 18, true, (x, y) => drawCactus(g, x, y, 14 + rnd() * 8));
    place(8, 16, false, (x, y) => drawBush(g, x, y, 7, "#9aa55a"));
  } else if (scene === "lake") {
    // One pond in the biggest open space the track leaves.
    let best = null;
    for (let i = 0; i < 400; i++) {
      const x = 120 + rnd() * (WORLD.w - 240);
      const y = 100 + rnd() * (WORLD.h - 200);
      const d = distanceToPath(path, x, y);
      if (!best || d > best.d) best = { x, y, d };
    }
    if (best) {
      const rx = Math.min(110, best.d - PATH_RADIUS - 24);
      if (rx > 30) drawPond(g, best.x, best.y, rx, rx * 0.62, rnd);
    }
    const pondClear = (x, y) => !best || Math.hypot((x - best.x) / 1.2, y - best.y) > Math.min(110, best.d) + 20;
    const items = [];
    for (let i = 0; i < 40; i++) {
      const p = spot(8, false);
      if (p && pondClear(p.x, p.y)) items.push(p);
    }
    for (const p of items) drawFlowers(g, p.x, p.y, rnd, ["#ffffff", "#ffb3d9", "#b89cff", "#ffd166"]);
    place(20, 30, true, (x, y) => {
      if (pondClear(x, y)) drawTree(g, x, y, 20 + rnd() * 9, rnd, "#ffb6d5", "#e889b4");
    });
  } else {
    place(4, 40, true, (x, y) => drawLava(g, x, y, 24 + rnd() * 16, 14 + rnd() * 8));
    place(14, 16, true, (x, y) => drawCrystal(g, x, y, 10 + rnd() * 6, rnd));
    place(12, 12, false, (x, y) => drawRock(g, x, y, 6 + rnd() * 8, "#3a2f3d", rnd));
    place(10, 26, true, (x, y) => drawDeadTree(g, x, y, 16 + rnd() * 8));
  }
}

function paintVignette(g, map) {
  const v = g.createRadialGradient(
    WORLD.w / 2, WORLD.h / 2, WORLD.h * 0.45,
    WORLD.w / 2, WORLD.h / 2, WORLD.w * 0.72,
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, map.theme.scene === "volcano" ? "rgba(10,0,10,0.5)" : "rgba(0,20,10,0.28)");
  g.fillStyle = v;
  g.fillRect(0, 0, WORLD.w, WORLD.h);
}

function paintMap(g, state) {
  const map = state.map;
  const rnd = seeded(hashStr(map.id));
  paintGround(g, map, rnd);
  paintTrack(g, state.path, map, rnd);
  paintScenery(g, state.path, map, rnd);
  paintGates(g, state.path);
  paintVignette(g, map);
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

/** Menu thumbnail: the same painter, just smaller. */
export function paintMapThumb(canvas, map, path, width = 320) {
  const h = Math.round(width * (WORLD.h / WORLD.w));
  canvas.width = width;
  canvas.height = h;
  const g = canvas.getContext("2d");
  g.setTransform(width / WORLD.w, 0, 0, h / WORLD.h, 0, 0);
  paintMap(g, { map, path });
}

export function invalidateMapLayer() {
  mapLayer = null;
}

// ---------------------------------------------------------------- bloons ---

// Sprites are drawn this many pixels per world unit. The board is 1280 units
// wide, so 3x stays crisp on a full-screen 4K display.
const SPRITE_SCALE = 3;

function balloonShape(g, r) {
  g.beginPath();
  g.moveTo(0, -r);
  g.bezierCurveTo(r * 1.18, -r, r * 1.08, r * 0.5, 0, r * 0.98);
  g.bezierCurveTo(-r * 1.08, r * 0.5, -r * 1.18, -r, 0, -r);
  g.closePath();
}

function camoBlotches(g, r, seed) {
  const rnd = seeded(seed);
  const cols = ["#3f6b2a", "#6f8a3a", "#2c4a22", "#8a7a45"];
  for (let i = 0; i < 9; i++) {
    g.fillStyle = cols[i % cols.length];
    g.globalAlpha = 0.72;
    g.beginPath();
    g.ellipse((rnd() - 0.5) * r * 1.8, (rnd() - 0.5) * r * 2, r * (0.2 + rnd() * 0.25), r * (0.14 + rnd() * 0.2), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function paintBalloon(g, type, camo) {
  const def = BLOONS[type];
  const r = def.r;
  const base = def.color;

  // Ground shadow — balloons float, so it sits well below them.
  g.fillStyle = "rgba(0,0,0,0.2)";
  g.beginPath();
  g.ellipse(r * 0.25, r * 1.95, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
  g.fill();

  // String.
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(0, r * 1.1);
  g.bezierCurveTo(r * 0.3, r * 1.35, -r * 0.3, r * 1.55, r * 0.05, r * 1.8);
  g.stroke();

  // Knot.
  g.fillStyle = shade(base === "#e8eef7" ? "#b8c2d0" : base, -0.25);
  g.beginPath();
  g.moveTo(0, r * 0.9);
  g.lineTo(-r * 0.2, r * 1.14);
  g.lineTo(r * 0.2, r * 1.14);
  g.closePath();
  g.fill();

  g.save();
  balloonShape(g, r);
  g.clip();
  if (def.rainbow) {
    const cols = ["#ff4d4d", "#ffa53a", "#ffe14d", "#3ddc84", "#4aa3e8", "#9b6bff"];
    const band = (r * 2.4) / cols.length;
    for (let i = 0; i < cols.length; i++) {
      g.fillStyle = cols[i];
      g.save();
      g.rotate(-0.5);
      g.fillRect(-r * 1.5, -r * 1.2 + i * band, r * 3, band + 0.5);
      g.restore();
    }
  } else if (type === "lead") {
    const lg = g.createLinearGradient(-r, -r, r, r);
    lg.addColorStop(0, "#d6dae3");
    lg.addColorStop(0.45, "#8d93a3");
    lg.addColorStop(0.55, "#a3a9b8");
    lg.addColorStop(1, "#4b505c");
    g.fillStyle = lg;
    g.fillRect(-r * 1.3, -r * 1.2, r * 2.6, r * 2.4);
  } else {
    g.fillStyle = base;
    g.fillRect(-r * 1.3, -r * 1.2, r * 2.6, r * 2.4);
  }
  if (type === "ceramic") {
    // Clay rings.
    g.strokeStyle = "#8f4a1e";
    g.lineWidth = r * 0.14;
    for (const k of [-0.35, 0.15, 0.6]) {
      g.beginPath();
      g.ellipse(0, k * r, r * 1.1, r * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#f2b27a";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(-r * 0.75 + i * r * 0.3, -r * 0.1, r * 0.06, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (type === "lead") {
    g.fillStyle = "#5c6170";
    for (const [x, y] of [[-0.5, -0.2], [0.5, -0.2], [-0.3, 0.45], [0.3, 0.45], [0, -0.6]]) {
      g.beginPath();
      g.arc(x * r, y * r, r * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (camo) camoBlotches(g, r, hashStr(type));

  // Shading: light from the top left, a rim of shadow bottom right.
  const sg = g.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r * 1.25);
  sg.addColorStop(0, "rgba(255,255,255,0.35)");
  sg.addColorStop(0.45, "rgba(255,255,255,0)");
  sg.addColorStop(1, type === "black" ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.42)");
  g.fillStyle = sg;
  g.fillRect(-r * 1.3, -r * 1.2, r * 2.6, r * 2.4);
  g.restore();

  balloonShape(g, r);
  g.lineWidth = 1.2;
  g.strokeStyle = type === "white" ? "rgba(90,105,130,0.6)" : "rgba(0,0,0,0.38)";
  g.stroke();

  // Specular highlight.
  g.fillStyle = type === "black" ? "rgba(170,190,255,0.45)" : "rgba(255,255,255,0.7)";
  g.beginPath();
  g.ellipse(-r * 0.42, -r * 0.45, r * 0.16, r * 0.3, 0.55, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(-r * 0.2, -r * 0.8, r * 0.07, 0, Math.PI * 2);
  g.fill();
}

function balloonSprite(type, camo) {
  const key = `b:${type}:${camo ? 1 : 0}`;
  let s = sprites.get(key);
  if (!s) {
    const r = BLOONS[type].r;
    s = makeSprite(r * 2.8, r * 4.6, SPRITE_SCALE, (g) => paintBalloon(g, type, camo));
    sprites.set(key, s);
  }
  return s;
}

const BLIMP_LOOK = {
  moab: { body: "#3a7fe0", band: "#e8eef7", label: "MOAB" },
  bfb: { body: "#d8433a", band: "#ffd166", label: "B.F.B." },
  zomg: { body: "#5bb046", band: "#1c1f26", label: "ZOMG" },
};

function paintBlimp(g, type, stage, camo) {
  const def = BLOONS[type];
  const look = BLIMP_LOOK[type] ?? { body: def.color, band: "#ffffff", label: "" };
  const r = def.r;
  const L = r * 1.1;
  const H = r * 0.56;

  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  g.ellipse(r * 0.15, H * 2.1, L * 0.9, H * 0.35, 0, 0, Math.PI * 2);
  g.fill();

  // Tail fins sit behind the envelope.
  const fin = shade(look.body, -0.3);
  g.fillStyle = fin;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(-L * 0.55, s * H * 0.35);
    g.lineTo(-L * 1.12, s * H * 1.25);
    g.lineTo(-L * 1.2, s * H * 1.25);
    g.lineTo(-L * 1.02, s * H * 0.2);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.moveTo(-L * 0.6, -H * 0.12);
  g.lineTo(-L * 1.22, -H * 0.1);
  g.lineTo(-L * 1.22, H * 0.1);
  g.lineTo(-L * 0.6, H * 0.12);
  g.closePath();
  g.fill();

  // Gondola.
  g.fillStyle = "#2a2e38";
  g.beginPath();
  g.roundRect(-L * 0.28, H * 0.78, L * 0.56, H * 0.36, 4);
  g.fill();
  g.fillStyle = "#9fe8ff";
  for (let i = 0; i < 3; i++) g.fillRect(-L * 0.2 + i * L * 0.15, H * 0.86, L * 0.08, H * 0.14);

  // Envelope.
  g.save();
  g.beginPath();
  g.ellipse(0, 0, L, H, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = look.body;
  g.fillRect(-L, -H, L * 2, H * 2);
  g.fillStyle = look.band;
  g.fillRect(-L * 0.62, -H, L * 0.12, H * 2);
  g.fillRect(L * 0.5, -H, L * 0.12, H * 2);
  if (camo) camoBlotches(g, r * 0.9, hashStr(type));
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 1.2;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.ellipse(i * L * 0.26, 0, L * 0.1, H, 0, -Math.PI / 2, Math.PI / 2);
    g.stroke();
  }
  // Battle damage: dents and tears as the hull drops below 2/3 and 1/3.
  if (stage > 0) {
    const rnd = seeded(hashStr(type) + stage);
    g.strokeStyle = "rgba(20,10,10,0.75)";
    g.lineWidth = 1.6;
    for (let i = 0; i < stage * 4; i++) {
      let x = (rnd() - 0.5) * L * 1.5;
      let y = (rnd() - 0.5) * H * 1.4;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rnd() - 0.5) * r * 0.35;
        y += (rnd() - 0.5) * r * 0.3;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(30,20,20,0.35)";
    for (let i = 0; i < stage * 3; i++) {
      g.beginPath();
      g.arc((rnd() - 0.5) * L * 1.4, (rnd() - 0.5) * H * 1.2, r * (0.06 + rnd() * 0.08), 0, Math.PI * 2);
      g.fill();
    }
  }
  const sg = g.createLinearGradient(0, -H, 0, H);
  sg.addColorStop(0, "rgba(255,255,255,0.45)");
  sg.addColorStop(0.35, "rgba(255,255,255,0)");
  sg.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = sg;
  g.fillRect(-L, -H, L * 2, H * 2);
  g.restore();

  g.beginPath();
  g.ellipse(0, 0, L, H, 0, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.stroke();

  // Nose cap.
  g.fillStyle = shade(look.body, -0.35);
  g.beginPath();
  g.ellipse(L * 0.9, 0, L * 0.12, H * 0.45, 0, 0, Math.PI * 2);
  g.fill();
}

function blimpSprite(type, stage, camo) {
  const key = `m:${type}:${stage}:${camo ? 1 : 0}`;
  let s = sprites.get(key);
  if (!s) {
    const r = BLOONS[type].r;
    s = makeSprite(r * 2.8, r * 2.6, SPRITE_SCALE, (g) => paintBlimp(g, type, stage, camo));
    sprites.set(key, s);
  }
  return s;
}

function drawBalloon(ctx, b, time) {
  const s = balloonSprite(b.type, b.camo);
  const bob = Math.sin(time * 3.2 + b.id * 1.7) * 1.4;
  ctx.save();
  ctx.translate(b.x, b.y + bob);
  // A slight wobble keeps a screen full of balloons from looking like a spreadsheet.
  ctx.rotate(Math.sin(time * 3 + b.id) * 0.12);
  blit(ctx, s, 0, 0);

  if (b.type === "ceramic" && b.hp < b.maxHp) {
    // Cracks spread as a ceramic takes hits.
    const dmg = 1 - b.hp / b.maxHp;
    const r = b.r;
    ctx.strokeStyle = "rgba(60,25,5,0.85)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.9);
    ctx.lineTo(r * 0.15, -r * 0.4);
    ctx.lineTo(-r * 0.1, 0);
    if (dmg > 0.35) {
      ctx.lineTo(r * 0.3, r * 0.4);
      ctx.moveTo(r * 0.15, -r * 0.4);
      ctx.lineTo(r * 0.6, -r * 0.2);
    }
    if (dmg > 0.65) {
      ctx.moveTo(-r * 0.1, 0);
      ctx.lineTo(-r * 0.6, r * 0.25);
      ctx.moveTo(-r * 0.05, -r * 0.6);
      ctx.lineTo(-r * 0.55, -r * 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlimp(ctx, b, def) {
  const frac = Math.max(0, b.hp / b.maxHp);
  const stage = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  const s = blimpSprite(b.type, stage, b.camo);
  // Heading is eased so a blimp swings round a corner instead of snapping.
  // Purely cosmetic state kept on the bloon; the simulation never reads it.
  const target = Math.atan2(b.dy ?? 0, b.dx ?? 1);
  if (b.ang === undefined) b.ang = target;
  let diff = target - b.ang;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  b.ang += diff * 0.12;
  const flip = Math.cos(b.ang) < 0;

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.ang);
  // Mirror vertically when flying left so the lettering is never upside down.
  if (flip) ctx.scale(1, -1);
  blit(ctx, s, 0, 0);
  ctx.restore();

  // The name is lettered per frame, turned so it always reads left to right;
  // baked into the sprite it came out mirrored on every leftward lane.
  const look = BLIMP_LOOK[b.type];
  const r = def.r;
  if (look) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(flip ? b.ang + Math.PI : b.ang);
    ctx.font = `${Math.round(r * 0.36)}px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.strokeText(look.label, 0, r * 0.05);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(look.label, 0, r * 0.05);
    ctx.restore();
  }
  const w = r * 1.7;
  const y = b.y - r * 0.95;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(b.x - w / 2 - 2, y - 2, w + 4, 9, 4);
  ctx.fill();
  ctx.fillStyle = frac > 0.5 ? "#3ddc84" : frac > 0.2 ? "#ffb020" : "#ff5d5d";
  ctx.beginPath();
  ctx.roundRect(b.x - w / 2, y, Math.max(2, w * frac), 5, 2.5);
  ctx.fill();
}

function drawIce(ctx, b) {
  const r = b.r + 4;
  ctx.save();
  ctx.fillStyle = "rgba(170,230,255,0.45)";
  ctx.strokeStyle = "rgba(235,250,255,0.95)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(b.x - r, b.y - r, r * 2, r * 2, r * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.moveTo(b.x - r * 0.6, b.y - r * 0.3);
  ctx.lineTo(b.x - r * 0.25, b.y - r * 0.65);
  ctx.stroke();
  ctx.restore();
}

export function drawBloons(ctx, state, time) {
  for (const b of state.bloons) {
    const def = BLOONS[b.type];
    if (def.moab) drawBlimp(ctx, b, def);
    else drawBalloon(ctx, b, time);

    if (b.freezeT > 0) {
      drawIce(ctx, b);
    } else if (b.slowT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#bff1ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------- towers ---

/** Per-tower paint: the platform colour and what sticks out of it. */
export const TOWER_LOOK = {
  hero: { color: "#ffc94a", barrel: "dart" },
  dart: { color: "#d98a4a", barrel: "dart" },
  tack: { color: "#ff6f91", barrel: "tack" },
  bomb: { color: "#6d7688", barrel: "cannon" },
  ice: { color: "#72d4ff", barrel: "none" },
  sniper: { color: "#7a9a52", barrel: "rifle" },
  wizard: { color: "#a276ff", barrel: "staff" },
  super: { color: "#ff4d6d", barrel: "twin" },
  farm: { color: "#f5d14a", barrel: "none" },
};

function paintPlatform(g, def, tierMax) {
  const look = TOWER_LOOK[def.id] ?? { color: "#8a93a6" };
  const R = TOWER_RADIUS;
  // Shadow and the side of the plinth give the flat disc some height.
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.beginPath();
  g.ellipse(3, 7, R + 2, R * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  const rim = tierMax >= 3 ? "#ffcf4a" : tierMax >= 2 ? "#c6ccd8" : "#6b5a48";
  g.fillStyle = shade(rim, -0.35);
  g.beginPath();
  g.arc(0, 4, R, 0, Math.PI * 2);
  g.fill();
  const rg = g.createLinearGradient(0, -R, 0, R);
  rg.addColorStop(0, shade(rim, 0.3));
  rg.addColorStop(1, rim);
  g.fillStyle = rg;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();

  if (tierMax >= 2) {
    g.fillStyle = tierMax >= 3 ? "#fff3b0" : "#eef1f6";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * (R - 2.6), Math.sin(a) * (R - 2.6), 1.4, 0, Math.PI * 2);
      g.fill();
    }
  }

  const inner = R - 5;
  const ig = g.createRadialGradient(-inner * 0.35, -inner * 0.45, 1, 0, 0, inner);
  ig.addColorStop(0, shade(look.color, 0.45));
  ig.addColorStop(0.6, look.color);
  ig.addColorStop(1, shade(look.color, -0.35));
  g.fillStyle = ig;
  g.beginPath();
  g.arc(0, 0, inner, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.stroke();
}

function platformSprite(def, tierMax) {
  const key = `p:${def.id}:${tierMax}`;
  let s = sprites.get(key);
  if (!s) {
    s = makeSprite(TOWER_RADIUS * 2 + 14, TOWER_RADIUS * 2 + 18, SPRITE_SCALE, (g) => paintPlatform(g, def, tierMax));
    sprites.set(key, s);
  }
  return s;
}

function iconSprite(def) {
  const key = `i:${def.id}`;
  let s = sprites.get(key);
  if (!s) {
    s = makeSprite(30, 30, SPRITE_SCALE, (g) => {
      g.font = "21px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.shadowColor = "rgba(0,0,0,0.45)";
      g.shadowBlur = 3;
      g.shadowOffsetY = 1.5;
      g.fillText(def.icon, 0, 1);
    });
    sprites.set(key, s);
  }
  return s;
}

function drawBarrel(ctx, kind, color, recoil) {
  const R = TOWER_RADIUS;
  const back = -recoil * 4;
  const dark = shade(color, -0.55);
  ctx.lineJoin = "round";
  switch (kind) {
    case "dart":
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.roundRect(R * 0.35 + back, -3.5, R * 0.75, 7, 3);
      ctx.fill();
      ctx.fillStyle = "#e8e2d6";
      ctx.beginPath();
      ctx.moveTo(R * 1.1 + back, -2.5);
      ctx.lineTo(R * 1.35 + back, 0);
      ctx.lineTo(R * 1.1 + back, 2.5);
      ctx.fill();
      break;
    case "cannon":
      ctx.fillStyle = "#2a2e38";
      ctx.beginPath();
      ctx.roundRect(R * 0.2 + back, -6.5, R * 0.95, 13, 4);
      ctx.fill();
      ctx.fillStyle = "#4a505e";
      ctx.fillRect(R * 0.95 + back, -7.5, 5, 15);
      break;
    case "rifle":
      ctx.fillStyle = "#23262e";
      ctx.fillRect(R * 0.3 + back, -2.2, R * 1.35, 4.4);
      ctx.fillStyle = "#5a4630";
      ctx.fillRect(R * 0.3 + back, -3.5, R * 0.45, 7);
      break;
    case "staff":
      ctx.strokeStyle = "#6b4a2b";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(R * 0.3, 0);
      ctx.lineTo(R * 1.15 + back, 0);
      ctx.stroke();
      ctx.fillStyle = "#e0c8ff";
      ctx.beginPath();
      ctx.arc(R * 1.2 + back, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "twin":
      ctx.fillStyle = dark;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(R * 0.35 + back, s * 5 - 2.8, R * 0.85, 5.6, 2.5);
        ctx.fill();
      }
      break;
    default:
      break;
  }
}

export function drawRange(ctx, x, y, range, ok = true) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.fillStyle = ok ? "rgba(255,255,255,0.14)" : "rgba(255,70,110,0.2)";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = ok ? "rgba(255,255,255,0.85)" : "rgba(255,70,110,0.95)";
  ctx.stroke();
  ctx.restore();
}

export function drawTower(ctx, tower, { selected = false, ghost = false, time = 0 } = {}) {
  const def = TOWER_BY_ID[tower.defId];
  const stats = statsFor(tower);
  const look = TOWER_LOOK[def.id] ?? { color: "#8a93a6", barrel: "dart" };
  const tierMax = def.hero ? Math.min(3, Math.floor(((tower.level ?? 1) - 1) / 3) + 1) : Math.max(tower.tiers[0], tower.tiers[1]);
  const R = TOWER_RADIUS;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.7;
  ctx.translate(tower.x, tower.y);

  // A ready ability is the one thing on the board the player has to notice, so
  // it gets a pulsing halo rather than a static outline.
  if (!ghost && stats.ability && (tower.abilityCd ?? 0) <= 0) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.beginPath();
    ctx.arc(0, 0, R + 6 + pulse * 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,209,102,${0.5 + pulse * 0.45})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (!ghost && tower.buffT > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, R + 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,209,102,${0.16 + 0.08 * Math.sin(time * 14)})`;
    ctx.fill();
  }
  if (selected) {
    ctx.save();
    ctx.rotate(time * 1.5);
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  blit(ctx, platformSprite(def, tierMax), 0, 2);

  if (look.barrel === "tack") {
    // Nozzles all the way round, turning a notch with every volley.
    ctx.save();
    ctx.rotate((tower.shotCount ?? 0) * 0.19);
    ctx.fillStyle = "#3a2530";
    const n = Math.min(16, stats.count ?? 8);
    for (let i = 0; i < n; i++) {
      ctx.rotate((Math.PI * 2) / n);
      ctx.fillRect(R - 4, -2, 7, 4);
    }
    ctx.restore();
  } else if (!stats.support && look.barrel !== "none") {
    const since = 1 / Math.max(0.1, stats.rate ?? 1) - (tower.cooldown ?? 0);
    const recoil = ghost ? 0 : Math.max(0, 1 - since / 0.09);
    ctx.save();
    ctx.rotate(tower.angle ?? 0);
    drawBarrel(ctx, look.barrel, look.color, recoil);
    ctx.restore();
  }
  if (def.id === "ice" && !ghost) {
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.2 * Math.sin(time * 3);
    ctx.strokeStyle = "#e6fbff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  blit(ctx, iconSprite(def), 0, 0);

  if (def.hero) {
    // Level badge instead of upgrade pips — the hero has no bought tiers.
    ctx.beginPath();
    ctx.arc(R - 2, -R + 2, 9.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7a4a00";
    ctx.stroke();
    ctx.fillStyle = "#3a2400";
    ctx.font = `12px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tower.level ?? 1), R - 2, -R + 3);
  } else {
    // Upgrade gems under the platform: amber for the left path, mint for the right.
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < tower.tiers[p]; i++) {
        const x = (p === 0 ? -1 : 1) * (6 + i * 7);
        ctx.beginPath();
        ctx.moveTo(x, R + 3);
        ctx.lineTo(x + 3.2, R + 6.5);
        ctx.lineTo(x, R + 10);
        ctx.lineTo(x - 3.2, R + 6.5);
        ctx.closePath();
        ctx.fillStyle = p === 0 ? "#ffb020" : "#5ee6c8";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function drawTowers(ctx, state, selected, time = 0) {
  for (const t of state.towers) drawTower(ctx, t, { selected: t === selected, time });
}

/** Ongoing ability areas (Firestorm, Sun Blast, a missile salvo) so the player
 * can see where the damage is actually landing while it ticks. */
export function drawEffects(ctx, state, time) {
  for (const e of state.effects) {
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.07 * Math.sin(time * 9);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -time * 60;
    ctx.stroke();
    ctx.restore();
  }
}

// ----------------------------------------------------------- projectiles ---

function drawDart(ctx, p, tint) {
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(-8, -1.1, 12, 2.2);
  ctx.fillStyle = tint ?? "#e8e8ee";
  ctx.beginPath();
  ctx.moveTo(4, -2.4);
  ctx.lineTo(10, 0);
  ctx.lineTo(4, 2.4);
  ctx.fill();
  ctx.fillStyle = "#ff5d8f";
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-12, -3.5);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-12, 3.5);
  ctx.fill();
}

export function drawProjectiles(ctx, state) {
  const glows = [];
  for (const p of state.projectiles) {
    const kind = p.owner?.defId;
    const a = Math.atan2(p.vy, p.vx);
    if (p.dmgType === "magic" || kind === "super") {
      glows.push(p);
      continue;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dmgType === "explosive") {
      if (p.homing) {
        // Missile.
        ctx.rotate(a);
        ctx.fillStyle = "#d8dde6";
        ctx.beginPath();
        ctx.roundRect(-7, -2.6, 12, 5.2, 2.6);
        ctx.fill();
        ctx.fillStyle = "#ff5d5d";
        ctx.beginPath();
        ctx.moveTo(5, -2.6);
        ctx.lineTo(9, 0);
        ctx.lineTo(5, 2.6);
        ctx.fill();
        glows.push(p);
      } else {
        ctx.fillStyle = "#1e2129";
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(-2, -2.2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.arc(4, -5, 1.8 + Math.random() * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === "tack") {
      ctx.rotate(a);
      ctx.fillStyle = p.tint ?? "#c9ced8";
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-3, -2.6);
      ctx.lineTo(-3, 2.6);
      ctx.fill();
      ctx.fillStyle = shade(p.tint ?? "#c9ced8", -0.4);
      ctx.fillRect(-5, -3.2, 2.2, 6.4);
    } else {
      ctx.rotate(a);
      drawDart(ctx, p, p.tint);
    }
    ctx.restore();
  }

  // Everything that glows goes in one additive pass.
  if (!glows.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const p of glows) {
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const ux = p.vx / sp;
    const uy = p.vy / sp;
    if (p.owner?.defId === "super") {
      const c = p.tint ?? "#fff3b0";
      ctx.strokeStyle = rgba(c.startsWith("#") ? c : "#ffffff", 0.45);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(p.x - ux * 16, p.y - uy * 16);
      ctx.lineTo(p.x + ux * 4, p.y + uy * 4);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.dmgType === "explosive") {
      ctx.fillStyle = "rgba(255,170,60,0.8)";
      ctx.beginPath();
      ctx.arc(p.x - ux * 9, p.y - uy * 9, 3 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const c = p.tint ?? "#b06bff";
      ctx.strokeStyle = rgba(c.startsWith("#") ? c : "#b06bff", 0.4);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(p.x - ux * 14, p.y - uy * 14);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = rgba(c.startsWith("#") ? c : "#b06bff", 0.55);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
