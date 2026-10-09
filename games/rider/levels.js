// Procedural (seeded, deterministic) level + endless track generation.
// Jumps are built from ballistic predictions so every landing zone sits under
// the bike's flight path for a range of take-off speeds.

import { P, TAU, clamp, groundAccel, targetSpeed, normAng } from "./physics.js";
import { Track } from "./track.js";
import { LEVEL_COUNT, themeForLevel } from "./themes.js";

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

export class Builder {
  constructor(track) {
    this.track = track;
    this.flipOpp = 0;
    this.features = [];
  }

  start(x, y, ang, v, boostT = 0, connect = false) {
    this.connect = connect;
    this.pts = [x, y];
    this.flags = [0];
    this.loops = [];
    this.boosts = [];
    this.x = x;
    this.y = y;
    this.ang = ang;
    this.v = v;
    this.boostT = boostT;
    this.s = 0;
    this.inLoop = false;
    this.pieceIndex = this.track.pieces.length;
  }

  _integrate(ty, ds) {
    let rem = ds;
    while (rem > 1e-9) {
      const step = Math.min(rem, 8);
      const dt = step / Math.max(this.v, 60);
      this.v += groundAccel(this.v, ty, targetSpeed(this.boostT, 0)) * dt;
      if (this.inLoop) this.v = Math.max(this.v, P.LOOP_VMIN);
      this.v = clamp(this.v, 60, P.VMAX);
      this.boostT = Math.max(0, this.boostT - dt);
      rem -= step;
    }
  }

  to(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    const ds = Math.hypot(dx, dy);
    if (ds < 1e-6) return;
    this._integrate(dy / ds, ds);
    this.pts.push(x, y);
    this.flags.push(this.inLoop ? 1 : 0);
    this.x = x;
    this.y = y;
    this.s += ds;
  }

  line(len) {
    const n = Math.max(1, Math.ceil(len / 24));
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    const x0 = this.x;
    const y0 = this.y;
    for (let k = 1; k <= n; k++) this.to(x0 + (ca * len * k) / n, y0 + (sa * len * k) / n);
  }

  arc(d, r) {
    if (Math.abs(d) < 1e-6) return;
    const n = Math.max(2, Math.ceil((Math.abs(d) * r) / 14));
    const dd = d / n;
    const chord = 2 * r * Math.sin(Math.abs(dd) / 2);
    for (let k = 0; k < n; k++) {
      const am = this.ang + dd / 2;
      this.to(this.x + Math.cos(am) * chord, this.y + Math.sin(am) * chord);
      this.ang += dd;
    }
  }

  crestR(toAng) {
    const c = Math.max(0.35, Math.min(Math.cos(this.ang), Math.cos(toAng)));
    const v = this.v * 1.1;
    return (1.7 * v * v) / (P.G * c);
  }

  /** Turn to an absolute heading; convex (crest) turns get a speed-safe radius. */
  turnTo(toAng, r = 300) {
    const d = toAng - this.ang;
    if (d > 0) r = Math.max(r, this.crestR(toAng));
    this.arc(d, r);
  }

  boost(len) {
    this.v = Math.max(this.v, P.VBOOST);
    this.boostT = P.BOOST_T;
    this.boosts.push({ s0: this.s, s1: this.s + len });
    this.line(len);
  }

  loop(r) {
    const cx = this.x;
    const cy = this.y - r;
    this.flags[this.flags.length - 1] = 1;
    const s0 = this.s;
    this.inLoop = true;
    this.ang = 0;
    const N = Math.ceil((TAU * r) / 14);
    for (let k = 1; k <= N; k++) {
      const th = (TAU * k) / N;
      this.to(cx + r * Math.sin(th), cy + r * Math.cos(th));
    }
    this.inLoop = false;
    this.ang = 0;
    this.loops.push({ s0, s1: this.s, cx, cy, r });
    this.gem(cx, cy - r + 24);
  }

  checkpoint(hidden = false) {
    this.track.checkpoints.push({
      piece: this.pieceIndex, s: this.s, x: this.x, y: this.y, v: this.v, boostT: this.boostT, hidden,
    });
  }

  gem(x, y) {
    this.track.gems.push({ x, y, id: this.track.gemCount++, taken: false, old: false });
  }

  groundGems(count, spacing = 70) {
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    for (let i = 0; i < count; i++) {
      const d = 40 + i * spacing;
      this.gem(this.x + ca * d + sa * 30, this.y + sa * d - ca * 30);
    }
  }

  end() {
    this.track.addPiece({ pts: this.pts, loops: this.loops, boosts: this.boosts, loopFlags: Uint8Array.from(this.flags), connect: this.connect });
    return { x: this.x, y: this.y, ang: this.ang, v: this.v, boostT: this.boostT };
  }

  /**
   * Build a landing piece for a jump that left the track at `to`.
   * o: { tAir, gap, delta (extra flatness = pull-up needed), endAng, gems, rOut }
   */
  landing(to, o) {
    const G = P.G;
    const x0 = to.x;
    const y0 = to.y;
    const vx = to.v * Math.cos(to.ang);
    const vy = to.v * Math.sin(to.ang);
    const fL = o.fLow ?? 0.84;
    const fH = o.fHigh ?? 1.2;
    const yAt = (f, x) => {
      const t = (x - x0) / (vx * f);
      return y0 + vy * f * t + 0.5 * G * t * t;
    };
    const slopeAt = (f, x) => {
      const t = (x - x0) / (vx * f);
      return (vy * f + G * t) / (vx * f);
    };
    const tApexL = Math.max(0, (-vy * fL) / G);
    let xk = x0 + vx * o.tAir * 0.8;
    xk = Math.max(xk, x0 + vx * fL * tApexL + 110, x0 + 150);
    let xs = x0 + (o.gap ?? 100);
    if (xs > xk - 80) xs = Math.max(x0 + 30, xk - 80);
    const span = xk - xs;
    const drop0 = o.drop0 ?? clamp(span * 0.3, 30, 220);
    const kk = drop0 / (span * span);
    const surfA = (x) => yAt(fL, x) + 12 + kk * (xk - x) * (xk - x);

    this.start(xs, surfA(xs), 0, to.v);
    for (let x = xs + 14; x < xk; x += 14) this.to(x, surfA(x));
    this.to(xk, surfA(xk));
    this.ang = Math.atan(slopeAt(fL, xk));
    const thK = this.ang;
    const thL = Math.max(Math.min(thK - (o.delta ?? 0.08), 1.25), (o.endAng ?? 0) - 0.05);
    this.arc(thL - thK, 120);

    const tK = (xk - x0) / vx;
    const nvy = vy + G * tK;
    const sp = Math.hypot(vx, nvy);
    this.v = clamp(sp * Math.cos(Math.atan2(nvy, vx) - thL), 150, P.VLAND_MAX);
    this.boostT = 0;

    const lx0 = this.x;
    const ly0 = this.y;
    const m = Math.tan(thL);
    const hitX = (f) => {
      for (let x = lx0; x < lx0 + 5000; x += 6) if (yAt(f, x) >= ly0 + m * (x - lx0)) return x;
      return lx0 + 5000;
    };
    const xh = hitX(fH);
    const xn = Math.min(hitX(1), xh);
    const L = Math.max(160, (xh - lx0) / Math.cos(thL) + 170);
    this.line(L);
    const endAng = o.endAng ?? 0;
    if (endAng < this.ang) this.arc(endAng - this.ang, o.rOut ?? 380);

    const tN = (xn - x0) / vx;
    this.flipOpp += Math.max(0, Math.floor((tN - 0.3) / 0.95));
    const ng = o.gems ?? 0;
    for (let i = 0; i < ng; i++) {
      const t = tN * (0.18 + (0.6 * (i + 0.5)) / ng);
      const x = x0 + vx * t;
      this.gem(x, yAt(1, x) - 26);
    }
    return { tAir: tN };
  }
}

// ---------------------------------------------------------------- features

function runway(B, len) {
  B.turnTo(0, 380);
  B.line(len);
}

function kicker(B, r, a, rad, tAir, gap, extra = {}) {
  B.turnTo(-a, rad);
  B.line(30);
  const to = B.end();
  return B.landing(to, { tAir, gap, delta: 0.08, gems: extra.gems ?? 0, ...extra });
}

const FEATURES = {
  kicker(B, r, d) {
    runway(B, r.range(140, 240));
    if (r.chance(0.4)) B.groundGems(3);
    kicker(B, r, r.range(0.28, 0.4 + 0.14 * d), r.range(170, 240), r.range(0.75, 1.05 + 0.8 * d), r.range(80, 160 + 220 * d), { gems: r.chance(0.6) ? 3 : 0 });
  },
  hills(B, r, d) {
    runway(B, 120);
    const n = r.int(2, 3 + Math.round(d * 2));
    for (let i = 0; i < n; i++) {
      const a = r.range(0.18, 0.3 + 0.12 * d);
      B.turnTo(-a, r.range(220, 320));
      B.line(r.range(70, 200));
      B.turnTo(0);
      if (r.chance(0.5)) B.gem(B.x, B.y - 34);
      B.turnTo(a);
      B.line(r.range(70, 200));
      B.turnTo(0, r.range(220, 320));
      B.line(r.range(40, 120));
    }
  },
  drop(B, r, d, pull = false) {
    runway(B, r.range(160, 240));
    B.line(20);
    const to = B.end();
    const delta = pull ? r.range(0.45 + 0.3 * d, 0.7 + 0.35 * d) : r.range(0.1, 0.3);
    B.landing(to, { tAir: r.range(0.6, 0.85 + 0.35 * d), gap: r.range(60, 180), delta, gems: r.chance(0.5) ? 2 : 0 });
  },
  pulldrop(B, r, d) {
    FEATURES.drop(B, r, d, true);
  },
  loop(B, r) {
    runway(B, r.range(120, 200));
    B.boost(110);
    B.line(150);
    B.loop(r.range(125, 165));
    B.line(220);
  },
  doubleloop(B, r) {
    runway(B, 140);
    B.boost(110);
    B.line(140);
    const rad = r.range(120, 145);
    B.loop(rad);
    B.line(70);
    B.boost(rad * 2 - 40);
    B.line(80);
    B.loop(r.range(120, 150));
    B.line(220);
  },
  mega(B, r, d) {
    runway(B, 120);
    B.boost(130);
    B.line(110);
    kicker(B, r, r.range(0.45, 0.6), r.range(230, 280), r.range(1.45, 1.75 + 0.55 * d), r.range(220, 520), { gems: 6, rOut: 520 });
  },
  stairs(B, r, d) {
    const n = r.int(3, 4 + Math.round(d));
    for (let i = 0; i < n; i++) {
      runway(B, r.range(110, 190));
      const to = B.end();
      B.landing(to, { tAir: r.range(0.42, 0.6), gap: r.range(40, 120), delta: r.range(0.1, 0.2 + 0.25 * d), gems: i === n - 1 ? 2 : 0 });
    }
  },
  wave(B, r, d) {
    const n = r.int(3, 4);
    for (let i = 0; i < n; i++) {
      runway(B, r.range(90, 150));
      kicker(B, r, r.range(0.24, 0.32), r.range(140, 180), r.range(0.55, 0.75 + 0.15 * d), r.range(60, 140), { gems: 1 });
    }
  },
  climb(B, r, d) {
    runway(B, 120);
    B.boost(110);
    B.turnTo(-r.range(0.25, 0.38 + 0.08 * d), 320);
    B.line(r.range(250, 420));
    B.turnTo(0);
    B.groundGems(3);
    B.line(140);
  },
  jumpup(B, r) {
    runway(B, 100);
    B.boost(130);
    B.line(60);
    const a = r.range(0.62, 0.72);
    const rad = 230;
    B.turnTo(-a, rad);
    B.line(30);
    const to = B.end();
    const tApex = (to.v * Math.sin(a)) / P.G;
    B.landing(to, { tAir: tApex + r.range(0.18, 0.32), gap: r.range(120, 220), delta: 0.08, gems: 3 });
  },
};

const UNLOCK = {
  kicker: 1, hills: 1, drop: 2, wave: 3, pulldrop: 5, loop: 4, stairs: 6, climb: 7, mega: 8, jumpup: 11, doubleloop: 15,
};
const WEIGHT = {
  kicker: 3, hills: 2, drop: 2, wave: 2, pulldrop: 1.6, loop: 1.5, stairs: 1.4, climb: 1, mega: 1.6, jumpup: 1.2, doubleloop: 0.8,
};

function pickFeature(r, level, prev) {
  const pool = Object.keys(UNLOCK).filter((k) => UNLOCK[k] <= level && k !== prev);
  let total = 0;
  for (const k of pool) total += WEIGHT[k];
  let x = r.next() * total;
  for (const k of pool) {
    x -= WEIGHT[k];
    if (x <= 0) return k;
  }
  return pool[pool.length - 1];
}

function addFeature(B, r, d, kind) {
  const x0 = B.x;
  FEATURES[kind](B, r, d);
  B.features.push({ kind, x0, x1: B.x });
}

const SCRIPTED = {
  1: ["kicker", "hills", "kicker", "drop"],
  2: ["hills", "kicker", "drop", "kicker", "hills"],
  3: ["kicker", "wave", "hills", "drop", "kicker"],
  4: ["kicker", "loop", "hills", "wave", "drop", "kicker"],
  5: ["drop", "kicker", "pulldrop", "loop", "wave", "kicker"],
};

export function buildLevel(n) {
  const r = rng(n * 7919 + 101);
  const d = (n - 1) / (LEVEL_COUNT - 1);
  const track = new Track();
  track.gemCount = 0;
  const B = new Builder(track);
  B.start(0, 0, 0, P.V0);
  B.line(560);
  const count = Math.min(17, 4 + Math.floor(n * 0.22));
  const plan = SCRIPTED[n] || [];
  let prev = null;
  for (let i = 0; i < Math.max(count, plan.length); i++) {
    if (i > 0 && i % 2 === 0) {
      runway(B, 160);
      B.checkpoint();
      B.line(120);
    }
    const kind = plan[i] || pickFeature(r, n, prev);
    addFeature(B, r, d, kind);
    prev = kind;
  }
  runway(B, 340);
  track.finish = { x: B.x, y: B.y };
  B.line(1600);
  B.end();
  track.sortGems();
  return {
    n,
    track,
    theme: themeForLevel(n),
    start: { piece: 0, s: 220, v: P.V0 },
    startX: 220,
    flipTarget: Math.max(1, Math.round(B.flipOpp * 0.4)),
    gemTotal: track.gemCount,
    features: B.features,
  };
}

/** Endless track that keeps generating ahead of the bike. */
export function createEndless(seed) {
  const r = rng(seed);
  const track = new Track();
  track.gemCount = 0;
  const B = new Builder(track);
  B.start(0, 0, 0, P.V0);
  B.line(700);
  let prev = null;
  const world = {
    track,
    start: { piece: 0, s: 220, v: P.V0 },
    startX: 220,
    features: B.features,
    extend(untilX) {
      let added = false;
      while (B.x < untilX) {
        const d = clamp(B.x / 60000, 0, 1);
        const lvl = 3 + Math.floor(d * 57);
        runway(B, 160);
        B.checkpoint(true);
        B.line(100);
        const kind = pickFeature(r, Math.max(lvl, 4), prev);
        addFeature(B, r, d, kind);
        prev = kind;
        added = true;
      }
      if (added) {
        // Close the current piece so its geometry is collidable, then continue
        // seamlessly with a new piece starting at the same point.
        const st = B.end();
        B.start(st.x, st.y, st.ang, st.v, st.boostT, true);
        track.sortGems();
      }
    },
  };
  world.extend(6000);
  return world;
}

// ---------------------------------------------------------------- bot

function predictLanding(b, track) {
  let x = b.x;
  let y = b.y;
  let vx = b.vx;
  let vy = b.vy;
  const dt = 1 / 60;
  for (let t = 0; t < 4; t += dt) {
    vy += P.G * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    const h = track.sweep(x, y, nx, ny);
    if (h) {
      if (h.wall || h.side <= 0) return { T: t, ang: Math.atan2(vy, vx), bad: true };
      const pc = track.pieces[h.p];
      const m = track.sample(pc, pc.s[h.i] + h.u * pc.segLen[h.i], { seg: h.i });
      return { T: t, ang: m.ang };
    }
    x = nx;
    y = ny;
  }
  return { T: 4, ang: Math.atan2(vy, vx) };
}

/** A simple autopilot: optional flips plus pulling the nose up for flat landings. */
export function makeBot({ flips = true, maxFlips = 3 } = {}) {
  const st = { active: false, F: 0, pred: null, at: -1, hold: false };
  return function botHold(b, track) {
    if (b.mode !== "air") {
      st.active = false;
      return false;
    }
    if (!st.active) {
      st.active = true;
      st.pred = predictLanding(b, track);
      st.at = 0;
      st.F = flips ? Math.min(maxFlips, Math.max(0, Math.floor((st.pred.T - 0.45) / 0.95))) : 0;
      st.hold = false;
    } else if (b.airTime - st.at > 0.05) {
      st.pred = predictLanding(b, track);
      st.at = b.airTime;
    }
    const remain = st.pred.T - (b.airTime - st.at);
    const done = b.flipRot;
    if (done < st.F * TAU - 0.95) {
      const need = (st.F * TAU - 0.95 - done) / P.SPIN + 0.4;
      if (need < remain) return true;
      st.F = Math.max(0, Math.floor((done + 1.2) / TAU));
    }
    if (remain < 0.5) {
      const diff = normAng(b.angle - st.pred.ang);
      if (diff > 0.28) st.hold = true;
      else if (diff < 0.04) st.hold = false;
      return st.hold;
    }
    return false;
  };
}
