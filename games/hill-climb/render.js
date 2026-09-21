// render.js — every pixel. Layered parallax sky, painted terrain, deterministic
// scenery, the buggy (chassis, cage, driver, sprung wheels), pickups and FX.
//
// The camera maps world metres (y-up) to canvas pixels (y-down); world() sets
// up that transform once per frame and everything downstream draws in metres.
// Nothing here mutates the simulation: draw(view) takes a snapshot and paints.

import { CHASSIS, WHEEL, HEAD, anchorOf } from "./vehicle.js";
import { mulberry32 } from "./terrain.js";

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex, a) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
const mix = (a, b, t) => {
  const ca = rgb(a);
  const cb = rgb(b);
  return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(
    ca[2] + (cb[2] - ca[2]) * t
  )})`;
};
const shade = (hex, t) => (t < 0 ? mix(hex, "#000000", -t) : mix(hex, "#ffffff", t));

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let W = 0;
  let H = 0;
  let scale = 42; // pixels per metre
  let cam = { x: 0, y: 0 };

  function resize(w, h) {
    W = w;
    H = h;
    // Keep roughly 12 metres of road in view on any aspect ratio, so the car
    // reads clearly on a phone without the horizon crowding a desktop window.
    scale = Math.max(30, Math.min(92, w / 12));
  }

  /** World -> screen. */
  const sx = (x) => (x - cam.x) * scale + W * 0.33;
  const sy = (y) => H * 0.58 - (y - cam.y) * scale;

  function world(fn) {
    ctx.save();
    ctx.translate(W * 0.33, H * 0.58);
    ctx.scale(scale, -scale);
    ctx.translate(-cam.x, -cam.y);
    fn();
    ctx.restore();
  }

  // -- sky ------------------------------------------------------------------

  function drawSky(theme, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.sky0);
    g.addColorStop(1, theme.sky1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sun / moon with a soft halo, parked high and slightly behind the car.
    const sunX = W * 0.78 - cam.x * 1.2;
    const px = ((sunX % (W * 2)) + W * 2) % (W * 2);
    const sunY = H * 0.16;
    const halo = ctx.createRadialGradient(px, sunY, 4, px, sunY, H * 0.34);
    halo.addColorStop(0, rgba(theme.sun, 0.85));
    halo.addColorStop(0.3, rgba(theme.sun, 0.22));
    halo.addColorStop(1, rgba(theme.sun, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = theme.sun;
    ctx.beginPath();
    ctx.arc(px, sunY, Math.max(16, W * 0.035), 0, 6.283);
    ctx.fill();

    // Clouds: three parallax bands of soft blobs, seeded so they never jitter.
    const rnd = mulberry32(7727);
    for (let band = 0; band < 3; band++) {
      const depth = 0.05 + band * 0.045;
      const y = H * (0.08 + band * 0.07);
      const size = (0.5 + band * 0.28) * H * 0.028;
      for (let i = 0; i < 5; i++) {
        const base = rnd() * 3000;
        const drift = t * (2 + band);
        const x = (((base - cam.x * depth * scale - drift) % (W + 600)) + W + 600) % (W + 600) - 300;
        ctx.globalAlpha = 0.55 + band * 0.12;
        ctx.fillStyle = theme.cloud;
        ctx.beginPath();
        ctx.ellipse(x, y + rnd() * 16, size * 2.1, size, 0, 0, 6.283);
        ctx.ellipse(x + size * 1.3, y - size * 0.35 + rnd() * 8, size * 1.4, size * 0.82, 0, 0, 6.283);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Two distant ridge lines, drawn from cheap sine noise, not the terrain. */
  function drawRidges(theme, terrain) {
    for (let layer = 0; layer < 2; layer++) {
      const depth = layer === 0 ? 0.12 : 0.28;
      const baseY = H * (layer === 0 ? 0.62 : 0.7);
      const amp = H * (layer === 0 ? 0.07 : 0.1);
      ctx.fillStyle = layer === 0 ? theme.ridgeFar : theme.ridgeNear;
      ctx.beginPath();
      ctx.moveTo(-10, H);
      for (let px = -10; px <= W + 10; px += 12) {
        const wx = cam.x * depth + px / 26;
        const y =
          baseY -
          Math.sin(wx * 0.22 + layer * 2.1) * amp -
          Math.sin(wx * 0.07 + layer) * amp * 0.9 +
          cam.y * scale * depth * 0.25;
        ctx.lineTo(px, y);
      }
      ctx.lineTo(W + 10, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  // -- terrain --------------------------------------------------------------

  function drawTerrain(terrain, theme) {
    const x0 = cam.x - W / scale;
    const x1 = cam.x + W / scale;
    const pts = terrain.slice(x0, x1);
    const bottom = cam.y - H / scale;

    world(() => {
      // Soil body.
      ctx.beginPath();
      ctx.moveTo(pts[0].x, bottom);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, bottom);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, pts[0].y + 2, 0, bottom);
      g.addColorStop(0, theme.soil);
      g.addColorStop(1, theme.soilDark);
      ctx.fillStyle = g;
      ctx.fill();

      // Crust: a thick stroke sitting on the polyline the wheels touch.
      ctx.lineWidth = 0.42;
      ctx.lineJoin = "round";
      ctx.strokeStyle = theme.crust;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y - 0.16);
      for (const p of pts) ctx.lineTo(p.x, p.y - 0.16);
      ctx.stroke();

      ctx.lineWidth = 0.1;
      ctx.strokeStyle = rgba("#000000", 0.18);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y - 0.38);
      for (const p of pts) ctx.lineTo(p.x, p.y - 0.38);
      ctx.stroke();
    });

    // Soil speckle: deterministic per metre so it doesn't crawl.
    world(() => {
      const rnd = mulberry32(((Math.floor(x0 / 24) & 1023) | 0) + 91);
      ctx.fillStyle = rgba("#000000", 0.12);
      for (let i = 0; i < 90; i++) {
        const x = x0 + rnd() * (x1 - x0);
        const depth = 0.6 + rnd() * 5.5;
        const y = terrain.groundY(x) - depth;
        if (y < bottom) continue;
        ctx.beginPath();
        ctx.arc(x, y, 0.05 + rnd() * 0.12, 0, 6.283);
        ctx.fill();
      }
    });
  }

  // -- scenery --------------------------------------------------------------

  const DECO_SPAN = 9; // metres between candidate scenery slots

  function drawScenery(terrain, theme) {
    const x0 = cam.x - W / scale - 6;
    const x1 = cam.x + W / scale + 6;
    const i0 = Math.floor(x0 / DECO_SPAN);
    const i1 = Math.ceil(x1 / DECO_SPAN);
    world(() => {
      for (let i = i0; i <= i1; i++) {
        const rnd = mulberry32((i * 2654435761) >>> 0);
        if (rnd() > 0.55) continue;
        const x = i * DECO_SPAN + rnd() * DECO_SPAN * 0.8;
        if (x < 12) continue; // keep the start line clear
        const y = terrain.groundY(x);
        const s = 0.75 + rnd() * 0.6;
        drawDeco(theme, x, y, s, rnd);
      }
    });
  }

  function drawDeco(theme, x, y, s, rnd) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    switch (theme.deco) {
      case "tree": {
        ctx.fillStyle = "#5b3d22";
        ctx.fillRect(-0.09, 0, 0.18, 1.1);
        ctx.fillStyle = shade("#2f8f4e", rnd() * 0.25);
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc((rnd() - 0.5) * 0.5, 1.2 + k * 0.32, 0.62 - k * 0.12, 0, 6.283);
          ctx.fill();
        }
        break;
      }
      case "cactus": {
        ctx.fillStyle = "#3f8a52";
        ctx.fillRect(-0.16, 0, 0.32, 1.5);
        ctx.fillRect(-0.62, 0.7, 0.46, 0.22);
        ctx.fillRect(-0.62, 0.7, 0.2, 0.62);
        ctx.fillRect(0.18, 0.95, 0.44, 0.2);
        ctx.fillRect(0.42, 0.95, 0.2, 0.5);
        break;
      }
      case "pine": {
        ctx.fillStyle = "#3a2a1c";
        ctx.fillRect(-0.08, 0, 0.16, 0.5);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = k === 0 ? "#1f5b46" : "#24705a";
          ctx.beginPath();
          ctx.moveTo(0, 2.1 - k * 0.42);
          ctx.lineTo(0.62 - k * 0.1, 0.5 + k * 0.42);
          ctx.lineTo(-0.62 + k * 0.1, 0.5 + k * 0.42);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = rgba("#ffffff", 0.75);
        ctx.beginPath();
        ctx.moveTo(0, 2.1);
        ctx.lineTo(0.3, 1.4);
        ctx.lineTo(-0.3, 1.4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "pylon": {
        ctx.strokeStyle = rgba("#ffffff", 0.22);
        ctx.lineWidth = 0.09;
        ctx.beginPath();
        ctx.moveTo(-0.4, 0);
        ctx.lineTo(0, 3.2);
        ctx.lineTo(0.4, 0);
        ctx.moveTo(-0.28, 1);
        ctx.lineTo(0.28, 1);
        ctx.moveTo(-0.18, 2);
        ctx.lineTo(0.18, 2);
        ctx.moveTo(-0.8, 2.9);
        ctx.lineTo(0.8, 2.9);
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = shade(theme.soil, 0.12);
        ctx.beginPath();
        ctx.moveTo(-0.6, 0);
        ctx.lineTo(-0.3, 0.55);
        ctx.lineTo(0.25, 0.62);
        ctx.lineTo(0.62, 0);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  const MARKER_GAP = 50; // metres between roadside distance flags

  /** A flag every 50 m, so progress is legible without reading the HUD. */
  function drawMarkers(terrain, theme) {
    const x0 = cam.x - W / scale;
    const x1 = cam.x + W / scale;
    world(() => {
      for (let m = Math.max(MARKER_GAP, Math.floor(x0 / MARKER_GAP) * MARKER_GAP); m <= x1; m += MARKER_GAP) {
        const y = terrain.groundY(m);
        ctx.strokeStyle = rgba("#ffffff", 0.75);
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(m, y);
        ctx.lineTo(m, y + 2.1);
        ctx.stroke();
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.moveTo(m, y + 2.1);
        ctx.lineTo(m + 1.05, y + 1.8);
        ctx.lineTo(m, y + 1.5);
        ctx.closePath();
        ctx.fill();
      }
    });
    // Metre labels ride in screen space so they stay upright and crisp.
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let m = Math.max(MARKER_GAP, Math.floor(x0 / MARKER_GAP) * MARKER_GAP); m <= x1; m += MARKER_GAP) {
      const y = terrain.groundY(m);
      ctx.fillStyle = rgba("#ffffff", 0.8);
      ctx.fillText(`${m}m`, sx(m + 0.5), sy(y + 2.55));
    }
  }

  // -- pickups ---------------------------------------------------------------

  function drawPickups(pickups, t) {
    const x0 = cam.x - W / scale - 2;
    const x1 = cam.x + W / scale + 2;
    world(() => {
      for (const it of pickups.items) {
        if (it.taken || it.x < x0 || it.x > x1) continue;
        const bob = Math.sin(t * 3 + it.bob) * 0.12;
        ctx.save();
        ctx.translate(it.x, it.y + bob);
        if (it.kind === "coin") {
          const squash = Math.abs(Math.cos(t * 3.4 + it.bob));
          ctx.save();
          ctx.scale(0.22 + squash * 0.2, 0.42);
          ctx.fillStyle = "#ffcf3f";
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, 6.283);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = rgba("#b87b12", 0.9);
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.ellipse(0, 0, (0.22 + squash * 0.2) * 0.62, 0.26, 0, 0, 6.283);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#e2453a";
          ctx.fillRect(-0.3, -0.34, 0.6, 0.72);
          ctx.fillStyle = "#b5332b";
          ctx.fillRect(-0.3, -0.34, 0.6, 0.12);
          ctx.fillStyle = "#ffffff";
          ctx.save();
          ctx.scale(1, -1);
          ctx.font = "600 0.42px system-ui";
          ctx.textAlign = "center";
          ctx.fillText("F", 0, 0.14);
          ctx.restore();
          ctx.strokeStyle = "#8d2a22";
          ctx.lineWidth = 0.07;
          ctx.beginPath();
          ctx.moveTo(-0.14, 0.4);
          ctx.lineTo(0.14, 0.4);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  // -- the buggy -------------------------------------------------------------

  function drawVehicle(car, theme) {
    world(() => {
      // Contact shadow.
      ctx.fillStyle = rgba("#000000", 0.2);
      ctx.beginPath();
      ctx.ellipse(car.x, car.wheels[0].y - WHEEL.r + 0.04, 1.5, 0.18, 0, 0, 6.283);
      ctx.fill();

      for (let i = 0; i < 2; i++) {
        const w = car.wheels[i];
        const an = anchorOf(car, i);
        // Suspension arm.
        ctx.strokeStyle = "#31363f";
        ctx.lineWidth = 0.13;
        ctx.beginPath();
        ctx.moveTo(an.x, an.y);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();
        // Coil, squeezed by compression.
        const coils = 6;
        ctx.strokeStyle = "#9aa0ac";
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        for (let k = 0; k <= coils * 4; k++) {
          const f = k / (coils * 4);
          const px = an.x + (w.x - an.x) * f + Math.cos(f * coils * 6.283) * 0.11;
          const py = an.y + (w.y - an.y) * f + Math.sin(f * coils * 6.283) * 0.02;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      drawBody(car);

      for (let i = 0; i < 2; i++) drawWheel(car.wheels[i]);
    });
  }

  function drawBody(car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    const hw = CHASSIS.w / 2;
    const hh = CHASSIS.h / 2;

    // Main tub.
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw - 0.12, -hh);
    ctx.lineTo(hw, hh * 0.2);
    ctx.lineTo(0.35, hh);
    ctx.lineTo(-hw + 0.1, hh);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, hh, 0, -hh);
    g.addColorStop(0, "#ff5d3a");
    g.addColorStop(1, "#c8341d");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = "#7d1d0f";
    ctx.stroke();

    // Roll cage.
    ctx.strokeStyle = "#2b2f38";
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.72, hh);
    ctx.lineTo(-0.5, hh + 0.72);
    ctx.lineTo(0.28, hh + 0.72);
    ctx.lineTo(0.5, hh);
    ctx.moveTo(-0.5, hh + 0.72);
    ctx.lineTo(-0.05, hh);
    ctx.stroke();

    // Driver: torso, arms to the wheel, helmeted head at the physics' head point.
    ctx.fillStyle = "#3b6fd4";
    ctx.beginPath();
    ctx.moveTo(-0.3, hh - 0.02);
    ctx.lineTo(0.12, hh - 0.02);
    ctx.lineTo(0.06, hh + 0.42);
    ctx.lineTo(-0.26, hh + 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#3b6fd4";
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.05, hh + 0.3);
    ctx.lineTo(0.34, hh + 0.16);
    ctx.stroke();

    ctx.fillStyle = "#f4c9a0";
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y, HEAD.r * 0.86, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = car.crashed ? "#9aa0ac" : "#ffd166";
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y + 0.03, HEAD.r, Math.PI * 0.05, Math.PI * 0.95);
    ctx.fill();
    ctx.fillStyle = "#2b2f38";
    ctx.fillRect(HEAD.x + 0.02, HEAD.y - 0.04, 0.17, 0.07);

    // Exhaust stub and a hint of a headlight.
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(-hw - 0.12, -hh + 0.06, 0.14, 0.12);
    ctx.fillStyle = rgba("#fff3c4", 0.9);
    ctx.beginPath();
    ctx.arc(hw - 0.05, 0.02, 0.1, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawWheel(w) {
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.rot);
    ctx.fillStyle = "#15181f";
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL.r, 0, 6.283);
    ctx.fill();
    // Tread blocks.
    ctx.strokeStyle = "#2c3140";
    ctx.lineWidth = 0.09;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 6.283;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (WHEEL.r - 0.09), Math.sin(a) * (WHEEL.r - 0.09));
      ctx.lineTo(Math.cos(a) * WHEEL.r, Math.sin(a) * WHEEL.r);
      ctx.stroke();
    }
    ctx.fillStyle = "#d8dbe2";
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL.r * 0.42, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = "#8b909c";
    ctx.lineWidth = 0.06;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * 6.283;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * WHEEL.r * 0.4, Math.sin(a) * WHEEL.r * 0.4);
      ctx.stroke();
    }
    ctx.restore();
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
          ctx.arc(p.x, p.y, p.size * (1 + p.t * 1.6), 0, 6.283);
        } else {
          ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, 6.283);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    for (const p of fx.pops) {
      const k = p.t / p.life;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.color;
      ctx.font = `700 ${p.big ? 24 : 16}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 6;
      ctx.fillText(p.text, sx(p.x), sy(p.y));
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

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
      scale = Math.max(24, Math.min(92, (W / 12) * z));
    },
    toScreen: (x, y) => [sx(x), sy(y)],
    draw({ terrain, stage, car, pickups, fx, time, showMarkers = true }) {
      const theme = stage.theme;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      ctx.scale(dpr, dpr);
      ctx.save();
      if (fx.shake > 0.001) {
        const s = fx.shake * 9;
        ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }
      drawSky(theme, time);
      drawRidges(theme, terrain);
      drawTerrain(terrain, theme);
      drawScenery(terrain, theme);
      if (showMarkers) drawMarkers(terrain, theme);
      drawPickups(pickups, time);
      if (car) drawVehicle(car, theme);
      drawFx(fx);
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
