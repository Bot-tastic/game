// levels.js — level definitions + deterministic seeded level generation for
// Geo Dash. No live browser is available to hand-tune pixel-perfect levels,
// so every level is built procedurally from a small numeric difficulty
// profile + a fixed seed (same mulberry32 PRNG pattern as demolition-run's
// world.js), which keeps every run of a given level byte-identical and lets
// fairness be reasoned about in code instead of by playtesting.
//
// World units: everything (positions, sizes, speeds) is expressed in a
// resolution-independent "world unit" space, WORLD_HEIGHT tall. main.js
// scales world units to CSS pixels by a single factor S = canvasHeight /
// WORLD_HEIGHT, so physics constants never need to change per device.

export const WORLD_HEIGHT = 400;
export const GROUND_Y = 320; // baseline floor for cube/robot/ufo segments
export const BLOCK_HEIGHT = 40;

// Ground modes (cube/robot/ufo) all walk a single floor height-map + a
// separate hazard (spike) list. Ship is the only free-flight mode, using a
// floor/ceiling tunnel instead. This mirrors real Geometry Dash, where cube/
// ball/robot/ufo/wave are all "ground" modes and ship is the odd one out.
export const GROUND_MODES = ["cube", "robot", "ufo"];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Every gap/step in a ground segment must stay within what the *shortest*
// jump among cube/robot/ufo can clear, since a segment's mode is fixed at
// generation time but the fairness math is shared — keeping these caps
// mode-agnostic means we never have to special-case which mode is active.
const MAX_GAP_WIDTH = 135; // world units; keeps real reaction-time margin under every level's jump-arc distance
const MIN_GAP_WIDTH = 60;

export const LEVEL_DEFS = [
  { id: 1, name: "First Steps", difficulty: "Easy", seed: 101, length: 9200, speed: 260, color: "#4fd1c5", density: 0.3, gapChance: 0.2, modePlan: [{ mode: "cube", at: 0 }] },
  { id: 2, name: "Sky Cruiser", difficulty: "Easy", seed: 202, length: 10500, speed: 280, color: "#5b8cff", density: 0.34, gapChance: 0.22, tunnelMin: 90, modePlan: [{ mode: "cube", at: 0 }, { mode: "ship", at: 0.4 }, { mode: "cube", at: 0.75 }] },
  { id: 3, name: "Block Party", difficulty: "Normal", seed: 303, length: 11500, speed: 300, color: "#ffb347", density: 0.44, gapChance: 0.25, modePlan: [{ mode: "cube", at: 0 }] },
  { id: 4, name: "Turbulence", difficulty: "Normal", seed: 404, length: 12800, speed: 320, color: "#7a5cff", density: 0.46, gapChance: 0.26, tunnelMin: 80, modePlan: [{ mode: "cube", at: 0 }, { mode: "ship", at: 0.3 }, { mode: "cube", at: 0.6 }, { mode: "ship", at: 0.85 }] },
  { id: 5, name: "Iron Legs", difficulty: "Hard", seed: 505, length: 13500, speed: 340, color: "#ff5d73", density: 0.52, gapChance: 0.28, modePlan: [{ mode: "robot", at: 0 }] },
  { id: 6, name: "Hover Zone", difficulty: "Hard", seed: 606, length: 14200, speed: 360, color: "#3fd68a", density: 0.46, gapChance: 0.28, modePlan: [{ mode: "ufo", at: 0 }] },
  { id: 7, name: "Quad Shift", difficulty: "Hard", seed: 707, length: 15500, speed: 380, color: "#ffd23f", density: 0.56, gapChance: 0.3, tunnelMin: 75, modePlan: [{ mode: "cube", at: 0 }, { mode: "ship", at: 0.2 }, { mode: "robot", at: 0.45 }, { mode: "ufo", at: 0.7 }, { mode: "cube", at: 0.9 }] },
  { id: 8, name: "Spike Storm", difficulty: "Harder", seed: 808, length: 17000, speed: 420, color: "#ff7a1a", density: 0.64, gapChance: 0.32, tunnelMin: 70, modePlan: [{ mode: "cube", at: 0 }, { mode: "robot", at: 0.25 }, { mode: "ship", at: 0.5 }, { mode: "ufo", at: 0.75 }] },
  { id: 9, name: "Chaos Theory", difficulty: "Insane", seed: 909, length: 19500, speed: 460, color: "#ff3fa4", density: 0.72, gapChance: 0.34, tunnelMin: 65, modePlan: [{ mode: "cube", at: 0 }, { mode: "ufo", at: 0.15 }, { mode: "ship", at: 0.35 }, { mode: "robot", at: 0.55 }, { mode: "ship", at: 0.75 }, { mode: "cube", at: 0.9 }] },
  { id: 10, name: "Demon Core", difficulty: "Demon", seed: 1010, length: 22000, speed: 520, color: "#ff2d4d", density: 0.7, gapChance: 0.32, tunnelMin: 60, modePlan: [{ mode: "cube", at: 0 }, { mode: "ship", at: 0.15 }, { mode: "robot", at: 0.3 }, { mode: "ufo", at: 0.45 }, { mode: "ship", at: 0.6 }, { mode: "cube", at: 0.72 }, { mode: "robot", at: 0.85 }] },
];

function generateGroundSegment(rng, seg, def, groundSegments, hazards) {
  let cursor = seg.start;
  // Tighter than a first pass: real Geometry Dash rarely gives more than a
  // beat of flat runway between obstacles, even on easy levels.
  const reactionTime = lerp(1.1, 0.5, def.density);
  const marginEnd = 220;

  while (cursor < seg.end - marginEnd) {
    const flatLen = Math.round(def.speed * (reactionTime + rng() * 0.35));
    const flatEnd = Math.min(cursor + flatLen, seg.end - marginEnd);
    groundSegments.push({ x0: cursor, x1: flatEnd, floorY: GROUND_Y });
    cursor = flatEnd;
    if (cursor >= seg.end - marginEnd) break;

    const roll = rng();
    if (roll < def.gapChance) {
      const w = MIN_GAP_WIDTH + rng() * (MAX_GAP_WIDTH - MIN_GAP_WIDTH);
      groundSegments.push({ x0: cursor, x1: cursor + w, floorY: null });
      cursor += w;
    } else if (roll < def.gapChance + 0.3) {
      // Plain raised platform — floor.js's landing rule auto-mounts these
      // (no jump required), so it must never carry a hazard: a standing
      // player's own hitbox already occupies the space directly above the
      // platform, which would make any hazard there unavoidable rather than
      // something to jump over.
      const w = 70 + rng() * 50;
      groundSegments.push({ x0: cursor, x1: cursor + w, floorY: GROUND_Y - BLOCK_HEIGHT });
      cursor += w;
    } else if (roll < def.gapChance + 0.42) {
      // Tall spike on flat ground — a taller, single-hazard variant of the
      // spike row below for extra visual/timing variety at higher density.
      // Height 46 stays safely under every mode's jump apex (cube ~104,
      // robot/ufo ~77) with real margin, unlike a block-top spike would.
      groundSegments.push({ x0: cursor, x1: cursor + 30, floorY: GROUND_Y });
      hazards.push({ x0: cursor + 2, x1: cursor + 28, y0: GROUND_Y - 46, y1: GROUND_Y });
      cursor += 30;
    } else {
      const maxRow = 1 + Math.floor(def.density * 4);
      const rowCount = 1 + Math.floor(rng() * Math.min(4, maxRow));
      const rowWidth = (rowCount - 1) * 30 + 44; // must cover every hazard in the row, not just the first
      groundSegments.push({ x0: cursor, x1: cursor + rowWidth, floorY: GROUND_Y });
      for (let k = 0; k < rowCount; k++) {
        const sx = cursor + k * 30;
        hazards.push({ x0: sx, x1: sx + 26, y0: GROUND_Y - 30, y1: GROUND_Y });
      }
      cursor += rowWidth;
    }
  }

  if (cursor < seg.end) groundSegments.push({ x0: cursor, x1: seg.end, floorY: GROUND_Y });
}

function generateTunnelSegment(rng, seg, def, tunnelKeyframes) {
  const tunnelMin = def.tunnelMin || 90;
  let x = seg.start;
  let mid = 200;
  let halfHeight = lerp(140, tunnelMin, def.density);
  tunnelKeyframes.push({ x, floorY: mid + halfHeight, ceilY: mid - halfHeight });

  while (x < seg.end) {
    x = Math.min(x + 90 + rng() * 70, seg.end);
    mid = clamp(mid + (rng() * 2 - 1) * 40, 140, 260);
    halfHeight = clamp(halfHeight + (rng() * 2 - 1) * 15, tunnelMin, 110);
    tunnelKeyframes.push({ x, floorY: mid + halfHeight, ceilY: mid - halfHeight });
  }
}

/**
 * Build the full obstacle/tunnel/portal layout for a level def. Returns
 * { ...def, groundSegments, hazards, tunnelKeyframes, portals }.
 *   groundSegments: sorted, contiguous {x0,x1,floorY} covering every
 *     ground-mode range (floorY === null means "pit", no floor collision).
 *   hazards: {x0,x1,y0,y1} instant-death rects (spikes), ground ranges only.
 *   tunnelKeyframes: sorted {x,floorY,ceilY} covering every ship range,
 *     linearly interpolated between consecutive points by the caller.
 *   portals: {x, mode} markers where the active mode switches (excludes the
 *     level's starting mode at x=0, which needs no marker).
 */
export function generateLevel(def) {
  const rng = mulberry32(def.seed);
  const groundSegments = [];
  const hazards = [];
  const tunnelKeyframes = [];
  const portals = [];

  const boundaries = def.modePlan.map((m, i) => ({
    mode: m.mode,
    start: Math.round(m.at * def.length),
    end: i + 1 < def.modePlan.length ? Math.round(def.modePlan[i + 1].at * def.length) : def.length,
  }));

  boundaries.forEach((seg, i) => {
    if (i > 0) portals.push({ x: seg.start, mode: seg.mode });
    if (seg.mode === "ship") {
      generateTunnelSegment(rng, seg, def, tunnelKeyframes);
    } else {
      generateGroundSegment(rng, seg, def, groundSegments, hazards);
    }
  });

  return { ...def, groundSegments, hazards, tunnelKeyframes, portals };
}

/** Floor height (world Y) at world-x for ground modes, or null if it's a pit. */
export function floorAt(level, x) {
  const segs = level.groundSegments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (x >= s.x0 && x < s.x1) return s.floorY;
  }
  return GROUND_Y;
}

/** {floorY, ceilY} at world-x for the ship tunnel, linearly interpolated. */
export function tunnelAt(level, x) {
  const kf = level.tunnelKeyframes;
  if (kf.length === 0) return { floorY: GROUND_Y, ceilY: 40 };
  if (x <= kf[0].x) return kf[0];
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i];
    const b = kf[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return { floorY: lerp(a.floorY, b.floorY, t), ceilY: lerp(a.ceilY, b.ceilY, t) };
    }
  }
  return kf[kf.length - 1];
}

/** Mode active at world-x, derived from the level's modePlan fractions. */
export function modeAt(level, x) {
  let mode = level.modePlan[0].mode;
  for (const step of level.modePlan) {
    if (x >= step.at * level.length) mode = step.mode;
  }
  return mode;
}

export function bestScoreKey(levelId) {
  return `game-tastic:geo-dash:best:${levelId}`;
}
