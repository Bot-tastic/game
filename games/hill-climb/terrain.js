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
 * a fresh landscape every attempt.
 */
export function createTerrain(stage, seed = (Math.random() * 1e9) | 0) {
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
  /** The hills alone, before any kicker is stamped on top. */
  function baseAt(x) {
    if (x <= 0) return 0;
    let h = 0;
    for (const o of octaves) h += Math.sin(x / o.wave + o.phase) * o.amp;
    h += Math.sin(x / drift.wave + drift.phase) * drift.amp;
    // Difficulty ramps with distance: amplitude grows, capped so it stays
    // driveable rather than turning into a wall.
    return h * (1 + Math.min(x / 2000, 1.2));
  }

  // Launch kickers. These are what put the car in the air, so they are
  // asymmetric on purpose: a short, steep run-up to the lip and almost nothing
  // on the far side, so you leave the ground instead of being set back down.
  // A kicker is only stamped where the hill underneath is not already climbing
  // hard — stacking one on a steep face is what makes a car simply stop.
  const rampRnd = mulberry32(seed ^ 0x9e3779b9);
  const ramps = [];
  for (let x = 70; x < 40000; x += 80 + rampRnd() * 120) {
    if (rampRnd() >= p.ramp) continue;
    const up = 4.5 + rampRnd() * 3.5;
    let h = 2.1 + rampRnd() * 2.3;
    // Ease the first couple of hundred metres in: the opening stretch should
    // teach the throttle, not launch a stock car into a hillside.
    h *= 0.45 + 0.55 * Math.min(1, x / 260);
    // Flatten the kicker into whatever the hill is already doing.
    const under = (baseAt(x) - baseAt(x - up)) / up;
    if (under > 0.75) continue;
    if (under > 0.2) h *= 1 - (under - 0.2) / 0.55;
    if (h < 0.6) continue;
    ramps.push({ x, up, down: 1.6 + rampRnd() * 2.2, h });
  }

  /** Height a kicker adds at x: smoothstep up to the lip, quick fall after. */
  function rampAt(r, x) {
    const d = x - r.x;
    if (d <= -r.up || d >= r.down) return 0;
    if (d <= 0) return r.h * smoothstep(1 + d / r.up);
    return r.h * (1 - smoothstep(d / r.down));
  }

  /** Raw height (metres, y-up) at any x — the single source of truth. */
  function heightAt(x) {
    if (x <= 0) return 0;
    let h = baseAt(x);
    for (const r of ramps) h += rampAt(r, x);
    // Ease out of the flat start line instead of stepping off a cliff.
    if (x < FLAT_END) h *= smoothstep(Math.max(0, x - 8) / (FLAT_END - 8));
    return h;
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
 */
export function createPickups(terrain, seed) {
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const items = [];
  let nextCoinX = 40;
  let nextFuelX = 210;
  let built = 0;

  function buildTo(x) {
    while (nextCoinX < x) {
      const n = 3 + Math.floor(rnd() * 5);
      const gap = 1.5;
      const arc = rnd() < 0.45;
      const bx = nextCoinX;
      for (let i = 0; i < n; i++) {
        const cx = bx + i * gap;
        const lift = arc ? 1.05 + Math.sin((i / (n - 1 || 1)) * Math.PI) * 1.7 : 1.05;
        items.push({ kind: "coin", x: cx, y: terrain.groundY(cx) + lift, taken: false, bob: rnd() * 6.28 });
      }
      nextCoinX = bx + n * gap + 22 + rnd() * 46;
    }
    while (nextFuelX < x) {
      items.push({ kind: "fuel", x: nextFuelX, y: terrain.groundY(nextFuelX) + 1.25, taken: false, bob: rnd() * 6.28 });
      nextFuelX += 150 + rnd() * 110;
    }
    built = x;
  }

  buildTo(400);

  return {
    items,
    ensure(x) {
      if (x + 260 > built) buildTo(x + 300);
    },
    /** Forget pickups far behind so the array cannot grow without bound. */
    prune(x) {
      let cut = 0;
      while (cut < items.length && items[cut].x < x - 60) cut++;
      if (cut > 64) items.splice(0, cut);
    },
  };
}
