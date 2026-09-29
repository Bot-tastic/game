// terrain.js — deterministic, endless hills.
//
// The ground is a polyline sampled every STEP metres. Heights come from a
// seeded fBm of sines (mulberry32 picks the phases), so a stage+seed pair
// always regenerates byte-identical ground: a replay of the same run drives
// over the same hill, and the physics can ask for any x at any time without
// the generator having to remember what it already produced.
//
// Chunks are generated lazily as the camera moves and the ones far behind are
// dropped, which keeps memory flat on an endless run.

export const STEP = 1.2; // metres between ground samples
const CHUNK = 64; // samples per chunk
const FLAT_END = 70; // metres easing out of the flat start line
const KEEP_BEHIND = 3; // chunks retained behind the car

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Create a terrain for a stage. `seed` makes a run reproducible; omit it for
 * a fresh landscape every attempt. Pass a campaign `level` (levels.js) for a
 * finite course: its features are stamped on, and the ground runs flat past
 * the finish line.
 */
export function createTerrain(stage, seed = (Math.random() * 1e9) | 0, level = null) {
  const p = stage.terrain;
  const rnd = mulberry32(seed);

  // Four octaves: the long swell that makes the hills, plus progressively
  // finer detail. Phases are random per run, wavelengths are not.
  const octaves = [
    { wave: p.wave, amp: p.amp, phase: rnd() * 6.283 },
    { wave: p.wave * 0.47, amp: p.amp * 0.52 * p.rough, phase: rnd() * 6.283 },
    { wave: p.wave * 0.19, amp: p.amp * 0.22 * p.rough, phase: rnd() * 6.283 },
    { wave: p.wave * 0.071, amp: p.amp * 0.09 * p.bumps, phase: rnd() * 6.283 },
  ];
  // A slow drift that keeps long stretches from averaging out to a plateau.
  const drift = { wave: p.wave * 4.3, amp: p.amp * 1.25, phase: rnd() * 6.283 };
  const finishX = level ? level.length : Infinity;

  /** The hills alone, before any feature or kicker is stamped on top. */
  function hillsAt(x) {
    if (x <= 0) return 0;
    let h = 0;
    for (const o of octaves) h += Math.sin(x / o.wave + o.phase) * o.amp;
    h += Math.sin(x / drift.wave + drift.phase) * drift.amp;
    // Difficulty ramps with distance: amplitude grows, capped so it stays
    // driveable rather than turning into a wall. A level has its own scale.
    if (level) return h * level.ampScale * (1 + 0.3 * Math.min(1, x / level.length));
    return h * (1 + Math.min(x / 2000, 1.2));
  }

  // --- level features ---------------------------------------------------
  const maxUp = level ? level.maxUp : Infinity;
  const feats = level ? level.features : [];
  const additive = feats.filter((f) => f.type !== "pit");

  /** Hills plus the additive features (hills, washboards, ledges). */
  function shapedAt(x) {
    let h = hillsAt(x);
    for (const f of additive) {
      if (f.type === "hill") {
        const d = (x - f.x) / f.w;
        if (d > -0.5 && d < 0.5) h += f.h * (1 + Math.cos(d * 2 * Math.PI)) * 0.5;
      } else if (f.type === "bumps") {
        const d = x - (f.x - f.len / 2);
        if (d > 0 && d < f.len) h += Math.sin((d / f.len) * Math.PI) * f.a * (1 - Math.cos(d * 1.9));
      } else if (f.type === "climb") {
        // A trapezoid: steep enough that the slope limit below shapes its
        // face into a straight ramp at exactly the level's maxUp, then a flat
        // top and a gentler way down.
        const up = f.h / Math.min(1.2, maxUp);
        const d = x - f.x;
        if (d > -up && d < f.top + f.h / 0.5) {
          if (d <= 0) h += f.h * (1 + d / up);
          else if (d <= f.top) h += f.h;
          else h += f.h * (1 - (d - f.top) / (f.h / 0.5));
        }
      } else if (f.type === "drop" && x < f.x && x > f.x - 14) {
        // A short flat lip before the ledge (the fall itself is in dropAt).
        h += (hillsAt(f.x) - hillsAt(x)) * smoothstep((x - (f.x - 14)) / 14);
      }
    }
    return h;
  }

  /** How far the ledges passed so far have lowered the ground at x. */
  function dropAt(x) {
    let h = 0;
    for (const f of additive) {
      if (f.type === "drop" && x > f.x) h -= f.d * smoothstep(Math.min(1, (x - f.x) / 3));
    }
    return h;
  }

  // A level's base ground is precomputed and slope-limited: no sustained
  // climb may be steeper than the level allows (kickers, added
  // later, are short enough to carry momentum over), and no descent so steep
  // that the valley at its foot folds the car in half. Ledges are added after.
  const maxDown = 0.72;
  let baseAt = shapedAt;
  if (level) {
    const n = Math.ceil((finishX + 260) / STEP);
    const base = new Float64Array(n + 1);
    base[0] = shapedAt(0);
    for (let i = 1; i <= n; i++) base[i] = Math.min(shapedAt(i * STEP), base[i - 1] + maxUp * STEP);
    for (let i = n - 1; i >= 0; i--) base[i] = Math.min(base[i], base[i + 1] + maxDown * STEP);
    // Round every crest and valley: a steep descent straight into a steep
    // climb is a V the chassis folds into, and no amount of upgrades helps.
    for (let pass = 0; pass < 3; pass++) {
      const src = base.slice();
      for (let i = 3; i <= n - 3; i++) {
        let sum = 0;
        for (let k = -3; k <= 3; k++) sum += src[i + k];
        base[i] = sum / 7;
      }
    }
    for (let i = 0; i <= n; i++) base[i] += dropAt(i * STEP);
    baseAt = (x) => {
      const s = Math.max(0, Math.min(n - 1e-9, x / STEP));
      const i = Math.floor(s);
      return base[i] + (base[Math.min(n, i + 1)] - base[i]) * (s - i);
    };
  }

  // Pits flatten a stretch of road into approach, kicker, gap and landing.
  // The spot is searched inside the feature's slot for the flattest fit, so
  // the plateau never has to bridge a big height difference.
  const APPROACH = 34;
  const LANDING = 24;
  const BLEND = 16;
  const pits = [];
  for (const f of feats) {
    if (f.type !== "pit") continue;
    let best = null;
    const span = 12;
    for (let k = 0; k <= 16; k++) {
      const x0 = f.x - span / 2 + (span * k) / 16;
      const ya = baseAt(x0 - APPROACH);
      const yb = baseAt(x0 + f.w + LANDING);
      const score = Math.abs(yb - ya) + Math.abs(baseAt(x0 - APPROACH - BLEND) - ya) * 0.5;
      if (!best || score < best.score) best = { x0, ya, yb, score };
    }
    const { x0, ya } = best;
    // Landing plateau may sit a little lower than the lip, never higher.
    const yb = Math.max(ya - 2.5, Math.min(ya, best.yb));
    const x1 = x0 + f.w;
    const a = x0 - APPROACH;
    const b = x1 + LANDING;
    // Blend lengths grow with the height the plateau has to meet, so the
    // ramp onto and off it is never steeper than the world allows.
    const blendLen = (edge, y, dir) => {
      let d = BLEND;
      while (d < 90 && Math.abs(y - baseAt(edge + dir * d)) > d * Math.min(maxUp, 0.6) * 0.6) d += 2;
      return d;
    };
    pits.push({
      x0,
      x1,
      a,
      b,
      ba: blendLen(a, ya, -1),
      bb: blendLen(b, yb, 1),
      ya,
      yb,
      kh: f.kh,
      up: 7,
      depth: 3.4,
      surface: Math.min(ya, yb) - 1.3,
      kind: stage.theme.hazard.kind,
    });
  }

  /** Height inside a pit's flattened stretch, or null outside it. */
  function pitAt(pit, x, under) {
    if (x < pit.a - pit.ba || x > pit.b + pit.bb) return null;
    if (x < pit.a) return under + (pit.ya - under) * smoothstep((x - (pit.a - pit.ba)) / pit.ba);
    if (x > pit.b) return pit.yb + (under - pit.yb) * smoothstep((x - pit.b) / pit.bb);
    if (x <= pit.x0) {
      const t = Math.max(0, (x - (pit.x0 - pit.up)) / pit.up);
      return pit.ya + pit.kh * Math.pow(t, 1.6);
    }
    if (x < pit.x1) {
      // The basin: steep walls, flat floor well under the hazard surface.
      const floor = Math.min(pit.ya, pit.yb) - pit.depth;
      const e = Math.min(x - pit.x0, pit.x1 - x);
      const wall = Math.min(1, e / 0.9);
      const top = x - pit.x0 < pit.x1 - x ? pit.ya : pit.yb;
      return top + (floor - top) * wall;
    }
    return pit.yb;
  }

  /** The stretches kickers must stay out of. */
  const busy = [
    ...pits.map((q) => [q.a - q.ba, q.b + q.bb]),
    ...additive.map((f) => {
      if (f.type === "climb") return [f.x - f.h / Math.min(1.2, maxUp) - 8, f.x + f.top + 6];
      const r = f.type === "hill" ? f.w / 2 : f.type === "bumps" ? f.len / 2 : 16;
      return [f.x - r - 6, f.x + r + 6];
    }),
  ];
  const isBusy = (x) => busy.some(([a, b]) => x > a && x < b);

  // Launch kickers. These are what put the car in the air, so they are
  // asymmetric on purpose: a short, steep run-up to the lip and almost nothing
  // on the far side, so you leave the ground instead of being set back down.
  // A kicker is only stamped where the hill underneath is not already climbing
  // hard — stacking one on a steep face is what makes a car simply stop.
  const rampRnd = mulberry32(seed ^ 0x9e3779b9);
  const rampChance = p.ramp * (level ? level.rampScale : 1);
  const ramps = [];
  for (let x = 70; x < Math.min(40000, finishX - 30); x += 80 + rampRnd() * 120) {
    if (rampRnd() >= rampChance) continue;
    const up = 4.5 + rampRnd() * 3.5;
    let h = 2.1 + rampRnd() * 2.3;
    if (isBusy(x)) continue;
    // Ease the first couple of hundred metres in: the opening stretch should
    // teach the throttle, not launch a stock car into a hillside.
    h *= 0.45 + 0.55 * Math.min(1, x / 260);
    // Flatten the kicker into whatever the hill is already doing.
    const under = (baseAt(x) - baseAt(x - up)) / up;
    if (under > 0.75) continue;
    if (under > 0.2) h *= 1 - (under - 0.2) / 0.55;
    if (h < 0.6) continue;
    // On a level a kicker must be takeable from a standing start after a
    // retry, so it is lower and never steeper than about 45 degrees.
    if (level) {
      // ...and never throws the car into a hillside or off a cliff: skip it
      // when the landing zone climbs or falls away steeply.
      const fall = baseAt(x + 25) - baseAt(x);
      if (fall > 25 * 0.25 || fall < -25 * 0.3 || under < -0.3) continue;
      h *= 0.62 + 0.25 * (level.index / 5);
      ramps.push({ x, up: Math.max(up, h * 1.7), down: 1.6 + rampRnd() * 2.2, h });
      continue;
    }
    ramps.push({ x, up, down: 1.6 + rampRnd() * 2.2, h });
  }

  /** Height a kicker adds at x: smoothstep up to the lip, quick fall after. */
  function rampAt(r, x) {
    const d = x - r.x;
    if (d <= -r.up || d >= r.down) return 0;
    if (d <= 0) return r.h * smoothstep(1 + d / r.up);
    return r.h * (1 - smoothstep(d / r.down));
  }

  function courseAt(x) {
    let h = baseAt(x);
    for (const r of ramps) h += rampAt(r, x);
    for (const q of pits) {
      const v = pitAt(q, x, h);
      if (v != null) return v;
    }
    return h;
  }

  const finishY = level ? courseAt(finishX) : 0;

  /** Raw height (metres, y-up) at any x — the single source of truth. */
  function heightAt(x) {
    if (x <= 0) return 0;
    let h;
    if (x > finishX) {
      // Past the finish the road eases flat, so a car can roll to a stop.
      const t = smoothstep(Math.min(1, (x - finishX) / 14));
      h = x - finishX > 14 ? finishY : courseAt(x) + (finishY - courseAt(x)) * t;
    } else {
      h = courseAt(x);
    }
    // Ease out of the flat start line instead of stepping off a cliff.
    if (x < FLAT_END) h *= smoothstep(Math.max(0, x - 8) / (FLAT_END - 8));
    return h;
  }

  /** The hazard under x, if x is over a pit's gap. */
  function hazardAt(x) {
    for (const q of pits) if (x > q.x0 && x < q.x1) return q;
    return null;
  }

  const chunks = new Map(); // index -> Float64Array of heights

  function chunkAt(ci) {
    let c = chunks.get(ci);
    if (!c) {
      c = new Float64Array(CHUNK + 1);
      for (let i = 0; i <= CHUNK; i++) c[i] = heightAt((ci * CHUNK + i) * STEP);
      chunks.set(ci, c);
    }
    return c;
  }

  /** Sampled polyline height: what the wheels actually roll on. */
  function groundY(x) {
    const s = x / STEP;
    const i = Math.floor(s);
    const t = s - i;
    const a = sample(i);
    const b = sample(i + 1);
    return a + (b - a) * t;
  }

  function sample(i) {
    const ci = Math.floor(i / CHUNK);
    return chunkAt(ci)[i - ci * CHUNK];
  }

  /** Surface slope (dy/dx) at x, from the same polyline the wheels touch. */
  function slopeAt(x) {
    const i = Math.floor(x / STEP);
    return (sample(i + 1) - sample(i)) / STEP;
  }

  return {
    stage,
    seed,
    level,
    finishX,
    pits,
    hazardAt,
    STEP,
    heightAt,
    groundY,
    slopeAt,
    sample,
    /** Polyline vertices covering [x0, x1] — what the renderer draws. */
    slice(x0, x1) {
      const i0 = Math.floor(x0 / STEP) - 1;
      const i1 = Math.ceil(x1 / STEP) + 1;
      const pts = [];
      for (let i = i0; i <= i1; i++) pts.push({ x: i * STEP, y: sample(i) });
      return pts;
    },
    /** Drop chunks the car can no longer reach. */
    prune(x) {
      const keep = Math.floor(x / STEP / CHUNK) - KEEP_BEHIND;
      for (const ci of chunks.keys()) if (ci < keep) chunks.delete(ci);
    },
  };
}

/**
 * Pickups: coins follow the ground in little arcs over crests, fuel cans are
 * spaced so a full tank just about reaches the next one when driven well.
 * On a level they stop at the finish line, stay out of the pits, and every
 * pit gets a coin arc over its gap as a reward for clearing it cleanly.
 */
export function createPickups(terrain, seed) {
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const level = terrain.level;
  const items = [];
  const limit = level ? terrain.finishX - 8 : Infinity;
  const fuelGap = level ? level.fuelGap : 150;
  let nextCoinX = 40;
  let nextFuelX = level ? Math.min(210, fuelGap) : 210;
  let built = 0;
  let total = 0;

  const nearPit = (x, pad) => terrain.pits.some((q) => x > q.x0 - q.up - pad && x < q.x1 + pad);

  function coin(x, y) {
    items.push({ kind: "coin", x, y, taken: false, bob: rnd() * 6.28 });
    total++;
  }

  function buildTo(x) {
    x = Math.min(x, limit);
    while (nextCoinX < x) {
      const n = 3 + Math.floor(rnd() * 5);
      const gap = 1.5;
      const arc = rnd() < 0.45;
      const bx = nextCoinX;
      if (!nearPit(bx, 4) && !nearPit(bx + n * gap, 4) && bx + n * gap < limit) {
        for (let i = 0; i < n; i++) {
          const cx = bx + i * gap;
          const lift = arc ? 1.05 + Math.sin((i / (n - 1 || 1)) * Math.PI) * 1.7 : 1.05;
          coin(cx, terrain.groundY(cx) + lift);
        }
      }
      nextCoinX = bx + n * gap + 22 + rnd() * 46;
    }
    while (nextFuelX < x) {
      let fx = nextFuelX;
      // Slide a can that lands in a pit's stretch to the landing side.
      for (const q of terrain.pits) if (fx > q.x0 - q.up - 3 && fx < q.x1 + 3) fx = q.x1 + 8;
      if (fx < limit) items.push({ kind: "fuel", x: fx, y: terrain.groundY(fx) + 1.25, taken: false, bob: rnd() * 6.28 });
      nextFuelX = fx + (level ? fuelGap * (0.9 + rnd() * 0.2) : 150 + rnd() * 110);
    }
    built = x;
  }

  // Coin arcs over every pit, following a rough jump trajectory.
  for (const q of terrain.pits) {
    const n = Math.max(3, Math.round((q.x1 - q.x0) / 1.4));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      coin(q.x0 + (q.x1 - q.x0) * f, q.ya + q.kh + 1.1 + Math.sin(f * Math.PI) * 1.3);
    }
  }

  buildTo(level ? limit : 400);
  items.sort((a, b) => a.x - b.x);

  return {
    items,
    /** Coins on the whole course — only meaningful on a level. */
    get total() {
      return total;
    },
    ensure(x) {
      if (!level && x + 260 > built) buildTo(x + 300);
    },
    /** Forget pickups far behind so the array cannot grow without bound. */
    prune(x) {
      if (level) return;
      let cut = 0;
      while (cut < items.length && items[cut].x < x - 60) cut++;
      if (cut > 64) items.splice(0, cut);
    },
  };
}
