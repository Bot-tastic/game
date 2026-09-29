// Particles, floating text and banners, driven by the events the simulation
// emits. Nothing in here feeds back into the simulation.

import { DISPLAY_FONT } from "./render.js";

const MAX_PARTICLES = 560;

export function createFx() {
  return { particles: [], texts: [], shake: 0, beams: [], rings: [], stars: [], flashes: [], flash: 0, banner: null, dmgGap: 0, immuneGap: 0 };
}

function burst(fx, x, y, color, count, speed, life, kind = "dot") {
  if (fx.particles.length > MAX_PARTICLES) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    fx.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life,
      maxLife: life,
      r: kind === "smoke" ? 6 + Math.random() * 8 : 2 + Math.random() * 3,
      color,
      kind,
      g: kind === "smoke" ? -30 : 180,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 18,
    });
  }
}

export function addText(fx, x, y, text, color = "#f2f3f5", size = 18) {
  fx.texts.push({ x, y, text, color, size, life: 0.9, maxLife: 0.9 });
}

/** Translate one simulation event into whatever it should look like. */
export function handleEvent(fx, ev) {
  switch (ev.kind) {
    case "pop":
      // Rubber shreds in the balloon's colour plus a white "pop" star.
      burst(fx, ev.x, ev.y, ev.color, ev.moab ? 26 : 6, ev.moab ? 300 : 150, ev.moab ? 0.8 : 0.45, "shred");
      fx.stars.push({ x: ev.x, y: ev.y, r: ev.r * (ev.moab ? 1.6 : 1.3), life: 0.16, maxLife: 0.16 });
      if (ev.moab) {
        fx.shake = Math.max(fx.shake, 11);
        burst(fx, ev.x, ev.y, "#5a5560", 12, 70, 1.1, "smoke");
        burst(fx, ev.x, ev.y, "#ffd166", 14, 260, 0.5);
        fx.rings.push({ x: ev.x, y: ev.y, r: ev.r, max: ev.r * 4, life: 0.5, maxLife: 0.5, color: "#ffb020" });
        fx.flashes.push({ x: ev.x, y: ev.y, r: ev.r * 2.4, life: 0.25, maxLife: 0.25, color: "255,210,120" });
      }
      // Only the bloons that pay real money get a floater; a "+$1" on every
      // red bloon would bury the board in text.
      if (ev.reward) addText(fx, ev.x, ev.y - 10, `+$${ev.reward}`, "#ffd166", ev.moab ? 26 : 18);
      break;
    case "dmg":
      // Blimps are the only thing with a health bar worth reading, and even
      // there the numbers are throttled so a barrage does not spam them.
      if (fx.dmgGap <= 0 && ev.amount >= 5) {
        fx.dmgGap = 0.09;
        addText(fx, ev.x + (Math.random() - 0.5) * 26, ev.y - 14, `${ev.amount}`, "#ffe9a8", 15);
      }
      break;
    case "blast":
      fx.rings.push({ x: ev.x, y: ev.y, r: ev.r * 0.3, max: ev.r, life: 0.28, maxLife: 0.28, color: ev.color ?? "#ffb020" });
      fx.flashes.push({ x: ev.x, y: ev.y, r: ev.r * 0.9, life: 0.18, maxLife: 0.18, color: "255,190,90" });
      burst(fx, ev.x, ev.y, "#6a6470", 3, 40, 0.7, "smoke");
      break;
    case "pulse":
      fx.rings.push({ x: ev.x, y: ev.y, r: 8, max: ev.r, life: 0.4, maxLife: 0.4, color: "#9fe8ff" });
      fx.flashes.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.3, maxLife: 0.3, color: "170,230,255" });
      break;
    case "snipe":
      fx.beams.push({ ...ev, life: 0.14, maxLife: 0.14 });
      break;
    case "ability":
      fx.shake = Math.max(fx.shake, 8);
      fx.rings.push({ x: ev.x, y: ev.y, r: 10, max: ev.r, life: 0.55, maxLife: 0.55, color: ev.color });
      fx.rings.push({ x: ev.x, y: ev.y, r: 10, max: ev.r * 0.7, life: 0.4, maxLife: 0.4, color: "#ffffff" });
      burst(fx, ev.x, ev.y, ev.color ?? "#ffd166", 24, 320, 0.6);
      break;
    case "leak":
      fx.shake = Math.max(fx.shake, ev.moab ? 18 : 8);
      fx.flash = Math.max(fx.flash, ev.moab ? 0.55 : 0.28);
      break;
    case "immune":
      // A lead wave against sharp towers bounces hundreds of shots a second;
      // one label now and then says it just as well.
      if (fx.immuneGap <= 0) {
        fx.immuneGap = 0.5;
        addText(fx, ev.x, ev.y, "IMMUNE", "#c9ced8", 15);
      }
      break;
    case "income":
      addText(fx, ev.x, ev.y, `+$${ev.amount}`, "#ffd166", 20);
      break;
    case "heroLevel":
      fx.rings.push({ x: ev.x, y: ev.y, r: 8, max: 120, life: 0.7, maxLife: 0.7, color: "#ffd166" });
      addText(fx, ev.x, ev.y - 26, `LEVEL ${ev.level}`, "#ffd166", 22);
      burst(fx, ev.x, ev.y, "#ffd166", 22, 180, 0.8);
      break;
    case "roundStart":
      fx.banner = { text: ev.title ?? `Round ${ev.round}`, sub: ev.sub ?? "", life: 1.6, maxLife: 1.6 };
      break;
    case "build":
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, max: 52, life: 0.35, maxLife: 0.35, color: "#ffffff" });
      burst(fx, ev.x, ev.y + 8, "#d8c8a8", 10, 90, 0.5, "smoke");
      break;
    case "upgrade":
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, max: 60, life: 0.4, maxLife: 0.4, color: "#ffd166" });
      burst(fx, ev.x, ev.y, "#ffd166", 16, 200, 0.55);
      addText(fx, ev.x, ev.y - 30, "UPGRADE!", "#ffd166", 18);
      break;
    case "sell":
      burst(fx, ev.x, ev.y, "#ffd166", 12, 160, 0.5);
      break;
    default:
      break;
  }
}

export function updateFx(fx, dt) {
  fx.shake = Math.max(0, fx.shake - dt * 45);
  fx.flash = Math.max(0, fx.flash - dt * 1.4);
  fx.dmgGap -= dt;
  fx.immuneGap -= dt;
  fx.particles = fx.particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy = p.vy * 0.92 + p.g * dt;
    p.rot += p.spin * dt;
    return p.life > 0;
  });
  fx.stars = fx.stars.filter((st) => (st.life -= dt) > 0);
  fx.flashes = fx.flashes.filter((f) => (f.life -= dt) > 0);
  fx.texts = fx.texts.filter((t) => {
    t.life -= dt;
    t.y -= 28 * dt;
    return t.life > 0;
  });
  fx.rings = fx.rings.filter((r) => {
    r.life -= dt;
    return r.life > 0;
  });
  fx.beams = fx.beams.filter((b) => {
    b.life -= dt;
    return b.life > 0;
  });
  if (fx.banner) {
    fx.banner.life -= dt;
    if (fx.banner.life <= 0) fx.banner = null;
  }
}

export function drawFx(ctx, fx) {
  if (fx.flashes.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of fx.flashes) {
      const k = f.life / f.maxLife;
      ctx.fillStyle = `rgba(${f.color},${0.35 * k})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  for (const r of fx.rings) {
    const t = 1 - r.life / r.maxLife;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3.5 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + (r.max - r.r) * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const b of fx.beams) {
    const k = b.life / b.maxLife;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(255,236,150,${0.45 * k})`;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${k})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  if (fx.stars.length) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    for (const st of fx.stars) {
      const t = 1 - st.life / st.maxLife;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const r0 = st.r * (0.5 + t * 0.5);
        const r1 = st.r * (0.9 + t * 0.7) * (i % 2 ? 0.75 : 1);
        ctx.moveTo(st.x + Math.cos(a) * r0, st.y + Math.sin(a) * r0);
        ctx.lineTo(st.x + Math.cos(a) * r1, st.y + Math.sin(a) * r1);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const p of fx.particles) {
    const k = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.fillStyle = p.color;
    if (p.kind === "shred") {
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
    } else if (p.kind === "smoke") {
      ctx.globalAlpha = k * 0.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  for (const t of fx.texts) {
    const k = Math.max(0, t.life / t.maxLife);
    // Pop in slightly oversized, then settle.
    const grow = k > 0.8 ? 1 + (k - 0.8) * 1.5 : 1;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.fillStyle = t.color;
    ctx.font = `${Math.round((t.size ?? 18) * grow)}px ${DISPLAY_FONT}`;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

/** Full-board overlays: the damage flash and the round banner. Drawn after the
 * world so they sit on top of everything, still inside the map clip. */
export function drawOverlayFx(ctx, fx, world) {
  if (fx.flash > 0) {
    ctx.save();
    const grad = ctx.createRadialGradient(
      world.w / 2, world.h / 2, world.h * 0.3,
      world.w / 2, world.h / 2, world.w * 0.62,
    );
    grad.addColorStop(0, "rgba(255,40,80,0)");
    grad.addColorStop(1, `rgba(255,40,80,${Math.min(0.75, fx.flash)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.restore();
  }
  if (fx.banner) {
    const t = 1 - fx.banner.life / fx.banner.maxLife;
    const alpha = t < 0.12 ? t / 0.12 : t > 0.75 ? (1 - t) / 0.25 : 1;
    // Slam in from slightly too big, like a stamp.
    const scale = t < 0.12 ? 1.35 - (t / 0.12) * 0.35 : 1;
    const y = world.h * 0.34;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(world.w / 2, y);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `60px ${DISPLAY_FONT}`;
    const w = Math.max(ctx.measureText(fx.banner.text).width, 260) + 90;
    const h = fx.banner.sub ? 118 : 86;
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, "rgba(40,30,80,0.82)");
    grad.addColorStop(1, "rgba(20,14,44,0.82)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,209,102,0.85)";
    ctx.lineWidth = 3;
    ctx.stroke();
    const ty = fx.banner.sub ? -14 : 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a0f33";
    ctx.lineWidth = 8;
    ctx.strokeText(fx.banner.text, 0, ty);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fx.banner.text, 0, ty);
    if (fx.banner.sub) {
      ctx.font = `26px ${DISPLAY_FONT}`;
      ctx.lineWidth = 6;
      ctx.strokeText(fx.banner.sub, 0, ty + 44);
      ctx.fillStyle = "#ffd166";
      ctx.fillText(fx.banner.sub, 0, ty + 44);
    }
    ctx.restore();
  }
}
