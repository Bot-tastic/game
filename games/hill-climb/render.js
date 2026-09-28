// render.js — every pixel. A layered sky (gradient, sun or moon, stars,
// clouds), three parallax ridges with atmospheric haze, painted ground with
// strata, stones and grass, hazards, deterministic scenery, weather, the buggy
// and the FX on top.
//
// The camera maps world metres (y-up) to canvas pixels (y-down); world() sets
// up that transform once per frame and everything downstream draws in metres.
// Nothing here mutates the simulation: draw(view) takes a snapshot and paints.

import { CHASSIS, WHEEL, HEAD, anchorOf } from "./vehicle.js";
import { mulberry32 } from "./terrain.js";

const rgbCache = new Map();
const rgb = (hex) => {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
};
const rgba = (hex, a) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
const mix = (a, b, t) => {
  const ca = rgb(a);
  const cb = rgb(b);
  const h = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(ca[0] + (cb[0] - ca[0]) * t)}${h(ca[1] + (cb[1] - ca[1]) * t)}${h(ca[2] + (cb[2] - ca[2]) * t)}`;
};
const shade = (hex, t) => (t < 0 ? mix(hex, "#000000", -t) : mix(hex, "#ffffff", t));
const TAU = Math.PI * 2;
// Where the camera's focus sits on screen, as a fraction of width/height.
const AX = 0.36;
const AY = 0.5;

/** Cheap smooth 1D value noise, used for the ridges so they never repeat. */
function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const r = (k) => {
    const v = Math.sin((k + seed * 131.7) * 127.1) * 43758.5453;
    return v - Math.floor(v);
  };
  const t = f * f * (3 - 2 * f);
  return r(i) * (1 - t) + r(i + 1) * t;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  // Older Safari has no roundRect; a square corner is a fine fallback.
  if (!ctx.roundRect) ctx.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
  let W = 0;
  let H = 0;
  let scale = 42; // pixels per metre
  const cam = { x: 0, y: 0 };
  let weather = []; // screen-space weather particles
  let weatherKind = null;
  let stars = [];

  function resize(w, h) {
    W = w;
    H = h;
    // Keep roughly 13 metres of road in view, so the car reads clearly on a
    // phone without the horizon crowding a desktop window.
    // Short landscape phones are height-bound, so both axes get a say.
    scale = baseScale();
    const rnd = mulberry32(99);
    stars = Array.from({ length: 110 }, () => ({
      x: rnd(),
      y: rnd() * 0.62,
      r: 0.4 + rnd() * 1.3,
      tw: rnd() * TAU,
    }));
    weatherKind = null; // re-seed for the new size
  }

  const baseScale = () => Math.max(26, Math.min(88, Math.min(W / 13, H / 7.2)));

  /** World -> screen. */
  const sx = (x) => (x - cam.x) * scale + W * AX;
  const sy = (y) => H * AY - (y - cam.y) * scale;

  function world(fn) {
    ctx.save();
    ctx.translate(W * AX, H * AY);
    ctx.scale(scale, -scale);
    ctx.translate(-cam.x, -cam.y);
    fn();
    ctx.restore();
  }

  // -- sky ------------------------------------------------------------------

  function drawSky(theme, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.sky0);
    g.addColorStop(0.55, theme.sky1);
    g.addColorStop(0.8, theme.horizon);
    g.addColorStop(1, theme.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (theme.stars) {
      for (const s of stars) {
        const a = 0.35 + 0.45 * Math.sin(t * 1.7 + s.tw) ** 2;
        ctx.globalAlpha = a * (1 - s.y * 1.1);
        ctx.fillStyle = "#ffffff";
        const px = (((s.x * W * 1.4 - cam.x * 0.6) % (W * 1.4)) + W * 1.4) % (W * 1.4) - W * 0.2;
        ctx.fillRect(px, s.y * H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    // Sun / moon / earth, parked high and drifting slowly with the camera.
    const period = W * 2.2;
    const px = ((((W * 0.76 - cam.x * 0.9) % period) + period) % period) - W * 0.3;
    const py = H * 0.2;
    const r = Math.max(18, Math.min(W, H) * 0.06);
    if (theme.sunKind !== "none") {
      const halo = ctx.createRadialGradient(px, py, r * 0.5, px, py, r * 7);
      halo.addColorStop(0, rgba(theme.sun, theme.sunKind === "sun" ? 0.55 : 0.3));
      halo.addColorStop(0.25, rgba(theme.sun, 0.14));
      halo.addColorStop(1, rgba(theme.sun, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(px - r * 7, py - r * 7, r * 14, r * 14);
    }
    if (theme.sunKind === "sun") {
      // Slowly turning rays.
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(t * 0.05);
      ctx.fillStyle = rgba(theme.sun, 0.08);
      for (let k = 0; k < 12; k++) {
        ctx.rotate(TAU / 12);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 6, -r * 0.5);
        ctx.lineTo(r * 6, r * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = theme.sun;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    } else if (theme.sunKind === "moon") {
      ctx.fillStyle = theme.sun;
      ctx.beginPath();
      ctx.arc(px, py, r * 0.9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba("#000000", 0.08);
      for (const [cx, cy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12]]) {
        ctx.beginPath();
        ctx.arc(px + cx * r, py + cy * r, cr * r, 0, TAU);
        ctx.fill();
      }
    } else if (theme.sunKind === "earth") {
      const eg = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
      eg.addColorStop(0, "#9fd8ff");
      eg.addColorStop(0.7, "#2f7fd8");
      eg.addColorStop(1, "#153a78");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#4fae5a";
      ctx.beginPath();
      ctx.ellipse(px - r * 0.25, py - r * 0.1, r * 0.35, r * 0.5, 0.5, 0, TAU);
      ctx.ellipse(px + r * 0.45, py + r * 0.35, r * 0.3, r * 0.22, -0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba("#ffffff", 0.7);
      ctx.fillRect(px - r, py - r * 0.55, r * 2, r * 0.1);
      ctx.fillRect(px - r, py + r * 0.15, r * 2, r * 0.08);
      // Night side.
      ctx.fillStyle = rgba("#000010", 0.55);
      ctx.beginPath();
      ctx.arc(px + r * 0.55, py + r * 0.2, r * 1.05, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Clouds: three parallax bands of puffy, two-tone clusters.
    const rnd = mulberry32(7727);
    for (let band = 0; band < (theme.clouds === false ? 0 : 3); band++) {
      const depth = 0.04 + band * 0.04;
      const y = H * (0.07 + band * 0.085);
      const size = (0.55 + band * 0.25) * Math.min(H, W) * 0.045;
      const alpha = theme.stars ? 0.35 : 0.8;
      for (let i = 0; i < 4; i++) {
        const base = rnd() * 3000;
        const drift = t * (3 + band * 2);
        const span = W + size * 10;
        const x = (((base - cam.x * depth * scale - drift) % span) + span) % span - size * 5;
        const yy = y + rnd() * size;
        const puffs = 4 + Math.floor(rnd() * 3);
        ctx.globalAlpha = alpha * (0.6 + band * 0.2);
        // Shadow side first, then the lit top offset upwards.
        for (let pass = 0; pass < 2; pass++) {
          ctx.fillStyle = pass === 0 ? mix(theme.cloud, theme.sky1, 0.45) : theme.cloud;
          ctx.beginPath();
          const pr = mulberry32(i * 31 + band * 7 + 1);
          for (let k = 0; k < puffs; k++) {
            const ox = (k - puffs / 2) * size * 0.75;
            const oy = -Math.sin((k / (puffs - 1)) * Math.PI) * size * 0.55 + pr() * size * 0.2;
            const rr = size * (0.55 + Math.sin((k / (puffs - 1)) * Math.PI) * 0.45);
            ctx.moveTo(x + ox + rr, yy + oy - pass * size * 0.14);
            ctx.arc(x + ox, yy + oy - pass * size * 0.14, rr * (1 - pass * 0.12), 0, TAU);
          }
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Three ridge silhouettes, hazed toward the horizon colour with distance. */
  function drawRidges(theme) {
    const layers = [
      { depth: 0.06, base: 0.6, amp: 0.2, freq: 0.004, haze: 0.45, seed: 1 },
      { depth: 0.14, base: 0.66, amp: 0.15, freq: 0.007, haze: 0.2, seed: 2 },
      { depth: 0.26, base: 0.74, amp: 0.12, freq: 0.012, haze: 0, seed: 3 },
    ];
    layers.forEach((L, idx) => {
      const col = mix(theme.ridges[idx], theme.horizon, L.haze);
      const shift = cam.x * scale * L.depth;
      const lift = cam.y * scale * L.depth * 0.3;
      const baseY = H * L.base + lift;
      const top = (px) => {
        const wx = (px + shift) * L.freq;
        let n = noise1(wx, L.seed) * 0.65 + noise1(wx * 2.3, L.seed + 5) * 0.28 + noise1(wx * 6, L.seed + 9) * 0.07;
        if (theme.id === "canyon" && idx > 0) n = Math.round(n * 3.2) / 3.2; // mesas: flat tops
        return baseY - n * H * L.amp;
      };
      const g = ctx.createLinearGradient(0, baseY - H * L.amp, 0, H);
      g.addColorStop(0, col);
      g.addColorStop(1, mix(col, theme.sky0, 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-10, H);
      for (let px = -10; px <= W + 10; px += 6) ctx.lineTo(px, top(px));
      ctx.lineTo(W + 10, H);
      ctx.closePath();
      ctx.fill();

      if (idx === 0 && theme.caps) {
        // Snow caps: the ridge above a line, tinted.
        ctx.save();
        ctx.clip();
        ctx.fillStyle = rgba(theme.caps, 0.75);
        ctx.fillRect(0, 0, W, baseY - H * L.amp * 0.62);
        ctx.restore();
      }
      if (idx === 1 && theme.skyline) drawSkyline(theme, top, shift);
      if (idx === 2) drawRidgeTrees(theme, top, shift, col);
    });
    // A band of haze where the ridges meet the ground.
    const hg = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.85);
    hg.addColorStop(0, rgba(theme.horizon, 0));
    hg.addColorStop(1, rgba(theme.horizon, 0.18));
    ctx.fillStyle = hg;
    ctx.fillRect(0, H * 0.45, W, H * 0.4);
  }

  function drawSkyline(theme, top, shift) {
    const bw = 26;
    const i0 = Math.floor(shift / bw) - 1;
    for (let i = i0; i < i0 + W / bw + 3; i++) {
      const r = mulberry32((i * 7919) >>> 0);
      if (r() < 0.25) continue;
      const px = i * bw - shift;
      const h = 30 + r() * H * 0.2;
      const w = bw * (0.6 + r() * 0.5);
      const y = top(px + w / 2) + 12;
      ctx.fillStyle = mix(theme.ridges[1], "#000000", 0.2);
      ctx.fillRect(px, y - h, w, h + H);
      ctx.fillStyle = rgba(r() < 0.5 ? "#ffd98a" : "#9ad8ff", 0.55);
      for (let wy = y - h + 6; wy < y - 4; wy += 7) {
        for (let wx = px + 4; wx < px + w - 4; wx += 6) {
          if (r() < 0.45) ctx.fillRect(wx, wy, 2.4, 3);
        }
      }
    }
  }

  /** Small silhouettes along the nearest ridge, matching the world's scenery. */
  function drawRidgeTrees(theme, top, shift, col) {
    const kind = theme.deco[0];
    if (!["tree", "fir", "pine", "cactus", "charred", "deadtree"].includes(kind)) return;
    const gap = 18;
    const i0 = Math.floor(shift / gap) - 1;
    ctx.fillStyle = mix(col, "#000000", 0.12);
    for (let i = i0; i < i0 + W / gap + 3; i++) {
      const r = mulberry32((i * 104729) >>> 0);
      if (r() < 0.45) continue;
      const px = i * gap - shift + r() * gap;
      const y = top(px) + 2;
      const s = 7 + r() * 9;
      ctx.beginPath();
      if (kind === "tree") {
        ctx.arc(px, y - s, s * 0.8, 0, TAU);
        ctx.rect(px - 1.2, y - s, 2.4, s);
      } else if (kind === "cactus") {
        ctx.rect(px - 1.5, y - s * 1.4, 3, s * 1.4);
        ctx.rect(px - 5, y - s * 0.9, 3, s * 0.5);
        ctx.rect(px + 2, y - s * 1.1, 3, s * 0.45);
      } else {
        ctx.moveTo(px, y - s * 2);
        ctx.lineTo(px + s * 0.55, y);
        ctx.lineTo(px - s * 0.55, y);
      }
      ctx.fill();
    }
  }

  // -- terrain --------------------------------------------------------------

  function viewSpan() {
    return [cam.x - (W * AX) / scale - 2, cam.x + (W * (1 - AX)) / scale + 2];
  }

  function drawTerrain(terrain, theme, t) {
    const [x0, x1] = viewSpan();
    const pts = terrain.slice(x0, x1);
    const bottom = cam.y - (H * (1 - AY)) / scale - 1;
    const topY = pts.reduce((m, p) => Math.max(m, p.y), -1e9);

    world(() => {
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, bottom);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1].x, bottom);
        ctx.closePath();
      };

      // Soil body, darkening with depth.
      path();
      const g = ctx.createLinearGradient(0, topY, 0, Math.min(bottom, topY - 14));
      g.addColorStop(0, theme.soil);
      g.addColorStop(1, theme.soilDark);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      path();
      ctx.clip();

      // Strata: bands that follow the surface at fixed depths.
      for (const [depth, width, alpha] of [[1.6, 0.5, 0.5], [3.4, 0.9, 0.35], [6.2, 1.3, 0.25]]) {
        ctx.strokeStyle = rgba(theme.strata, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((p, k) => {
          const wob = Math.sin(p.x * 0.21 + depth) * 0.25;
          k ? ctx.lineTo(p.x, p.y - depth + wob) : ctx.moveTo(p.x, p.y - depth + wob);
        });
        ctx.stroke();
      }

      // Embedded stones, deterministic per 4 m cell so they never crawl.
      const c0 = Math.floor(x0 / 4);
      const c1 = Math.ceil(x1 / 4);
      for (let c = c0; c <= c1; c++) {
        const r = mulberry32((c * 2246822519) >>> 0);
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const x = c * 4 + r() * 4;
          const d = 0.9 + r() * 6;
          const y = terrain.groundY(x) - d;
          const rx = 0.12 + r() * 0.3;
          const ry = rx * (0.55 + r() * 0.3);
          ctx.fillStyle = rgba(theme.stone, 0.55 + r() * 0.3);
          ctx.beginPath();
          ctx.ellipse(x, y, rx, ry, r() * 3, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba("#ffffff", 0.1);
          ctx.beginPath();
          ctx.ellipse(x - rx * 0.2, y + ry * 0.3, rx * 0.5, ry * 0.4, 0, 0, TAU);
          ctx.fill();
        }
      }

      if (theme.surface === "cracks") {
        // Glowing lava veins pulsing under the crust.
        const pulse = 0.55 + 0.3 * Math.sin(t * 2.2);
        ctx.strokeStyle = rgba(theme.hazard.top, pulse);
        ctx.lineWidth = 0.09;
        ctx.shadowColor = theme.hazard.glow;
        ctx.shadowBlur = 8;
        for (let c = c0; c <= c1; c++) {
          const r = mulberry32((c * 374761393) >>> 0);
          if (r() < 0.5) continue;
          let x = c * 4 + r() * 3;
          let y = terrain.groundY(x) - 0.5;
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let s = 0; s < 4; s++) {
            x += (r() - 0.3) * 0.9;
            y -= 0.4 + r() * 0.6;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      if (theme.surface === "craters") {
        for (let c = c0; c <= c1; c++) {
          const r = mulberry32((c * 668265263) >>> 0);
          if (r() < 0.6) continue;
          const x = c * 4 + r() * 4;
          const y = terrain.groundY(x) - 0.25;
          const rr = 0.4 + r() * 0.7;
          ctx.fillStyle = rgba("#000000", 0.18);
          ctx.beginPath();
          ctx.ellipse(x, y, rr, rr * 0.28, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();

      // Crust: a thick band sitting on the polyline the wheels touch, a lit
      // top edge and a soft shadow line under it.
      const crustPath = (off) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y - off);
        for (const p of pts) ctx.lineTo(p.x, p.y - off);
      };
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 0.2;
      ctx.strokeStyle = rgba("#000000", 0.22);
      crustPath(0.52);
      ctx.stroke();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = theme.crust;
      crustPath(0.22);
      ctx.stroke();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = theme.crustHi;
      crustPath(0.02);
      ctx.stroke();

      if (theme.surface === "road") {
        // Dashed centre line and a kerb glow.
        ctx.setLineDash([1.6, 1.4]);
        ctx.lineWidth = 0.07;
        ctx.strokeStyle = rgba("#ffd166", 0.85);
        crustPath(0.24);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (theme.surface === "snow") {
        // Soft drifts piled on the crust.
        ctx.fillStyle = "#ffffff";
        for (let c = Math.floor(x0 / 1.5); c <= x1 / 1.5; c++) {
          const r = mulberry32((c * 1597334677) >>> 0);
          if (r() < 0.5) continue;
          const x = c * 1.5 + r();
          const y = terrain.groundY(x);
          ctx.beginPath();
          ctx.ellipse(x, y, 0.4 + r() * 0.5, 0.08 + r() * 0.08, Math.atan(terrain.slopeAt(x)), 0, Math.PI);
          ctx.fill();
        }
      }

      if (theme.grass) drawGrass(terrain, theme, x0, x1, t);
    });
  }

  function drawGrass(terrain, theme, x0, x1, t) {
    const sway = Math.sin(t * 1.6) * 0.05;
    ctx.lineWidth = 0.05;
    ctx.lineCap = "round";
    const light = shade(theme.grass, 0.25);
    for (let c = Math.floor(x0 / 0.7); c <= x1 / 0.7; c++) {
      const r = mulberry32((c * 2654435761) >>> 0);
      if (r() < 0.35) continue;
      const x = c * 0.7 + r() * 0.7;
      if (terrain.hazardAt(x)) continue;
      const y = terrain.groundY(x) - 0.05;
      const blades = 2 + Math.floor(r() * 3);
      ctx.strokeStyle = r() < 0.5 ? theme.grass : light;
      ctx.beginPath();
      for (let b = 0; b < blades; b++) {
        const h = 0.16 + r() * 0.24;
        const lean = (r() - 0.5) * 0.18 + sway;
        const bx = x + (b - blades / 2) * 0.05;
        ctx.moveTo(bx, y);
        ctx.quadraticCurveTo(bx + lean * 0.4, y + h * 0.6, bx + lean, y + h);
      }
      ctx.stroke();
      if (r() < 0.06) {
        // The odd flower.
        ctx.fillStyle = r() < 0.5 ? "#ffe066" : "#ff8fb1";
        ctx.beginPath();
        ctx.arc(x, y + 0.3, 0.06, 0, TAU);
        ctx.fill();
      }
    }
  }

  // -- hazards ----------------------------------------------------------------

  function drawHazards(terrain, theme, t) {
    const [x0, x1] = viewSpan();
    const hz = theme.hazard;
    world(() => {
      for (const q of terrain.pits) {
        if (q.x1 < x0 - 2 || q.x0 > x1 + 2) continue;
        const floor = Math.min(q.ya, q.yb) - q.depth - 0.5;
        const top = q.surface;
        if (hz.kind === "spikes" || hz.kind === "void") {
          // Dark pit with a glowing rim; a bed of spikes for the city.
          const g = ctx.createLinearGradient(0, top + 1.3, 0, floor);
          g.addColorStop(0, rgba(hz.glow, 0.3));
          g.addColorStop(1, rgba(hz.deep, 0.95));
          ctx.fillStyle = g;
          ctx.fillRect(q.x0 - 0.2, floor, q.x1 - q.x0 + 0.4, top + 1.3 - floor);
          if (hz.kind === "spikes") {
            const n = Math.max(3, Math.round((q.x1 - q.x0) / 0.55));
            for (let k = 0; k < n; k++) {
              const bx = q.x0 + ((k + 0.5) / n) * (q.x1 - q.x0);
              const sg = ctx.createLinearGradient(bx - 0.22, 0, bx + 0.22, 0);
              sg.addColorStop(0, "#8a909c");
              sg.addColorStop(0.5, "#eef1f6");
              sg.addColorStop(1, "#6a707c");
              ctx.fillStyle = sg;
              ctx.beginPath();
              ctx.moveTo(bx - 0.24, floor);
              ctx.lineTo(bx, top + 0.1);
              ctx.lineTo(bx + 0.24, floor);
              ctx.closePath();
              ctx.fill();
            }
          } else {
            // The void: faint stars far below.
            const r = mulberry32(Math.floor(q.x0 * 10));
            ctx.fillStyle = rgba("#ffffff", 0.6);
            for (let k = 0; k < 8; k++) ctx.fillRect(q.x0 + r() * (q.x1 - q.x0), floor + r() * (top - floor), 0.05, 0.05);
          }
          ctx.fillStyle = rgba(hz.glow, 0.45 + 0.25 * Math.sin(t * 4));
          ctx.fillRect(q.x0, top + 1.2, q.x1 - q.x0, 0.06);
          continue;
        }
        // Liquids: gradient body and an animated wavy surface.
        const g = ctx.createLinearGradient(0, top, 0, floor);
        g.addColorStop(0, hz.top);
        g.addColorStop(1, hz.deep);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(q.x0 - 0.3, floor);
        const steps = Math.max(8, Math.round((q.x1 - q.x0) * 4));
        for (let k = 0; k <= steps; k++) {
          const x = q.x0 - 0.3 + ((q.x1 - q.x0 + 0.6) * k) / steps;
          ctx.lineTo(x, top + Math.sin(x * 2.4 + t * 3) * 0.07 + Math.sin(x * 5.1 - t * 2) * 0.03);
        }
        ctx.lineTo(q.x1 + 0.3, floor);
        ctx.closePath();
        if (hz.glow) {
          ctx.shadowColor = hz.glow;
          ctx.shadowBlur = 24;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        // Surface shine.
        ctx.strokeStyle = rgba("#ffffff", hz.kind === "lava" ? 0.35 : 0.55);
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const x = q.x0 + ((q.x1 - q.x0) * k) / steps;
          const y = top + Math.sin(x * 2.4 + t * 3) * 0.07 + Math.sin(x * 5.1 - t * 2) * 0.03 - 0.02;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        if (hz.kind === "lava" || hz.kind === "swamp") {
          // Bubbles popping on the surface.
          const r = mulberry32(Math.floor(q.x0 * 10));
          for (let k = 0; k < 4; k++) {
            const bx = q.x0 + 0.5 + r() * (q.x1 - q.x0 - 1);
            const ph = (t * (0.6 + r() * 0.5) + r()) % 1;
            ctx.fillStyle = rgba(hz.kind === "lava" ? "#ffe08a" : "#b6d66a", 0.8 * (1 - ph));
            ctx.beginPath();
            ctx.arc(bx, top + ph * 0.25, 0.08 + ph * 0.14, 0, TAU);
            ctx.fill();
          }
        }
        if (hz.kind === "icewater") {
          ctx.fillStyle = rgba("#ffffff", 0.85);
          const r = mulberry32(Math.floor(q.x0 * 10));
          for (let k = 0; k < 2; k++) {
            const bx = q.x0 + 0.8 + r() * (q.x1 - q.x0 - 1.6);
            const by = top + Math.sin(bx * 2.4 + t * 3) * 0.07;
            ctx.fillRect(bx - 0.4, by - 0.05, 0.8, 0.14);
          }
        }
      }
    });
  }

  // -- scenery --------------------------------------------------------------

  const DECO_SPAN = 7; // metres between candidate scenery slots

  function drawScenery(terrain, theme, t, layer) {
    const [x0, x1] = viewSpan();
    const i0 = Math.floor((x0 - 4) / DECO_SPAN);
    const i1 = Math.ceil((x1 + 4) / DECO_SPAN);
    world(() => {
      for (let i = i0; i <= i1; i++) {
        const rnd = mulberry32(((i * 2654435761) ^ (layer * 97)) >>> 0);
        if (rnd() > (layer === 0 ? 0.6 : 0.3)) continue;
        const x = i * DECO_SPAN + rnd() * DECO_SPAN * 0.8;
        if (x < 12 || terrain.hazardAt(x) || terrain.hazardAt(x + 1) || terrain.hazardAt(x - 1)) continue;
        if (Math.abs(terrain.slopeAt(x)) > 0.9) continue;
        const y = terrain.groundY(x) - 0.12;
        const s = (layer === 0 ? 0.8 : 0.6) + rnd() * 0.5;
        const kind = theme.deco[Math.floor(rnd() * theme.deco.length)];
        ctx.save();
        if (layer === 1) ctx.globalAlpha = 0.95;
        drawDeco(theme, kind, x, y, s, rnd, t);
        ctx.restore();
      }
    });
  }

  function drawDeco(theme, kind, x, y, s, rnd, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    switch (kind) {
      case "tree": {
        ctx.fillStyle = "#5b3d22";
        ctx.beginPath();
        ctx.moveTo(-0.12, 0);
        ctx.lineTo(-0.07, 1.3);
        ctx.lineTo(0.07, 1.3);
        ctx.lineTo(0.12, 0);
        ctx.fill();
        const base = shade("#2f8f4e", (rnd() - 0.5) * 0.3);
        const blobs = [[0, 1.55, 0.7], [-0.45, 1.25, 0.5], [0.45, 1.3, 0.52], [0, 2.0, 0.5]];
        ctx.fillStyle = shade(base, -0.25);
        for (const [bx, by, br] of blobs) {
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = base;
        for (const [bx, by, br] of blobs) {
          ctx.beginPath();
          ctx.arc(bx - 0.08, by + 0.08, br * 0.82, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = rgba("#ffffff", 0.12);
        ctx.beginPath();
        ctx.arc(-0.2, 2.1, 0.25, 0, TAU);
        ctx.fill();
        if (rnd() < 0.3) {
          ctx.fillStyle = "#e84a4a";
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc((rnd() - 0.5) * 1, 1.2 + rnd() * 0.9, 0.07, 0, TAU);
            ctx.fill();
          }
        }
        break;
      }
      case "bush": {
        ctx.fillStyle = shade("#3a9a52", -0.2);
        ctx.beginPath();
        ctx.arc(-0.3, 0.25, 0.35, 0, TAU);
        ctx.arc(0.25, 0.3, 0.4, 0, TAU);
        ctx.arc(0, 0.5, 0.35, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#4cb865";
        ctx.beginPath();
        ctx.arc(-0.05, 0.55, 0.22, 0, TAU);
        ctx.fill();
        break;
      }
      case "fence": {
        ctx.fillStyle = "#c89a64";
        for (const px of [-1, 0, 1]) ctx.fillRect(px - 0.06, 0, 0.12, 0.8);
        ctx.fillRect(-1.1, 0.5, 2.2, 0.1);
        ctx.fillRect(-1.1, 0.25, 2.2, 0.1);
        break;
      }
      case "cactus": {
        const c = "#3f8a52";
        const lit = "#5fae6a";
        const limb = (x0, y0, w, h) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.roundRect(x0, y0, w, h, w / 2);
          ctx.fill();
          ctx.fillStyle = lit;
          ctx.fillRect(x0 + w * 0.2, y0 + w * 0.3, w * 0.18, h - w * 0.6);
        };
        limb(-0.18, 0, 0.36, 1.8);
        limb(-0.7, 0.75, 0.3, 0.75);
        ctx.fillStyle = c;
        ctx.fillRect(-0.55, 0.75, 0.45, 0.24);
        limb(0.36, 1.0, 0.28, 0.6);
        ctx.fillStyle = c;
        ctx.fillRect(0.1, 1.0, 0.4, 0.22);
        if (rnd() < 0.4) {
          ctx.fillStyle = "#ff7ab0";
          ctx.beginPath();
          ctx.arc(0, 1.82, 0.1, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "skull": {
        ctx.fillStyle = "#efe6d2";
        ctx.beginPath();
        ctx.ellipse(0, 0.18, 0.3, 0.2, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#efe6d2";
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(-0.25, 0.3);
        ctx.quadraticCurveTo(-0.6, 0.5, -0.55, 0.75);
        ctx.moveTo(0.25, 0.3);
        ctx.quadraticCurveTo(0.6, 0.5, 0.55, 0.75);
        ctx.stroke();
        ctx.fillStyle = "#5a4a3a";
        ctx.beginPath();
        ctx.arc(-0.1, 0.2, 0.05, 0, TAU);
        ctx.arc(0.1, 0.2, 0.05, 0, TAU);
        ctx.fill();
        break;
      }
      case "rock": {
        ctx.fillStyle = shade(theme.stone, 0.1);
        ctx.beginPath();
        ctx.moveTo(-0.7, 0);
        ctx.lineTo(-0.45, 0.5);
        ctx.lineTo(0.05, 0.72);
        ctx.lineTo(0.5, 0.45);
        ctx.lineTo(0.72, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(theme.stone, 0.35);
        ctx.beginPath();
        ctx.moveTo(-0.45, 0.5);
        ctx.lineTo(0.05, 0.72);
        ctx.lineTo(0.1, 0.35);
        ctx.lineTo(-0.3, 0.25);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "fir":
      case "pine": {
        const snowy = kind === "pine";
        ctx.fillStyle = "#3a2a1c";
        ctx.fillRect(-0.09, 0, 0.18, 0.6);
        const green = kind === "fir" ? "#1f4a3a" : "#1f5b46";
        for (let k = 0; k < 4; k++) {
          const yb = 0.45 + k * 0.5;
          const w = 0.85 - k * 0.17;
          ctx.fillStyle = shade(green, -0.15);
          ctx.beginPath();
          ctx.moveTo(0, yb + 0.95);
          ctx.lineTo(w, yb);
          ctx.lineTo(-w, yb);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = shade(green, 0.08);
          ctx.beginPath();
          ctx.moveTo(0, yb + 0.95);
          ctx.lineTo(-w, yb);
          ctx.lineTo(-w * 0.1, yb + 0.1);
          ctx.closePath();
          ctx.fill();
          if (snowy) {
            ctx.fillStyle = rgba("#ffffff", 0.9);
            ctx.beginPath();
            ctx.moveTo(0, yb + 0.95);
            ctx.lineTo(w * 0.45, yb + 0.5);
            ctx.lineTo(-w * 0.45, yb + 0.5);
            ctx.closePath();
            ctx.fill();
          }
        }
        break;
      }
      case "mushroom": {
        ctx.fillStyle = "#efe2c8";
        ctx.fillRect(-0.08, 0, 0.16, 0.35);
        ctx.fillStyle = "#d8423a";
        ctx.beginPath();
        ctx.ellipse(0, 0.36, 0.3, 0.2, 0, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-0.1, 0.45, 0.04, 0, TAU);
        ctx.arc(0.1, 0.42, 0.035, 0, TAU);
        ctx.arc(0.0, 0.52, 0.03, 0, TAU);
        ctx.fill();
        break;
      }
      case "stump": {
        ctx.fillStyle = "#5a3e28";
        ctx.fillRect(-0.3, 0, 0.6, 0.45);
        ctx.fillStyle = "#c9a37a";
        ctx.beginPath();
        ctx.ellipse(0, 0.45, 0.3, 0.1, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#8a6a4a";
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.ellipse(0, 0.45, 0.16, 0.05, 0, 0, TAU);
        ctx.stroke();
        break;
      }
      case "snowman": {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0.35, 0.36, 0, TAU);
        ctx.arc(0, 0.9, 0.25, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#ff8a3a";
        ctx.beginPath();
        ctx.moveTo(0.18, 0.93);
        ctx.lineTo(0.42, 0.9);
        ctx.lineTo(0.18, 0.86);
        ctx.fill();
        ctx.fillStyle = "#222";
        ctx.fillRect(-0.2, 1.1, 0.4, 0.05);
        ctx.fillRect(-0.13, 1.1, 0.26, 0.26);
        break;
      }
      case "ice": {
        ctx.fillStyle = rgba("#bfefff", 0.85);
        ctx.beginPath();
        ctx.moveTo(-0.4, 0);
        ctx.lineTo(-0.2, 0.9);
        ctx.lineTo(0.05, 0.4);
        ctx.lineTo(0.25, 1.2);
        ctx.lineTo(0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba("#ffffff", 0.6);
        ctx.beginPath();
        ctx.moveTo(0.25, 1.2);
        ctx.lineTo(0.3, 0.2);
        ctx.lineTo(0.12, 0.3);
        ctx.fill();
        break;
      }
      case "lamp": {
        ctx.fillStyle = "#4a5060";
        ctx.fillRect(-0.06, 0, 0.12, 3.4);
        ctx.fillRect(-0.06, 3.3, 0.8, 0.1);
        const glow = ctx.createRadialGradient(0.7, 3.2, 0.05, 0.7, 3.2, 2.4);
        glow.addColorStop(0, rgba("#ffe6a8", 0.55));
        glow.addColorStop(1, rgba("#ffe6a8", 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.moveTo(0.55, 3.25);
        ctx.lineTo(0.85, 3.25);
        ctx.lineTo(2.1, 0);
        ctx.lineTo(-0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff3c4";
        ctx.fillRect(0.5, 3.18, 0.4, 0.1);
        break;
      }
      case "cone": {
        ctx.fillStyle = "#ff7a2a";
        ctx.beginPath();
        ctx.moveTo(-0.25, 0);
        ctx.lineTo(0, 0.6);
        ctx.lineTo(0.25, 0);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-0.13, 0.25, 0.26, 0.08);
        break;
      }
      case "sign": {
        ctx.fillStyle = "#6b7280";
        ctx.fillRect(-0.05, 0, 0.1, 1.6);
        ctx.fillStyle = "#1f8f5a";
        ctx.fillRect(-0.6, 1.5, 1.2, 0.6);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.04;
        ctx.strokeRect(-0.55, 1.55, 1.1, 0.5);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-0.4, 1.78, 0.6, 0.06);
        ctx.beginPath();
        ctx.moveTo(0.25, 1.7);
        ctx.lineTo(0.42, 1.81);
        ctx.lineTo(0.25, 1.92);
        ctx.fill();
        break;
      }
      case "mesa": {
        ctx.fillStyle = shade(theme.ridges[2], 0.15);
        ctx.beginPath();
        ctx.moveTo(-0.9, 0);
        ctx.lineTo(-0.6, 1.9);
        ctx.lineTo(0.55, 2.0);
        ctx.lineTo(0.85, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba("#000000", 0.18);
        ctx.fillRect(-0.72, 0.6, 1.5, 0.1);
        ctx.fillRect(-0.66, 1.2, 1.35, 0.08);
        break;
      }
      case "deadtree":
      case "charred": {
        ctx.strokeStyle = kind === "charred" ? "#1a1414" : "#6a4a3a";
        ctx.lineCap = "round";
        ctx.lineWidth = 0.14;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0.05, 1.5);
        ctx.moveTo(0.03, 0.8);
        ctx.lineTo(-0.45, 1.3);
        ctx.moveTo(0.05, 1.1);
        ctx.lineTo(0.5, 1.6);
        ctx.moveTo(0.05, 1.5);
        ctx.lineTo(-0.2, 1.9);
        ctx.stroke();
        if (kind === "charred") {
          ctx.fillStyle = rgba("#ff6a2a", 0.5 + 0.3 * Math.sin(t * 4 + x));
          ctx.beginPath();
          ctx.arc(0.04, 0.5, 0.05, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "lavarock": {
        ctx.fillStyle = "#1c1616";
        ctx.beginPath();
        ctx.moveTo(-0.6, 0);
        ctx.lineTo(-0.3, 0.55);
        ctx.lineTo(0.2, 0.6);
        ctx.lineTo(0.6, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba("#ff7a2a", 0.75 + 0.2 * Math.sin(t * 3 + x));
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(-0.3, 0.1);
        ctx.lineTo(-0.1, 0.35);
        ctx.lineTo(0.15, 0.2);
        ctx.stroke();
        break;
      }
      case "vent": {
        ctx.fillStyle = "#2a2222";
        ctx.beginPath();
        ctx.moveTo(-0.5, 0);
        ctx.lineTo(-0.2, 0.5);
        ctx.lineTo(0.2, 0.5);
        ctx.lineTo(0.5, 0);
        ctx.fill();
        for (let k = 0; k < 3; k++) {
          const ph = (t * 0.5 + k / 3 + x) % 1;
          ctx.fillStyle = rgba("#6a5a5a", 0.4 * (1 - ph));
          ctx.beginPath();
          ctx.arc(Math.sin(ph * 4 + k) * 0.2, 0.6 + ph * 2.2, 0.18 + ph * 0.4, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "antenna": {
        ctx.strokeStyle = "#b8bccb";
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(-0.3, 0);
        ctx.lineTo(0, 1.1);
        ctx.lineTo(0.3, 0);
        ctx.stroke();
        ctx.fillStyle = "#dfe3f0";
        ctx.beginPath();
        ctx.ellipse(0, 1.3, 0.45, 0.18, -0.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba("#ff4a4a", Math.sin(t * 4 + x) > 0 ? 0.95 : 0.2);
        ctx.beginPath();
        ctx.arc(0.1, 1.55, 0.06, 0, TAU);
        ctx.fill();
        break;
      }
      case "flag": {
        ctx.fillStyle = "#cfd3de";
        ctx.fillRect(-0.03, 0, 0.06, 1.6);
        ctx.fillStyle = "#e8eaf2";
        ctx.fillRect(0.03, 1.1, 0.7, 0.45);
        ctx.fillStyle = "#3b6fd4";
        ctx.fillRect(0.03, 1.33, 0.25, 0.22);
        ctx.fillStyle = "#d44a4a";
        for (let k = 0; k < 3; k++) ctx.fillRect(0.28, 1.12 + k * 0.15, 0.45, 0.06);
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  const MARKER_GAP = 50; // metres between roadside distance flags

  /** A flag every 50 m, so progress is legible without reading the HUD. */
  function drawMarkers(terrain, theme) {
    const [x0, x1] = viewSpan();
    const limit = Number.isFinite(terrain.finishX) ? terrain.finishX - 20 : Infinity;
    const first = Math.max(MARKER_GAP, Math.floor(x0 / MARKER_GAP) * MARKER_GAP);
    world(() => {
      for (let m = first; m <= x1 && m < limit; m += MARKER_GAP) {
        if (terrain.hazardAt(m)) continue;
        const y = terrain.groundY(m);
        ctx.strokeStyle = rgba("#ffffff", 0.8);
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(m, y);
        ctx.lineTo(m, y + 2.1);
        ctx.stroke();
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.moveTo(m, y + 2.1);
        ctx.quadraticCurveTo(m + 0.5, y + 2.05, m + 1.05, y + 1.85);
        ctx.lineTo(m, y + 1.5);
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let m = first; m <= x1 && m < limit; m += MARKER_GAP) {
      if (terrain.hazardAt(m)) continue;
      const y = terrain.groundY(m);
      ctx.fillStyle = rgba("#000000", 0.35);
      ctx.fillText(`${m}m`, sx(m + 0.5) + 1, sy(y + 2.55) + 1);
      ctx.fillStyle = rgba("#ffffff", 0.9);
      ctx.fillText(`${m}m`, sx(m + 0.5), sy(y + 2.55));
    }
  }

  /** Chequered arch over the finish line of a level. */
  function drawFinish(terrain, theme, t) {
    const fx = terrain.finishX;
    const [x0, x1] = viewSpan();
    if (!Number.isFinite(fx) || fx < x0 - 6 || fx > x1 + 6) return;
    const y = terrain.groundY(fx);
    world(() => {
      const h = 4.2;
      // Posts.
      ctx.fillStyle = "#e8ebf2";
      ctx.fillRect(fx - 2.2, y, 0.18, h);
      ctx.fillRect(fx + 2.0, y, 0.18, h);
      // Banner, chequered.
      const cell = 0.3;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 14; c++) {
          ctx.fillStyle = (r + c) % 2 ? "#111318" : "#ffffff";
          const wave = Math.sin(t * 3 + c * 0.5) * 0.05;
          ctx.fillRect(fx - 2.1 + c * cell, y + h - 0.2 - (r + 1) * cell + wave, cell + 0.01, cell + 0.01);
        }
      }
      // Line on the ground.
      for (let c = 0; c < 6; c++) {
        ctx.fillStyle = c % 2 ? "#111318" : "#ffffff";
        ctx.fillRect(fx - 0.15, y - 0.3 + c * 0.05, 0.3, 0.05);
      }
      // Flags on top.
      for (const px of [fx - 2.1, fx + 2.1]) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.moveTo(px, y + h + 0.8);
        ctx.lineTo(px + 0.7 + Math.sin(t * 5 + px) * 0.08, y + h + 0.6);
        ctx.lineTo(px, y + h + 0.4);
        ctx.fill();
        ctx.fillStyle = "#e8ebf2";
        ctx.fillRect(px - 0.03, y + h, 0.06, 0.8);
      }
    });
    ctx.font = "900 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#111318";
    ctx.fillText("FINISH", sx(fx), sy(y + 4.2 + 0.35));
  }

  // -- pickups ---------------------------------------------------------------

  function drawPickups(pickups, t) {
    const [x0, x1] = viewSpan();
    world(() => {
      for (const it of pickups.items) {
        if (it.taken || it.x < x0 - 1 || it.x > x1 + 1) continue;
        const bob = Math.sin(t * 3 + it.bob) * 0.1;
        ctx.save();
        ctx.translate(it.x, it.y + bob);
        if (it.kind === "coin") {
          const spin = Math.cos(t * 3.4 + it.bob);
          const w = 0.34 * Math.max(0.18, Math.abs(spin));
          // Glow.
          const glow = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 0.7);
          glow.addColorStop(0, rgba("#ffd166", 0.35));
          glow.addColorStop(1, rgba("#ffd166", 0));
          ctx.fillStyle = glow;
          ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
          // Edge, face, inner ring.
          ctx.fillStyle = "#c98a12";
          ctx.beginPath();
          ctx.ellipse(0.03, -0.02, w, 0.34, 0, 0, TAU);
          ctx.fill();
          const g = ctx.createLinearGradient(0, 0.34, 0, -0.34);
          g.addColorStop(0, "#fff2a8");
          g.addColorStop(0.5, "#ffcf3f");
          g.addColorStop(1, "#e9a21a");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(0, 0, w * 0.92, 0.31, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = rgba("#b87b12", 0.7);
          ctx.lineWidth = 0.035;
          ctx.beginPath();
          ctx.ellipse(0, 0, w * 0.6, 0.2, 0, 0, TAU);
          ctx.stroke();
          // Glint.
          if (spin > 0.6) {
            ctx.fillStyle = rgba("#ffffff", (spin - 0.6) * 2);
            ctx.beginPath();
            ctx.ellipse(-w * 0.35, 0.14, w * 0.18, 0.06, -0.6, 0, TAU);
            ctx.fill();
          }
        } else {
          // Fuel can: glow ring, red body, cap, label.
          const glow = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1.1);
          glow.addColorStop(0, rgba("#5ee6c8", 0.35 + 0.15 * Math.sin(t * 4)));
          glow.addColorStop(1, rgba("#5ee6c8", 0));
          ctx.fillStyle = glow;
          ctx.fillRect(-1.1, -1.1, 2.2, 2.2);
          const g = ctx.createLinearGradient(-0.32, 0, 0.32, 0);
          g.addColorStop(0, "#b52a22");
          g.addColorStop(0.35, "#ff5a48");
          g.addColorStop(1, "#9c2019");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(-0.32, -0.4, 0.64, 0.74, 0.08);
          ctx.fill();
          ctx.fillStyle = "#2b2f38";
          ctx.fillRect(0.06, 0.34, 0.18, 0.14);
          ctx.strokeStyle = "#8d2a22";
          ctx.lineWidth = 0.07;
          ctx.beginPath();
          ctx.moveTo(-0.24, 0.34);
          ctx.lineTo(-0.1, 0.46);
          ctx.lineTo(0.02, 0.34);
          ctx.stroke();
          ctx.fillStyle = "#ffe8a0";
          ctx.fillRect(-0.22, -0.16, 0.44, 0.28);
          ctx.fillStyle = "#9c2019";
          ctx.save();
          ctx.scale(1, -1);
          ctx.font = "900 0.24px system-ui";
          ctx.textAlign = "center";
          ctx.fillText("FUEL", 0, 0.08);
          ctx.restore();
        }
        ctx.restore();
      }
    });
  }

  // -- the buggy -------------------------------------------------------------

  function drawVehicle(car, theme) {
    world(() => {
      // Soft contact shadow, stretched along the slope under the car.
      const gy = Math.min(car.wheels[0].y, car.wheels[1].y) - WHEEL.r;
      const lift = Math.max(0, car.y - gy - 1.2);
      ctx.fillStyle = rgba("#000000", Math.max(0.05, 0.28 - lift * 0.04));
      ctx.beginPath();
      ctx.ellipse(car.x, gy + 0.05, 1.5 + lift * 0.1, 0.16, Math.atan2(car.wheels[1].y - car.wheels[0].y, car.wheels[1].x - car.wheels[0].x), 0, TAU);
      ctx.fill();

      if (theme.lights) drawHeadlight(car);

      for (let i = 0; i < 2; i++) {
        const w = car.wheels[i];
        const an = anchorOf(car, i);
        ctx.strokeStyle = "#2a2e36";
        ctx.lineWidth = 0.14;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(an.x, an.y);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();
        // Coil spring.
        const coils = 6;
        ctx.strokeStyle = "#f2c230";
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        for (let k = 0; k <= coils * 4; k++) {
          const f = k / (coils * 4);
          const px = an.x + (w.x - an.x) * f * 0.8 + Math.cos(f * coils * TAU) * 0.11;
          const py = an.y + (w.y - an.y) * f * 0.8 + Math.sin(f * coils * TAU) * 0.02;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      drawBody(car);
      for (let i = 0; i < 2; i++) drawWheel(car.wheels[i]);
    });
  }

  function drawHeadlight(car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const hx = CHASSIS.w / 2 - 0.05;
    const g = ctx.createLinearGradient(hx, 0, hx + 7, 0);
    g.addColorStop(0, rgba("#fff3c4", 0.42));
    g.addColorStop(1, rgba("#fff3c4", 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(hx, 0.08);
    ctx.lineTo(hx + 7, 1.1);
    ctx.lineTo(hx + 7, -1.9);
    ctx.lineTo(hx, -0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBody(car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    const hw = CHASSIS.w / 2;
    const hh = CHASSIS.h / 2;

    // Roll cage behind the driver.
    ctx.strokeStyle = "#20242c";
    ctx.lineWidth = 0.1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-0.78, hh - 0.02);
    ctx.lineTo(-0.55, hh + 0.78);
    ctx.lineTo(0.3, hh + 0.78);
    ctx.lineTo(0.56, hh - 0.02);
    ctx.moveTo(-0.55, hh + 0.78);
    ctx.lineTo(-0.1, hh);
    ctx.stroke();

    // Driver: torso, arm to the wheel, helmet with a visor.
    ctx.fillStyle = "#2f5fc4";
    ctx.beginPath();
    ctx.moveTo(-0.34, hh - 0.02);
    ctx.lineTo(0.12, hh - 0.02);
    ctx.lineTo(0.06, hh + 0.44);
    ctx.lineTo(-0.28, hh + 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2f5fc4";
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(-0.05, hh + 0.32);
    ctx.lineTo(0.3, hh + 0.18);
    ctx.stroke();
    // Steering wheel.
    ctx.strokeStyle = "#20242c";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(0.44, hh - 0.05);
    ctx.lineTo(0.32, hh + 0.24);
    ctx.stroke();

    ctx.fillStyle = "#f4c9a0";
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y - 0.02, HEAD.r * 0.8, 0, TAU);
    ctx.fill();
    const hg = ctx.createRadialGradient(HEAD.x - 0.06, HEAD.y + 0.1, 0.02, HEAD.x, HEAD.y, HEAD.r * 1.1);
    hg.addColorStop(0, car.crashed ? "#c9ced8" : "#ffe07a");
    hg.addColorStop(1, car.crashed ? "#7a808c" : "#f0a818");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y + 0.02, HEAD.r, Math.PI * 0.02, Math.PI * 1.02);
    ctx.lineTo(HEAD.x - HEAD.r, HEAD.y - 0.06);
    ctx.fill();
    ctx.fillStyle = "#1a2030";
    ctx.beginPath();
    ctx.roundRect(HEAD.x + 0.02, HEAD.y - 0.06, 0.2, 0.1, 0.04);
    ctx.fill();
    ctx.fillStyle = rgba("#9ad8ff", 0.7);
    ctx.fillRect(HEAD.x + 0.08, HEAD.y - 0.01, 0.1, 0.025);

    // Main tub with a lit top edge and a dark underside.
    ctx.beginPath();
    ctx.moveTo(-hw, -hh + 0.05);
    ctx.lineTo(-hw + 0.08, hh * 0.6);
    ctx.lineTo(-0.5, hh);
    ctx.lineTo(0.42, hh);
    ctx.lineTo(hw - 0.05, hh * 0.25);
    ctx.lineTo(hw, -hh * 0.35);
    ctx.lineTo(hw - 0.2, -hh);
    ctx.lineTo(-hw + 0.15, -hh);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, hh, 0, -hh);
    g.addColorStop(0, "#ff7a4a");
    g.addColorStop(0.45, "#e8402a");
    g.addColorStop(1, "#a82414");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.045;
    ctx.strokeStyle = "#5e150b";
    ctx.stroke();

    // Racing stripe and number disc.
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(-hw + 0.06, 0.02);
    ctx.lineTo(hw - 0.02, -0.02);
    ctx.lineTo(hw - 0.03, -0.1);
    ctx.lineTo(-hw + 0.05, -0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-0.45, 0.02, 0.17, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e8402a";
    ctx.save();
    ctx.scale(1, -1);
    ctx.font = "900 0.24px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("7", -0.45, 0.06);
    ctx.restore();

    // Top highlight.
    ctx.strokeStyle = rgba("#ffffff", 0.45);
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.45, hh - 0.04);
    ctx.lineTo(0.4, hh - 0.04);
    ctx.lineTo(hw - 0.1, hh * 0.25);
    ctx.stroke();

    // Exhaust, headlight and tail light.
    ctx.fillStyle = "#9aa0ac";
    ctx.beginPath();
    ctx.roundRect(-hw - 0.2, -hh + 0.1, 0.24, 0.1, 0.04);
    ctx.fill();
    ctx.fillStyle = "#fff6d0";
    ctx.beginPath();
    ctx.ellipse(hw - 0.04, 0.0, 0.05, 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff3b3b";
    ctx.fillRect(-hw - 0.01, hh * 0.1, 0.06, 0.12);
    ctx.restore();
  }

  function drawWheel(w) {
    ctx.save();
    ctx.translate(w.x, w.y);
    // Tyre with a subtle radial shade.
    const g = ctx.createRadialGradient(0, 0, WHEEL.r * 0.5, 0, 0, WHEEL.r);
    g.addColorStop(0, "#2a2e38");
    g.addColorStop(1, "#0e1016");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL.r, 0, TAU);
    ctx.fill();
    ctx.rotate(w.rot);
    const blur = Math.min(1, Math.abs(w.spin) / 60);
    // Tread blocks, fading into a blur at speed.
    ctx.lineCap = "butt";
    ctx.strokeStyle = rgba("#3a404e", 1 - blur * 0.7);
    ctx.lineWidth = 0.08;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (WHEEL.r - 0.1), Math.sin(a) * (WHEEL.r - 0.1));
      ctx.lineTo(Math.cos(a) * (WHEEL.r - 0.02), Math.sin(a) * (WHEEL.r - 0.02));
      ctx.stroke();
    }
    // Rim.
    const rg = ctx.createRadialGradient(-0.05, 0.05, 0.02, 0, 0, WHEEL.r * 0.5);
    rg.addColorStop(0, "#f4f6fa");
    rg.addColorStop(1, "#9aa0ac");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL.r * 0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba("#5a606c", 1 - blur * 0.8);
    ctx.lineWidth = 0.055;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 0.05, Math.sin(a) * 0.05);
      ctx.lineTo(Math.cos(a) * WHEEL.r * 0.46, Math.sin(a) * WHEEL.r * 0.46);
      ctx.stroke();
    }
    if (blur > 0.3) {
      ctx.strokeStyle = rgba("#c9ced8", (blur - 0.3) * 0.5);
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.arc(0, 0, WHEEL.r * 0.32, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = "#e8402a";
    ctx.beginPath();
    ctx.arc(0, 0, 0.055, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // -- weather -----------------------------------------------------------------

  function drawWeather(theme, dt, t, speed) {
    const kind = theme.weather;
    if (kind !== weatherKind) {
      weatherKind = kind;
      const n = { snow: 90, dust: 40, embers: 50, fireflies: 26, rain: 110, leaves: 14 }[kind] || 0;
      weather = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.4 + Math.random() * 0.8,
        ph: Math.random() * TAU,
      }));
    }
    if (!weather.length) return;
    const wind = -speed * 6; // particles stream past as the car moves
    for (const p of weather) {
      let vx = wind * p.z;
      let vy = 0;
      switch (kind) {
        case "snow":
          vy = 38 * p.z;
          vx += Math.sin(t + p.ph) * 14;
          break;
        case "rain":
          vy = 620 * p.z;
          vx += -60;
          break;
        case "dust":
          vx += -40 * p.z;
          vy = Math.sin(t * 0.7 + p.ph) * 6;
          break;
        case "embers":
          vy = -34 * p.z;
          vx += Math.sin(t * 2 + p.ph) * 18;
          break;
        case "fireflies":
          vx = wind * 0.3 * p.z + Math.sin(t * 0.9 + p.ph) * 16;
          vy = Math.cos(t * 1.1 + p.ph * 2) * 12;
          break;
        case "leaves":
          vy = 26 * p.z;
          vx += -26 + Math.sin(t * 1.5 + p.ph) * 22;
          break;
      }
      p.x += vx * dt;
      p.y += vy * dt;
      if (p.x < -20) p.x += W + 40;
      if (p.x > W + 20) p.x -= W + 40;
      if (p.y > H + 20) p.y -= H + 40;
      if (p.y < -20) p.y += H + 40;

      switch (kind) {
        case "snow":
          ctx.fillStyle = rgba("#ffffff", 0.5 + p.z * 0.35);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1 + p.z * 1.8, 0, TAU);
          ctx.fill();
          break;
        case "rain":
          ctx.strokeStyle = rgba("#a8c0ff", 0.18 + p.z * 0.18);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - vx * 0.02, p.y - vy * 0.025);
          ctx.stroke();
          break;
        case "dust":
          ctx.fillStyle = rgba(theme.crustHi, 0.18 + p.z * 0.18);
          ctx.fillRect(p.x, p.y, 1.5 + p.z * 2, 1 + p.z);
          break;
        case "embers": {
          const a = 0.5 + 0.5 * Math.sin(t * 6 + p.ph);
          ctx.fillStyle = rgba("#ffb04a", 0.4 + a * 0.5);
          ctx.fillRect(p.x, p.y, 1.5 + p.z * 1.5, 1.5 + p.z * 1.5);
          break;
        }
        case "fireflies": {
          const a = Math.max(0, Math.sin(t * 2.2 + p.ph * 3));
          const r = 2 + p.z * 5;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
          g.addColorStop(0, rgba("#fff59a", a * 0.9));
          g.addColorStop(1, rgba("#fff59a", 0));
          ctx.fillStyle = g;
          ctx.fillRect(p.x - r * 2, p.y - r * 2, r * 4, r * 4);
          break;
        }
        case "leaves":
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(t * 2 + p.ph);
          ctx.fillStyle = p.z > 0.8 ? "#e8a23a" : "#8cc85a";
          ctx.beginPath();
          ctx.ellipse(0, 0, 3.5 * p.z + 1.5, 1.6 * p.z + 0.6, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
      }
    }
  }

  // -- fx --------------------------------------------------------------------

  function drawFx(fx) {
    world(() => {
      for (const p of fx.parts) {
        const k = 1 - p.t / p.life;
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (p.kind === "smoke") {
          ctx.arc(p.x, p.y, p.size * (1 + p.t * 1.8), 0, TAU);
        } else if (p.kind === "spark") {
          ctx.globalCompositeOperation = "lighter";
          ctx.arc(p.x, p.y, p.size * (0.6 + k), 0, TAU);
        } else {
          ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, TAU);
        }
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.globalAlpha = 1;
    });
    for (const p of fx.pops) {
      const k = p.t / p.life;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, (k - 0.12) * 0.4);
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.font = `italic 900 ${Math.round((p.big ? 26 : 17) * pop)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(p.text, sx(p.x), sy(p.y));
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, sx(p.x), sy(p.y));
      ctx.globalAlpha = 1;
    }
  }

  let lastT = 0;

  return {
    resize,
    get scale() {
      return scale;
    },
    setCamera(x, y) {
      cam.x = x;
      cam.y = y;
    },
    /** Shift the pixels-per-metre, used to pull back at speed. */
    setZoom(z) {
      scale = Math.max(20, baseScale() * z);
    },
    toScreen: (x, y) => [sx(x), sy(y)],
    draw({ terrain, stage, car, pickups, fx, time, showMarkers = true }) {
      const theme = { ...stage.theme, id: stage.id };
      const dt = Math.min(0.05, Math.max(0, time - lastT));
      lastT = time;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      ctx.scale(dpr, dpr);
      ctx.save();
      if (fx.shake > 0.001) {
        const s = fx.shake * 9;
        ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }
      drawSky(theme, time);
      drawRidges(theme);
      drawScenery(terrain, theme, time, 1);
      drawHazards(terrain, theme, time);
      drawTerrain(terrain, theme, time);
      drawScenery(terrain, theme, time, 0);
      if (showMarkers) drawMarkers(terrain, theme);
      drawFinish(terrain, theme, time);
      drawPickups(pickups, time);
      if (car) drawVehicle(car, theme);
      drawFx(fx);
      drawWeather(theme, dt, time, car ? car.vx * (scale / 42) * 0.12 : 0.3);
      ctx.restore();

      if (fx.flash > 0.001) {
        ctx.globalAlpha = Math.min(0.6, fx.flash);
        ctx.fillStyle = fx.flashColor;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },
  };
}
