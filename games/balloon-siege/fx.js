// Particles, floating text and banners, driven by the events the simulation
// emits. Nothing in here feeds back into the simulation.

const MAX_PARTICLES = 560;

export function createFx() {
  return { particles: [], texts: [], shake: 0, beams: [], rings: [], flash: 0, banner: null, dmgGap: 0 };
}

function burst(fx, x, y, color, count, speed, life) {
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
      r: 2 + Math.random() * 3,
      color,
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
      burst(fx, ev.x, ev.y, ev.color, ev.moab ? 30 : 8, ev.moab ? 280 : 130, ev.moab ? 0.7 : 0.4);
      if (ev.moab) {
        fx.shake = Math.max(fx.shake, 11);
        fx.rings.push({ x: ev.x, y: ev.y, r: ev.r, max: ev.r * 4, life: 0.5, maxLife: 0.5, color: "#ffb020" });
      }
      // Only the bloons that pay real money get a floater; a "+$1" on every
      // red bloon would bury the board in text.
      if (ev.reward) addText(fx, ev.x, ev.y - 10, `+$${ev.reward}`, "#ffd166", ev.moab ? 24 : 17);
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
      break;
    case "pulse":
      fx.rings.push({ x: ev.x, y: ev.y, r: 8, max: ev.r, life: 0.4, maxLife: 0.4, color: "#9fe8ff" });
      break;
    case "snipe":
      fx.beams.push({ ...ev, life: 0.14, maxLife: 0.14 });
      break;
    case "ability":
      fx.shake = Math.max(fx.shake, 8);
      fx.rings.push({ x: ev.x, y: ev.y, r: 10, max: ev.r, life: 0.55, maxLife: 0.55, color: ev.color });
      fx.rings.push({ x: ev.x, y: ev.y, r: 10, max: ev.r * 0.7, life: 0.4, maxLife: 0.4, color: "#ffffff" });
      break;
    case "leak":
      fx.shake = Math.max(fx.shake, ev.moab ? 18 : 8);
      fx.flash = Math.max(fx.flash, ev.moab ? 0.55 : 0.28);
      break;
    case "immune":
      addText(fx, ev.x, ev.y, "immune", "#9aa0ac", 15);
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
    case "upgrade":
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, max: 52, life: 0.35, maxLife: 0.35, color: "#5ee6c8" });
      break;
    default:
      break;
  }
}

export function updateFx(fx, dt) {
  fx.shake = Math.max(0, fx.shake - dt * 45);
  fx.flash = Math.max(0, fx.flash - dt * 1.4);
  fx.dmgGap -= dt;
  fx.particles = fx.particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy = p.vy * 0.92 + 180 * dt;
    return p.life > 0;
  });
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
  for (const r of fx.rings) {
    const t = 1 - r.life / r.maxLife;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + (r.max - r.r) * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const b of fx.beams) {
    ctx.save();
    ctx.globalAlpha = b.life / b.maxLife;
    ctx.strokeStyle = "#fff6b0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.restore();
  }
  for (const p of fx.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 3;
  for (const t of fx.texts) {
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    ctx.fillStyle = t.color;
    ctx.font = `800 ${t.size ?? 18}px system-ui, sans-serif`;
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
    const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 6;
    ctx.font = "900 52px system-ui, sans-serif";
    const y = world.h * 0.34 - t * 18;
    ctx.strokeText(fx.banner.text, world.w / 2, y);
    ctx.fillText(fx.banner.text, world.w / 2, y);
    if (fx.banner.sub) {
      ctx.font = "800 24px system-ui, sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.lineWidth = 5;
      ctx.strokeText(fx.banner.sub, world.w / 2, y + 38);
      ctx.fillText(fx.banner.sub, world.w / 2, y + 38);
    }
    ctx.restore();
  }
}
