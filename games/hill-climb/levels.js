// levels.js — the campaign: six hand-named levels per world, 48 in all.
//
// A level is a fixed stretch of one world's terrain with a finish line. Its
// shape is generated, but from a fixed seed, so "Duck Pond" is the same hill
// for every player on every attempt. Difficulty climbs through the whole
// campaign (steeper, longer, wider pits, rarer fuel) and is balanced so the
// later worlds cannot be finished without upgrades and, eventually, a better
// car — tools/verify-levels.mjs checks both directions.
//
// Features a level can stamp onto its terrain (see terrain.js):
//   pit    a kicker, then a gap filled with the world's hazard — clear it or die
//   hill   a tall bump that needs momentum
//   bumps  a washboard stretch that unsettles the suspension
//   drop   a ledge the ground falls away from
//   climb  a long ramp at the level's steepest allowed slope up to a plateau —
//          the gate a car without enough torque and grip cannot get past

import { STAGES } from "./stages.js";
import { mulberry32 } from "./terrain.js";

const NAMES = {
  countryside: ["Green Mile", "Hay Bale Hop", "Duck Pond", "Windmill Ridge", "Tractor Tracks", "Harvest Run"],
  desert: ["Dune Buggy", "Oasis Leap", "Sandstorm", "Scorpion Pass", "Mirage", "Sun Bleached"],
  forest: ["Pine Trail", "Mossy Steps", "Firefly Hollow", "Bog Jumper", "Timber Line", "Owl's Watch"],
  arctic: ["First Frost", "Thin Ice", "Polar Drift", "Glacier Gap", "Whiteout", "Aurora"],
  highway: ["Night Shift", "Overpass", "Neon Mile", "Roadworks", "Rush Hour", "Last Exit"],
  canyon: ["Red Rock", "Dry Riverbed", "Mesa Hop", "Rapids", "Devil's Spine", "Canyon Run"],
  volcano: ["Ash Road", "Ember Fields", "Magma Moat", "Obsidian", "Eruption", "The Caldera"],
  moon: ["Small Step", "Crater Hop", "Low G", "Dark Side", "Sea of Rains", "Giant Leap"],
};

// Per slot inside a world: how many of each feature the level carries.
const PLAN = [
  { pit: 0, hill: 1, bumps: 0, drop: 0 },
  { pit: 1, hill: 1, bumps: 0, drop: 0 },
  { pit: 1, hill: 1, bumps: 1, drop: 1 },
  { pit: 2, hill: 1, bumps: 1, drop: 1 },
  { pit: 2, hill: 2, bumps: 1, drop: 1 },
  { pit: 3, hill: 2, bumps: 2, drop: 1 },
];

export const LEVELS_PER_WORLD = 6;

/**
 * How hard a level is, 0 (1-1) to 1 (8-6). Every knob below reads this rather
 * than the world or slot alone, so difficulty climbs smoothly through the whole
 * campaign instead of resetting at the start of each world. The curve bends
 * upward: the first world is a tutorial, the last two need a serious car.
 */
export const difficultyOf = (w, i) => Math.pow((w * LEVELS_PER_WORLD + i) / (STAGES.length * LEVELS_PER_WORLD - 1), 0.9);

function buildLevel(world, w, i) {
  const rnd = mulberry32(0x5eed + w * 977 + i * 131);
  const l = i / (LEVELS_PER_WORLD - 1); // 0..1 inside the world
  const D = difficultyOf(w, i);
  const plan = PLAN[i];
  const baseLength = Math.round((430 + 70 * i + 150 * w + 250 * D) / 10) * 10;
  const lowG = world.gravity < 10;

  // Feature list, spread over evenly sized slots so nothing overlaps.
  const kinds = [];
  for (const k of ["pit", "hill", "bumps", "drop", "climb"]) {
    let n = k === "climb" ? Math.floor(1 + 3 * D) : plan[k];
    if (k === "pit" && w >= 3 && i >= 1) n += 1;
    if (k === "hill" && w >= 2) n += 1;
    if (k === "hill" && w >= 5) n += 1;
    if (k === "pit" && w >= 6) n += 1;
    for (let j = 0; j < n; j++) kinds.push(k);
  }
  // Shuffle deterministically, but never open on a pit.
  for (let a = kinds.length - 1; a > 0; a--) {
    const b = Math.floor(rnd() * (a + 1));
    [kinds[a], kinds[b]] = [kinds[b], kinds[a]];
  }
  if (kinds[0] === "pit") {
    const alt = kinds.findIndex((k) => k !== "pit");
    if (alt > 0) [kinds[0], kinds[alt]] = [kinds[alt], kinds[0]];
  }

  const start = 110;
  const end = baseLength - 70;
  const slot = kinds.length ? (end - start) / kinds.length : 0;
  const features = kinds.map((type, j) => {
    const x = start + slot * j + slot * (0.35 + rnd() * 0.3);
    switch (type) {
      case "pit": {
        const wd = (3 + 6 * D + 9 * D * D * D + rnd() * 1.2) * (lowG ? 1.3 : 1);
        return { type, x, w: wd, kh: 1.3 + 1.1 * D, slot };
      }
      case "hill":
        return { type, x, h: 3 + 11 * D + rnd() * 2, w: 44 + 26 * D + rnd() * 14 };
      case "bumps":
        return { type, x, len: 26 + rnd() * 18, a: 0.22 + 0.35 * D };
      case "climb":
        // Momentum carries a car further up a hill under low gravity, so the
        // Moon's climbs are taller to ask the same of the car.
        return { type, x, h: (9 + 22 * D + rnd() * 3) * (lowG ? 1.8 : 1), top: 22 + rnd() * 10 };
      default:
        return { type, x, d: 1.8 + 3.5 * D + rnd() * 0.6 };
    }
  });

  // Push features apart so no two stretches overlap; the course grows to fit.
  let cursor = start - 40;
  for (const f of features) {
    const [before, after] = extent(f);
    f.x = Math.max(f.x, cursor + before);
    cursor = f.x + after;
  }
  const length = Math.max(baseLength, Math.round((cursor + 70) / 10) * 10);

  return {
    id: `${world.id}-${i + 1}`,
    world: world.id,
    worldIndex: w,
    index: i,
    number: `${w + 1}-${i + 1}`,
    name: NAMES[world.id][i],
    difficulty: D,
    length,
    seed: (0xc0ffee ^ (w * 7919 + i * 104729)) >>> 0,
    ampScale: 0.66 + 0.5 * D,
    rampScale: 0.55 + 0.45 * l,
    // Steepest sustained climb the ground may hold. This is the gate a stock
    // car cannot talk its way past: too little torque and grip and it simply
    // rolls back down.
    maxUp: Math.min(1.2, (0.4 + 1.1 * D) * (0.75 + 0.25 * world.grip)),
    fuelGap: 170 + 180 * D + 560 * D * D * D,
    features,
    // Three-star time: brisk for a car that is properly upgraded for here.
    par: Math.round(length / parSpeed(world, D)),
    coinValue: coinValueOf(w),
    reward: Math.round((60 + (w * LEVELS_PER_WORLD + i) * 20) / 10) * 10,
  };
}

/** Coins are worth more in later worlds — the cars you need there cost more. */
export const coinValueOf = (w) => 10 + 4 * w;

/** Metres a feature needs before and after its x, including blends. */
function extent(f) {
  switch (f.type) {
    case "pit":
      return [34 + 40 + 8, f.w + 24 + 40 + 4];
    case "hill":
      return [f.w / 2 + 8, f.w / 2 + 8];
    case "bumps":
      return [f.len / 2 + 6, f.len / 2 + 6];
    case "climb":
      // Worst case: the ramp at the gentlest slope a level uses, then the fall.
      return [f.h / 0.36 + 10, f.top + f.h / 0.5 + 10];
    default:
      return [22, 12];
  }
}

function parSpeed(world, D) {
  const base = { countryside: 8.7, desert: 8.8, forest: 8.2, arctic: 8.4, highway: 11, canyon: 10.4, volcano: 10, moon: 8.1 };
  return (base[world.id] || 7.5) * (1 + 0.5 * D);
}

export const LEVELS = STAGES.flatMap((world, w) =>
  Array.from({ length: LEVELS_PER_WORLD }, (_, i) => buildLevel(world, w, i))
);

export const getLevel = (id) => LEVELS.find((l) => l.id === id) || null;
export const levelsOf = (worldId) => LEVELS.filter((l) => l.world === worldId);
export const levelAfter = (lvl) => LEVELS[LEVELS.indexOf(lvl) + 1] || null;
