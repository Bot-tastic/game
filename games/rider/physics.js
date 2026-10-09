// Bike simulation. Pure (no DOM) so the level verifier can run it in Node.
//
// Coordinates: x right, y DOWN (screen convention). A bike moving right on
// flat ground has angle 0. Nose-up rotation (a backflip) DEcreases the angle.
// Track "up" normal for a direction (tx, ty) is (ty, -tx).

export const P = {
  G: 1200, // gravity (units/s^2)
  V0: 600, // cruising speed the engine pulls toward
  VBOOST: 1000, // boost pad speed
  K: 2.0, // engine pull strength (1/s)
  G_ALONG: 0.6, // fraction of gravity felt along the track while grounded
  VMAX: 1500,
  VLAND_MAX: 1300,
  BOOST_T: 1.2,
  PERFECT_T: 0.7,
  PERFECT_MULT: 1.16,
  LOOP_VMIN: 520,
  SPIN: 7.5, // rad/s while holding in the air
  SPIN_ACCEL: 32,
  ALIGN_GAIN: 4.5, // released bikes ease toward their flight direction
  ALIGN_MAX: 3.4,
  ALIGN_ACCEL: 30,
  LAND_OK: 0.72, // max |angle error| for a safe landing (~41°)
  LAND_PERFECT: 0.3, // ~17°
  HEAD: 46, // rider head height above the contact point
  WHEELIE_MAX: 0.42,
  DETACH_EPS: 60,
  DT: 1 / 120,
  GEM_R: 52,
};

export const TAU = Math.PI * 2;

export function normAng(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function targetSpeed(boostT, perfectT) {
  if (boostT > 0) return P.VBOOST;
  if (perfectT > 0) return P.V0 * P.PERFECT_MULT;
  return P.V0;
}

/** Tangential acceleration while riding on the track. */
export function groundAccel(v, ty, targetV) {
  return P.G_ALONG * P.G * ty + P.K * (targetV - v);
}

export function createBike() {
  return {
    mode: "ready", // ready | ground | air | crashed
    x: 0, y: 0, angle: 0, angVel: 0,
    piece: 0, s: 0, seg: 0, v: 0, vx: 0, vy: 0,
    wheelie: 0, boostT: 0, perfectT: 0,
    airTime: 0, airRot: 0, flipRot: 0, va0: 0, flipsLive: 0, groundTime: 0,
    lastPad: null, cpIndex: 0, finished: false,
    hx: 0, hy: 0, wheelRot: 0, distance: 0,
  };
}

/** Place the bike on the track at a checkpoint ({piece, s, v}). */
export function placeBike(b, track, cp) {
  const pc = track.pieces[cp.piece];
  b.piece = cp.piece;
  b.seg = 0;
  b.s = cp.s;
  const m = track.sample(pc, cp.s, b);
  b.x = m.x;
  b.y = m.y;
  b.angle = m.ang;
  b.angVel = 0;
  b.v = cp.v;
  b.vx = b.vy = 0;
  b.wheelie = 0;
  b.boostT = cp.boostT || 0;
  b.perfectT = 0;
  b.airTime = 0;
  b.airRot = 0;
  b.flipRot = 0;
  b.flipsLive = 0;
  b.groundTime = 0;
  b.lastPad = null;
  b.finished = false;
  b.mode = "ready";
  b.hx = b.x + Math.sin(b.angle) * P.HEAD;
  b.hy = b.y - Math.cos(b.angle) * P.HEAD;
  // Next checkpoint to reach is the first one strictly ahead.
  b.cpIndex = 0;
  const cps = track.checkpoints;
  while (b.cpIndex < cps.length && cps[b.cpIndex].x <= b.x + 1) b.cpIndex++;
}

function takeoff(b, tx, ty, k, ev) {
  b.mode = "air";
  b.vx = b.v * tx;
  b.vy = b.v * ty;
  // Lift off a hair above the surface so the sweep doesn't re-hit it.
  b.x += ty * 0.6;
  b.y -= tx * 0.6;
  b.angVel = clamp(-k * b.v, -4, 4);
  b.wheelie = 0;
  b.airTime = 0;
  b.airRot = 0;
  b.flipsLive = 0;
  b.va0 = Math.atan2(b.vy, b.vx);
  ev.push({ type: "takeoff" });
}

function crash(b, ev, reason) {
  b.mode = "crashed";
  ev.push({ type: "crash", reason, x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle });
}

function groundStep(b, track, hold, dt, ev) {
  const pc = track.pieces[b.piece];
  let m = track.sample(pc, b.s, b);
  const ty0 = m.ty;
  b.v += groundAccel(b.v, ty0, targetSpeed(b.boostT, b.perfectT)) * dt;
  const sticky = pc.stickyAt(b.s);
  if (sticky) b.v = Math.max(b.v, P.LOOP_VMIN);
  b.v = clamp(b.v, 60, P.VMAX);
  const prevS = b.s;
  b.s += b.v * dt;
  b.distance += b.v * dt;
  b.groundTime += dt;

  for (const pad of pc.boosts) {
    if (b.s >= pad.s0 && prevS <= pad.s1 && b.lastPad !== pad) {
      b.lastPad = pad;
      b.boostT = P.BOOST_T;
      b.v = Math.max(b.v, P.VBOOST);
      ev.push({ type: "boost" });
    }
  }
  for (const lp of pc.loops) {
    if (prevS < lp.s1 && b.s >= lp.s1) ev.push({ type: "loop" });
  }

  if (b.s >= pc.len && pc.next != null) {
    b.s -= pc.len;
    b.piece = pc.next;
    b.seg = 0;
    b.lastPad = null;
    groundPose(b, track, track.pieces[b.piece], hold, dt, ev, false);
    return;
  }
  if (b.s >= pc.len) {
    m = track.sample(pc, pc.len, b);
    b.x = m.x;
    b.y = m.y;
    b.angle = m.ang - b.wheelie;
    takeoff(b, m.tx, m.ty, 0, ev);
    return;
  }

  groundPose(b, track, pc, hold, dt, ev, sticky);
}

function groundPose(b, track, pc, hold, dt, ev, sticky) {
  const m = track.sample(pc, b.s, b);
  b.x = m.x;
  b.y = m.y;
  if (hold) b.wheelie = Math.min(P.WHEELIE_MAX, b.wheelie + 2.6 * dt);
  else b.wheelie = Math.max(0, b.wheelie - 3.5 * dt);
  b.angle = m.ang - b.wheelie;
  b.hx = b.x + Math.sin(b.angle) * P.HEAD;
  b.hy = b.y - Math.cos(b.angle) * P.HEAD;

  if (!sticky) {
    const n = b.v * b.v * m.k + P.G * m.tx;
    if (n < -P.DETACH_EPS) takeoff(b, m.tx, m.ty, m.k, ev);
  }
}

function airStep(b, track, hold, dt, ev) {
  if (hold) {
    b.angVel += clamp(-P.SPIN - b.angVel, -P.SPIN_ACCEL * dt, P.SPIN_ACCEL * dt);
  } else {
    const va = Math.atan2(b.vy, b.vx);
    const d = normAng(va - b.angle);
    const tgt = clamp(d * P.ALIGN_GAIN, -P.ALIGN_MAX, P.ALIGN_MAX);
    b.angVel += clamp(tgt - b.angVel, -P.ALIGN_ACCEL * dt, P.ALIGN_ACCEL * dt);
  }
  b.angle += b.angVel * dt;
  b.airRot += b.angVel * dt;
  b.airTime += dt;
  // Rotation relative to the flight path (the path itself turns nose-down).
  b.flipRot = -b.airRot + (Math.atan2(b.vy, b.vx) - b.va0);
  const nf = Math.floor((b.flipRot + 0.35) / TAU);
  if (nf > b.flipsLive) {
    b.flipsLive = nf;
    ev.push({ type: "flip", n: nf });
  }

  const ox = b.x;
  const oy = b.y;
  b.vy += P.G * dt;
  const nx = ox + b.vx * dt;
  const ny = oy + b.vy * dt;
  b.distance += Math.abs(b.vx) * dt;

  const hit = track.sweep(ox, oy, nx, ny);
  if (hit) {
    b.x = hit.x;
    b.y = hit.y;
    if (hit.wall || hit.side <= 0) {
      if (b.finished) { b.vx *= -0.3; return; }
      crash(b, ev, "wall");
      return;
    }
    const pc = track.pieces[hit.p];
    b.piece = hit.p;
    b.seg = hit.i;
    b.s = pc.s[hit.i] + hit.u * pc.segLen[hit.i];
    const m = track.sample(pc, b.s, b);
    const diff = normAng(b.angle - m.ang);
    if (!b.finished && Math.abs(diff) > P.LAND_OK) {
      crash(b, ev, "angle");
      return;
    }
    const vt = b.vx * m.tx + b.vy * m.ty;
    b.v = clamp(vt, 150, P.VLAND_MAX);
    b.mode = "ground";
    b.x = m.x;
    b.y = m.y;
    b.wheelie = clamp(-diff, 0, P.WHEELIE_MAX);
    b.angle = m.ang - b.wheelie;
    const flips = Math.max(0, Math.floor((b.flipRot + 0.9) / TAU));
    const perfect = flips > 0 && Math.abs(diff) < P.LAND_PERFECT;
    if (perfect) b.perfectT = P.PERFECT_T;
    ev.push({ type: "land", flips, perfect, airTime: b.airTime, diff, impact: Math.abs(b.vx * m.ty - b.vy * m.tx) });
    b.groundTime = 0;
    b.hx = b.x + Math.sin(b.angle) * P.HEAD;
    b.hy = b.y - Math.cos(b.angle) * P.HEAD;
    return;
  }

  b.x = nx;
  b.y = ny;
  const hx = nx + Math.sin(b.angle) * P.HEAD;
  const hy = ny - Math.cos(b.angle) * P.HEAD;
  if (!b.finished && track.sweep(b.hx, b.hy, hx, hy)) {
    b.hx = hx;
    b.hy = hy;
    crash(b, ev, "head");
    return;
  }
  b.hx = hx;
  b.hy = hy;
  if (b.y > track.floorAt(b.x) + 1300) crash(b, ev, "fall");
}

/** Advance one fixed step. Appends events ({type,...}) to `ev`. */
export function stepBike(b, track, hold, dt, ev) {
  if (b.mode === "ready" || b.mode === "crashed") return;
  b.boostT = Math.max(0, b.boostT - dt);
  b.perfectT = Math.max(0, b.perfectT - dt);
  if (b.mode === "ground") groundStep(b, track, hold, dt, ev);
  else airStep(b, track, hold, dt, ev);
  if (b.mode === "crashed") return;

  b.wheelRot += (b.mode === "ground" ? b.v : Math.hypot(b.vx, b.vy) * 0.8) * dt / 13;

  // Gems (checked around the bike's middle, not its contact point).
  const cx = b.x + Math.sin(b.angle) * 22;
  const cy = b.y - Math.cos(b.angle) * 22;
  const gems = track.gems;
  let lo = 0;
  let hi = gems.length;
  const xmin = cx - P.GEM_R;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gems[mid].x < xmin) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < gems.length && gems[i].x <= cx + P.GEM_R; i++) {
    const g = gems[i];
    if (g.taken) continue;
    const dx = g.x - cx;
    const dy = g.y - cy;
    if (dx * dx + dy * dy < P.GEM_R * P.GEM_R) {
      g.taken = true;
      ev.push({ type: "gem", gem: g });
    }
  }

  const cps = track.checkpoints;
  while (b.cpIndex < cps.length && b.x >= cps[b.cpIndex].x) {
    ev.push({ type: "checkpoint", index: b.cpIndex, cp: cps[b.cpIndex] });
    b.cpIndex++;
  }
  if (track.finish && !b.finished && b.x >= track.finish.x) {
    b.finished = true;
    ev.push({ type: "finish" });
  }
}

/** Launch a bike that is waiting at the start / a checkpoint. */
export function launchBike(b) {
  if (b.mode === "ready") b.mode = "ground";
}
