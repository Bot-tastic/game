// Bike catalogue + neon line-art drawing. Bikes are cosmetic; they unlock with
// gems or by completing challenges.

export const BIKES = [
  { id: "neon", name: "Neon", style: "classic", color: "#20f2ff", rider: "#ffffff", trail: "#20f2ff", trailStyle: "line", cost: 0 },
  { id: "rose", name: "Rose", style: "classic", color: "#ff4fa3", rider: "#ffe1f0", trail: "#ff4fa3", trailStyle: "line", cost: 40 },
  { id: "lime", name: "Lime Dirt", style: "dirt", color: "#9dff3c", rider: "#f4ffe8", trail: "#9dff3c", trailStyle: "dots", cost: 80 },
  { id: "gold", name: "Gold Chopper", style: "chopper", color: "#ffd23f", rider: "#fff4cc", trail: "#ffd23f", trailStyle: "spark", cost: 140 },
  { id: "ice", name: "Ice Scooter", style: "scooter", color: "#bdf3ff", rider: "#ffffff", trail: "#8fe3ff", trailStyle: "line", cost: 200 },
  { id: "ember", name: "Ember", style: "sport", color: "#ff6a1f", rider: "#ffe2c9", trail: "#ff6a1f", trailStyle: "fire", cost: 260 },
  { id: "violet", name: "Violet Racer", style: "sport", color: "#b06bff", rider: "#efe1ff", trail: "#b06bff", trailStyle: "line", cost: 330 },
  { id: "ghost", name: "Ghost", style: "classic", color: "rgba(255,255,255,0.75)", rider: "rgba(255,255,255,0.6)", trail: "#ffffff", trailStyle: "ghost", cost: 420 },
  { id: "rainbow", name: "Rainbow", style: "dirt", color: "#ffffff", rider: "#ffffff", trail: "rainbow", trailStyle: "rainbow", cost: 520 },
  { id: "retro", name: "Retro", style: "chopper", color: "#ff9f1c", rider: "#2ec4b6", trail: "#2ec4b6", trailStyle: "dots", cost: 640 },
  { id: "shadow", name: "Shadow", style: "sport", color: "#ff1f3d", rider: "#1a0006", trail: "#ff1f3d", trailStyle: "line", cost: 780 },
  { id: "plasma", name: "Plasma", style: "classic", color: "#5cf2ff", rider: "#d9fbff", trail: "#5cf2ff", trailStyle: "electric", cost: 950 },
  { id: "mono", name: "Monowheel", style: "mono", color: "#e7ff3a", rider: "#fbffd6", trail: "#e7ff3a", trailStyle: "spark", challenge: "triple", cost: 0 },
  { id: "rocket", name: "Rocket", style: "rocket", color: "#ff3cf0", rider: "#ffe0fb", trail: "#ff3cf0", trailStyle: "fire", challenge: "world3", cost: 0 },
  { id: "bones", name: "Skeleton", style: "skeleton", color: "#e8e8e8", rider: "#ffffff", trail: "#a0ffef", trailStyle: "ghost", challenge: "endless", cost: 0 },
  { id: "galaxy", name: "Galaxy", style: "sport", color: "#7d8bff", rider: "#ffffff", trail: "rainbow", trailStyle: "spark", challenge: "flips500", cost: 0 },
];

export const CHALLENGES = {
  triple: { text: "Land a triple flip", test: (st) => st.maxFlip >= 3 },
  world3: { text: "Finish world 3 (level 30)", test: (st, save) => (save.levels[30]?.stars || 0) > 0 },
  endless: { text: "Score 15,000 in Endless", test: (st, save) => save.bestEndless >= 15000 },
  flips500: { text: "Do 500 flips in total", test: (st) => st.flips >= 500 },
};

export function bikeById(id) {
  return BIKES.find((b) => b.id === id) || BIKES[0];
}

function wheel(ctx, x, y, r, rot, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = rot + (k * Math.PI) / 3;
    ctx.moveTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
    ctx.lineTo(x - Math.cos(a) * r * 0.85, y - Math.sin(a) * r * 0.85);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function poly(ctx, pts, close = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

function rider(ctx, def, hip, shoulder, headC, hand, knee, foot, t) {
  ctx.strokeStyle = def.rider;
  if (def.style === "skeleton") {
    ctx.lineWidth = 2;
    poly(ctx, [hip[0], hip[1], shoulder[0], shoulder[1]]);
    for (let k = 1; k <= 3; k++) {
      const yy = hip[1] + ((shoulder[1] - hip[1]) * k) / 4;
      const xx = hip[0] + ((shoulder[0] - hip[0]) * k) / 4;
      poly(ctx, [xx - 4, yy, xx + 4, yy]);
    }
  } else {
    ctx.lineWidth = 4;
    poly(ctx, [hip[0], hip[1], shoulder[0], shoulder[1]]);
  }
  ctx.lineWidth = 2.6;
  poly(ctx, [shoulder[0], shoulder[1], (shoulder[0] + hand[0]) / 2 + 1, (shoulder[1] + hand[1]) / 2 + 4, hand[0], hand[1]]);
  poly(ctx, [hip[0], hip[1], knee[0], knee[1], foot[0], foot[1]]);
  ctx.beginPath();
  ctx.arc(headC[0], headC[1], 6.5, 0, Math.PI * 2);
  if (def.style === "skeleton") {
    ctx.stroke();
    ctx.fillStyle = def.rider;
    ctx.fillRect(headC[0] + 1, headC[1] - 2, 2, 2);
    ctx.fillRect(headC[0] + 4, headC[1] - 2, 2, 2);
  } else {
    ctx.fillStyle = def.rider;
    ctx.fill();
    // visor
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headC[0], headC[1], 6.5, -0.6, 0.5);
    ctx.stroke();
  }
}

function frame(ctx, def, rot, t) {
  const c = def.color;
  ctx.strokeStyle = c;
  ctx.lineWidth = 2.6;
  switch (def.style) {
    case "dirt":
      wheel(ctx, -27, -14, 14, rot, c);
      wheel(ctx, 29, -14, 14, rot, c);
      poly(ctx, [-27, -14, -8, -32, 18, -38, 29, -14]);
      poly(ctx, [-8, -32, 4, -20, 18, -38]);
      poly(ctx, [-30, -34, -10, -36]); // rear fender
      poly(ctx, [20, -44, 34, -36]); // front fender
      poly(ctx, [18, -38, 16, -48, 22, -50]);
      rider(ctx, def, [-6, -38], [6, -56], [11, -64], [20, -49], [8, -28], [2, -20], t);
      break;
    case "chopper":
      wheel(ctx, -26, -13, 13, rot, c);
      wheel(ctx, 36, -13, 13, rot, c);
      poly(ctx, [-26, -13, -10, -24, 14, -30, 36, -13]);
      poly(ctx, [14, -30, 18, -52, 10, -56]); // ape hanger
      ctx.lineWidth = 5;
      poly(ctx, [-4, -26, 10, -28]);
      ctx.lineWidth = 2.6;
      rider(ctx, def, [-10, -30], [-6, -50], [-3, -59], [11, -54], [6, -24], [12, -16], t);
      break;
    case "scooter":
      wheel(ctx, -24, -10, 10, rot, c);
      wheel(ctx, 26, -10, 10, rot, c);
      poly(ctx, [-24, -10, -18, -18, 14, -18, 22, -42, 26, -10]);
      poly(ctx, [-20, -24, -4, -24]);
      poly(ctx, [18, -44, 26, -44]);
      rider(ctx, def, [-10, -28], [0, -48], [5, -56], [20, -43], [6, -22], [6, -18], t);
      break;
    case "sport":
      wheel(ctx, -27, -13, 13, rot, c);
      wheel(ctx, 28, -13, 13, rot, c);
      poly(ctx, [-27, -13, -12, -28, -26, -32, -6, -32, 8, -26, 24, -40, 28, -13]);
      ctx.fillStyle = c.startsWith("#") ? c + "33" : c;
      ctx.beginPath();
      ctx.moveTo(-8, -20);
      ctx.lineTo(12, -18);
      ctx.lineTo(26, -36);
      ctx.lineTo(16, -42);
      ctx.lineTo(0, -32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      rider(ctx, def, [-8, -36], [10, -48], [16, -54], [20, -40], [4, -26], [-2, -18], t);
      break;
    case "mono": {
      ctx.lineWidth = 3;
      wheel(ctx, 0, -26, 26, rot, c);
      ctx.beginPath();
      ctx.arc(0, -26, 20, 0, Math.PI * 2);
      ctx.stroke();
      rider(ctx, def, [-2, -28], [4, -48], [8, -56], [12, -36], [8, -20], [6, -12], t);
      break;
    }
    case "rocket":
    case "skeleton":
    case "classic":
    default:
      wheel(ctx, -27, -13, 13, rot, c);
      wheel(ctx, 27, -13, 13, rot, c);
      poly(ctx, [-27, -13, -6, -30, 18, -34, 27, -13]);
      poly(ctx, [-6, -30, 2, -18, 18, -34]);
      poly(ctx, [18, -34, 16, -42]);
      if (def.style === "rocket") {
        ctx.lineWidth = 4;
        poly(ctx, [-30, -24, -8, -24]);
        const f = 10 + Math.sin(t * 40) * 4;
        ctx.strokeStyle = "#ffd23f";
        ctx.lineWidth = 3;
        poly(ctx, [-30, -27, -30 - f, -24, -30, -21]);
        ctx.strokeStyle = c;
      }
      rider(ctx, def, [-6, -34], [6, -52], [11, -60], [16, -42], [8, -24], [2, -16], t);
  }
}

/** Draw a bike in local space (origin = ground contact, x forward, y up = -). */
export function drawBike(ctx, def, wheelRot, t = 0, alpha = 1) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha * (def.trailStyle === "ghost" ? 0.75 : 1);
  // soft glow pass then crisp pass
  ctx.save();
  ctx.globalAlpha *= 0.28;
  const glowDef = { ...def, rider: def.color };
  thick(ctx, () => frame(ctx, glowDef, wheelRot, t));
  ctx.restore();
  frame(ctx, def, wheelRot, t);
  ctx.restore();
}

// Re-run a draw routine with every stroke widened (cheap glow without shadowBlur).
function thick(ctx, fn) {
  const orig = ctx.stroke;
  ctx.stroke = function (...a) {
    const lw = this.lineWidth;
    this.lineWidth = lw + 6;
    orig.apply(this, a);
    this.lineWidth = lw;
  };
  try {
    fn();
  } finally {
    ctx.stroke = orig;
  }
}

/** Line segments approximating the bike for the crash shatter effect (local space). */
export const BIKE_SHARDS = [
  [-27, -13, -6, -30], [-6, -30, 18, -34], [18, -34, 27, -13], [-6, -30, 2, -18], [2, -18, 18, -34],
  [-40, -13, -14, -13], [14, -13, 40, -13], [-27, 0, -27, -26], [27, 0, 27, -26],
  [-6, -34, 6, -52], [6, -52, 16, -42], [-6, -34, 8, -24], [8, -24, 2, -16], [5, -60, 17, -60],
];
