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
const FLAT_END = 26; // metres of flat tarmac at the start line
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
  // Occasional launch ramps: a raised cosine bump every so many metres.
  const rampRnd = mulberry32(seed ^ 0x9e3779b9);
  const ramps = [];
  for (let x = 120; x < 40000; x += 90 + rampRnd() * 150) {
    if (rampRnd() < p.ramp) ramps.push({ x, w: 9 + rampRnd() * 7, h: 1.6 + rampRnd() * 2.4 });
  }

  /** Raw height (metres, y-up) at any x — the single source of truth. */
  function heightAt(x) {
    if (x <= 0) return 0;
    let h = 0;
    for (const o of octaves) h += Math.sin(x / o.wave + o.phase) * o.amp;
    h += Math.sin(x / drift.wave + drift.phase) * drift.amp;
    // Difficulty ramps with distance: amplitude grows, capped so it stays
    // driveable rather than turning into a wall.
    h *= 1 + Math.min(x / 2600, 1.1);
    for (const r of ramps) {
      const d = Math.abs(x - r.x);
      if (d < r.w) h += r.h * 0.5 * (1 + Math.cos((d / r.w) * Math.PI));
    }
    // Ease out of the flat start line instead of stepping off a cliff.
    if (x < FLAT_END) h *= smoothstep(Math.max(0, x - 6) / (FLAT_END - 6));
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
