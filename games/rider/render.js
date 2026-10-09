// Canvas rendering: parallax neon backgrounds, track, pickups, bike + trail.
import { drawBike } from "./bikes.js";
import { clamp } from "./physics.js";

function hash(i) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const STARS = Array.from({ length: 90 }, (_, i) => ({ x: hash(i * 3 + 1), y: hash(i * 3 + 2) * 0.7, s: 0.5 + hash(i * 3 + 3) * 1.6, p: hash(i + 999) * 6 }));
const FLAKES = Array.from({ length: 70 }, (_, i) => ({ x: hash(i * 7 + 11), y: hash(i * 7 + 12), s: 1 + hash(i * 7 + 13) * 2.5, v: 0.3 + hash(i * 7 + 14) }));

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.inited = false;
  }

  baseZoom(W, H) {
    return Math.min(W / 700, H / 760);
  }

  update(dt, b, track, W, H) {
    let z = this.baseZoom(W, H);
    const speed = b.mode === "air" ? Math.hypot(b.vx, b.vy) : b.v;
    z *= 1 - clamp((speed - 650) / 1500, 0, 0.16);
    let ty = b.y - 70;
    if (b.mode === "air") {
      const gy = track.heightAt(b.x + b.vx * 0.35);
      if (gy != null && gy > b.y) {
        const gap = gy - b.y;
        z *= clamp(1 - (gap - 250) / 2600, 0.72, 1);
        ty = b.y + Math.min(gap, 900) * 0.35;
      }
    }
    const tx = b.x + (W * 0.14) / z;
    if (!this.inited) {
      this.x = tx;
      this.y = ty;
      this.zoom = z;
      this.inited = true;
    }
    const k = Math.min(1, dt * 9);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * Math.min(1, dt * 4.5);
    this.zoom += (z - this.zoom) * Math.min(1, dt * 1.8);
  }

  snap() {
    this.inited = false;
  }
}

export class Trail {
  constructor() {
    this.pts = [];
  }
  clear() {
    this.pts.length = 0;
  }
  push(x, y) {
    const n = this.pts.length;
    if (n && Math.hypot(x - this.pts[n - 1].x, y - this.pts[n - 1].y) < 7) return;
    this.pts.push({ x, y });
    if (this.pts.length > 48) this.pts.shift();
  }
  draw(ctx, def, t) {
    const pts = this.pts;
    const n = pts.length;
    if (n < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    const style = def.trailStyle;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const a = pts[i - 1];
      const b = pts[i];
      let color = def.trail;
      let w = 2 + f * 7;
      let alpha = f * 0.85;
      let ox = 0;
      let oy = 0;
      if (style === "rainbow") color = `hsl(${(i * 14 + t * 240) % 360},100%,62%)`;
      if (style === "fire") {
        color = i > n * 0.6 ? "#ffd23f" : def.trail;
        w *= 0.8 + Math.random() * 0.5;
      }
      if (style === "ghost") {
        alpha *= 0.45;
        w *= 0.7;
      }
      if (style === "electric") {
        ox = (Math.random() - 0.5) * 9 * f;
        oy = (Math.random() - 0.5) * 9 * f;
      }
      if (style === "dots") {
        if (i % 3) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, w * 0.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha * 0.3;
      ctx.lineWidth = w + 8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x + ox, b.y + oy);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = w;
      ctx.stroke();
      if (style === "spark" && Math.random() < 0.18) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(b.x + (Math.random() - 0.5) * 20, b.y + (Math.random() - 0.5) * 20, 3, 3);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- background

let skyCache = { key: "", grad: null };

function mountains(ctx, W, H, off, base, amp, color, seed, step = 18) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + step; sx += step) {
    const u = (sx + off) / 260;
    const h = Math.sin(u + seed) * 0.5 + Math.sin(u * 2.3 + seed * 2) * 0.28 + Math.sin(u * 5.1 + seed * 3) * 0.12;
    ctx.lineTo(sx, base - (h + 0.9) * amp);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function city(ctx, W, H, off, base, color, win, seed, wMin) {
  const bw = wMin;
  const i0 = Math.floor(off / bw) - 1;
  const i1 = Math.floor((off + W) / bw) + 1;
  for (let i = i0; i <= i1; i++) {
    const r = hash(i * 13 + seed);
    if (r < 0.15) continue;
    const h = 60 + r * H * 0.32;
    const x = i * bw - off;
    const w = bw * (0.6 + hash(i + seed * 7) * 0.35);
    ctx.fillStyle = color;
    ctx.fillRect(x, base - h, w, h + H);
    if (win) {
      ctx.fillStyle = win;
      for (let wy = base - h + 10; wy < base - 8; wy += 14) {
        for (let wx = x + 6; wx < x + w - 6; wx += 11) {
          if (hash(Math.floor(wx * 3 + wy * 7) + i) > 0.72) ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
  }
}

export function drawBackground(ctx, theme, cam, W, H, t) {
  const key = theme.name + H;
  if (skyCache.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(0.6, theme.sky[1]);
    g.addColorStop(1, theme.sky[2]);
    skyCache = { key, grad: g };
  }
  ctx.fillStyle = skyCache.grad;
  ctx.fillRect(0, 0, W, H);

  // stars
  for (const s of STARS) {
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + s.p));
    ctx.globalAlpha = tw * (theme.deco === "embers" ? 0.3 : 0.8);
    ctx.fillStyle = "#ffffff";
    const x = (((s.x * W - cam.x * 0.02) % W) + W) % W;
    ctx.fillRect(x, s.y * H, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  const ox = cam.x * 0.5;
  const deco = theme.deco;
  if (deco === "sun" || deco === "synth") {
    const cx = W * 0.62;
    const cy = H * 0.5;
    const r = Math.min(W, H) * 0.2;
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, deco === "synth" ? "#ffe45e" : "#ffd166");
    g.addColorStop(1, theme.accent);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.sky[1];
    for (let k = 0; k < 7; k++) {
      const yy = cy + r * 0.1 + k * r * 0.14;
      ctx.fillRect(cx - r, yy, r * 2, 2 + k * 1.6);
    }
  }
  if (deco === "snow") {
    ctx.fillStyle = "rgba(220,240,255,0.85)";
    ctx.beginPath();
    ctx.arc(W * 0.25, H * 0.22, Math.min(W, H) * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  mountains(ctx, W, H, ox * 0.25, H * 0.62, H * 0.16, theme.far, 1.3);
  if (deco === "city") {
    city(ctx, W, H, ox * 0.35, H * 0.72, theme.far, "rgba(255,43,214,0.35)", 3, 46);
    city(ctx, W, H, ox * 0.6, H * 0.82, theme.near, "rgba(32,242,255,0.4)", 9, 64);
  } else {
    mountains(ctx, W, H, ox * 0.5, H * 0.78, H * 0.12, theme.near, 4.1, 14);
  }

  if (deco === "grid" || deco === "synth") {
    const hz = H * 0.8;
    ctx.strokeStyle = deco === "synth" ? "rgba(255,60,240,0.35)" : "rgba(124,255,79,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sp = 60;
    const shift = (ox * 0.8) % sp;
    for (let i = -30; i <= 30; i++) {
      const xb = W / 2 + (i * sp - shift) * 4;
      const xt = W / 2 + (i * sp - shift) * 0.6;
      ctx.moveTo(xt, hz);
      ctx.lineTo(xb, H);
    }
    for (let k = 0; k < 8; k++) {
      const f = ((k + ((t * 0.6) % 1)) / 8) ** 2;
      const y = hz + (H - hz) * f;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  if (deco === "snow" || deco === "embers") {
    const ember = deco === "embers";
    ctx.fillStyle = ember ? "#ff9a3c" : "#ffffff";
    for (const f of FLAKES) {
      const sp = ember ? -40 : 50;
      const y = ((((f.y * H + t * sp * f.v) % H) + H) % H);
      const x = ((((f.x * W - cam.x * 0.15 * f.v + Math.sin(t + f.y * 9) * 12) % W) + W) % W);
      ctx.globalAlpha = ember ? 0.4 + 0.5 * Math.abs(Math.sin(t * 3 + f.x * 20)) : 0.7;
      ctx.fillRect(x, y, f.s, f.s);
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- world

export function worldTransform(ctx, cam, W, H, shake) {
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.translate(W / 2 + sx, H / 2 + sy);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
}

export function drawTrack(ctx, track, cam, W, H, theme, t) {
  const hw = W / 2 / cam.zoom + 60;
  const hh = H / 2 / cam.zoom + 60;
  const vx0 = cam.x - hw;
  const vx1 = cam.x + hw;
  const vy0 = cam.y - hh;
  const vy1 = cam.y + hh;
  const glow = theme.glow;

  for (const pc of track.pieces) {
    if (pc.maxX < vx0 || pc.minX > vx1 || pc.minY > vy1) continue;
    let c0 = -1;
    let c1 = -1;
    for (let c = 0; c < pc.chunks.length; c++) {
      const ch = pc.chunks[c];
      if (ch.maxX < vx0 || ch.minX > vx1 || ch.minY > vy1) continue;
      if (c0 < 0) c0 = c;
      c1 = c;
    }
    if (c0 < 0) continue;
    const i0 = pc.chunks[c0].i0;
    const i1 = pc.chunks[c1].i1;
    const xs = pc.xs;
    const ys = pc.ys;

    // ground fill (loops excluded)
    let first = -1;
    let last = -1;
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      if (pc.loopFlag[i] && !(i > 0 && !pc.loopFlag[i - 1]) && !(i < pc.n - 1 && !pc.loopFlag[i + 1])) continue;
      if (first < 0) {
        ctx.moveTo(xs[i], ys[i]);
        first = i;
      } else ctx.lineTo(xs[i], ys[i]);
      last = i;
    }
    const bottom = Math.max(vy1, pc.chunks[c0].minY) + 200;
    ctx.lineTo(xs[last], bottom);
    ctx.lineTo(xs[first], bottom);
    ctx.closePath();
    const top = Math.max(vy0, pc.chunks[c0].minY);
    const g = ctx.createLinearGradient(0, top, 0, top + 700);
    g.addColorStop(0, theme.fill2);
    g.addColorStop(1, theme.fill);
    ctx.fillStyle = g;
    ctx.fill();

    // inner stripe parallel to the surface
    ctx.strokeStyle = `rgba(${glow},0.22)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = i0; i <= i1; i++) {
      if (pc.loopFlag[i]) {
        started = false;
        continue;
      }
      const x = xs[i] - pc.pty[i] * 18;
      const y = ys[i] + pc.ptx[i] * 18;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // cliff edges
    ctx.strokeStyle = `rgba(${glow},0.35)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (i0 === 0) {
      ctx.moveTo(xs[0], ys[0]);
      ctx.lineTo(xs[0], bottom);
    }
    if (i1 === pc.n - 1 && pc.next == null) {
      ctx.moveTo(xs[i1], ys[i1]);
      ctx.lineTo(xs[i1], bottom);
    }
    ctx.stroke();

    // neon surface line
    ctx.beginPath();
    ctx.moveTo(xs[i0], ys[i0]);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(${glow},0.18)`;
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${glow},0.35)`;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 4;
    ctx.stroke();

    // boost pads
    for (const pad of pc.boosts) {
      const hint = { seg: 0 };
      let k = 0;
      for (let s = pad.s0 + 10; s < pad.s1; s += 26, k++) {
        const m = track.sample(pc, s, hint);
        if (m.x < vx0 || m.x > vx1) continue;
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 8 - k * 0.7));
        ctx.save();
        ctx.translate(m.x - m.ty * 9, m.y + m.tx * -9);
        ctx.rotate(m.ang);
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-6, -9);
        ctx.lineTo(4, 0);
        ctx.lineTo(-6, 9);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export function drawMarkers(ctx, track, cam, W, H, theme, t, reachedIdx) {
  const hw = W / 2 / cam.zoom + 200;
  const vx0 = cam.x - hw;
  const vx1 = cam.x + hw;
  track.checkpoints.forEach((cp, i) => {
    if (cp.hidden || cp.x < vx0 || cp.x > vx1) return;
    const on = i < reachedIdx;
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.lineCap = "round";
    ctx.strokeStyle = on ? theme.accent : "rgba(255,255,255,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -120);
    ctx.stroke();
    const wave = Math.sin(t * 6) * 5;
    ctx.fillStyle = on ? theme.accent : "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.quadraticCurveTo(25, -112 + wave, 50, -108);
    ctx.lineTo(0, -92);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  const f = track.finish;
  if (f && f.x > vx0 - 200 && f.x < vx1 + 200) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-90, 0);
    ctx.lineTo(-90, -200);
    ctx.moveTo(90, 0);
    ctx.lineTo(90, -200);
    ctx.stroke();
    const sq = 18;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 10; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#ffffff" : "#111111";
        ctx.fillRect(-90 + c * sq, -200 + r * sq + Math.sin(t * 4 + c * 0.6) * 3, sq, sq);
      }
    }
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 5);
    ctx.fillRect(-90, -146, 180, 146);
    ctx.restore();
  }
}

export function drawGems(ctx, track, cam, W, t) {
  const hw = W / 2 / cam.zoom + 60;
  const vx0 = cam.x - hw;
  const vx1 = cam.x + hw;
  ctx.save();
  for (const g of track.gems) {
    if (g.x < vx0) continue;
    if (g.x > vx1) break;
    if (g.taken) continue;
    const sx = Math.cos(t * 3 + g.id);
    ctx.save();
    ctx.translate(g.x, g.y + Math.sin(t * 2.5 + g.id) * 4);
    ctx.scale(Math.max(0.2, Math.abs(sx)), 1);
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(13, -5);
    ctx.lineTo(0, 17);
    ctx.lineTo(-13, -5);
    ctx.closePath();
    if (g.old) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#9ff6ff";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#9ff6ff";
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#6ff0ff";
      ctx.fill();
      ctx.fillStyle = "#e9fdff";
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.lineTo(13, -5);
      ctx.lineTo(0, -1);
      ctx.lineTo(-13, -5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawRider(ctx, b, def, t, alpha = 1) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  drawBike(ctx, def, b.wheelRot, t, alpha);
  ctx.restore();
}

export function drawSpeedLines(ctx, W, H, strength, color) {
  if (strength <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y = Math.random() * H;
    const x = Math.random() * W;
    const len = 60 + Math.random() * 160;
    ctx.globalAlpha = strength * (0.15 + Math.random() * 0.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len, y);
    ctx.stroke();
  }
  ctx.restore();
}

