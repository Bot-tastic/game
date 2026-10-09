// Particles (world space) and floating popup texts (screen space).
import { BIKE_SHARDS } from "./bikes.js";

export class FX {
  constructor() {
    this.parts = [];
    this.popups = [];
    this.shake = 0;
    this.flash = 0;
  }

  clear() {
    this.parts.length = 0;
    this.popups.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  spark(x, y, color, n = 10, speed = 300, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ type: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, size: 2 + Math.random() * 2.5, g: 900 });
    }
  }

  dust(x, y, color, dirx, n = 8) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ type: "spark", x, y, vx: -dirx * (80 + Math.random() * 200) + (Math.random() - 0.5) * 120, vy: -Math.random() * 220, life: 0.45, max: 0.45, color, size: 2 + Math.random() * 2, g: 700 });
    }
  }

  ring(x, y, color, r = 60, life = 0.45) {
    this.parts.push({ type: "ring", x, y, r, life, max: life, color });
  }

  gemBurst(x, y) {
    this.ring(x, y, "#ffffff", 50, 0.35);
    this.spark(x, y, "#9ff6ff", 8, 260, 0.45);
  }

  shatter(x, y, angle, vx, vy, color, riderColor) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    BIKE_SHARDS.forEach((s, i) => {
      const lx = (s[0] + s[2]) / 2;
      const ly = (s[1] + s[3]) / 2;
      const wx = x + lx * ca - ly * sa;
      const wy = y + lx * sa + ly * ca;
      const hx = (s[2] - s[0]) / 2;
      const hy = (s[3] - s[1]) / 2;
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 450;
      this.parts.push({
        type: "shard", x: wx, y: wy, ang: angle, len: Math.hypot(hx, hy), base: Math.atan2(hy, hx),
        vx: vx * 0.35 + Math.cos(a) * sp, vy: vy * 0.25 + Math.sin(a) * sp - 300, spin: (Math.random() - 0.5) * 16,
        life: 1.6, max: 1.6, color: i >= 9 ? riderColor : color, g: 1100,
      });
    });
    this.spark(x, y - 20, color, 40, 650, 0.9);
    this.spark(x, y - 20, "#ffffff", 16, 400, 0.5);
    this.ring(x, y - 20, color, 160, 0.5);
    this.shake = 22;
    this.flash = 0.35;
  }

  popup(text, color = "#ffffff", size = 34, sub = "") {
    // Stack new popups above the ones still showing.
    for (const p of this.popups) p.slot++;
    this.popups.push({ text, color, size, sub, life: 1.3, max: 1.3, slot: 0 });
    if (this.popups.length > 4) this.popups.shift();
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      if (p.type !== "ring") {
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.ang += p.spin * dt;
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].life -= dt;
      if (this.popups[i].life <= 0) this.popups.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 60);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  drawWorld(ctx) {
    ctx.save();
    ctx.lineCap = "round";
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.type === "spark") {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * a + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - a * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === "shard") {
        const ang = p.ang + p.base;
        const dx = Math.cos(ang) * p.len;
        const dy = Math.sin(ang) * p.len;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 7;
        ctx.globalAlpha = a * 0.25;
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x + dx, p.y + dy);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawScreen(ctx, W, H) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.popups) {
      const t = 1 - p.life / p.max;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.5 : t < 0.2 ? 1.1 - ((t - 0.12) / 0.08) * 0.1 : 1;
      const a = p.life < 0.35 ? p.life / 0.35 : 1;
      const y = H * 0.3 - p.slot * (p.size * 1.2) - t * 30;
      ctx.globalAlpha = a;
      ctx.font = `900 italic ${Math.round(p.size * pop)}px system-ui, sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(p.text, W / 2, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, W / 2, y);
      if (p.sub) {
        ctx.font = `800 ${Math.round(p.size * 0.5)}px system-ui, sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(p.sub, W / 2, y + p.size * 0.75);
      }
    }
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}
