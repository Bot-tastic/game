// Particles and floating text, driven by the events the simulation emits.

const MAX_PARTICLES = 500;

export function createFx() {
  return { particles: [], texts: [], shake: 0, beams: [], rings: [] };
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

export function addText(fx, x, y, text, color = "#f2f3f5") {
  fx.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}

/** Translate one simulation event into whatever it should look like. */
export function handleEvent(fx, ev) {
  switch (ev.kind) {
    case "pop":
      burst(fx, ev.x, ev.y, ev.color, ev.moab ? 26 : 8, ev.moab ? 260 : 120, ev.moab ? 0.7 : 0.4);
      if (ev.moab) {
        fx.shake = Math.max(fx.shake, 10);
        fx.rings.push({ x: ev.x, y: ev.y, r: ev.r, max: ev.r * 4, life: 0.5, maxLife: 0.5, color: "#ffb020" });
      }
      break;
    case "blast":
      fx.rings.push({ x: ev.x, y: ev.y, r: ev.r * 0.3, max: ev.r, life: 0.28, maxLife: 0.28, color: "#ffb020" });
      break;
    case "pulse":
      fx.rings.push({ x: ev.x, y: ev.y, r: 8, max: ev.r, life: 0.4, maxLife: 0.4, color: "#9fe8ff" });
      break;
    case "snipe":
      fx.beams.push({ ...ev, life: 0.14, maxLife: 0.14 });
      break;
    case "leak":
      fx.shake = Math.max(fx.shake, ev.moab ? 16 : 7);
      break;
    case "immune":
      addText(fx, ev.x, ev.y, "immune", "#9aa0ac");
      break;
    case "income":
      addText(fx, ev.x, ev.y, `+$${ev.amount}`, "#ffd166");
      break;
    case "build":
    case "upgrade":
      fx.rings.push({ x: ev.x, y: ev.y, r: 6, max: 46, life: 0.35, maxLife: 0.35, color: "#5ee6c8" });
      break;
    default:
      break;
  }
}

export function updateFx(fx, dt) {
  fx.shake = Math.max(0, fx.shake - dt * 45);
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
  for (const t of fx.texts) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    ctx.fillStyle = t.color;
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }
}
